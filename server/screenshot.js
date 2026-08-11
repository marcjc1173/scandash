import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { getThumbnailsDir, updateService } from './storage.js';

let browserInstance = null;
const MAX_CONCURRENT = parseInt(process.env.SCREENSHOT_CONCURRENCY || '2', 10);
const DEFAULT_WAIT_MS = parseInt(process.env.SCREENSHOT_WAIT_MS || '2500', 10);
const DEFAULT_TIMEOUT_MS = parseInt(process.env.SCREENSHOT_TIMEOUT || '8000', 10);

// Managed Queue State
const queue = [];
let activeWorkers = 0;
const queuedIds = new Set();

/**
 * Get or initialize Puppeteer browser instance
 */
async function getBrowser() {
  if (browserInstance && browserInstance.connected) {
    return browserInstance;
  }

  try {
    browserInstance = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--ignore-certificate-errors',
        '--allow-insecure-localhost',
        '--window-size=1280,800'
      ]
    });

    browserInstance.on('disconnected', () => {
      browserInstance = null;
    });

    return browserInstance;
  } catch (err) {
    console.error('Failed to launch headless browser for thumbnails:', err.message);
    return null;
  }
}

/**
 * Close browser on process exit
 */
export async function closeBrowser() {
  if (browserInstance) {
    try {
      await browserInstance.close();
    } catch {}
    browserInstance = null;
  }
}

/**
 * Queue a thumbnail generation request
 */
export function queueThumbnail(serviceId, url, onComplete) {
  if (!url || !serviceId) return;

  // Prevent duplicate queue entries for the same service
  if (queuedIds.has(serviceId)) return;
  queuedIds.add(serviceId);

  queue.push({ serviceId, url, onComplete });
  processQueue();
}

/**
 * Clear pending thumbnail queue
 */
export function clearThumbnailQueue() {
  queue.length = 0;
  queuedIds.clear();
}

/**
 * Process queue with concurrency limit
 */
async function processQueue() {
  if (activeWorkers >= MAX_CONCURRENT || queue.length === 0) {
    return;
  }

  activeWorkers++;
  const task = queue.shift();

  try {
    const thumbUrl = await captureThumbnail(task.serviceId, task.url);
    queuedIds.delete(task.serviceId);

    if (thumbUrl) {
      const updated = updateService(task.serviceId, { thumbnail: thumbUrl });
      if (task.onComplete) {
        task.onComplete(updated || { id: task.serviceId, thumbnail: thumbUrl });
      }
    }
  } catch (err) {
    queuedIds.delete(task.serviceId);
    console.warn(`Queue thumbnail error for ${task.serviceId}:`, err.message);
  } finally {
    activeWorkers--;
    // Process next item in queue
    setImmediate(processQueue);
  }
}

/**
 * Capture thumbnail screenshot of a web service URL
 */
export async function captureThumbnail(serviceId, url, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (!url) return null;

  // Auto-normalize Plex URLs
  let targetUrl = url;
  if (targetUrl.includes(':32400') && !targetUrl.includes('/web')) {
    targetUrl = targetUrl.replace(/\/+$/, '') + '/web/index.html';
  }

  const browser = await getBrowser();
  if (!browser) return null;

  const thumbnailsDir = getThumbnailsDir();
  if (!fs.existsSync(thumbnailsDir)) {
    fs.mkdirSync(thumbnailsDir, { recursive: true });
  }

  const safeFilename = `${serviceId.replace(/[^a-zA-Z0-9_-]/g, '_')}.webp`;
  const outputPath = path.join(thumbnailsDir, safeFilename);

  let page = null;
  try {
    page = await browser.newPage();
    page.setDefaultNavigationTimeout(timeoutMs);
    page.setDefaultTimeout(timeoutMs);

    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    
    // Set realistic User-Agent for modern web apps
    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    // Ignore SSL errors for local certs
    await page.setBypassCSP(true);

    // Navigate to target URL using 'domcontentloaded' so active WebSockets/SSE don't block
    try {
      await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs
      });
    } catch (navErr) {
      // If error occurs, check if frame still attached
      console.warn(`Navigation warning for ${targetUrl}: ${navErr.message}`);
    }

    // Wait for Single Page App dynamic rendering (React, Vue, Plex, Grafana, etc.)
    const isPlex = targetUrl.includes('32400') || targetUrl.includes('plex');
    const renderWaitMs = isPlex ? 3000 : DEFAULT_WAIT_MS;

    await new Promise(r => setTimeout(r, renderWaitMs));

    // Save screenshot
    await page.screenshot({
      path: outputPath,
      type: 'webp',
      quality: 85
    });

    return `/api/thumbnails/${safeFilename}`;
  } catch (err) {
    console.warn(`Thumbnail capture skipped for ${targetUrl}: ${err.message}`);
    return null;
  } finally {
    if (page) {
      try {
        await page.close();
      } catch {}
    }
  }
}
