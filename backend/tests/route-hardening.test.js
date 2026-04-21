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
  ]) {
    assert.ok(html.includes(helper), `missing ${helper}`);
  }
  assert.ok(html.includes("headers: { 'Content-Type': 'application/json', ...authHeaders.headers }"));
});
