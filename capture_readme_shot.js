import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';

async function capture() {
  const assetsDir = path.resolve('./assets');
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,920']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  
  await page.goto('http://localhost:3500', {
    waitUntil: ['domcontentloaded', 'load'],
    timeout: 10000
  });

  // Give 2 seconds for cards and thumbnails to fully load
  await new Promise(r => setTimeout(r, 2000));

  const outputPath = path.join(assetsDir, 'dashboard.png');
  await page.screenshot({
    path: outputPath,
    type: 'png'
  });

  console.log('✅ Screenshot captured successfully:', outputPath);
  await browser.close();
}

capture().catch(err => {
  console.error('Error capturing dashboard screenshot:', err);
  process.exit(1);
});
