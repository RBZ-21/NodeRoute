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
      key.includes(`${path.sep}backend${path.sep}services${path.sep}ap-ledger.js`)
    ) {
      delete require.cache[key];
    }
  }
}

async function withApLedger(fn) {
  const previousBackupPath = process.env.NODEROUTE_BACKUP_PATH;
  const previousForceDemoMode = process.env.NODEROUTE_FORCE_DEMO_MODE;
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-ap-ledger-'));

  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  clearBackendModuleCache();

  try {
    const { supabase } = require('../services/supabase');
    const ledger = require('../services/ap-ledger');
    await fn({ supabase, ledger, context: { companyId: 'company-ap-a', locationId: 'location-ap-a' } });
  } finally {
    if (previousBackupPath === undefined) delete process.env.NODEROUTE_BACKUP_PATH;
    else process.env.NODEROUTE_BACKUP_PATH = previousBackupPath;
    if (previousForceDemoMode === undefined) delete process.env.NODEROUTE_FORCE_DEMO_MODE;
    else process.env.NODEROUTE_FORCE_DEMO_MODE = previousForceDemoMode;
    clearBackendModuleCache();
    fs.rmSync(backupPath, { recursive: true, force: true });
  }
}

test('postBill writes one AP ledger entry and is idempotent', async () => {
  await withApLedger(async ({ supabase, ledger, context }) => {
    await supabase.from('vendors').insert({
      id: 'vendor-ap-1',
      company_id: 'company-ap-a',
      location_id: 'location-ap-a',
      name: 'Harbor Supply',
    });
    await supabase.from('vendor_bills').insert({
      id: 'bill-ap-1',
      company_id: 'company-ap-a',
      location_id: 'location-ap-a',
      vendor_id: 'vendor-ap-1',
      vendor_name: 'Harbor Supply',
      total: 125,
      status: 'approved',
      due_date: '2026-06-20',
    });

    const first = await ledger.postBill('bill-ap-1', { db: supabase, context });
    const second = await ledger.postBill('bill-ap-1', { db: supabase, context });

    assert.equal(first.entry_type, 'bill');
    assert.equal(first.amount, 125);
    assert.equal(first.balance_after, 125);
    assert.equal(second.idempotent, true);

    const { data: entries } = await supabase.from('ap_ledger_entries').select('*').eq('reference_id', 'bill-ap-1');
    assert.equal(entries.length, 1);
    assert.equal(entries[0].company_id, 'company-ap-a');
    assert.equal(entries[0].location_id, 'location-ap-a');
  });
});

test('processPaymentBatch posts payments, closes bills, and is safe to retry', async () => {
  await withApLedger(async ({ supabase, ledger, context }) => {
    await supabase.from('vendors').insert({
      id: 'vendor-ap-2',
      company_id: 'company-ap-a',
      location_id: 'location-ap-a',
      name: 'Market Supply',
    });
    await supabase.from('vendor_bills').insert({
      id: 'bill-ap-2',
      company_id: 'company-ap-a',
      location_id: 'location-ap-a',
      vendor_id: 'vendor-ap-2',
      vendor_name: 'Market Supply',
      total: 90,
      status: 'approved',
      due_date: '2026-06-10',
    });
    await ledger.postBill('bill-ap-2', { db: supabase, context });
    await supabase.from('ap_payment_batches').insert({
      id: 'batch-ap-2',
      company_id: 'company-ap-a',
      location_id: 'location-ap-a',
      payment_date: '2026-06-29',
      status: 'approved',
      total_amount: 90,
    });
    await supabase.from('ap_payment_batch_items').insert({
      id: 'batch-item-ap-2',
      company_id: 'company-ap-a',
      location_id: 'location-ap-a',
      ap_payment_batch_id: 'batch-ap-2',
      vendor_bill_id: 'bill-ap-2',
      vendor_id: 'vendor-ap-2',
      amount: 90,
    });

    const first = await ledger.processPaymentBatch('batch-ap-2', { db: supabase, context });
    const second = await ledger.processPaymentBatch('batch-ap-2', { db: supabase, context });

    assert.equal(first.status, 'paid');
    assert.equal(second.idempotent, true);

    const { data: bill } = await supabase.from('vendor_bills').select('*').eq('id', 'bill-ap-2').single();
    assert.equal(bill.status, 'paid');

    const { data: entries } = await supabase.from('ap_ledger_entries').select('*').eq('vendor_id', 'vendor-ap-2');
    assert.equal(entries.length, 2);
    assert.equal(entries.find((entry) => entry.entry_type === 'payment').amount, -90);
  });
});

test('getAPAging groups open vendor bills by due date bucket', async () => {
  await withApLedger(async ({ supabase, ledger, context }) => {
    await supabase.from('vendors').insert({
      id: 'vendor-ap-3',
      company_id: 'company-ap-a',
      location_id: 'location-ap-a',
      name: 'Frozen Supply',
    });
    await supabase.from('vendor_bills').insert([
      {
        id: 'bill-ap-current',
        company_id: 'company-ap-a',
        location_id: 'location-ap-a',
        vendor_id: 'vendor-ap-3',
        vendor_name: 'Frozen Supply',
        total: 40,
        status: 'approved',
        due_date: '2026-06-30',
      },
      {
        id: 'bill-ap-60',
        company_id: 'company-ap-a',
        location_id: 'location-ap-a',
        vendor_id: 'vendor-ap-3',
        vendor_name: 'Frozen Supply',
        total: 70,
        status: 'approved',
        due_date: '2026-05-01',
      },
    ]);

    const rows = await ledger.getAPAging('company-ap-a', '2026-06-29', { db: supabase, context });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].vendor_id, 'vendor-ap-3');
    assert.equal(rows[0].buckets.current, 40);
    assert.equal(rows[0].buckets['60'], 70);
    assert.equal(rows[0].total_open, 110);
  });
});
