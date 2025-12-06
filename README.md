# Screenshot Service

A Dockerized Node.js service that generates screenshots of HTML content or webpages using headless Chromium via Puppeteer.

## Build and Run

```bash
docker build -t screenshot-service .
docker run -p 3000:3000 screenshot-service
```

## API Usage

### POST /render

Accepts JSON payload with the following fields:

#### Required Parameters (choose exactly one)

- `html` (string): HTML content to render (mutually exclusive with `url`)
- `url` (string): URL to screenshot (mutually exclusive with `html`)

#### Optional Parameters

- `width` (number, default: 1280): Viewport width in pixels
- `height` (number, default: 720): Viewport height in pixels
- `fullPage` (boolean, default: false): Capture full page (scrolls through entire content)
- `delay` (number, default: 0): Delay in milliseconds before taking screenshot
- `type` (string, default: "png"): Output format - "png" or "jpeg"

Returns image binary (PNG/JPEG).

### Examples

HTML mode:
```bash
curl -X POST http://localhost:3000/render \
  -H "Content-Type: application/json" \
  -d '{"html":"<h1>Test</h1>"}' \
  --output test.png
```

URL mode:
```bash
curl -X POST http://localhost:3000/render \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}' \
  --output screenshot.png
```

## Running ScreenshotService with Local n8n

### 1. Prerequisites

- **Node.js**: Version 18 or higher (for native ScreenshotService and n8n npm installation). Download from [nodejs.org](https://nodejs.org/).
- **Docker**: Installed and running (for Docker-based runs of ScreenshotService and n8n). Download from [docker.com](https://www.docker.com/).
- **npm**: Included with Node.js (verify with `npm --version`).
- **curl**: For API testing (pre-installed on most systems; on Windows, use PowerShell or install via Chocolatey: `choco install curl`).
- **Ports**: Ensure ports 3000 (ScreenshotService) and 5678 (n8n) are free.

Verify prerequisites:
```bash
node --version  # Should be >= v18.x.x
docker --version  # Should output Docker version
```

### 2. Run ScreenshotService

ScreenshotService exposes a `POST /render` endpoint on `http://localhost:3000`. It accepts JSON with **exactly one** of `html` (string) or `url` (string), and optional `opts`: `width` (default: 1280), `height` (default: 720), `fullPage` (default: false), `delay` (default: 0, ms), `type` (default: 'png', or 'jpeg').

#### Native (npm)

1. Clone/open the project directory:
   ```bash
   cd /path/to/ScreenshotService  # e.g., e:/shrun/Projects/ScreenshotService
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the server:
   ```bash
   npm start
   ```
   - Server runs on `http://localhost:3000`.

#### Docker

1. Build the image:
   ```bash
   docker build -t screenshot-service .
   ```

2. Run the container:
   ```bash
   docker run -p 3000:3000 screenshot-service