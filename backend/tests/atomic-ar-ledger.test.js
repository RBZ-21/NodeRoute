'use strict';

// BE-004 regression tests (Root Depth Scan, commit 904d7119).
// Original bug: ar-ledger.js computed customer balance_after and invoice
// open_balance in JS from previously-read rows, then wrote absolute values
// back with no transaction/lock — the same non-atomic read-modify-write
// pattern as BE-001. The fix routes both mutations through atomic Postgres
// RPCs (insert_ar_ledger_entry / apply_invoice_balance_delta) when reachable.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const migrationPath = path.join(
  repoRoot, 'supabase', 'migrations', '20260705110000_atomic_ar_ledger.sql'
);

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
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-atomic-ar-'));

  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  clearBackendModuleCache();

  try {
    const { supabase } = require('../services/supabase');
    const ledger = require('../services/ar-ledger');
    await fn({ supabase, ledger, context: { companyId: 'company-ar-x', locationId: 'location-ar-x' } });
  } finally {
    if (previousBackupPath === undefined) delete process.env.NODEROUTE_BACKUP_PATH;
    else process.env.NODEROUTE_BACKUP_PATH = previousBackupPath;
    if (previousForceDemoMode === undefined) delete process.env.NODEROUTE_FORCE_DEMO_MODE;
    else process.env.NODEROUTE_FORCE_DEMO_MODE = previousForceDemoMode;
    clearBackendModuleCache();
    fs.rmSync(backupPath, { recursive: true, force: true });
  }
}

test('atomic AR migration exists with row locks and same-txn balance updates', () => {
  assert.ok(fs.existsSync(migrationPath), 'atomic AR ledger migration missing');
  const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase();

  assert.ok(sql.includes('create or replace function insert_ar_ledger_entry'));
  assert.ok(sql.includes('create or replace function apply_invoice_balance_delta'));
  // Row-level locks — the core of the concurrency fix.
  assert.ok(sql.includes('for update'), 'migration must lock rows with FOR UPDATE');
  // Customer balance update lives in the same function as the entry insert.
  assert.ok(sql.includes('update "customers"'), 'customer balance update must be in the same txn');
  assert.ok(sql.includes('insert into ar_ledger_entries'));
  // Execution locked to the backend service role.
  assert.ok(sql.includes('to service_role'), 'RPCs must be granted to service_role only');
});

test('ar-ledger service prefers the atomic RPCs over read-modify-write', () => {
  const source = fs.readFileSync(
    path.join(repoRoot, 'backend', 'services', 'ar-ledger.js'), 'utf8'
  );
  assert.ok(source.includes("'insert_ar_ledger_entry'"));
  assert.ok(source.includes("'apply_invoice_balance_delta'"));
});

// Wraps the demo client so reads pass through but any PostgREST-style
// update() is a test failure — if the legacy read-modify-write path runs
// despite working RPCs, that is a regression back to the original bug.
function rpcOnlyDb(supabase, rpcImpl, rpcCalls) {
  return {
    rpc: async (funcName, args) => {
      rpcCalls.push({ funcName, args });
      return rpcImpl(funcName, args);
    },
    from(table) {
      const real = supabase.from(table);
      return new Proxy(real, {
        get(target, prop) {
          if (prop === 'update') {
            return () => {
              throw new Error(`non-atomic update on ${table} despite atomic RPC being available`);
            };
          }
          const value = target[prop];
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  };
}

test('postInvoice routes ledger entry and open-balance init through atomic RPCs', async () => {
  await withArLedger(async ({ supabase, ledger, context }) => {
    await supabase.from('Customers').insert({
      id: 'customer-atomic-1',
      company_id: 'company-ar-x',
      location_id: 'location-ar-x',
      company_name: 'Atomic Fish Co',
      current_balance: 0,
    });
    await supabase.from('invoices').insert({
      id: 'invoice-atomic-1',
      company_id: 'company-ar-x',
      location_id: 'location-ar-x',
      customer_id: 'customer-atomic-1',
      total: 200,
      status: 'sent',
    });

    const rpcCalls = [];
    const db = rpcOnlyDb(supabase, (funcName) => {
      if (funcName === 'insert_ar_ledger_entry') {
        return {
          data: {
            ok: true,
            idempotent: false,
            entry: {
              customer_id: 'customer-atomic-1',
              entry_type: 'invoice',
              reference_id: 'invoice-atomic-1',
              amount: 200,
              balance_after: 200,
            },
            balance_after: 200,
          },
          error: null,
        };
      }
      if (funcName === 'apply_invoice_balance_delta') {
        return { data: { ok: true, invoice: { id: 'invoice-atomic-1', open_balance: 200 }, open_balance: 200 }, error: null };
      }
      return { data: null, error: null };
    }, rpcCalls);

    const entry = await ledger.postInvoice('invoice-atomic-1', { db, context });

    assert.equal(entry.entry_type, 'invoice');
    assert.equal(entry.balance_after, 200);
    const names = rpcCalls.map((call) => call.funcName);
    assert.ok(names.includes('insert_ar_ledger_entry'), 'ledger entry must go through the atomic RPC');
    assert.ok(names.includes('apply_invoice_balance_delta'), 'open-balance init must go through the atomic RPC');

    const ledgerCall = rpcCalls.find((call) => call.funcName === 'insert_ar_ledger_entry');
    assert.equal(ledgerCall.args.p_customer_id, 'customer-atomic-1');
    assert.equal(ledgerCall.args.p_amount, 200);
    const balanceCall = rpcCalls.find((call) => call.funcName === 'apply_invoice_balance_delta');
    assert.equal(balanceCall.args.p_set_absolute, 200);
    assert.equal(balanceCall.args.p_delta, null);
  });
});

test('applyReceipt sends delta (not JS-computed absolute) to the atomic RPC', async () => {
  await withArLedger(async ({ supabase, ledger, context }) => {
    await supabase.from('Customers').insert({
      id: 'customer-atomic-2',
      company_id: 'company-ar-x',
      location_id: 'location-ar-x',
      current_balance: 150,
    });
    await supabase.from('invoices').insert({
      id: 'invoice-atomic-2',
      company_id: 'company-ar-x',
      location_id: 'location-ar-x',
      customer_id: 'customer-atomic-2',
      total: 150,
      open_balance: 150,
      status: 'sent',
      due_date: '2026-06-01',
    });
    await supabase.from('cash_receipts').insert({
      id: 'receipt-atomic-2',
      company_id: 'company-ar-x',
      location_id: 'location-ar-x',
      customer_id: 'customer-atomic-2',
      receipt_date: '2026-07-01',
      total_amount: 60,
      status: 'new',
    });

    const rpcCalls = [];
    const db = {
      rpc: async (funcName, args) => {
        rpcCalls.push({ funcName, args });
        if (funcName === 'apply_invoice_balance_delta') {
          return { data: { ok: true, invoice: { id: 'invoice-atomic-2', open_balance: 90 }, open_balance: 90 }, error: null };
        }
        if (funcName === 'insert_ar_ledger_entry') {
          return {
            data: {
              ok: true,
              idempotent: false,
              entry: { customer_id: 'customer-atomic-2', entry_type: 'payment', amount: -60, balance_after: 90 },
            },
            error: null,
          };
        }
        return { data: null, error: null };
      },
      from: (table) => supabase.from(table),
    };

    const result = await ledger.applyReceipt('receipt-atomic-2', [
      { invoice_id: 'invoice-atomic-2', applied_amount: 60 },
    ], { db, context });

    assert.equal(result.applied_amount, 60);
    const balanceCall = rpcCalls.find((call) => call.funcName === 'apply_invoice_balance_delta');
    assert.ok(balanceCall, 'invoice balance change must go through the atomic RPC');
    assert.equal(balanceCall.args.p_delta, 60, 'RPC must receive the delta, not a JS-computed absolute');
    assert.equal(balanceCall.args.p_set_absolute, null);
  });
});

test('insertLedgerEntry maps RPC idempotent replays and customer-not-found', async () => {
  await withArLedger(async ({ ledger, context }) => {
    const idempotentDb = {
      rpc: async () => ({
        data: { ok: true, idempotent: true, entry: { entry_type: 'invoice', reference_id: 'inv-9', amount: 50 } },
        error: null,
      }),
      from: () => { throw new Error('should not touch tables on idempotent RPC replay'); },
    };
    const replay = await ledger.insertLedgerEntry(idempotentDb, {
      customer_id: 'customer-atomic-3',
      entry_type: 'invoice',
      reference_id: 'inv-9',
      amount: 50,
    }, context);
    assert.equal(replay.idempotent, true);

    const missingDb = {
      rpc: async () => ({ data: { ok: false, code: 'AR_CUSTOMER_NOT_FOUND', customer_id: 'ghost' }, error: null }),
      from: () => { throw new Error('should not fall back on customer-not-found'); },
    };
    await assert.rejects(
      ledger.insertLedgerEntry(missingDb, {
        customer_id: 'ghost',
        entry_type: 'invoice',
        reference_id: 'inv-10',
        amount: 25,
      }, context),
      /Customers ghost: not found/
    );
  });
});
