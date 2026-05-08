import { expect, test, type Locator, type Page } from '@playwright/test';

type InventoryRow = {
  id?: string;
  item_number?: string | null;
  description?: string;
  unit?: string;
  cost?: number | string;
  on_hand_qty?: number | string;
  is_catch_weight?: boolean;
  is_ftl_product?: boolean;
};

type CustomerRow = {
  id?: string | number;
  company_name?: string;
};

type OrderRow = {
  id: string;
  order_number?: string;
  customer_name?: string;
};

type InvoiceRow = {
  id: string;
  customer_name?: string;
};

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function installPrintStubs(page: Page) {
  await page.context().addInitScript(() => {
    const noop = () => {};
    window.print = noop;
    const originalOpen = window.open.bind(window);
    window.open = (...args) => {
      const popup = originalOpen(...args);
      if (popup) {
        try {
          popup.print = noop;
        } catch {
          // ignore cross-window timing issues
        }
        const timer = window.setInterval(() => {
          try {
            if (popup.closed) {
              window.clearInterval(timer);
              return;
            }
            popup.print = noop;
          } catch {
            // ignore cross-window timing issues
          }
        }, 50);
      }
      return popup;
    };
  });
}

async function login(page: Page) {
  const email = process.env.TEST_EMAIL;
  const password = process.env.TEST_PASSWORD;

  if (!email || !password) {
    throw new Error('Missing TEST_EMAIL or TEST_PASSWORD environment variables.');
  }

  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/dashboard|orders|customers|routes|inventory/i);
}

async function openWorkspace(page: Page, itemLabel: string, options?: {
  groupLabel?: string;
  headingName?: string | RegExp;
  urlPath?: string;
}) {
  const targetUrlPattern = options?.urlPath
    ? new RegExp(`${escapeRegex(options.urlPath)}(?:$|[?#])`)
    : null;

  if (targetUrlPattern && targetUrlPattern.test(page.url())) {
    if (options?.headingName) {
      await expect(page.getByRole('heading', { name: options.headingName })).toBeVisible();
    }
    await expect(page.getByText('Something went wrong')).not.toBeVisible();
    return;
  }

  const sidebar = page.locator('aside').first();
  const itemButton = sidebar.getByRole('button', { name: itemLabel, exact: true });

  if (options?.groupLabel && !(await itemButton.first().isVisible().catch(() => false))) {
    const groupButton = sidebar.getByRole('button', { name: options.groupLabel });
    await expect(groupButton).toBeVisible();
    await groupButton.click();
  }

  if (!(await itemButton.first().isVisible().catch(() => false))) {
    throw new Error(`Could not find sidebar workspace button for ${itemLabel}.`);
  }

  await itemButton.first().click();

  if (targetUrlPattern) {
    await expect(page).toHaveURL(targetUrlPattern);
  }

  if (options?.headingName) {
    await expect(page.getByRole('heading', { name: options.headingName })).toBeVisible();
  }

  await expect(page.getByText('Something went wrong')).not.toBeVisible();
}

async function fetchJson<T>(page: Page, apiPath: string): Promise<T> {
  return page.evaluate(async (path) => {
    const response = await fetch(path, { credentials: 'include' });
    if (!response.ok) {
      throw new Error(`${path} failed with ${response.status}`);
    }
    return response.json();
  }, apiPath);
}

async function deletePath(page: Page, apiPath: string) {
  await page.evaluate(async (path) => {
    const response = await fetch(path, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`${path} failed with ${response.status}`);
    }
  }, apiPath);
}

async function createCustomerViaUi(page: Page, customer: {
  company: string;
  contact: string;
  email: string;
  phone: string;
  address: string;
  terms: string;
}) {
  await openWorkspace(page, 'Customers', {
    groupLabel: 'People',
    headingName: 'Customers',
    urlPath: '/dashboard-v2/customers',
  });
  await page.getByRole('button', { name: 'Add Customer' }).click();
  await expect(page.getByText('Create a new customer directly from the customer dashboard.')).toBeVisible();

  await page.getByPlaceholder('Blue Fin Seafood').fill(customer.company);
  await page.getByPlaceholder('Receiving Manager').fill(customer.contact);
  await page.getByPlaceholder('ops@example.com').fill(customer.email);
  await page.getByPlaceholder('555-0103').fill(customer.phone);
  await page.getByPlaceholder('123 Dock Street').fill(customer.address);
  await page.getByPlaceholder('Net 30').fill(customer.terms);
  await page.getByRole('button', { name: /^Add Customer$/ }).click();

  await expect(page.getByText(`Customer ${customer.company} added.`)).toBeVisible();
}

async function selectComboboxOption(input: Locator, text: string) {
  await input.click();
  await input.fill(text);
  await input.press('ArrowDown');
  await input.press('Enter');
}

async function chooseOrderProduct(page: Page, description: string) {
  const orderLine = page.locator('table').first().locator('tbody tr').first();
  const productInput = orderLine.getByPlaceholder('Atlantic Salmon');
  await expect(productInput).toBeEnabled();
  await selectComboboxOption(productInput, description);
  return orderLine;
}

async function createOrderViaUi(page: Page, order: {
  customerName: string;
  customerEmail: string;
  customerAddress: string;
  notes: string;
  product: InventoryRow;
  sendToProcessing: boolean;
}) {
  await openWorkspace(page, 'Orders', {
    headingName: /Create Order|Edit Order/i,
    urlPath: '/dashboard-v2/orders',
  });

  await selectComboboxOption(page.getByPlaceholder('Oceanview Market'), order.customerName);
  await page.getByPlaceholder('buyer@customer.com').fill(order.customerEmail);
  await page.getByPlaceholder('123 Harbor St').fill(order.customerAddress);
  await page.getByPlaceholder('Special handling or packing notes').fill(order.notes);

  const line = await chooseOrderProduct(page, String(order.product.description || ''));

  if (order.product.is_catch_weight) {
    const estimatedWeightInput = line.getByPlaceholder('0.000 lbs');
    await estimatedWeightInput.fill('5');

    const priceInput = line.getByPlaceholder('0.0000');
    if ((await priceInput.inputValue()).trim() === '') {
      await priceInput.fill(String(asNumber(order.product.cost) || 12.5));
    }
  } else if (String(order.product.unit || '').toLowerCase() === 'lb') {
    await line.getByPlaceholder('Qty').fill('1');
    await line.getByPlaceholder('Est. lbs').fill('5');
  } else {
    await line.locator('input[type="number"]').first().fill('2');
  }

  if (order.sendToProcessing) {
    const popupPromise = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Create + Send' }).click();
    const popup = await popupPromise;
    await expect(page.getByText('Order created and sent to processing.')).toBeVisible();
    await popup.waitForLoadState('domcontentloaded');
    await expect(popup.getByText('Print')).toBeVisible();
    await expect(popup.getByText(order.customerName)).toBeVisible();
  } else {
    await page.getByRole('button', { name: 'Create Order' }).click();
    await expect(page.getByText('Order created.')).toBeVisible();
  }
}

function chooseSmokeOrderProduct(inventory: InventoryRow[]) {
  const candidates = inventory.filter((item) => !item.is_ftl_product && !!item.description);
  return (
    candidates.find((item) => asNumber(item.on_hand_qty) <= 0 && (String(item.unit || '').toLowerCase() === 'lb' || item.is_catch_weight))
    || candidates.find((item) => String(item.unit || '').toLowerCase() === 'lb' || item.is_catch_weight)
    || candidates.find((item) => asNumber(item.on_hand_qty) <= 0)
    || candidates[0]
    || null
  );
}

async function captureWorkbenchOrderNumber(page: Page, searchText: string, status: 'pending' | 'in_process') {
  await page.getByPlaceholder('Order # or customer').fill(searchText);
  await page.locator('select').filter({ has: page.locator('option[value="pending"]') }).last().selectOption(status);
  const row = page.locator('table').nth(1).locator('tbody tr').filter({ hasText: searchText }).first();
  await expect(row).toBeVisible();
  const orderButton = row.locator('button').first();
  const orderNumber = (await orderButton.locator('span').first().textContent())?.trim();
  if (!orderNumber) {
    throw new Error(`Could not capture ${status} order number for ${searchText}.`);
  }
  return orderNumber;
}

async function openDashboardWeightQueue(page: Page) {
  await openWorkspace(page, 'Dashboard', {
    urlPath: '/dashboard-v2/dashboard',
  });
  await expect(page.locator('h3').filter({ hasText: 'Weight Entry Queue' })).toBeVisible();
  await page.getByRole('button', { name: /Orders Needing Weights/i }).click();
  await expect(page.locator('h2').filter({ hasText: 'Weight Entry Queue' })).toBeVisible();
}

async function saveWeightAndPrintInvoice(page: Page, customerName: string) {
  const orderPanel = page.locator('div.px-6.py-5').filter({ hasText: customerName }).first();
  await expect(orderPanel).toBeVisible();

  const weightInput = orderPanel.getByPlaceholder('0.00 lb').first();
  await weightInput.fill('5.25');
  const saveButton = orderPanel.getByRole('button', { name: /^Save$/ }).first();
  await saveButton.click();

  await expect(page.getByText('Weight saved.')).toBeVisible();
  await expect(saveButton).toBeDisabled();

  const popupPromise = page.waitForEvent('popup');
  await orderPanel.getByRole('button', { name: 'Print Invoice' }).first().click();
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');
  await expect(popup.getByText('Print')).toBeVisible();
  await expect(popup.getByText(customerName)).toBeVisible();

  await page.getByRole('button', { name: 'Close' }).click();
}

async function exerciseInventoryPage(page: Page, viableItemNumbers: string[]) {
  await openWorkspace(page, 'Inventory', {
    groupLabel: 'Financials',
    headingName: 'Inventory Actions',
    urlPath: '/dashboard-v2/inventory',
  });

  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Print Count Sheet' }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');
  await expect(popup.getByText('Inventory Count Sheet')).toBeVisible();

  if (viableItemNumbers.length < 2) {
    return;
  }

  const [sourceItemNumber, targetItemNumber] = viableItemNumbers;
  const inventoryActionsCard = page.locator("//div[.//*[normalize-space()='Inventory Actions'] and .//*[normalize-space()='Restock Qty']]").first();
  await inventoryActionsCard.locator('select').first().selectOption(sourceItemNumber);
  await inventoryActionsCard.getByPlaceholder('e.g. 25').fill('2');
  await inventoryActionsCard.getByRole('button', { name: 'Restock Item' }).click();
  await expect(page.getByText(`Restocked ${sourceItemNumber} by 2.`)).toBeVisible();

  const adjustInput = inventoryActionsCard.getByPlaceholder('e.g. -2.5');
  await adjustInput.fill('-1');
  await inventoryActionsCard.getByRole('button', { name: 'Apply Adjustment' }).click();
  await expect(page.getByText(`Adjusted ${sourceItemNumber} by -1.`)).toBeVisible();

  const transferCard = page.locator("//div[.//*[normalize-space()='Transfer Inventory'] and .//*[normalize-space()='Transfer Stock']]").first();
  await transferCard.locator('select').nth(0).selectOption(targetItemNumber);
  await transferCard.locator('select').nth(1).selectOption(sourceItemNumber);
  await transferCard.getByPlaceholder('e.g. 5').fill('1');
  await transferCard.getByPlaceholder('Optional transfer notes').fill('Playwright transfer smoke');
  await transferCard.getByRole('button', { name: 'Transfer Stock' }).click();
  await expect(page.getByText(/Transfer completed/i)).toBeVisible();

  const spoilageCard = page.locator("//div[.//*[normalize-space()='Record Spoilage'] and .//*[normalize-space()='Post Spoilage']]").first();
  await spoilageCard.locator('select').first().selectOption(targetItemNumber);
  await spoilageCard.getByPlaceholder('e.g. 2').fill('1');
  await spoilageCard.getByPlaceholder('Temperature excursion').fill('Playwright spoilage smoke');
  await spoilageCard.getByPlaceholder('Optional spoilage notes').fill('Discarded during smoke test');
  await spoilageCard.getByRole('button', { name: 'Post Spoilage' }).click();
  await expect(page.getByText(`Spoilage recorded for ${targetItemNumber}.`)).toBeVisible();
}

async function buildAndExerciseRoute(page: Page, routeName: string, routeCustomerName: string, pendingOrderNumber: string) {
  await openWorkspace(page, 'Routes', {
    groupLabel: 'Logistics',
    headingName: 'Create Route',
    urlPath: '/dashboard-v2/routes',
  });

  await page.getByPlaceholder('Back Side').fill(routeName);
  await page.getByPlaceholder('Assign driver').fill('Playwright Driver');
  await page.getByPlaceholder('Optional').fill('Playwright smoke route');
  await page.getByRole('button', { name: 'Create Route' }).click();
  await expect(page.getByText(`Route "${routeName}" created.`)).toBeVisible();

  const routeRow = page.locator('table').last().locator('tbody tr').filter({ hasText: routeName }).first();
  await expect(routeRow).toBeVisible();
  await routeRow.getByRole('button', { name: 'Edit' }).click();

  await expect(page.getByText(`Editing: ${routeName}`)).toBeVisible();
  await page.locator("//div[.//*[contains(normalize-space(), 'Editing:')]]//input").nth(2).fill('Updated by Playwright smoke');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('Route updated.')).toBeVisible();

  const stopSearch = page.getByPlaceholder(/Search customers or orders/i);
  await selectComboboxOption(stopSearch, routeCustomerName);
  await page.getByRole('button', { name: 'Add to Route' }).click();
  await expect(page.getByText(`"${routeCustomerName}" added to route.`)).toBeVisible();

  const pendingOrderRow = page.locator('table').filter({ has: page.getByText('Order #') }).last().locator('tbody tr').filter({ hasText: pendingOrderNumber }).first();
  await expect(pendingOrderRow).toBeVisible();
  await pendingOrderRow.click();
  await page.getByRole('button', { name: /Add 1 Stop to Route/i }).click();
  await expect(page.getByText(/1 stop added\./i)).toBeVisible();
  await expect(routeRow).toContainText('2');
  await routeRow.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByText(`Editing: ${routeName}`)).not.toBeVisible();
}

test('covers the core admin UI smoke workflows end to end', async ({ page }) => {
  const runId = `${Date.now()}`;
  const routeCustomer = {
    company: `Playwright Route Customer ${runId}`,
    contact: 'Route Receiver',
    email: `route.${runId}@noderoute.test`,
    phone: '555-2001',
    address: '201 Route Dock Way',
    terms: 'Net 15',
  };
  const orderCustomer = {
    company: `Playwright Orders Customer ${runId}`,
    contact: 'Order Receiver',
    email: `orders.${runId}@noderoute.test`,
    phone: '555-2002',
    address: '202 Orders Harbor Road',
    terms: 'Net 30',
  };
  const routeName = `Playwright Route ${runId}`;

  let pendingOrderNumber = '';
  let viableInventoryItemNumbers: string[] = [];

  try {
    await installPrintStubs(page);
    await login(page);

    await test.step('Create two customers through the UI', async () => {
      await createCustomerViaUi(page, routeCustomer);
      await createCustomerViaUi(page, orderCustomer);
    });

    const orderProduct = await test.step('Load the real inventory dataset and choose a smoke-test product', async () => {
      const inventory = await fetchJson<InventoryRow[]>(page, '/api/inventory');
      viableInventoryItemNumbers = inventory
        .map((item) => String(item.item_number || '').trim())
        .filter(Boolean);
      const product = chooseSmokeOrderProduct(inventory);
      if (!product) {
        throw new Error('No inventory product is available for the order-entry smoke flow.');
      }
      return product;
    });

    await test.step('Create a pending order with an out-of-stock item through the UI', async () => {
      await createOrderViaUi(page, {
        customerName: orderCustomer.company,
        customerEmail: orderCustomer.email,
        customerAddress: orderCustomer.address,
        notes: 'Pending smoke order for route batch add',
        product: orderProduct,
        sendToProcessing: false,
      });
      pendingOrderNumber = await captureWorkbenchOrderNumber(page, orderCustomer.company, 'pending');
    });

    await test.step('Create and send a second order through the UI', async () => {
      await createOrderViaUi(page, {
        customerName: orderCustomer.company,
        customerEmail: orderCustomer.email,
        customerAddress: orderCustomer.address,
        notes: 'Sent smoke order for weights and invoice printing',
        product: orderProduct,
        sendToProcessing: true,
      });
      await captureWorkbenchOrderNumber(page, orderCustomer.company, 'in_process');
    });

    await test.step('Enter weights and print the generated invoice from the dashboard queue', async () => {
      await openDashboardWeightQueue(page);
      await saveWeightAndPrintInvoice(page, orderCustomer.company);
    });

    await test.step('Verify the generated invoice appears in the invoices workspace', async () => {
      await openWorkspace(page, 'Invoices', {
        headingName: 'Invoices',
        urlPath: '/dashboard-v2/invoices',
      });
      await page.getByPlaceholder('Invoice #, customer, lot #...').fill(orderCustomer.company);
      await expect(page.locator('table').locator('tbody tr').filter({ hasText: orderCustomer.company }).first()).toBeVisible();
    });

    await test.step('Exercise inventory actions and printable count-sheet UI', async () => {
      await exerciseInventoryPage(page, viableInventoryItemNumbers);
    });

    await test.step('Create, edit, and populate a route through the UI', async () => {
      await buildAndExerciseRoute(page, routeName, routeCustomer.company, pendingOrderNumber);
    });
  } finally {
    const [customers, orders, invoices] = await Promise.all([
      fetchJson<CustomerRow[]>(page, '/api/customers').catch(() => []),
      fetchJson<OrderRow[]>(page, '/api/orders').catch(() => []),
      fetchJson<InvoiceRow[]>(page, '/api/invoices').catch(() => []),
    ]);

    for (const invoice of invoices.filter((row) => row.customer_name === orderCustomer.company)) {
      await deletePath(page, `/api/invoices/${invoice.id}`).catch(() => undefined);
    }

    for (const order of orders.filter((row) => row.customer_name === orderCustomer.company)) {
      await deletePath(page, `/api/orders/${order.id}`).catch(() => undefined);
    }

    for (const customer of customers.filter((row) => row.company_name === orderCustomer.company || row.company_name === routeCustomer.company)) {
      await deletePath(page, `/api/customers/${customer.id}`).catch(() => undefined);
    }
  }
});
