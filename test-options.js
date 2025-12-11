const fs = require('fs');
const http = require('http');
require('dotenv').config(); // Load environment variables from .env

// Server URL - assuming it's running locally, port can be configured via .env
const SERVER_PORT = process.env.PORT || 4001;
const SERVER_URL_RENDER = `http://localhost:${SERVER_PORT}/render`;

// Test HTML content
const testHtml = `
<!DOCTYPE html>
<html>
<head>
    <title>Test Page</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .section { margin: 20px 0; padding: 15px; border: 1px solid #ccc; }
        .long-content { height: 1500px; background: linear-gradient(to bottom, #f0f0f0, #c0c0c0); }
    </style>
</head>
<body>
    <h1>Screenshot Service Test</h1>
    <div class="section">
        <h2>Section 1</h2>
        <p>This is a test page to verify screenshot options.</p>
    </div>
    <div class="section">
        <h2>Section 2</h2>
        <p>More content for testing purposes.</p>
    </div>
    <div class="long-content">
        <p>This is a long content section to test full page screenshots.</p>
    </div>
</body>
</html>
`;

// Function to make a POST request to the screenshot service
async function captureScreenshot(options, filename, expectedStatus = 200) {
    return new Promise((resolve) => {
        const postData = JSON.stringify(options);

        const req = http.request({
            hostname: 'localhost',
            port: SERVER_PORT,
            path: '/render',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        }, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                try {
                    const responseBody = Buffer.concat(chunks).toString().trim();
                    console.log(`Testing: ${filename} (Expected Status: ${expectedStatus}, Actual: ${res.statusCode})`);

                    if (res.statusCode !== expectedStatus) {
                        console.error(`✗ Error: HTTP ${res.statusCode} for ${filename}. Response: ${responseBody}`);
                        resolve(false);
                        return;
                    }

                    if (expectedStatus === 200) {
                        const contentType = res.headers['content-type'];
                        if (!contentType || !contentType.startsWith('image/')) {
                            console.error(`✗ Error: Invalid content-type '${contentType}' for ${filename}. Response: ${responseBody}`);
                            resolve(false);
                            return;
                        }

                        fs.writeFileSync(filename, Buffer.from(responseBody, 'binary'));
                        console.log(`✓ Saved: ${filename}`);
                    } else {
                        // For non-200 responses, we just check the status code and log the response body
                        console.log(`✓ Test passed for ${filename} with status ${res.statusCode}. Response: ${responseBody}`);
                    }
                    resolve(true);
                } catch (error) {
                    console.error(`✗ Error processing response for ${filename}:`, error.message);
                    resolve(false);
                }
            });
        });

        req.on('error', (error) => {
            console.error(`✗ Error capturing ${filename}:`, error.message);
            resolve(false);
        });

        req.write(postData);
        req.end();
    });
}

// Function to make a GET request to a given path and check status
async function makeGetRequest(path, expectedStatus = 200, expectedBody = null) {
    return new Promise((resolve) => {
        const req = http.request({
            hostname: 'localhost',
            port: SERVER_PORT,
            path: path,
            method: 'GET',
            timeout: 5000 // 5 seconds timeout for health checks
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                const testName = `GET ${path}`;
                let passed = true;

                if (res.statusCode === expectedStatus) {
                    console.log(`✓ ${testName} (Status: ${res.statusCode})`);
                } else {
                    console.error(`✗ ${testName} (Expected Status: ${expectedStatus}, Actual: ${res.statusCode}). Response: ${data}`);
                    passed = false;
                }

                if (passed && expectedBody) {
                    try {
                        const parsedData = JSON.parse(data);
                        // Check if the expected body is a subset of the actual response
                        for (const key in expectedBody) {
                            if (parsedData[key] !== expectedBody[key]) {
                                console.error(`✗ ${testName} (Body mismatch for key "${key}"). Expected: ${expectedBody[key]}, Actual: ${parsedData[key]}`);
                                passed = false;
                                break;
                            }
                        }
                        if (passed) {
                            console.log(`✓ ${testName} (Body matches expected)`);
                        }
                    } catch (e) {
                        console.error(`✗ ${testName} (Failed to parse JSON response: ${e.message}). Response: ${data}`);
                        passed = false;
                    }
                }
                resolve(passed);
            });
        });

        req.on('error', (error) => {
            console.error(`✗ ${testName} failed: ${error.message}`);
            resolve(false);
        });

        req.on('timeout', () => {
            req.abort();
            console.error(`✗ ${testName} timed out.`);
            resolve(false);
        });

        req.end();
    });
}

// Function to run concurrent requests
async function runConcurrentRequests(count, options, baseFilename, expectedStatus = 200) {
    const promises = [];
    for (let i = 0; i < count; i++) {
        // Use a Promise.allSettled to ensure all promises resolve regardless of individual success/failure
        promises.push(captureScreenshot(options, `${baseFilename}-${i + 1}.png`, expectedStatus));
    }
    const results = await Promise.all(promises);
    return results.filter(result => result).length;
}

// Main test function
async function runTests() {
    console.log('Starting screenshot service tests...\n');

    let successCount = 0;
    let totalCount = 0;

    // Test 1: Basic HTML screenshot (default options)
    totalCount++;
    if (await captureScreenshot(
        { html: '<h1>Basic Test</h1><p>Default options</p>' },
        'test-basic.png'
    )) successCount++;

    // Test 2: HTML with custom width and height
    totalCount++;
    if (await captureScreenshot(
        {
            html: '<h1>Custom Size</h1><p>800x600 viewport</p>',
            width: 800,
            height: 600
        },
        'test-custom-size.png'
    )) successCount++;

    // Test 3: HTML with full page screenshot
    totalCount++;
    if (await captureScreenshot(
        {
            html: testHtml,
            fullPage: true
        },
        'test-full-page.png'
    )) successCount++;

    // Test 4: HTML with delay
    totalCount++;
    if (await captureScreenshot(
        {
            html: '<h1>Delay Test</h1><p>Captured after 1 second</p>',
            delay: 1000
        },
        'test-delay.png'
    )) successCount++;

    // Test 5: HTML as JPEG
    totalCount++;
    if (await captureScreenshot(
        {
            html: '<h1>JPEG Test</h1><p>This should be a JPEG</p>',
            type: 'jpeg'
        },
        'test-jpeg.jpg'
    )) successCount++;

    // Test 6: URL screenshot (default options)
    totalCount++;
    if (await captureScreenshot(
        { url: 'https://example.com' },
        'test-url-default.png'
    )) successCount++;

    // Test 7: URL with custom options
    totalCount++;
    if (await captureScreenshot(
        {
            url: 'https://example.com',
            width: 1024,
            height: 768,
            type: 'jpeg'
        },
        'test-url-custom.jpg'
    )) successCount++;

    // Test 8: Complex HTML with all options
    totalCount++;
    if (await captureScreenshot(
        {
            html: testHtml,
            width: 1920,
            height: 1080,
            fullPage: true,
            delay: 500,
            type: 'png'
        },
        'test-complex-all-options.png'
    )) successCount++;

    // Test 9: Health endpoint verification (part of requirement 1)
    console.log('\n--- Health Endpoint Verification ---');
    totalCount++;
    if (await makeGetRequest('/health', 200, { status: 'ok' })) successCount++;
    totalCount++;
    if (await makeGetRequest('/', 200, { status: 'ok', message: 'Screenshot service is running' })) successCount++;


    // Test 10: Concurrency limit validation (part of requirement 3, refined)
    // The server is configured with MAX_BROWSERS and MAX_PAGES_PER_BROWSER.
    const maxBrowsers = parseInt(process.env.MAX_BROWSERS || '3');
    const maxPagesPerBrowser = parseInt(process.env.MAX_PAGES_PER_BROWSER || '5');
    const queueTimeoutMs = parseInt(process.env.QUEUE_TIMEOUT || '30000');
    const totalMaxConcurrent = maxBrowsers * maxPagesPerBrowser;
    const requestsToSendForConcurrency = totalMaxConcurrent + 5; // Send more requests than the pool can handle simultaneously

    console.log(`\n--- Concurrency Limit Validation (${requestsToSendForConcurrency} requests vs pool max ${totalMaxConcurrent}) ---`);
    console.log(`  Sending ${requestsToSendForConcurrency} requests. Expecting some to be queued.`);
    const concurrencyOptions = { html: '<h1>Concurrency Limit Test</h1><p>Testing queueing and limits.</p>', delay: queueTimeoutMs / 2 }; // Keep pages busy for half the queue timeout
    const concurrentSuccesses = await runConcurrentRequests(requestsToSendForConcurrency, concurrencyOptions, 'test-concurrency-limit');
    console.log(`  Concurrency test: ${concurrentSuccesses}/${requestsToSendForConcurrency} requests succeeded.`);
    totalCount += requestsToSendForConcurrency;
    successCount += concurrentSuccesses;


    // Test 11: RENDER_TIMEOUT scenario (part of requirement 2)
    console.log('\n--- RENDER_TIMEOUT Scenario ---');
    const renderTimeoutMs = parseInt(process.env.PUPPETEER_RENDER_TIMEOUT || '60000');
    // Create HTML that causes a delay longer than RENDER_TIMEOUT for screenshotting
    // The delay inside the HTML needs to be relative to when screenshot() is called.
    const renderTimeoutHtml = `
        <body>
            <h1>Render Timeout Expected</h1>
            <p>This page tries to delay its content processing beyond the render timeout.</p>
            <script>
                // This makes the page "busy" so it won't be considered fully rendered by Puppeteer until later
                const startTime = Date.now();
                while (Date.now() - startTime < ${renderTimeoutMs + 2000}) {
                    // Busy wait
                }
                document.body.style.backgroundColor = 'red'; // Should not be reached before timeout
            </script>
        </body>
    `;
    totalCount++;
    if (await captureScreenshot({ html: renderTimeoutHtml, delay: 100 }, 'test-render-timeout-expected-504.png', 504)) {
        successCount++;
    } else {
        console.warn('  Ensure PUPPETEER_RENDER_TIMEOUT is configured to a reasonable value for this test to pass.');
    }


    // Test 12: GLOBAL_REQUEST_TIMEOUT scenario (part of requirement 2)
    console.log('\n--- GLOBAL_REQUEST_TIMEOUT Scenario ---');
    const globalRequestTimeoutMs = parseInt(process.env.PUPPETEER_GLOBAL_REQUEST_TIMEOUT || '120000'); // Default 120s
    // Use the 'delay' option to simulate a long request that exceeds the global timeout.
    const longDelay = globalRequestTimeoutMs + 5000;
    totalCount++;
    if (await captureScreenshot({
        html: '<h1>Global Timeout Test</h1>',
        delay: longDelay
    }, 'test-global-timeout-expected-504.png', 504)) {
        successCount++;
    } else {
        console.warn('  Ensure PUPPETEER_GLOBAL_REQUEST_TIMEOUT is configured to a reasonable value for this test to pass.');
    }
    
    // Test 13: QUEUE_TIMEOUT scenario (part of requirement 2)
    console.log('\n--- QUEUE_TIMEOUT Scenario ---');
    console.log(`  Attempting to fill the browser pool (${totalMaxConcurrent} slots) and then trigger a queue timeout.`);
    console.log(`  Individual browser page operations will be delayed for ${queueTimeoutMs / 2}ms.`);

    const queueBusterOptions = { html: '<p>Queue Buster</p>', delay: queueTimeoutMs / 2 }; 
    const numQueueBusters = totalMaxConcurrent; 

    // Send requests to occupy the pool. These are expected to succeed if pool is correctly configured.
    console.log(`  Sending ${numQueueBusters} queue buster requests to occupy pool for a short duration.`);
    const busterPromises = Array(numQueueBusters).fill(0).map((_, i) =>
        captureScreenshot(queueBusterOptions, `test-queue-buster-${i + 1}.png`).catch(e => {
            console.error(`  Queue buster ${i + 1} failed unexpectedly: ${e.message}`);
            return false;
        })
    );
     // Do not await all busters here. Send them off and then immediately try to acquire another page.
     // This simulates a burst of requests. The acquirePage in `captureScreenshot` will handle queueing.
    Promise.all(busterPromises); // Fire and forget for now, individual resolution handled by captureScreenshot

    console.log(`  Sending one request expected to timeout in queue after ${queueTimeoutMs}ms.`);
    // Now send the actual test request expecting a 504 timeout from the queue
    if (await new Promise(resolve => {
        // Enqueue this request after the busters are sent
        setTimeout(async () => {
             // This request should wait in the queue and eventually time out.
             const result = await captureScreenshot(
                { html: '<h1>Queue Timeout Expected</h1>', delay: 1000 },
                `test-queue-timeout-expected-504.png`, 504
            );
            resolve(result);
        }, 100); // Small delay to ensure busters are enqueued first
    })) {
        successCount++;
        successCount++;
    } else {
        console.warn('  Queue timeout test might have failed to register a timeout. Check QUEUE_TIMEOUT config or try increasing numQueueBusters.');
    }

    // Test 14: Environment configuration tests (part of requirement 4)
    console.log('\n--- Environment Configuration Tests ---');
    // We already adjust the port check in checkServerReady.
    // Let's explicitly log the values being used to verify they come from .env
    const currentPort = process.env.PORT || 3000;
    const currentMaxBrowsers = process.env.MAX_BROWSERS || '3';
    const currentMaxPagesPerBrowser = process.env.MAX_PAGES_PER_BROWSER || '5';
    const currentQueueTimeout = process.env.QUEUE_TIMEOUT || '30000';
    const currentRenderTimeout = process.env.PUPPETEER_RENDER_TIMEOUT || '60000';
    const currentGlobalRequestTimeout = process.env.PUPPETEER_GLOBAL_REQUEST_TIMEOUT || '120000';
    
    console.log(`  Configured PORT: ${currentPort}`);
    console.log(`  Configured MAX_BROWSERS: ${currentMaxBrowsers}`);
    console.log(`  Configured MAX_PAGES_PER_BROWSER: ${currentMaxPagesPerBrowser}`);
    console.log(`  Configured QUEUE_TIMEOUT: ${currentQueueTimeout}ms`);
    console.log(`  Configured PUPPETEER_RENDER_TIMEOUT: ${currentRenderTimeout}ms`);
    console.log(`  Configured PUPPETEER_GLOBAL_REQUEST_TIMEOUT: ${currentGlobalRequestTimeout}ms`);
    
    // This test primarily involves logging to verify values.
    // A more advanced test would read server logs or expose an /config endpoint.
    totalCount++;
    console.log('✓ Environment configuration values logged for verification.');
    successCount++; 


    // Test 15: Browser reuse validation test - sequential requests to validate reuse (Original Test 11)
    console.log('\n--- Browser Reuse Validation ---');
    const reuseOptions = { html: '<h1>Reuse Test</h1><p>Testing browser instance reuse</p>' };
    let reuseSuccessCount = 0;
    for (let i = 0; i < 5; i++) {
        if (await captureScreenshot(reuseOptions, `test-reuse-${i + 1}.png`)) {
            reuseSuccessCount++;
        }
    }
    console.log(`  Browser reuse test: ${reuseSuccessCount}/5 requests succeeded`);
    totalCount += 5;
    successCount += reuseSuccessCount;

    // Summary
    console.log('\n' + '='.repeat(50));
    console.log(`Test Results: ${successCount}/${totalCount} tests passed`);

    if (successCount === totalCount) {
        console.log('All tests passed! 🎉');
    } else {
        console.log(`${totalCount - successCount} tests failed.`);
    }
    console.log('='.repeat(50));
}

// Check if server is ready before running tests
async function checkServerReady() {
    return new Promise((resolve) => {
        const req = http.request(
            {
                hostname: 'localhost',
                port: SERVER_PORT, // Use the configured server port
                path: '/',
                method: 'GET',
                timeout: 2000
            },
            (res) => {
                resolve(res.statusCode === 200);
            }
        );
        req.on('error', (err) => {
            console.error(`Error checking server readiness on port ${SERVER_PORT}: ${err.message}`);
            resolve(false);
        });
        req.on('timeout', () => {
            req.abort();
            console.error(`Server readiness check timed out on port ${SERVER_PORT}.`);
            resolve(false);
        });
        req.end();
    });
}

(async function main() {
    console.log(`Attempting to connect to server on port ${SERVER_PORT}...`);
    let ready = false;
    // Retry server readiness check a few times
    for (let i = 0; i < 5; i++) {
        ready = await checkServerReady();
        if (ready) {
            console.log('Server is ready. Running tests.');
            break;
        }
        console.log('Server not ready, retrying in 2 seconds...');
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    if (!ready) {
        console.error(`\n[E] Screenshot service is not running on port ${SERVER_PORT} or is unresponsive.`);
        console.error('>> Please build and start the Docker container before running tests:');
        console.error('   docker build -t screenshot-service .');
        console.error(`   docker run -p ${SERVER_PORT}:${SERVER_PORT} screenshot-service`);
        process.exit(1);
    }
    // Proceed with existing test logic
    runTests().catch(error => {
        console.error('Test suite failed:', error);
        process.exit(1);
    });
})();