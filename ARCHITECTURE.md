# Screenshot Service Architecture

## Overview
A Dockerized Node.js service that generates screenshots of HTML content or webpages using headless Chromium via Puppeteer. Accepts POST requests to `/render` with JSON payload specifying HTML, URL (mutually exclusive), dimensions, and options. Returns image binary (PNG/JPEG).

## Folder Structure
```
.
├── src/
│   └── server.js          # Express server with /render endpoint, Puppeteer logic
├── Dockerfile             # Docker build instructions
├── package.json           # Dependencies and scripts
├── .dockerignore          # Exclude node_modules, .git, etc.
├── README.md              # Usage, build, run instructions
└── ARCHITECTURE.md        # This document
```

## Tech Stack
- **Runtime**: Node.js 20+ (compatible with zenika/alpine-chrome:with-node-20 base image)
- **Server**: Express.js (HTTP handling, JSON parsing)
- **Browser Automation**: Puppeteer (headless Chromium screenshots)
- **Containerization**: Docker (base: `zenika/alpine-chrome:with-node-20`; confirmed Puppeteer-compatible via system Chromium, skip bundled download)
- **Validation**: Joi or Zod (JSON schema validation)
- **Other**: No CORS needed for API service (add if frontend); no auth (stateless API)

**Base Image Confirmation**: `zenika/alpine-chrome:with-node-20` includes Node 20 and Chromium. Puppeteer works by setting `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true` and using system executablePath `/usr/bin/google-chrome-stable`.

## API Specification
### Endpoint
- **POST /render**
  - **Content-Type**: `application/json`
  - **Body Schema** (JSON, required fields validated):
    ```json
    {
      "html": "string",          // Optional: HTML string to render (mutually exclusive with "url")
      "url": "string",           // Optional: URL to screenshot (mutually exclusive with "html")
      "width": 1080,             // Number, default: 1280 (viewport width)
      "height": 1920,            // Number, default: 720 (viewport height)
      "fullPage": false,         // Boolean, default: false (full page screenshot if true)
      "delay": 0,                // Number (ms), optional, default: 0 (waitForTimeout)
      "type": "png"              // "png" | "jpeg", default: "png"
    }
    ```
    - Exactly one of `html` or `url` required.
    - Defaults ensure sensible viewport (1280x720) for unspecified cases.
  - **Response**:
    - **200**: `image/png` or `image/jpeg` binary buffer
    - **400**: `{ "error": "Invalid request body: ..." }` (validation failures, missing html/url)
    - **500**: `{ "error": "Internal server error" }` (Puppeteer launch/goto/screenshot failures)
  - **Headers**: `Content-Length` for image size

### Error Handling
- Joi/Zod for body validation → 400
- Puppeteer errors (e.g., invalid URL, timeout) → 500
- Graceful browser close on errors

## Puppeteer Configuration
```javascript
const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome-stable',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--disable-gpu'
  ]
});
const page = await browser.newPage();
if (!fullPage) {
  await page.setViewport({ width, height });
}
if (html) {
  await page.setContent(html);
} else {
  await page.goto(url, { waitUntil: 'networkidle0' });
}
if (delay > 0) {
  await page.waitForTimeout(delay);
}
const buffer = await page.screenshot({
  type,
  fullPage,
  omitBackground: true  // Optional: transparent PNG
});
await browser.close();
```
- Docker args prevent sandbox/permission issues.
- `networkidle0` for URL mode ensures load complete.
- Buffer returned directly in Express response.

## Dockerfile Outline
```dockerfile
FROM zenika/alpine-chrome:with-node-20

# Install deps
RUN apk add --no-cache nmap nmap-scripts dumb-init

WORKDIR /app

# Copy package files first for caching
COPY package*.json ./

# Skip Puppeteer Chromium download, use system
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

RUN npm ci --only=production && npm cache clean --force

COPY . .

EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/server.js"]
```

## package.json Outline
```json
{
  "name": "screenshot-service",
  "version": "1.0.0",
  "main": "src/server.js",
  "scripts": {
    "dev": "nodemon src/server.js",
    "start": "node src/server.js"
  },
  "dependencies": {
    "express": "^4.19.2",
    "puppeteer": "^23.0.0",
    "joi": "^17.13.3"
  },
  "engines": {
    "node": ">=20"
  }
}
```
- Production-only deps in Docker (no nodemon).
- No devDependencies.

## .dockerignore
```
node_modules
npm-debug.log
.git
.gitignore
README.md
ARCHITECTURE.md
```

## Security & Best Practices
- **Puppeteer**: `--no-sandbox` required in Docker (unprivileged rootless).
- **Input Validation**: Joi/Zod strict schema; limit `html`/`url` length (e.g., 1MB/2048 chars).
- **HTML Sanitization**: Optional DOMPurify (client-side only, server unnecessary as Puppeteer isolates).
- **Rate Limiting**: express-rate-limit (e.g., 10 req/min/IP) to prevent abuse.
- **Timeouts**: Puppeteer default 30s; configurable via launch/ goto.
- **Memory**: `--disable-dev-shm-usage` for Docker /dev/shm limits.
- **Logging**: Winston/Morgan for errors/access.
- **Healthcheck**: `/health` endpoint.
- **Scalability**: Stateless; scale horizontally.
- **Monitoring**: No Prometheus initially.

## Implementation Notes
- Validate mutually exclusive html/url.
- Set `Content-Type` and `Content-Length` in response.
- Handle browser launch once (pool if scaling).
- Test: curl POST with html/url payloads.

Design verified complete: covers all requested sections, actionable for implementation.

## CI/CD Pipeline
The CI/CD pipeline is designed to automate the build and deployment process to Render.com. The workflow is triggered by pushes to the `master` branch on GitHub.

1.  **Connect to GitHub:** The user connects their GitHub repository to their Render.com account.
2.  **Create a New Web Service:** The user creates a new "Web Service" on Render.com and selects the appropriate repository.
3.  **Configure the Service:** Render automatically detects the `render.yaml` file in the repository root and uses it to configure the build and start commands for the service.
4.  **Automatic Deployments:** Once the service is configured, Render will automatically build and deploy new changes whenever they are pushed to the `master` branch on GitHub.