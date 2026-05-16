const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

// Route modules throw at load time when JWT_SECRET is absent (intentional
// production guard). Provide a dev value so require() succeeds in tests.
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'test-dev-secret';

const repoRoot = path.resolve(__dirname, '..', '..');
const routeDir = path.join(repoRoot, 'backend', 'routes');

function routeSource(name) {
  return fs.readFileSync(path.join(routeDir, `${name}.js`), 'utf8');
}

test('hardened routes do not write raw request bodies', () => {
  for (const name of ['customers', 'stops', 'routes', 'orders', 'invoices', 'inventory']) {
    const source = routeSource(name);
    assert.equal(/update\(req\.body\)/.test(source), false, `${name} uses raw req.body update`);
    assert.equal(/insert\(\[req\.body\]/.test(source), false, `${name} uses raw req.body insert`);
  }
});

test('manager write routes include role checks and context guards', () => {
  const expectations = {
    customers: ['requireRole(\'admin\', \'manager\')', 'rowMatchesContext(existing, req.context)', 'insertRecordWithOptionalScope'],
    stops: ['requireRole(\'admin\', \'manager\')', 'rowMatchesContext(existing, req.context)', 'insertRecordWithOptionalScope'],
    routes: ['requireRole(\'admin\', \'manager\')', 'rowMatchesContext(existing, req.context)', 'insertRecordWithOptionalScope'],
    orders: ['requireRole(\'admin\', \'manager\')', 'rowMatchesContext(existing, req.context)', 'insertRecordWithOptionalScope'],
    invoices: ['requireRole(\'admin\', \'manager\')', 'rowMatchesContext(inv, req.context)', 'insertRecordWithOptionalScope'],
    inventory: ['requireRole(\'admin\', \'manager\')', 'rowMatchesContext(existing, req.context)', 'filterRowsByContext'],
  };

  for (const [name, needles] of Object.entries(expectations)) {
    const source = routeSource(name);
    for (const needle of needles) {
      assert.ok(source.includes(needle), `${name} missing ${needle}`);
    }
  }
});

test('frontend workflow helpers required by dispatch operations are present', () => {
  const srcDir = path.join(repoRoot, 'frontend-v2', 'src');
  function readSrc(...files) {
    return files.map((f) => fs.readFileSync(path.join(srcDir, f), 'utf8')).join('\n');
  }
  const ordersSrc    = readSrc('pages/OrdersPage.tsx');
  const invoicesSrc  = readSrc('pages/InvoicesPage.tsx');
  const inventorySrc = readSrc('pages/InventoryPage.tsx');
  const navSrc       = readSrc('lib/nav.ts');

  assert.ok(ordersSrc.includes("'/api/ai/order-intake'"), 'orders page must call AI order-intake API');
  assert.ok(invoicesSrc.includes('function customerName'), 'invoices page should expose customer name helper');
  assert.ok(inventorySrc.includes('function printCountSheet'), 'inventory page should expose count sheet print');
  assert.ok(inventorySrc.includes('function downloadCsv'), 'inventory page should expose CSV export');
  assert.ok(navSrc.includes("id: 'purchasing'"), 'nav should define purchasing tab');
  assert.ok(navSrc.includes("id: 'warehouse'"), 'nav should define warehouse tab');
  assert.ok(navSrc.includes("id: 'integrations'"), 'nav should define integrations tab');
});

test('routes backend normalizes stop id payloads for create and update', () => {
  const { normalizeStopIds } = require('../routes/routes');

  assert.deepEqual(normalizeStopIds([' a ', '', null, 'b']), ['a', 'b']);
  assert.deepEqual(normalizeStopIds('a, b,, c'), ['a', 'b', 'c']);
  assert.deepEqual(normalizeStopIds(undefined), []);
});

test('processing workflow optional schema fields can be stripped on older databases', () => {
  const { isMissingColumnError } = require('../services/operating-context');
  const source = fs.readFileSync(path.join(repoRoot, 'backend', 'services', 'operating-context.js'), 'utf8');

  assert.equal(isMissingColumnError({ message: "Could not find the 'tracking_token' column of 'orders' in the schema cache" }), true);
  for (const field of ['tracking_token', 'tracking_expires_at', 'invoice_id', 'driver_name', 'route_id', 'charges']) {
    assert.ok(source.includes(`'${field}'`), `missing optional schema field ${field}`);
  }
});

test('driver routes import invoice stop matching helper', () => {
  const source = routeSource('driver');
  const { routeStopIdsForToday } = require('../routes/driver');

  assert.ok(source.includes('stopMatchesInvoice'), 'driver route hydration needs stopMatchesInvoice');
  assert.ok(source.includes("require('../services/driver-invoice-access')"));
  assert.ok(source.includes('validateBody(driverLocationBodySchema)'), 'driver location should use shared Zod body validation');
  assert.ok(source.includes('Valid lat and lng are required'), 'driver location should reject invalid coordinates');
  assert.deepEqual(routeStopIdsForToday({ stop_ids: ['a', 'b'], active_stop_ids: ['b'] }), ['b']);
  assert.deepEqual(routeStopIdsForToday({ stop_ids: ['a', 'b'] }), ['a', 'b']);
});

test('temperature logs routes use shared Zod validation for body and query payloads', () => {
  const source = routeSource('temperature-logs');
  assert.ok(source.includes("require('../lib/zod-validate')"), 'temperature logs should import shared Zod helpers');
  assert.ok(source.includes('validateQuery(temperatureLogQuerySchema)'), 'temperature logs GET should validate queries');
  assert.ok(source.includes('validateBody(temperatureLogBodySchema)'), 'temperature logs POST should validate body payloads');
  assert.ok(source.includes('Date must be in YYYY-MM-DD format'), 'temperature logs query should validate date formatting');
});

test('invoice, inventory, and purchase-order routes enforce shared Zod validation for high-risk inputs', () => {
  const invoices = routeSource('invoices');
  const inventory = routeSource('inventory');
  const purchaseOrders = routeSource('purchase-orders');

  assert.ok(invoices.includes('validateBody(invoiceBodySchema)'), 'invoices should use shared body validation');
  assert.ok(invoices.includes('customer_name is required'), 'invoices should require customer_name');
  assert.ok(invoices.includes('items is required'), 'invoices should require items');
  assert.ok(invoices.includes('subtotal must be a number'), 'invoices should validate subtotal');
  assert.ok(invoices.includes('total must be a number'), 'invoices should validate total');

  assert.ok(inventory.includes('validateBody(inventoryCreateBodySchema)'), 'inventory should use shared body validation');
  assert.ok(inventory.includes('item_number required'), 'inventory should require item_number');
  assert.ok(
    inventory.includes('on_hand_qty must be a finite number ≥ 0')
    || inventory.includes('on_hand_qty must be a finite number \\u2265 0'),
    'inventory should validate non-negative on_hand_qty'
  );

  assert.ok(purchaseOrders.includes('validateBody(purchaseOrderConfirmSchema)'), 'purchase orders should use shared body validation');
  assert.ok(purchaseOrders.includes('vendor is required'), 'purchase orders should require vendor');
  assert.ok(purchaseOrders.includes('items is required'), 'purchase orders should require items');
  assert.ok(purchaseOrders.includes('quantity must be a positive number'), 'purchase orders should validate item quantity');
});

test('ai routes protect order-intake automation behind auth and manager/admin checks', () => {
  const source = routeSource('ai');
  assert.ok(source.includes("router.post('/order-intake', authenticateToken, requireRole('admin', 'manager')"), 'order-intake route should require manager/admin auth');
  assert.ok(source.includes("const message = String(req.body.message || '').trim();"), 'order-intake route should normalize intake payload');
  assert.ok(source.includes('Order intake message is required'), 'order-intake route should validate empty payload');
});

test('dwell tracking requires assigned routes and route stop membership', () => {
  const source = routeSource('stops');
  const { isRouteAssignedToUser } = require('../routes/stops');
  const user = { id: 'driver-1', email: 'driver@example.com', name: 'Jamie Driver' };

  assert.ok(source.includes('authorizeDwellEvent'), 'arrive/depart should authorize dwell events');
  assert.ok(source.includes('active_stop_ids'), 'dwell events should honor today\'s selected stops');
  assert.ok(source.includes('Stop is not part of this route'), 'dwell events should verify stop membership');
  assert.ok(source.includes('Route is not assigned to this driver'), 'driver dwell events should verify route assignment');
  assert.equal(isRouteAssignedToUser({ driver_id: 'driver-1' }, user), true);
  assert.equal(isRouteAssignedToUser({ driver: 'Someone Else' }, user), false);
});
