const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..', '..');
const stopsRouteSource = fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'stops.js'), 'utf8');
const dwellRouteSource = fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'dwell.js'), 'utf8');
const lotsRouteSource = fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'lots.js'), 'utf8');
const warehouseRouteSource = fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'warehouse.js'), 'utf8');
const salesRepsRouteSource = fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'sales-reps.js'), 'utf8');

test('stops routes scope list/detail reads and keep only one dwell action handler per endpoint', () => {
  for (const marker of [
    "res.json(filterRowsByContext(data || [], req.context));",
    "if (!rowMatchesContext(data, req.context)) {",
    "if (!rowMatchesContext(stop, req.context)) {",
    "if (!rowMatchesContext(route, req.context)) {",
  ]) {
    assert.ok(stopsRouteSource.includes(marker), `stops route missing tenant isolation marker ${marker}`);
  }

  assert.equal((stopsRouteSource.match(/router\.post\('\/:id\/arrive'/g) || []).length, 1, 'stops route should register arrive once');
  assert.equal((stopsRouteSource.match(/router\.post\('\/:id\/depart'/g) || []).length, 1, 'stops route should register depart once');
  assert.equal((stopsRouteSource.match(/router\.post\('\/:id\/defer'/g) || []).length, 1, 'stops route should register defer once');
});

test('dwell, lots, warehouse, and sales-reps routes enforce context filtering on sensitive reads', () => {
  assert.ok(dwellRouteSource.includes("res.json(filterRowsByContext(data || [], req.context));"), 'dwell records should be scoped before response');

  for (const marker of [
    "const lot = filterRowsByContext(lotRows || [], context)[0] || null;",
    "res.json(filterRowsByContext(data || [], req.context));",
    "orderRows = filterRowsByContext(matchedOrders || [], req.context).filter((o) =>",
  ]) {
    assert.ok(lotsRouteSource.includes(marker), `lots route missing scope marker ${marker}`);
  }

  for (const marker of [
    'const scopedInventory = filterRowsByContext(inventory || [], req.context);',
    "res.json(filterRowsByContext(data || [], req.context));",
    "if (!rowMatchesContext(existing, req.context)) return res.status(403).json({ error: 'Forbidden' });",
  ]) {
    assert.ok(warehouseRouteSource.includes(marker), `warehouse route missing scope marker ${marker}`);
  }

  for (const marker of [
    'const SALES_REP_ADMIN_ROLES = new Set([',
    "res.json(filterRowsByContext(data || [], req.context));",
    "if (!rowMatchesContext(customer, req.context)) return res.status(403).json({ error: 'Forbidden' });",
    "const orders = filterRowsByContext(ordersResult.data || [], req.context);",
  ]) {
    assert.ok(salesRepsRouteSource.includes(marker), `sales-reps route missing scope marker ${marker}`);
  }
});
