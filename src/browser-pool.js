const puppeteer = require('puppeteer');

class BrowserPool {
  constructor(options) {
    this.maxBrowsers = options.maxBrowsers || 5;
    this.maxPagesPerBrowser = options.maxPagesPerBrowser || 10;
    this.queueTimeout = options.queueTimeout || 30000;
    this.executablePath = options.executablePath;
    this.isInDocker = options.isInDocker || false;

    this.browsers = []; // Array of { browser, pages: [] }
    this.queue = []; // Array of { resolve, reject, timeoutHandle }
    this.processing = false;

    console.log(`BrowserPool initialized: maxBrowsers=${this.maxBrowsers}, maxPagesPerBrowser=${this.maxPagesPerBrowser}, queueTimeout=${this.queueTimeout}ms`);
  }

  async initialize() {
    console.log('Initializing browser pool...');
    for (let i = 0; i < this.maxBrowsers; i++) {
      await this.launchBrowser();
    }
    console.log(`Browser pool initialized with ${this.browsers.length} browsers`);
  }

  async launchBrowser() {
    try {
      const browser = await puppeteer.launch({
        executablePath: this.executablePath,
        args: this.isInDocker ? ['--no-sandbox', '--disable-setuid-sandbox'] : [],
        headless: true,
      });

      this.browsers.push({ browser, pages: [] });
      console.log(`Launched browser ${this.browsers.length}/${this.maxBrowsers}`);
    } catch (error) {
      console.error('Failed to launch browser:', error);
      throw error;
    }
  }

  async acquirePage(options = {}) {
    const { signal } = options;
    return new Promise(async (resolve, reject) => {
      if (signal?.aborted) {
        return reject(new Error('Request aborted before acquiring page'));
      }

      const onAbort = () => {
        const timestamp = new Date().toISOString();
        const index = this.queue.findIndex(item => item.reject === reject);
        if (index !== -1) {
          this.queue.splice(index, 1);
          console.warn(`[${timestamp}] [ABORT] Request removed from queue due to abort signal.`);
          reject(new Error('Request aborted while in queue'));
        }
        clearTimeout(timeoutHandle);
      };

      const timeoutHandle = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        const timestamp = new Date().toISOString();
        const index = this.queue.findIndex(item => item.reject === reject);
        if (index !== -1) {
          this.queue.splice(index, 1);
        }
        console.warn(`[${timestamp}] [TIMEOUT] Queue timeout exceeded for acquirePage request.`);
        reject(new Error('Queue timeout exceeded'));
      }, this.queueTimeout);

      signal?.addEventListener('abort', onAbort, { once: true });

      this.queue.push({ resolve, reject, timeoutHandle, signal });
      console.log(`Queued acquirePage request. Queue length: ${this.queue.length}`);

      this.processQueue();
    });
  }

  async processQueue() {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;

    try {
      let availableBrowser = null;

      // Find a browser with available page slots
      for (const browserInfo of this.browsers) {
        if (browserInfo.pages.length < this.maxPagesPerBrowser) {
          // Check if browser is still alive
          if (browserInfo.browser.isConnected()) {
            availableBrowser = browserInfo;
            break;
          } else {
            console.warn('Found disconnected browser, removing from pool');
            await this.removeBrowser(browserInfo);
          }
        }
      }

      // If no available browser and we can launch more
      if (!availableBrowser && this.browsers.length < this.maxBrowsers) {
        console.log('No available browsers, launching new one...');
        await this.launchBrowser();
        // Find the newly launched browser
        availableBrowser = this.browsers[this.browsers.length - 1];
      }

      if (!availableBrowser) {
        console.log('No available browsers, waiting...');
        this.processing = false;
        return;
      }

      const timestamp = new Date().toISOString();
      const { resolve, reject, timeoutHandle } = this.queue.shift();
      clearTimeout(timeoutHandle);

      try {
        const page = await availableBrowser.browser.newPage();
        availableBrowser.pages.push(page);
        console.log(`[${timestamp}] [POOL] Acquired page from browser. Active pages: ${availableBrowser.pages.length}/${this.maxPagesPerBrowser}`);
        resolve(page);
      } catch (error) {
        console.error(`[${timestamp}] Failed to create new page:`, error);
        reject(error);
      }
    } finally {
      this.processing = false;
      // Process next in queue
      if (this.queue.length > 0) {
        setImmediate(() => this.processQueue());
      }
    }
  }

  async releasePage(page) {
    try {
      // Find the browser that contains this page
      for (const browserInfo of this.browsers) {
        const pageIndex = browserInfo.pages.indexOf(page);
        if (pageIndex !== -1) {
          browserInfo.pages.splice(pageIndex, 1);
          await page.close();
          const timestamp = new Date().toISOString();
          console.log(`[${timestamp}] [POOL] Released page. Active pages: ${browserInfo.pages.length}/${this.maxPagesPerBrowser}`);
          break;
        }
      }

      // Process queue for next request
      this.processQueue();
    } catch (error) {
      console.error('Error releasing page:', error);
    }
  }

  async removeBrowser(browserInfo) {
    try {
      // Close all pages
      for (const page of browserInfo.pages) {
        await page.close().catch(() => {});
      }
      // Close browser
      await browserInfo.browser.close().catch(() => {});
    } catch (error) {
      console.error('Error removing browser:', error);
    }

    // Remove from browsers array
    const index = this.browsers.indexOf(browserInfo);
    if (index !== -1) {
      this.browsers.splice(index, 1);
    }
  }

  async shutdown() {
    console.log('Shutting down browser pool...');
    for (const browserInfo of this.browsers) {
      await this.removeBrowser(browserInfo);
    }
    this.browsers = [];
    console.log('Browser pool shutdown complete');
  }

  getStats() {
    return {
      totalBrowsers: this.browsers.length,
      maxBrowsers: this.maxBrowsers,
      queueLength: this.queue.length,
      browsers: this.browsers.map((b, i) => ({
        index: i,
        activePages: b.pages.length,
        maxPages: this.maxPagesPerBrowser,
        isConnected: b.browser.isConnected()
      }))
    };
  }
}

module.exports = BrowserPool;