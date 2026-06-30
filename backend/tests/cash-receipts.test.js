'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function clearBackendModuleCache() {
  for (const key of Object.keys(require.cache)) {
    if (
      key.includes(`${path.sep}backend${path.sep}services${path.sep}supabase.js`) ||
      key.includes(`${path.sep}backend${path.sep}services${path.sep}ar-ledger.js`)
    ) {
      delete require.cache[key];
    }
  }
}

async function withCashReceipts(fn) {
  const previousBackupPath = process.env.NODEROUTE_BACKUP_PATH;
  const previousForceDemoMode = process.env.NODEROUTE_FORCE_DEMO_MODE;
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-cash-receipts-'));

  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  clearBackendModuleCache();

  try {
    const { supabase } = require('../services/supabase');
    const ledger = require('../services/ar-ledger');
    await fn({ supabase, ledger, context: { companyId: 'company-cash-a', locationId: 'location-cash-a' } });
  } finally {
    if (previousBackupPath === undefined) delete process.env.NODEROUTE_BACKUP_PATH;
    else process.env.NODEROUTE_BACKUP_PATH = previousBackupPath;
    if (previousForceDemoMode === undefined) delete process.env.NODEROUTE_FORCE_DEMO_MODE;
    else process.env.NODEROUTE_FORCE_DEMO_MODE = previousForceDemoMode;
    clearBackendModuleCache();
    fs.rmSync(backupPath, { recursive: true, force: true });
  }
}

test('cash receipt application supports partial payment with unapplied remainder', async () => {
  await withCashReceipts(async ({ supabase, ledger, context }) => {
    await supabase.from('Customers').insert({
      id: 'customer-cash-1',
      company_id: 'company-cash-a',
      location_id: 'location-cash-a',
      company_name: 'Dockside Grill',
      current_balance: 200,
    });
    await supabase.from('invoices').insert({
      id: 'invoice-cash-1',
      company_id: 'company-cash-a',
      location_id: 'location-cash-a',
      customer_id: 'customer-cash-1',
      total: 200,
      open_balance: 200,
      status: 'overdue',
      due_date: '2026-05-15',
    });
    await supabase.from('cash_receipts').insert({
      id: 'receipt-cash-1',
      company_id: 'company-cash-a',
      location_id: 'location-cash-a',
      customer_id: 'customer-cash-1',
      receipt_date: '2026-06-29',
      total_amount: 275,
      payment_method: 'check',
      check_number: '5520',
      status: 'new',
    });

    const result = await ledger.applyReceipt('receipt-cash-1', [
      { invoice_id: 'invoice-cash-1', applied_amount: 125 },
    ], { db: supabase, context });

    assert.equal(result.status, 'partially_applied');
    assert.equal(result.applied_amount, 125);
    assert.equal(result.unapplied_amount, 150);

    const { data: receipt } = await supabase.from('cash_receipts').select('*').eq('id', 'receipt-cash-1').single();
    assert.equal(receipt.status, 'partially_applied');
    assert.equal(receipt.unapplied_amount, 150);
    assert.equal(receipt.payment_method, 'check');
    assert.equal(receipt.check_number, '5520');

    const { data: invoice } = await supabase.from('invoices').select('*').eq('id', 'invoice-cash-1').single();
    assert.equal(invoice.open_balance, 75);
    assert.equal(invoice.status, 'overdue');
  });
});
