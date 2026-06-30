import { test, expect } from '@playwright/test';
import { appPath, login } from './helpers/auth';

const TEST_EMAIL    = process.env.TEST_EMAIL    ?? 'admin@noderoute.local';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? 'password';

test.describe('Navigation & auth', () => {
  test('redirects unauthenticated users to login', async ({ page }) => {
    await page.goto(appPath('/orders'));
    await expect(page).toHaveURL(/login/, { timeout: 8_000 });
  });

  test('login flow succeeds', async ({ page }) => {
    await login(page, TEST_EMAIL, TEST_PASSWORD);
    // After login we should NOT be on /login
    await expect(page).not.toHaveURL(/login/);
  });

  test('nav links reach correct pages', async ({ page }) => {
    await login(page, TEST_EMAIL, TEST_PASSWORD);
    for (const [label, path] of [
      ['Orders', '/orders'],
      ['Routes', '/routes'],
    ]) {
      await page.getByRole('link', { name: new RegExp(label, 'i') }).click();
      await expect(page).toHaveURL(new RegExp(appPath(path)), { timeout: 6_000 });
    }
  });
});
