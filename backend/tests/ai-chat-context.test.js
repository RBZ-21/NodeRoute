const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function clearBackendModuleCache() {
  for (const key of Object.keys(require.cache)) {
    if (
      key.includes(`${path.sep}backend${path.sep}services${path.sep}supabase.js`)
      || key.includes(`${path.sep}backend${path.sep}routes${path.sep}ai.js`)
      || key.includes(`${path.sep}backend${path.sep}services${path.sep}ai.js`)
    ) {
      delete require.cache[key];
    }
  }
}

test('chat context loader pulls live overview and named matches from the program data', async () => {
  const previousBackupPath = process.env.NODEROUTE_BACKUP_PATH;
  const previousForceDemoMode = process.env.NODEROUTE_FORCE_DEMO_MODE;
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-ai-chat-'));
  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  clearBackendModuleCache();

  const { supabase } = require('../services/supabase');
  const aiRouter = require('../routes/ai');

  await supabase.from('orders').insert([
    {
      id: 'order-1',
      order_number: 'SO-100',
      customer_name: 'Harbor Bistro',
      status: 'pending',
      date: '2026-05-13',
      created_at: new Date().toISOString(),
      company_id: 'company-a',
      location_id: 'loc-a',
    },
  ]);
  await supabase.from('seafood_inventory').insert([
    {
      item_number: 'SKU-1',
      description: 'Atlantic Salmon Fillet',
      on_hand_qty: 2,
      unit: 'lb',
      category: 'Finfish',
      company_id: 'company-a',
      location_id: 'loc-a',
    },
  ]);
  await supabase.from('invoices').insert([
    {
      id: 'inv-1',
      invoice_number: 'INV-100',
      customer_name: 'Harbor Bistro',
      total: 412.5,
      status: 'overdue',
      due_date: '2026-05-01',
      created_at: new Date().toISOString(),
      company_id: 'company-a',
      location_id: 'loc-a',
    },
  ]);
  // BE-008: seed the REAL mixed-case "Customers" table. This test previously
  // seeded a lowercase 'customers' table that only exists in demo mode, which
  // masked the production bug where ai.js queried a nonexistent table.
  await supabase.from('Customers').insert([
    {
      id: 'cust-1',
      customer_number: 'CUST-1',
      company_name: 'Harbor Bistro',
      credit_hold_reason: 'Balance past due',
      company_id: 'company-a',
      location_id: 'loc-a',
    },
  ]);
  await supabase.from('routes').insert([
    {
      id: 'route-1',
      name: 'Harbor North',
      driver: 'Mia',
      created_at: new Date().toISOString(),
      company_id: 'company-a',
      location_id: 'loc-a',
    },
  ]);
  await supabase.from('vendors').insert([
    {
      id: 'vendor-1',
      name: 'Harbor Seafood Supply',
      company_id: 'company-a',
      location_id: 'loc-a',
    },
  ]);
  await supabase.from('purchase_orders').insert([
    {
      id: 'po-1',
      po_number: 'PO-100',
      vendor: 'Harbor Seafood Supply',
      status: 'open',
      workflow_kind: 'vendor_order',
      total_cost: 288,
      created_at: new Date().toISOString(),
      company_id: 'company-a',
      location_id: 'loc-a',
    },
  ]);

  const context = await aiRouter.loadChatContext(
    'What is going on today with Harbor Bistro and salmon?',
    {
      companyId: 'company-a',
      activeCompanyId: 'company-a',
      accessibleCompanyIds: ['company-a'],
      locationId: 'loc-a',
      activeLocationId: 'loc-a',
      accessibleLocationIds: ['loc-a'],
      isGlobalOperator: false,
    }
  );

  assert.equal(context.overview.recent_order_count, 1);
  assert.equal(context.overview.low_inventory_count, 1);
  assert.equal(context.overview.overdue_invoice_count, 1);
  assert.equal(context.overview.credit_hold_count, 1);
  assert.equal(context.overview.active_route_count, 1);
  assert.equal(context.overview.open_vendor_po_count, 1);
  assert.ok(context.matchingCustomers.some((customer) => customer.company_name === 'Harbor Bistro'));
  assert.ok(context.matchingProducts.some((item) => item.description === 'Atlantic Salmon Fillet'));
  assert.ok(context.matchingInvoices.some((invoice) => invoice.invoice_number === 'INV-100'));

  if (previousBackupPath === undefined) delete process.env.NODEROUTE_BACKUP_PATH;
  else process.env.NODEROUTE_BACKUP_PATH = previousBackupPath;
  if (previousForceDemoMode === undefined) delete process.env.NODEROUTE_FORCE_DEMO_MODE;
  else process.env.NODEROUTE_FORCE_DEMO_MODE = previousForceDemoMode;
  clearBackendModuleCache();
  fs.rmSync(backupPath, { recursive: true, force: true });
});

test('heuristic chat fallback gives concrete program-backed answers instead of generic navigation text', () => {
  const { heuristicChatReply } = require('../services/ai');

  const reply = heuristicChatReply('Show me low inventory items', {
    lowInventory: [
      { description: 'Atlantic Salmon Fillet', on_hand_qty: 2, unit: 'lb' },
      { description: 'Jumbo Shrimp', on_hand_qty: 4, unit: 'lb' },
    ],
    overview: {
      low_inventory_count: 2,
    },
  });

  assert.match(reply, /Atlantic Salmon Fillet/i);
  assert.match(reply, /Jumbo Shrimp/i);
  assert.doesNotMatch(reply, /Open Inventory to review and reorder/i);
});
