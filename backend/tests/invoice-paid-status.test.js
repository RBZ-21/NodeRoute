const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..', '..');
const invoicesRoute = fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'invoices.js'), 'utf8');

test('invoice paid status transition stamps both paid timestamp columns', () => {
  assert.ok(invoicesRoute.includes("updates.status = nextStatus"), 'invoice PATCH must update status');
  assert.ok(invoicesRoute.includes("if (nextStatus === 'paid')"), 'invoice PATCH must handle paid transition');
  assert.ok(invoicesRoute.includes('updates.paid_date = paidAt'), 'invoice PATCH must stamp paid_date');
  assert.ok(invoicesRoute.includes('updates.paid_at = paidAt'), 'invoice PATCH must stamp paid_at');
});
