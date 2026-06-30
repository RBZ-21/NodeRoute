import { test, expect } from '@playwright/test';
import { appPath, login } from './helpers/auth';

/**
 * E2E: Order → Route Assignment
 *
 * Verifies that when a route is selected during order entry,
 * the resulting stop appears under that route.
 *
 * Prerequisites:
 *  - Dev server running on localhost:5173
 *  - Backend running and accessible (proxied through Vite)
 *  - TEST_EMAIL / TEST_PASSWORD env vars set (or update defaults below)
 */

const TEST_EMAIL    = process.env.TEST_EMAIL    ?? 'admin@noderoute.local';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? 'password';

test.describe('Order → Route assignment', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, TEST_EMAIL, TEST_PASSWORD);
  });

  test('orders page loads and shows order list', async ({ page }) => {
    await page.goto(appPath('/orders'));
    await expect(page).toHaveTitle(/NodeRoute|Orders/i);
    // The orders table or empty-state message should be visible
    await expect(
      page.getByRole('table').or(page.getByText(/no orders|get started/i))
    ).toBeVisible({ timeout: 8_000 });
  });

  test('order form contains a route selector', async ({ page }) => {
    await page.goto(appPath('/orders'));
    // Open the new order form — adjust button text if needed
    const newOrderBtn = page.getByRole('button', { name: /new order|add order|create order/i });
    await expect(newOrderBtn).toBeVisible({ timeout: 8_000 });
    await newOrderBtn.click();
    // Route selector must exist in the form
    await expect(
      page.getByLabel(/route/i).or(page.getByPlaceholder(/route/i))
    ).toBeVisible({ timeout: 5_000 });
  });

  test('submitting an order with a route keeps the route_id', async ({ page }) => {
    await page.goto(appPath('/orders'));
    const newOrderBtn = page.getByRole('button', { name: /new order|add order|create order/i });
    await newOrderBtn.click();

    // Fill minimum required fields
    await page.getByLabel(/customer name/i).fill("Hank's Seafood");
    await page.getByLabel(/address/i).fill('123 Harbor St, Charleston SC');

    // Pick the first available route option
    const routeSelect = page.getByLabel(/route/i);
    await routeSelect.selectOption({ index: 1 });
    const selectedRoute = await routeSelect.inputValue();

    // Submit
    await page.getByRole('button', { name: /submit|save|confirm/i }).click();

    // Should show success or navigate away — wait for form to close
    await expect(page.getByLabel(/customer name/i)).not.toBeVisible({ timeout: 8_000 });

    // Navigate to Routes and confirm the stop is listed there
    await page.goto(appPath('/routes'));
    await expect(page.getByText("Hank's Seafood")).toBeVisible({ timeout: 8_000 });

    // The stop should be under the correct route
    const routeCard = page.locator(`[data-route-id="${selectedRoute}"]`)
      .or(page.getByText(selectedRoute).locator('..'));
    await expect(routeCard.getByText("Hank's Seafood")).toBeVisible({ timeout: 5_000 });
  });
});
