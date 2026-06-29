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
      key.includes(`${path.sep}backend${path.sep}services${path.sep}finance-charges.js`) ||
      key.includes(`${path.sep}backend${path.sep}services${path.sep}ar-ledger.js`)
    ) {
      delete require.cache[key];
    }
  }
}

async function withFinanceCharges(fn) {
  const previousBackupPath = process.env.NODEROUTE_BACKUP_PATH;
  const previousForceDemoMode = process.env.NODEROUTE_FORCE_DEMO_MODE;
  const previousRate = process.env.AR_FINANCE_CHARGE_RATE;
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-finance-charges-'));

  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  process.env.AR_FINANCE_CHARGE_RATE = '0.015';
  clearBackendModuleCache();

  try {
    const { supabase } = require('../services/supabase');
    const financeCharges = require('../services/finance-charges');
    await fn({ supabase, financeCharges, context: { companyId: 'company-finance-a', locationId: 'location-finance-a' } });
  } finally {
    if (previousBackupPath === undefined) delete process.env.NODEROUTE_BACKUP_PATH;
    else process.env.NODEROUTE_BACKUP_PATH = previousBackupPath;
    if (previousForceDemoMode === undefined) delete process.env.NODEROUTE_FORCE_DEMO_MODE;
    else process.env.NODEROUTE_FORCE_DEMO_MODE = previousForceDemoMode;
    if (previousRate === undefined) delete process.env.AR_FINANCE_CHARGE_RATE;
    else process.env.AR_FINANCE_CHARGE_RATE = previousRate;
    clearBackendModuleCache();
    fs.rmSync(backupPath, { recursive: true, force: true });
  }
}

async function seedOverdueInvoice(supabase) {
  await supabase.from('Customers').insert({
    id: 'customer-finance-1',
    company_id: 'company-finance-a',
    location_id: 'location-finance-a',
    company_name: 'Pier Supply',
  });
  await supabase.from('invoices').insert({
    id: 'invoice-finance-1',
    company_id: 'company-finance-a',
    location_id: 'location-finance-a',
    customer_id: 'customer-finance-1',
    total: 1000,
    open_balance: 1000,
    status: 'overdue',
    due_date: '2026-05-01',
  });
}

test('finance charge preview calculates charges without writing rows', async () => {
  await withFinanceCharges(async ({ supabase, financeCharges, context }) => {
    await seedOverdueInvoice(supabase);

    const preview = await financeCharges.calculateFinanceCharges('company-finance-a', '2026-06-29', 'preview', { db: supabase, context });

    assert.equal(preview.mode, 'preview');
    assert.equal(preview.total_charges, 15);
    assert.equal(preview.entries.length, 1);
    assert.equal(preview.entries[0].days_overdue, 59);

    const { data: runs } = await supabase.from('finance_charge_runs').select('*');
    const { data: entries } = await supabase.from('finance_charge_entries').select('*');
    assert.equal(runs.length, 0);
    assert.equal(entries.length, 0);
  });
});

test('finance charge commit writes run, entries, and is idempotent per run date', async () => {
  await withFinanceCharges(async ({ supabase, financeCharges, context }) => {
    await seedOverdueInvoice(supabase);

    const first = await financeCharges.calculateFinanceCharges('company-finance-a', '2026-06-29', 'commit', { db: supabase, context });
    const second = await financeCharges.calculateFinanceCharges('company-finance-a', '2026-06-29', 'commit', { db: supabase, context });

    assert.equal(first.mode, 'committed');
    assert.equal(first.total_charges, 15);
    assert.equal(second.idempotent, true);

    const { data: runs } = await supabase.from('finance_charge_runs').select('*').eq('company_id', 'company-finance-a');
    assert.equal(runs.length, 1);
    assert.equal(runs[0].status, 'committed');

    const { data: chargeEntries } = await supabase.from('finance_charge_entries').select('*').eq('finance_charge_run_id', runs[0].id);
    assert.equal(chargeEntries.length, 1);
    assert.equal(chargeEntries[0].charge_amount, 15);

    const { data: ledgerEntries } = await supabase.from('ar_ledger_entries').select('*').eq('entry_type', 'finance_charge');
    assert.equal(ledgerEntries.length, 1);
    assert.equal(ledgerEntries[0].amount, 15);
  });
});
