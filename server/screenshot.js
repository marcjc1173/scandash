import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { getThumbnailsDir } from './storage.js';

let browserInstance = null;
let activeCaptures = 0;
const MAX_CONCURRENT_SCREENSHOTS = parseInt(process.env.SCREENSHOT_CONCURRENCY || '3', 10);

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
 * Capture thumbnail screenshot of a web service URL
 */
export async function captureThumbnail(serviceId, url, timeoutMs = 6000) {
  if (!url) return null;

  const browser = await getBrowser();
  if (!browser) return null;

  const thumbnailsDir = getThumbnailsDir();
  const safeFilename = `${serviceId.replace(/[^a-zA-Z0-9_-]/g, '_')}.webp`;
  const outputPath = path.join(thumbnailsDir, safeFilename);

  let page = null;
  try {
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    
    // Ignore SSL errors for local certs
    await page.setBypassCSP(true);

    // Navigate to target URL
    await page.goto(url, {
      waitUntil: ['domcontentloaded', 'networkidle2'],
      timeout: timeoutMs
    });

    // Wait a brief moment for dynamic client-side rendering (e.g. React/Vue dashboards)
    await new Promise(r => setTimeout(r, 400));

    // Save screenshot
    await page.screenshot({
      path: outputPath,
      type: 'webp',
      quality: 80
    });

    return `/api/thumbnails/${safeFilename}`;
  } catch (err) {
    // If timeout or navigation error, try taking screenshot anyway if DOM exists
    if (page) {
      try {
        await page.screenshot({
          path: outputPath,
          type: 'webp',
          quality: 80
        });
        return `/api/thumbnails/${safeFilename}`;
      } catch {}
    }
    console.warn(`Thumbnail capture skipped for ${url}: ${err.message}`);
    return null;
  } finally {
    if (page) {
      try {
        await page.close();
      } catch {}
    }
  }
}
