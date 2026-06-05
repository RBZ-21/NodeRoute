// Check playwright browsers
const { chromium } = require('@playwright/test');
const fs = require('fs');

(async () => {
  console.log('Playwright found. Checking browser...');
  try {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto('https://noderoutesystems.com');
    const title = await page.title();
    console.log('Page title:', title);
    console.log('URL:', page.url());
    await page.screenshot({ path: 'C:/Users/ryand/NodeRoute_Fresh/test_screenshot.png' });
    console.log('Screenshot saved.');
    await browser.close();
    console.log('BROWSER OK');
  } catch(e) {
    console.log('BROWSER ERROR:', e.message.substring(0, 200));
  }
})();
