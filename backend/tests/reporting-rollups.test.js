const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { computeRollups } = require('../routes/reporting');

const repoRoot = path.resolve(__dirname, '..', '..');
const reportingRouteSource = fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'reporting.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(repoRoot, 'backend', 'server.js'), 'utf8');
const frontendSource = fs.readFileSync(path.join(repoRoot, 'frontend', 'index.html'), 'utf8');

function byLabel(rows, label) {
  return (rows || []).find((row) => row.label === label);
}

test('reporting route is mounted with auth + manager/admin role guard', () => {
  assert.ok(reportingRouteSource.includes("router.get('/rollups', authenticateToken, requireRole('admin', 'manager')"));
  assert.ok(reportingRouteSource.includes("const limit = Math.max(1, Math.min(parseInt(req.query.limit || '100', 10), 500));"));
  assert.ok(serverSource.includes("const reportingRouter = require('./routes/reporting').router;"));
  assert.ok(serverSource.includes("app.use('/api/reporting', reportingRouter);"));
});

test('analytics UI integrates reporting rollups controls and API call', () => {
  for (const marker of [
    'id="reportStartDate"',
    'id="reportEndDate"',
    'id="reportRowLimit"',
    'id="reportingOverview"',
    'id="reportingRollupGrid"',
    "fetch(`${API}/reporting/rollups?${params.toString()}`, authHeaders)",
    'function renderReportingRollups()',
    'function fetchReportingRollups()',
  ]) {
    assert.ok(frontendSource.includes(marker), `missing reporting UI marker ${marker}`);
  }
});

test('computeRollups aggregates customer, route, driver, SKU, and margin metrics', () => {
  const data = computeRollups({
    orders: [
      {
        id: 'o-1',
        created_at: '2026-04-20T08:00:00.000Z',
        customer_name: 'Blue Crab Cafe',
        customer_email: 'ops@bluecrabcafe.com',
        route_id: 'r-1',
        driver_name: 'Dana Driver',
      },
      {
        id: 'o-2',
        created_at: '2026-04-20T11:00:00.000Z',
        customer_name: 'Harbor Grill',
        customer_email: 'chef@harborgrill.com',
        route_id: 'r-2',
        driver_name: 'Riley Driver',
      },
    ],
    invoices: [
      {
        id: 'inv-1',
        order_id: 'o-1',
        created_at: '2026-04-20T10:00:00.000Z',
        customer_name: 'Blue Crab Cafe',
        customer_email: 'ops@bluecrabcafe.com',
        total: 300,
        items: [
          { item_number: 'SAL-001', description: 'Atlantic Salmon', quantity: 10, unit_price: 20, total: 200 },
          { item_number: 'SHR-002', description: 'White Shrimp', quantity: 5, unit_price: 20, total: 100 },
        ],
      },
      {
        id: 'inv-2',
        order_id: 'o-2',
        created_at: '2026-04-20T12:00:00.000Z',
        customer_name: 'Harbor Grill',
        customer_email: 'chef@harborgrill.com',
        total: 120,
        items: [
          { description: 'Atlantic Salmon', quantity: 4, unit_price: 30, total: 120 },
        ],
      },
    ],
    routes: [
      { id: 'r-1', name: 'Downtown Loop' },
      { id: 'r-2', name: 'Island Loop' },
    ],
    inventory: [
      { item_number: 'SAL-001', description: 'Atlantic Salmon', cost: 12 },
      { item_number: 'SHR-002', description: 'White Shrimp', cost: 8 },
    ],
    startDate: null,
    endDate: null,
    limit: 10,
  });

  assert.equal(data.overview.order_count, 2);
  assert.equal(data.overview.invoice_count, 2);
  assert.equal(data.overview.revenue, 420);
  assert.equal(data.overview.estimated_cost, 208);
  assert.equal(data.overview.margin, 212);

  const blueCrab = byLabel(data.customer, 'Blue Crab Cafe');
  assert.ok(blueCrab);
  assert.equal(blueCrab.revenue, 300);
  assert.equal(blueCrab.estimated_cost, 160);

  const downtownRoute = byLabel(data.route, 'Downtown Loop');
  assert.ok(downtownRoute);
  assert.equal(downtownRoute.revenue, 300);

  const dana = byLabel(data.driver, 'Dana Driver');
  assert.ok(dana);
  assert.equal(dana.revenue, 300);

  assert.ok((data.sku || []).length >= 2);
  assert.ok((data.sku || []).some((row) => row.label === 'Atlantic Salmon' || row.label === 'SAL-001'));
});

test('computeRollups honors date range filters for both orders and invoices', () => {
  const data = computeRollups({
    orders: [{ id: 'o-1', created_at: '2026-04-18T00:00:00.000Z', customer_name: 'Old Order' }],
    invoices: [{ id: 'inv-1', created_at: '2026-04-18T00:00:00.000Z', total: 99, items: [] }],
    routes: [],
    inventory: [],
    startDate: new Date('2026-04-20T00:00:00.000Z'),
    endDate: new Date('2026-04-22T23:59:59.000Z'),
    limit: 10,
  });

  assert.equal(data.overview.order_count, 0);
  assert.equal(data.overview.invoice_count, 0);
  assert.equal(data.overview.revenue, 0);
});
