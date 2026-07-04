import { Page } from '@playwright/test';

export function appPath(path: string) {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `/dashboard-v2${normalized}`;
}

/**
 * Demo-mode gotcha (see AGENTS.md "Demo-mode gotchas"): the mock persistence
 * layer used in demo mode doesn't implement `upsert`, so a brand-new company's
 * first-login onboarding wizard calls `company_config.upsert` and hangs,
 * leaving the app stuck on "Welcome — let's set up your account".
 *
 * Work around it the same way AGENTS.md documents: GET /api/company-config
 * (bootstraps the row if missing) then PATCH it with
 * `{ onboarding_completed: true }`, using the CSRF double-submit pattern
 * (the `csrf-token` cookie set on login, echoed back as X-CSRF-Token).
 *
 * This is defensive/idempotent: if the company is already onboarded, or if
 * either request fails for any reason (e.g. non-demo backend with a
 * different contract), it's swallowed so it never breaks a spec that
 * doesn't need it.
 */
async function completeOnboardingIfNeeded(page: Page) {
  try {
    const configRes = await page.request.get('/api/company-config');
    if (!configRes.ok()) return;

    const config = await configRes.json().catch(() => null);
    if (config?.onboarding_completed) return;

    const cookies = await page.context().cookies();
    const csrfToken = cookies.find((c) => c.name === 'csrf-token')?.value;
    if (!csrfToken) return;

    await page.request.patch('/api/company-config', {
      data: { onboarding_completed: true },
      headers: { 'X-CSRF-Token': csrfToken },
    });
  } catch {
    // Best-effort only — never fail login() because of this workaround.
  }
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

  // Guard against a fresh/un-onboarded demo company getting stuck on the
  // first-login onboarding wizard (see AGENTS.md "Demo-mode gotchas").
  await completeOnboardingIfNeeded(page);
}
