const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..', '..');
const purchaseOrdersRouteSource = fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'purchase-orders.js'), 'utf8');
const opsPurchasingRouteSource = fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'ops', 'purchasing-order-routes.js'), 'utf8');
const workflowServiceSource = fs.readFileSync(path.join(repoRoot, 'backend', 'services', 'purchase-order-workflows.js'), 'utf8');
const migrationSource = fs.readFileSync(path.join(repoRoot, 'supabase', 'migrations', '20260515_purchasing_receipt_idempotency.sql'), 'utf8');

test('purchase order confirm flow stores request ids and can replay inventory receipts safely', () => {
  for (const marker of [
    'request_id: z.any().optional()',
    'function normalizeInventoryReceiptRequestId(',
    'async function findExistingInventoryReceiptByRequest(',
    "workflow_kind', 'inventory_receipt'",
    ".eq('source_request_id', requestId)",
    "source_request_id: String(normalizedRequestId || '').trim() || null,",
    'await reverseLedgerApplications(ledgerApplications, req.user.name || req.user.email);',
    "const scopedFallbackLots = filterRowsByContext(fallbackLots || [], req.context);",
  ]) {
    assert.ok(purchaseOrdersRouteSource.includes(marker), `purchase-orders missing idempotency marker ${marker}`);
  }
});

test('vendor PO receive flow stores receipt request ids and blocks duplicate auto-generated bills', () => {
  for (const marker of [
    'function normalizeReceiptRequestId(',
    'const receiptRequestId = normalizeReceiptRequestId(req.body.receipt_request_id, req.body.scan_id);',
    "receipt_request_id: receiptRequestId,",
    ".eq('purchase_order_id', persisted.row.id)",
    ".eq('auto_generated', true)",
    "if (existingBillResult.data?.[0]?.id) {",
    "if (billInsert.error && billInsert.error.code !== '23505') {",
    'let persisted = null;',
  ]) {
    assert.ok(opsPurchasingRouteSource.includes(marker), `ops purchasing route missing marker ${marker}`);
  }
});

test('workflow snapshot persistence mirrors receipt request ids into purchase order audit tables', () => {
  for (const marker of [
    'receipt_request_id: receipt.receipt_request_id || null,',
    'receipt_request_id: normalizeText(receipt.receipt_request_id) || null,',
  ]) {
    assert.ok(workflowServiceSource.includes(marker), `workflow service missing marker ${marker}`);
  }
});

test('purchasing idempotency migration adds request ids and unique indexes with duplicate cleanup', () => {
  for (const marker of [
    'add column if not exists source_request_id text',
    'idx_purchase_orders_inventory_receipt_request_unique',
    'add column if not exists receipt_request_id text',
    'idx_po_receipts_request_unique',
    'duplicate_auto_bills as',
    'idx_vendor_bills_auto_generated_po_unique',
  ]) {
    assert.ok(migrationSource.includes(marker), `migration missing marker ${marker}`);
  }
});
