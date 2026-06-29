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
      key.includes(`${path.sep}backend${path.sep}services${path.sep}report-alerts.js`)
    ) {
      delete require.cache[key];
    }
  }
}

async function withAlerts(fn) {
  const previousBackupPath = process.env.NODEROUTE_BACKUP_PATH;
  const previousForceDemoMode = process.env.NODEROUTE_FORCE_DEMO_MODE;
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-report-alerts-'));

  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  clearBackendModuleCache();

  try {
    const { supabase } = require('../services/supabase');
    const alerts = require('../services/report-alerts');
    const mailerCalls = [];
    const mailer = {
      sendMail: async (message) => {
        mailerCalls.push(message);
        return { id: `mail-${mailerCalls.length}` };
      },
    };
    await fn({
      supabase,
      alerts,
      mailer,
      mailerCalls,
      context: { companyId: 'company-alert-a', locationId: 'location-alert-a' },
    });
  } finally {
    if (previousBackupPath === undefined) delete process.env.NODEROUTE_BACKUP_PATH;
    else process.env.NODEROUTE_BACKUP_PATH = previousBackupPath;
    if (previousForceDemoMode === undefined) delete process.env.NODEROUTE_FORCE_DEMO_MODE;
    else process.env.NODEROUTE_FORCE_DEMO_MODE = previousForceDemoMode;
    clearBackendModuleCache();
    fs.rmSync(backupPath, { recursive: true, force: true });
  }
}

test('low-stock alert fires once and respects the 24 hour cooldown', async () => {
  await withAlerts(async ({ supabase, alerts, mailer, mailerCalls, context }) => {
    await supabase.from('products').insert({
      id: 'product-alert-1',
      company_id: 'company-alert-a',
      location_id: 'location-alert-a',
      item_number: 'A100',
      description: 'Atlantic Salmon',
      on_hand_qty: 2,
      category_id: 'category-fish',
    });
    await supabase.from('inventory_alert_rules').insert({
      id: 'rule-low-stock-1',
      company_id: 'company-alert-a',
      location_id: 'location-alert-a',
      product_id: 'product-alert-1',
      rule_type: 'low_stock',
      threshold: 5,
      is_active: true,
    });

    const first = await alerts.checkInventoryAlerts('company-alert-a', {
      db: supabase,
      context,
      mailer,
      now: new Date('2026-06-29T12:00:00.000Z'),
      recipients: ['ops@noderoute.test'],
    });
    const second = await alerts.checkInventoryAlerts('company-alert-a', {
      db: supabase,
      context,
      mailer,
      now: new Date('2026-06-29T13:00:00.000Z'),
      recipients: ['ops@noderoute.test'],
    });

    assert.equal(first.sent, 1);
    assert.equal(second.sent, 0);
    assert.equal(second.skipped_cooldown, 1);
    assert.equal(mailerCalls.length, 1);

    const { data: sends } = await supabase.from('alert_sends').select('*').eq('rule_id', 'rule-low-stock-1');
    assert.equal(sends.length, 1);
    assert.equal(sends[0].entity_id, 'product-alert-1');
  });
});

test('credit alert fires when a customer exceeds the configured threshold', async () => {
  await withAlerts(async ({ supabase, alerts, mailer, mailerCalls, context }) => {
    await supabase.from('Customers').insert({
      id: 'customer-alert-1',
      company_id: 'company-alert-a',
      location_id: 'location-alert-a',
      company_name: 'Blue Fin Market',
      current_balance: 950,
      credit_limit: 1000,
    });
    await supabase.from('credit_alert_rules').insert({
      id: 'rule-credit-1',
      company_id: 'company-alert-a',
      location_id: 'location-alert-a',
      customer_id: 'customer-alert-1',
      rule_type: 'approaching_limit',
      threshold_pct: 90,
      is_active: true,
    });

    const result = await alerts.checkCreditAlerts('company-alert-a', {
      db: supabase,
      context,
      mailer,
      now: new Date('2026-06-29T12:00:00.000Z'),
      recipients: ['credit@noderoute.test'],
    });

    assert.equal(result.sent, 1);
    assert.equal(mailerCalls.length, 1);
    assert.match(mailerCalls[0].subject, /credit/i);
  });
});
