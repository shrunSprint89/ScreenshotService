const fs = require('fs');
const http = require('http');

// Server URL - assuming it's running locally on port 3000
const SERVER_URL = 'http://localhost:3000/render';

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

// Function to make a request to the screenshot service
async function captureScreenshot(options, filename) {
    return new Promise((resolve) => {
        const postData = JSON.stringify(options);

        const req = http.request({
            hostname: 'localhost',
            port: 3000,
            path: '/render',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            },
            postData
        }, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                try {
                    console.log(`Testing: ${filename}`);

                    // Validate response
                    if (res.statusCode !== 200) {
                        console.error(`✗ Error: HTTP ${res.statusCode} for ${filename}`);
                        resolve(false);
                        return;
                    }

                    const contentType = res.headers['content-type'];
                    if (!contentType || !contentType.startsWith('image/')) {
                        console.error(`✗ Error: Invalid content-type '${contentType}' for ${filename}`);
                        resolve(false);
                        return;
                    }

                    const buffer = Buffer.concat(chunks);
                    fs.writeFileSync(filename, buffer);
                    console.log(`✓ Saved: ${filename}`);
                    resolve(true);
                } catch (error) {
                    console.error(`✗ Error capturing ${filename}:`, error.message);
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

// Run the tests
runTests().catch(error => {
    console.error('Test suite failed:', error);
});