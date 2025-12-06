const express = require('express');
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

const app = express();
const PORT = 3000;
const resolvedExecutablePath = resolveExecutablePath();
console.log('Resolved Puppeteer executable:', resolvedExecutablePath);

app.use(express.json({ limit: '10mb' }));
app.use(cors());
app.use(helmet());

app.get('/', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Screenshot service is running' });
});

app.post('/render', async (req, res) => {
  try {
    const { html, url, width = 1280, height = 720, fullPage = false, delay = 0, type = 'png' } = req.body;

    // Validate input: exactly one of html or url
    if ((html && url) || (!html && !url)) {
      return res.status(400).json({ error: 'Invalid request body: exactly one of html or url is required' });
    }

    // Validate type
    if (type !== 'png' && type !== 'jpeg') {
      return res.status(400).json({ error: 'Invalid type: must be png or jpeg' });
    }

    const browser = await puppeteer.launch({
      headless: 'new',
      executablePath: isInDocker() ? '/usr/bin/chromium-browser' : process.env.PUPPETEER_EXECUTABLE_PATH,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    try {
      const page = await browser.newPage();

      if (!fullPage) {
        await page.setViewport({ width, height, deviceScaleFactor: 1 });
      }

      if (url) {
        await page.goto(url, { waitUntil: 'networkidle0' });
      } else {
        await page.setContent(html);
      }

      if (delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      const screenshotOptions = {
        type: type,
        fullPage,
      };

      if (type === 'png') {
        screenshotOptions.omitBackground = true;
      }

      const tempPath = `/tmp/${Date.now()}.${type}`;
      screenshotOptions.path = tempPath;
      await page.screenshot(screenshotOptions);

      // Send the file and let Express handle the streaming.
      // We will not delete the file immediately to ensure response integrity.
      res.sendFile(tempPath, (err) => {
        if (err) {
          console.error('Error sending file:', err);
          if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to send screenshot file.' });
          }
        } else {
          console.log(`Successfully sent ${tempPath} and will leave it for now.`);
          // In a production system, a separate cleanup process should manage these files.
          // For now, we will delete it after a short delay to ensure the response is sent.
          setTimeout(() => {
            fs.unlink(tempPath, (deleteErr) => {
              if (deleteErr) {
                console.error('Error deleting temp file:', deleteErr);
              }
            });
          }, 1000); // 1-second delay
        }
      });
    } finally {
      await browser.close();
    }
  } catch (error) {
    console.error('Error rendering screenshot:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

app.listen(PORT, () => {
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