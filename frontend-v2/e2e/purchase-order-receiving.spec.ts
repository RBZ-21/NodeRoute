import { test, expect } from '@playwright/test';
import { appPath, login } from './helpers/auth';

/**
 * E2E: Purchase order draft creation
 *
 * Verifies that an admin can create a new purchase order with one line item,
 * save it as a draft, and see it appear in the Purchasing Orders list with
 * status "draft".
 *
 * Prerequisites:
 *  - Dev server running on localhost:5173
 *  - Backend running and accessible (proxied through Vite)
 *  - TEST_EMAIL / TEST_PASSWORD env vars set (or update defaults below)
 */

const TEST_EMAIL    = process.env.TEST_EMAIL    ?? 'admin@noderoute.local';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? 'password';

test.describe('Purchasing → PO draft creation', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, TEST_EMAIL, TEST_PASSWORD);
  });

  test('purchasing page loads and shows the create PO form', async ({ page }) => {
    await page.goto(appPath('/purchasing'));
    await expect(page.getByRole('heading', { name: /confirm purchase order/i })).toBeVisible({ timeout: 8_000 });
    await expect(page.getByRole('button', { name: /save for later/i })).toBeVisible({ timeout: 5_000 });
  });

  test('creating a PO with one line item and saving as draft shows it in the list as draft', async ({ page }) => {
    await page.goto(appPath('/purchasing'));

    const vendorName = `E2E Test Vendor ${Date.now()}`;

    // Vendor / PO number fields are labelled inputs inside the "Confirm Purchase Order" card.
    await page.getByLabel(/^vendor$/i).fill(vendorName);
    await page.getByLabel(/po number/i).fill(`PO-E2E-${Date.now()}`);

    // Fill the first (and only) line item row.
    const lineTable = page.getByRole('table').first();
    const firstRow = lineTable.getByRole('row').nth(1);
    await firstRow.getByRole('textbox').nth(0).fill('E2E Test Widget'); // Description
    await firstRow.getByRole('spinbutton').nth(0).fill('10'); // Qty
    await firstRow.getByRole('spinbutton').nth(1).fill('5.50'); // Unit Price

    // Save as draft (does not require full validation like Confirm PO does).
    await page.getByRole('button', { name: /save for later/i }).click();

    // A success toast/notice should confirm the draft was saved.
    await expect(page.getByText(/purchase order draft.*saved/i).last()).toBeVisible({ timeout: 8_000 });

    // The draft should now appear in the "Purchasing Orders" history table with status "draft".
    const historyTable = page.getByRole('table').filter({ has: page.getByRole('columnheader', { name: /po number/i }) });
    const draftRow = historyTable.getByRole('row').filter({ hasText: vendorName });
    await expect(draftRow).toBeVisible({ timeout: 8_000 });
    // The status cell renders a badge with the literal text "draft" — scope past
    // the "Resume Draft" action button, which also matches /draft/i.
    await expect(draftRow.getByText('draft', { exact: true })).toBeVisible({ timeout: 5_000 });
  });
});
