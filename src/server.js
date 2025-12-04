const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');
const helmet = require('helmet');

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));
app.use(cors());
app.use(helmet());

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
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
        '--single-process'
      ]
    });

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
      await page.waitForTimeout(delay);
    }

    const buffer = await page.screenshot({
      type: type === 'jpeg' ? 'jpeg' : 'png',
      fullPage,
      omitBackground: true
    });

    await browser.close();

    res.type(type).send(buffer);
  } catch (error) {
    console.error('Error rendering screenshot:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(PORT, () => {
  console.log(`Screenshot service listening on port ${PORT}`);
});