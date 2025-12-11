# Browser Pooling System Architecture

This document outlines the architecture for a browser pooling system to be implemented in the Screenshot Service.

## 1. Overview

The current system launches a new browser instance for each screenshot request, which is inefficient. A browser pooling system will manage a set of pre-launched browser instances, reducing the overhead of browser creation and destruction for each request. This will improve performance and resource utilization.

## 2. Pool Configuration

The browser pool will be configured with the following parameters, which can be set via environment variables:

- **`MAX_BROWSERS`**: The maximum number of browser instances to be launched. Defaults to `5`.
- **`MAX_PAGES_PER_BROWSER`**: The maximum number of pages that can be open in a single browser instance. Defaults to `10`.

## 3. Queueing Mechanism

When the number of incoming requests exceeds the pool's capacity (i.e., `MAX_BROWSERS` * `MAX_PAGES_PER_BROWSER`), the excess requests will be placed in a queue. A First-In, First-Out (FIFO) queue will be used to ensure that requests are processed in the order they are received.

## 4. Queue Timeout and Error Handling

To prevent requests from waiting indefinitely in the queue, a timeout will be implemented.

- **`QUEUE_TIMEOUT`**: The maximum time (in milliseconds) a request can wait in the queue. Defaults to `30000`.

If a request's wait time exceeds `QUEUE_TIMEOUT`, it will be rejected with a `503 Service Unavailable` error.

## 5. Browser Instance Reuse Strategy

Browser instances will be reused to minimize the overhead of launching new browsers.

- **Page Management**: When a screenshot is complete, the page used for the rendering will be closed.
- **Browser State**: The browser instance itself will remain open and will be returned to the pool, ready to be used for another request.
- **Health Checks**: A mechanism to check the health of a browser instance will be implemented. If a browser is unresponsive or has crashed, it will be terminated and replaced with a new instance.

## 6. Implementation Steps for Code Mode

The following steps should be followed to implement the browser pooling system:

1.  **Create `src/browser-pool.js`**: Create a new module to encapsulate all the browser pooling logic.
2.  **Implement the Pool**:
    -   Initialize a pool of browser instances based on `MAX_BROWSERS`.
    -   Implement a method to acquire a page from the pool. This method will handle the queueing and timeout logic.
    -   Implement a method to release a page back to the pool.
3.  **Integrate with `src/server.js`**:
    -   Replace the direct `puppeteer.launch()` call in the `/render` endpoint with a call to the `browser-pool.js` module to acquire a page.
    -   Ensure the page is released back to the pool in a `finally` block to prevent leaks.
4.  **Add Configuration**:
    -   Read the pool configuration (`MAX_BROWSERS`, `MAX_PAGES_PER_BROWSER`, `QUEUE_TIMEOUT`) from environment variables in `server.js` and pass them to the `browser-pool.js` module.
5.  **Error Handling**:
    -   Implement the queue timeout error handling, returning a `503` status code.
    -   Add logging to monitor the pool's status (e.g., number of active browsers, queue length).