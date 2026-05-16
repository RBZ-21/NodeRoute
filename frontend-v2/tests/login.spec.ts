import { test, expect } from '@playwright/test';

test('can log into NodeRoute admin UI', async ({ page }) => {
  const email = process.env.TEST_EMAIL;
  const password = process.env.TEST_PASSWORD;

  if (!email || !password) {
    throw new Error('Missing TEST_EMAIL or TEST_PASSWORD environment variables.');
  }

  await page.goto('/login');

  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();

  await expect(page).toHaveURL(/dashboard|dashboard-v2|orders|customers|routes/i);
});
