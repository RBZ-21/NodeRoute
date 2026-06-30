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
      key.includes(`${path.sep}backend${path.sep}services${path.sep}ar-ledger.js`) ||
      key.includes(`${path.sep}backend${path.sep}services${path.sep}creditEngine.js`)
    ) {
      delete require.cache[key];
    }
  }
}

async function withArLedger(fn) {
  const previousBackupPath = process.env.NODEROUTE_BACKUP_PATH;
  const previousForceDemoMode = process.env.NODEROUTE_FORCE_DEMO_MODE;
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-ar-ledger-'));

  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  clearBackendModuleCache();

  try {
    const { supabase } = require('../services/supabase');
    const ledger = require('../services/ar-ledger');
    await fn({ supabase, ledger, context: { companyId: 'company-ar-a', locationId: 'location-ar-a' } });
  } finally {
    if (previousBackupPath === undefined) delete process.env.NODEROUTE_BACKUP_PATH;
    else process.env.NODEROUTE_BACKUP_PATH = previousBackupPath;
    if (previousForceDemoMode === undefined) delete process.env.NODEROUTE_FORCE_DEMO_MODE;
    else process.env.NODEROUTE_FORCE_DEMO_MODE = previousForceDemoMode;
    clearBackendModuleCache();
    fs.rmSync(backupPath, { recursive: true, force: true });
  }
}

test('postInvoice writes an invoice ledger entry and updates customer balance', async () => {
  await withArLedger(async ({ supabase, ledger, context }) => {
    await supabase.from('Customers').insert({
      id: 'customer-ar-1',
      company_id: 'company-ar-a',
      location_id: 'location-ar-a',
      company_name: 'Blue Fin Market',
      current_balance: 0,
      credit_limit: 500,
    });
    await supabase.from('invoices').insert({
      id: 'invoice-ar-1',
      company_id: 'company-ar-a',
      location_id: 'location-ar-a',
      customer_id: 'customer-ar-1',
      customer_name: 'Blue Fin Market',
      total: 150,
      status: 'sent',
      due_date: '2026-06-01',
      created_at: '2026-05-01T00:00:00.000Z',
    });

    const posted = await ledger.postInvoice('invoice-ar-1', { db: supabase, context });

    assert.equal(posted.entry_type, 'invoice');
    assert.equal(posted.amount, 150);
    assert.equal(posted.balance_after, 150);

    const { data: entries } = await supabase.from('ar_ledger_entries').select('*').eq('reference_id', 'invoice-ar-1');
    assert.equal(entries.length, 1);
    assert.equal(entries[0].company_id, 'company-ar-a');

    const { data: customer } = await supabase.from('Customers').select('*').eq('id', 'customer-ar-1').single();
    assert.equal(customer.current_balance, 150);
  });
});

test('applyReceipt reduces open balance and is idempotent when retried', async () => {
  await withArLedger(async ({ supabase, ledger, context }) => {
    await supabase.from('Customers').insert({
      id: 'customer-ar-2',
      company_id: 'company-ar-a',
      location_id: 'location-ar-a',
      company_name: 'Harbor Cafe',
      current_balance: 150,
    });
    await supabase.from('invoices').insert({
      id: 'invoice-ar-2',
      company_id: 'company-ar-a',
      location_id: 'location-ar-a',
      customer_id: 'customer-ar-2',
      customer_name: 'Harbor Cafe',
      total: 150,
      open_balance: 150,
      status: 'sent',
      due_date: '2026-06-01',
    });
    await supabase.from('cash_receipts').insert({
      id: 'receipt-ar-2',
      company_id: 'company-ar-a',
      location_id: 'location-ar-a',
      customer_id: 'customer-ar-2',
      receipt_date: '2026-06-29',
      total_amount: 60,
      payment_method: 'check',
      check_number: '1021',
      status: 'new',
    });

    const first = await ledger.applyReceipt('receipt-ar-2', [
      { invoice_id: 'invoice-ar-2', applied_amount: 60 },
    ], { db: supabase, context });
    const second = await ledger.applyReceipt('receipt-ar-2', [
      { invoice_id: 'invoice-ar-2', applied_amount: 60 },
    ], { db: supabase, context });

    assert.equal(first.status, 'applied');
    assert.equal(second.idempotent, true);

    const { data: applications } = await supabase.from('cash_receipt_applications').select('*').eq('cash_receipt_id', 'receipt-ar-2');
    assert.equal(applications.length, 1);
    assert.equal(applications[0].applied_amount, 60);

    const { data: invoice } = await supabase.from('invoices').select('*').eq('id', 'invoice-ar-2').single();
    assert.equal(invoice.open_balance, 90);
    assert.equal(invoice.status, 'sent');

    const { data: entries } = await supabase.from('ar_ledger_entries').select('*').eq('reference_id', 'receipt-ar-2');
    assert.equal(entries.length, 1);
    assert.equal(entries[0].entry_type, 'payment');
    assert.equal(entries[0].amount, -60);
  });
});
