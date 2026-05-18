const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..', '..');
const migration = fs.readFileSync(
  path.join(repoRoot, 'supabase', 'migrations', '20260518_invoice_status_constraint.sql'),
  'utf8',
);

test('invoice status constraint allows application delivery and payment states', () => {
  for (const status of ['signed', 'sent', 'delivered', 'overdue', 'paid', 'void']) {
    assert.ok(migration.includes(`'${status}'`), `invoice constraint must allow ${status}`);
  }
  assert.ok(migration.includes('drop constraint if exists invoices_status_check'));
  assert.ok(migration.includes('add constraint invoices_status_check'));
});
