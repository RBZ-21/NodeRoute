import { chromium } from 'playwright';

const baseUrl = process.env.CAPTURE_BASE_URL || 'http://127.0.0.1:3001';

async function login() {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: process.env.CAPTURE_EMAIL || 'admin@noderoutesystems.com',
      password: process.env.CAPTURE_PASSWORD || 'Admin@123',
    }),
  });
  const data = await response.json();
  if (!response.ok || !data?.token || !data?.user) {
    throw new Error(`Login failed for screenshot capture: ${data?.error || response.statusText}`);
  }
  return data;
}

async function main() {
  const auth = await login();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();

  await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });
  await page.evaluate((payload) => {
    localStorage.setItem('nr_token', payload.token);
    localStorage.setItem('nr_user', JSON.stringify(payload.user));
  }, auth);

  await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: 'docs/ui-v2/screenshots/legacy-dashboard.png', fullPage: true });

  await page.goto(`${baseUrl}/dashboard-v2`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: 'docs/ui-v2/screenshots/v2-dashboard-shell.png', fullPage: true });

  await page.getByRole('button', { name: 'Financials' }).click();
  await page.getByRole('menuitem', { name: 'Financial Overview' }).click();
  await page.screenshot({ path: 'docs/ui-v2/screenshots/v2-financials.png', fullPage: true });

  await page.getByRole('button', { name: 'Core' }).click();
  await page.getByRole('menuitem', { name: 'Orders' }).click();
  await page.screenshot({ path: 'docs/ui-v2/screenshots/v2-orders.png', fullPage: true });

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
