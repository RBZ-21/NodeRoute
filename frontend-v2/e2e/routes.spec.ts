import { test, expect } from '@playwright/test';
import { appPath, login } from './helpers/auth';

const TEST_EMAIL    = process.env.TEST_EMAIL    ?? 'admin@noderoute.local';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? 'password';

test.describe('Routes page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, TEST_EMAIL, TEST_PASSWORD);
  });

  test('routes page loads', async ({ page }) => {
    await page.goto(appPath('/routes'));
    await expect(
      page.getByRole('heading', { name: /routes/i })
        .or(page.getByText(/no routes|add route/i))
    ).toBeVisible({ timeout: 8_000 });
  });

  test('can create a new route', async ({ page }) => {
    await page.goto(appPath('/routes'));
    const addBtn = page.getByRole('button', { name: /new route|add route|create route/i });
    await expect(addBtn).toBeVisible({ timeout: 8_000 });
    await addBtn.click();
    await page.getByLabel(/route name|name/i).fill('Test Route Automation');
    await page.getByRole('button', { name: /save|create|confirm/i }).click();
    await expect(page.getByText('Test Route Automation')).toBeVisible({ timeout: 8_000 });
  });

  test('open invoices can be assigned to a route', async ({ page }) => {
    await page.goto(appPath('/routes'));
    // Look for an "Add Stop" or "Assign Invoice" control
    const assignBtn = page.getByRole('button', { name: /add stop|assign invoice|add invoice/i }).first();
    await expect(assignBtn).toBeVisible({ timeout: 8_000 });
    await assignBtn.click();
    // An invoice picker / modal should appear
    await expect(
      page.getByRole('dialog').or(page.getByText(/open invoices|select invoice/i))
    ).toBeVisible({ timeout: 5_000 });
  });
});
