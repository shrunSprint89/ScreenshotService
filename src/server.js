require('dotenv').config();
const express = require('express');
const { AbortController } = require('abort-controller');
const puppeteer = require('puppeteer');
const cors = require('cors');
const helmet = require('helmet');
const fs = require('fs');

const resolveExecutablePath = () => {
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (envPath && fs.existsSync(envPath)) {
    console.log('PUPPETEER_EXECUTABLE_PATH set and exists:', envPath);
    return envPath;
  }
  const fallback = '/usr/bin/chromium-browser';
  if (fs.existsSync(fallback)) {
    console.warn('PUPPETEER_EXECUTABLE_PATH invalid (' + envPath + '), falling back to ' + fallback);
    process.env.PUPPETEER_EXECUTABLE_PATH = fallback;
    return fallback;
  }
  console.error('No Chromium binary found. Tried env:', envPath, 'and fallback:', fallback);
  process.exit(1);
};

// Function to determine if we're running in a Docker container
const isInDocker = () => {
  try {
    // Check for the presence of .dockerenv file or specific cgroup entries
    return fs.existsSync('/.dockerenv') ||
            (fs.existsSync('/proc/self/cgroup') &&
             fs.readFileSync('/proc/self/cgroup', 'utf8').includes('docker'));
  } catch (err) {
    return false;
  }
};

async function cancellableDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      return reject(new Error('Delay aborted before starting.'));
    }
    const timeout = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timeout);
      reject(new Error('Delay aborted.'));
    }, { once: true });
  });
}

const app = express();
const PORT = process.env.PORT || 3000;
const resolvedExecutablePath = resolveExecutablePath();
console.log('Resolved Puppeteer executable:', resolvedExecutablePath);

// Timeout configurations (in milliseconds)
const LAUNCH_TIMEOUT = parseInt(process.env.PUPPETEER_LAUNCH_TIMEOUT) || 30000;
const NAVIGATION_TIMEOUT = parseInt(process.env.PUPPETEER_NAVIGATION_TIMEOUT) || 30000;
const RENDER_TIMEOUT = parseInt(process.env.PUPPETEER_RENDER_TIMEOUT) || 60000;
const GLOBAL_REQUEST_TIMEOUT = parseInt(process.env.PUPPETEER_GLOBAL_REQUEST_TIMEOUT) || 120000;

// Browser pool configurations
const MAX_BROWSERS = parseInt(process.env.MAX_BROWSERS) || 5;
const MAX_PAGES_PER_BROWSER = parseInt(process.env.MAX_PAGES_PER_BROWSER) || 10;
const QUEUE_TIMEOUT = parseInt(process.env.QUEUE_TIMEOUT) || 30000;

// Initialize browser pool
const BrowserPool = require('./browser-pool');
const browserPool = new BrowserPool({
  maxBrowsers: MAX_BROWSERS,
  maxPagesPerBrowser: MAX_PAGES_PER_BROWSER,
  queueTimeout: QUEUE_TIMEOUT,
  executablePath: resolvedExecutablePath,
  isInDocker: isInDocker()
});

// Initialize the browser pool
browserPool.initialize().catch(error => {
  console.error('Failed to initialize browser pool:', error);
  process.exit(1);
});

console.log('Timeout configurations:');
console.log('- Launch timeout:', LAUNCH_TIMEOUT + 'ms');
console.log('- Navigation timeout:', NAVIGATION_TIMEOUT + 'ms');
console.log('- Render timeout:', RENDER_TIMEOUT + 'ms');
console.log('- Global request timeout:', GLOBAL_REQUEST_TIMEOUT + 'ms');

console.log('Browser pool configurations:');
console.log('- Max browsers:', MAX_BROWSERS);
console.log('- Max pages per browser:', MAX_PAGES_PER_BROWSER);
console.log('- Queue timeout:', QUEUE_TIMEOUT + 'ms');

app.use(express.json({ limit: '10mb' }));
app.use(cors());
app.use(helmet());

app.get('/', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Screenshot service is running' });
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.post('/render', async (req, res) => {
  const { signal } = req;
  const abortController = new AbortController();

  const timeoutHandle = setTimeout(() => {
    const timestamp = new Date().toISOString();
    if (!res.headersSent) {
      console.error(`[${timestamp}] [TIMEOUT] Global request timeout fired for /render. Aborting operation.`);
      abortController.abort();
      res.status(504).json({ error: 'Request timeout exceeded' });
    } else {
      console.error(`[${timestamp}] [TIMEOUT] Global request timeout fired, but headers were already sent.`);
    }
  }, GLOBAL_REQUEST_TIMEOUT);

  let page;
  try {
    const { html, url, width = 1280, height = 720, fullPage = false, delay = 0, type = 'png' } = req.body;

    if ((html && url) || (!html && !url)) {
      return res.status(400).json({ error: 'Invalid request body: exactly one of html or url is required' });
    }
    if (type !== 'png' && type !== 'jpeg') {
      return res.status(400).json({ error: 'Invalid type: must be png or jpeg' });
    }

    page = await browserPool.acquirePage({ signal: abortController.signal });

    if (abortController.signal.aborted) throw new Error('Request aborted while acquiring page');

    await page.setViewport({ width, height, deviceScaleFactor: 1 });

    const navigationOptions = { waitUntil: 'networkidle0', timeout: NAVIGATION_TIMEOUT };
    if (url) {
      await page.goto(url, navigationOptions);
    } else {
      await page.setContent(html, navigationOptions);
    }

    if (delay > 0) {
      await cancellableDelay(delay, abortController.signal);
    }

    if (abortController.signal.aborted) throw new Error('Request aborted before screenshot');

    const tempPath = `/tmp/${Date.now()}.${type}`;
    const screenshotOptions = {
      path: tempPath,
      type,
      fullPage,
      omitBackground: type === 'png',
    };

    await Promise.race([
      page.screenshot(screenshotOptions),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Screenshot render timeout exceeded')), RENDER_TIMEOUT);
        abortController.signal.addEventListener('abort', () => reject(new Error('Request aborted during screenshot')));
      })
    ]);

    if (abortController.signal.aborted) {
      fs.unlink(tempPath, () => {}); // Clean up temp file on abort
      throw new Error('Request aborted after screenshot');
    }

    res.sendFile(tempPath, (err) => {
      clearTimeout(timeoutHandle);
      if (err) {
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to send screenshot file.' });
        }
      }
      fs.unlink(tempPath, () => {}); // Clean up after sending
    });

  } catch (error) {
    clearTimeout(timeoutHandle);
    if (!res.headersSent) {
      const status = (error.name === 'AbortError' || error.message.includes('timeout')) ? 504 : 500;
      const errorMessage = status === 504 ? 'Operation timeout exceeded' : 'Internal server error';
      console.error(`[${new Date().toISOString()}] Error rendering screenshot, sending ${status}:`, error.message);
      res.status(status).json({ error: errorMessage });
    } else {
      console.error(`[${new Date().toISOString()}] Error rendering screenshot, but headers already sent:`, error.message);
    }
  } finally {
    if (page) {
      await browserPool.releasePage(page);
    }
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Screenshot service v2 listening on port ${PORT}`);
  
  // Log startup diagnostic information
  console.log('Startup diagnostics:');
  console.log('- PUPPETEER_EXECUTABLE_PATH environment variable:', process.env.PUPPETEER_EXECUTABLE_PATH || 'Not set');
  
  // Determine and log the executable path that will be used
  if (isInDocker()) {
    console.log('- Detected Docker environment, will use executable path: /usr/bin/chromium-browser');
  } else if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    console.log('- Using custom executable path from environment variable:', process.env.PUPPETEER_EXECUTABLE_PATH);
  } else {
    console.log('- Using Puppeteer default executable path');
  }
});