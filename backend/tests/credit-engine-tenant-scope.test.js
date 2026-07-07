'use strict';

// BE-002 regression tests (Root Depth Scan, commit 904d7119).
// Original bug: creditEngine resolved customers by name with no tenant scope,
// so an order placed under company A could match company B's customer and the
// 402 response echoed B's balance, credit limit, and hold reason. The name
// input was also passed to .ilike() unescaped.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');

function clearBackendModuleCache() {
  for (const key of Object.keys(require.cache)) {
    if (
      key.includes(`${path.sep}backend${path.sep}services${path.sep}supabase.js`) ||
      key.includes(`${path.sep}backend${path.sep}services${path.sep}creditEngine.js`)
    ) {
      delete require.cache[key];
    }
  }
}

async function withCreditEngine(fn) {
  const previousBackupPath = process.env.NODEROUTE_BACKUP_PATH;
  const previousForceDemoMode = process.env.NODEROUTE_FORCE_DEMO_MODE;
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-credit-scope-'));

  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  clearBackendModuleCache();

  try {
    const { supabase } = require('../services/supabase');
    const creditEngine = require('../services/creditEngine');
    await fn({ supabase, creditEngine });
  } finally {
    if (previousBackupPath === undefined) delete process.env.NODEROUTE_BACKUP_PATH;
    else process.env.NODEROUTE_BACKUP_PATH = previousBackupPath;
    if (previousForceDemoMode === undefined) delete process.env.NODEROUTE_FORCE_DEMO_MODE;
    else process.env.NODEROUTE_FORCE_DEMO_MODE = previousForceDemoMode;
    clearBackendModuleCache();
    fs.rmSync(backupPath, { recursive: true, force: true });
  }
}

test('checkOrderAllowed cannot resolve another tenant\'s customer by name', async () => {
  await withCreditEngine(async ({ supabase, creditEngine }) => {
    // Same customer name in two companies; company B's is on credit hold with
    // a fat balance. Before the fix, company A's order lookup matched B's row
    // and the 402 echoed B's balance/limit/hold-reason.
    await supabase.from('Customers').insert({
      id: 'cust-tenant-b',
      company_id: 'company-b',
      company_name: 'Harbor Seafood',
      credit_hold: true,
      credit_hold_reason: 'past_due',
      current_balance: 98765.43,
      credit_limit: 500,
    });
    await supabase.from('Customers').insert({
      id: 'cust-tenant-a',
      company_id: 'company-a',
      company_name: 'Harbor Seafood',
      credit_hold: false,
      current_balance: 100,
      credit_limit: 10000,
    });

    const contextA = { companyId: 'company-a', activeCompanyId: 'company-a' };
    const decision = await creditEngine.checkOrderAllowed({
      customer_name: 'Harbor Seafood',
      order_total: 50,
      context: contextA,
    });

    assert.equal(decision.allowed, true, 'company A order must not be blocked by company B\'s hold');
    assert.notEqual(decision.customer_id, 'cust-tenant-b', 'must never resolve to the foreign tenant\'s customer');
    assert.equal(decision.customer_id, 'cust-tenant-a');

    // And the foreign tenant's numbers can never appear in the decision.
    assert.notEqual(decision.current_balance, 98765.43);
    assert.notEqual(decision.hold_reason, 'past_due');
  });
});

test('checkOrderAllowed with context does not leak when name only exists in another tenant', async () => {
  await withCreditEngine(async ({ supabase, creditEngine }) => {
    await supabase.from('Customers').insert({
      id: 'cust-only-b',
      company_id: 'company-b',
      company_name: 'Foreign Only Fish',
      credit_hold: true,
      credit_hold_reason: 'bounced_check',
      current_balance: 55555,
      credit_limit: 1,
    });

    const decision = await creditEngine.checkOrderAllowed({
      customer_name: 'Foreign Only Fish',
      order_total: 50,
      context: { companyId: 'company-a', activeCompanyId: 'company-a' },
    });

    // Unknown within THIS tenant: allowed, no foreign data echoed.
    assert.equal(decision.allowed, true);
    assert.equal(decision.unknown_customer, true);
    assert.equal(decision.customer_id, undefined);
    assert.equal(decision.hold_reason, undefined);
    assert.equal(decision.current_balance, undefined);
  });
});

test('checkCreditStatus with context rejects a foreign-tenant customer id', async () => {
  await withCreditEngine(async ({ supabase, creditEngine }) => {
    await supabase.from('Customers').insert({
      id: 'cust-direct-b',
      company_id: 'company-b',
      company_name: 'Direct Lookup Fish',
      current_balance: 777,
    });

    await assert.rejects(
      creditEngine.checkCreditStatus('cust-direct-b', { companyId: 'company-a', activeCompanyId: 'company-a' }),
      /Customer cust-direct-b/
    );
  });
});

test('escapeLike neutralizes LIKE metacharacters and is applied to name lookups', () => {
  const { escapeLike } = require('../lib/escape-like');
  assert.equal(escapeLike('100% Fresh_Fish\\Co'), '100\\% Fresh\\_Fish\\\\Co');
  assert.equal(escapeLike('plain name'), 'plain name');

  const source = fs.readFileSync(
    path.join(repoRoot, 'backend', 'services', 'creditEngine.js'), 'utf8'
  );
  assert.ok(
    source.includes('escapeLike(String(customerName).trim())'),
    'findCustomerByName must escape LIKE metacharacters'
  );
  assert.ok(source.includes("require('./operating-context')"), 'creditEngine must import tenant scoping');
});

test('orders route passes req.context to both credit-check call sites', () => {
  const source = fs.readFileSync(
    path.join(repoRoot, 'backend', 'routes', 'orders.js'), 'utf8'
  );
  const scopedCalls = source.match(/checkOrderAllowed\(\{[^}]*context: req\.context/gs) || [];
  assert.equal(scopedCalls.length, 2, 'both checkOrderAllowed call sites must pass req.context');
});
