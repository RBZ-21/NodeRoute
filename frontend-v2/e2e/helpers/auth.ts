import { Page } from '@playwright/test';

export function appPath(path: string) {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `/dashboard-v2${normalized}`;
}

/**
 * Log in via the UI login form.
 * Update selectors here if your login page labels change.
 */
export async function login(page: Page, email: string, password: string) {
  await page.goto(appPath('/login'));
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  // Wait for redirect away from login
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 10_000 });
}
