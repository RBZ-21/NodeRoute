const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..', '..');
const migrationSource = fs.readFileSync(
  path.join(repoRoot, 'supabase', 'migrations', '20260510000100_purchasing_receiving_schema.sql'),
  'utf8'
);
const workflowServiceSource = fs.readFileSync(
  path.join(repoRoot, 'backend', 'services', 'purchase-order-workflows.js'),
  'utf8'
);
const opsRouteSource = fs.readFileSync(
  path.join(repoRoot, 'backend', 'routes', 'ops', 'purchasing-order-routes.js'),
  'utf8'
);
const purchaseOrdersRouteSource = fs.readFileSync(
  path.join(repoRoot, 'backend', 'routes', 'purchase-orders.js'),
  'utf8'
);
const aiRouteSource = fs.readFileSync(
  path.join(repoRoot, 'backend', 'routes', 'ai.js'),
  'utf8'
);
const purchasingHookSource = fs.readFileSync(
  path.join(repoRoot, 'frontend-v2', 'src', 'hooks', 'usePurchasing.ts'),
  'utf8'
);
const purchasingPageSource = [
  fs.readFileSync(path.join(repoRoot, 'frontend-v2', 'src', 'pages', 'PurchasingPage.tsx'), 'utf8'),
  fs.readFileSync(path.join(repoRoot, 'frontend-v2', 'src', 'pages', 'CreatePurchaseOrderForm.tsx'), 'utf8'),
  fs.readFileSync(path.join(repoRoot, 'frontend-v2', 'src', 'pages', 'ReceivePoDrawer.tsx'), 'utf8'),
].join('\n');

test('purchasing schema migration adds receiving, discrepancy, scan, lot, and lead-time support', () => {
  for (const marker of [
    /create table if not exists public\.po_invoice_scans/i,
    /create table if not exists public\.po_receipts/i,
    /create table if not exists public\.po_receiving_lines/i,
    /create table if not exists public\.po_discrepancy_log/i,
    /create table if not exists public\.po_receiving_approval_queue/i,
    /alter table if exists public\.purchase_orders[\s\S]*add column if not exists vendor_id uuid/i,
    /add column if not exists workflow_kind text/i,
    /add column if not exists received_at timestamptz/i,
    /add column if not exists closed_at timestamptz/i,
    /add column if not exists receipts jsonb/i,
    /alter table if exists public\.lot_codes[\s\S]*add column if not exists purchase_order_id uuid/i,
    /alter table if exists public\.inventory_lots[\s\S]*add column if not exists purchase_order_id uuid/i,
    /create or replace view public\.vendor_lead_times/i,
  ]) {
    assert.match(migrationSource, marker);
  }
});

test('workflow persistence service loads and mirrors vendor POs through purchase_orders-backed storage', () => {
  for (const marker of [
    /async function loadVendorPurchaseOrdersFromDb/i,
    /workflow_kind:\s*'vendor_order'/i,
    /async function persistVendorPurchaseOrderSnapshot/i,
    /['"]po_receipts['"]/i,
    /['"]po_receiving_lines['"]/i,
    /['"]po_discrepancy_log['"]/i,
    /['"]po_receiving_approval_queue['"]/i,
    /async function recordPoInvoiceScan/i,
    /async function attachLotsToPurchaseOrder/i,
    /async function linkScanToPurchaseOrder/i,
  ]) {
    assert.match(workflowServiceSource, marker);
  }
});

test('ops purchasing routes mirror vendor PO snapshots and receipt scan links into Supabase', () => {
  for (const marker of [
    /loadVendorPurchaseOrdersFromDb/,
    /persistVendorPurchaseOrderSnapshot/,
    /scan_id:\s*String\(req\.body\.scan_id \|\| ''\)\.trim\(\) \|\| null/,
    /await linkScanToPurchaseOrder\(/,
    /await attachLotsToPurchaseOrder\(/,
  ]) {
    assert.match(opsRouteSource, marker);
  }
});

test('scan + confirm routes persist scan records and propagate scan ids through purchase order confirmation', () => {
  for (const marker of [
    /recordPoInvoiceScan/,
    /scan_id:\s*z\.any\(\)\.optional\(\)/,
    /source_scan_id:\s*String\(scan_id \|\| ''\)\.trim\(\) \|\| null/,
    /await linkScanToPurchaseOrder\(/,
    /scan_id:\s*scanRecord\?\.id \|\| null/,
  ]) {
    assert.match(`${purchaseOrdersRouteSource}\n${aiRouteSource}`, marker);
  }
});

test('purchase order confirm returns a friendly missing vendor error', () => {
  assert.match(purchaseOrdersRouteSource, /value === null \|\| value === undefined \? '' : value/);
  assert.match(purchaseOrdersRouteSource, /min\(1,\s*'Vendor Name Required'\)/);
});

test('purchase order confirm returns a friendly duplicate po number error', () => {
  assert.match(purchaseOrdersRouteSource, /function isDuplicatePoNumberError/);
  assert.match(purchaseOrdersRouteSource, /idx_purchase_orders_po_number_unique/);
  assert.match(purchaseOrdersRouteSource, /PO number already exists\. Enter a unique PO number\./);
  assert.match(purchaseOrdersRouteSource, /async function generateUniquePurchaseOrderNumber/);
});

test('frontend purchasing flow keeps scan ids when confirming POs or posting receipts', () => {
  for (const marker of [
    /scan_id\?: string \| null;/,
    /scan_id:\s*scanResult\?\.scan_id \|\| null/,
    /scan_id:\s*receiveScanResult\?\.scan_id \|\| null/,
  ]) {
    assert.match(`${purchasingHookSource}\n${purchasingPageSource}`, marker);
  }
});
