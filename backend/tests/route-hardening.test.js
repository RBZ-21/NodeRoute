const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

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
  const html = fs.readFileSync(path.join(repoRoot, 'frontend', 'index.html'), 'utf8');
  for (const helper of [
    'function normalizeRoute',
    'function customerName',
    'function filterOrderCustomers',
    'function submitInventoryCount',
    'function printInventoryCountSheet',
    'function requestWalkthrough',
    'function routeActiveStopIds',
    'function openEditCustomerModal',
  ]) {
    assert.ok(html.includes(helper), `missing ${helper}`);
  }
  assert.ok(html.includes("headers: { 'Content-Type': 'application/json', ...authHeaders.headers }"));
  assert.ok(html.includes('Number.isFinite(cost)'), 'route optimization should ignore invalid matrix costs');
  assert.ok(html.includes('OSRM returned no duration matrix'), 'route optimization should handle bad OSRM payloads');
});

test('routes backend normalizes stop id payloads for create and update', () => {
  const { normalizeStopIds } = require('../routes/routes');

  assert.deepEqual(normalizeStopIds([' a ', '', null, 'b']), ['a', 'b']);
  assert.deepEqual(normalizeStopIds('a, b,, c'), ['a', 'b', 'c']);
  assert.deepEqual(normalizeStopIds(undefined), []);
});

test('driver routes import invoice stop matching helper', () => {
  const source = routeSource('driver');
  const { routeStopIdsForToday } = require('../routes/driver');

  assert.ok(source.includes('stopMatchesInvoice'), 'driver route hydration needs stopMatchesInvoice');
  assert.ok(source.includes("require('../services/driver-invoice-access')"));
  assert.ok(source.includes('lat < -90 || lat > 90'), 'driver location should validate latitude bounds');
  assert.ok(source.includes('lng < -180 || lng > 180'), 'driver location should validate longitude bounds');
  assert.deepEqual(routeStopIdsForToday({ stop_ids: ['a', 'b'], active_stop_ids: ['b'] }), ['b']);
  assert.deepEqual(routeStopIdsForToday({ stop_ids: ['a', 'b'] }), ['a', 'b']);
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
