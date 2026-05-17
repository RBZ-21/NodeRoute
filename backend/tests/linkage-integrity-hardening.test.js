const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..', '..');
const migrationSource = fs.readFileSync(
  path.join(repoRoot, 'supabase', 'migrations', '20260515_stop_order_invoice_link_hardening.sql'),
  'utf8'
);
const ordersRouteSource = fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'orders.js'), 'utf8');
const stopsRouteSource = fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'stops.js'), 'utf8');

test('stop linkage migration adds direct order and invoice link columns plus backfill/index coverage', () => {
  assert.match(migrationSource, /alter table if exists public\.stops[\s\S]*add column if not exists order_id text/i);
  assert.match(migrationSource, /add column if not exists invoice_id text/i);
  assert.match(migrationSource, /update public\.stops as stop[\s\S]*from public\.orders as orders/i);
  assert.match(migrationSource, /update public\.orders as orders[\s\S]*from public\.invoices as invoices/i);
  assert.match(migrationSource, /update public\.invoices as invoices[\s\S]*from public\.orders as orders/i);
  for (const marker of [
    'idx_stops_order_id',
    'idx_stops_invoice_id',
    'idx_orders_invoice_id',
    'idx_invoices_order_id',
  ]) {
    assert.ok(migrationSource.includes(marker), `missing index marker ${marker}`);
  }
});

test('orders route prefers direct stop order_id linkage and synchronizes stop invoice links', () => {
  for (const marker of [
    ".eq('order_id', order.id)",
    'async function syncOrderStopLinks(order, req, overrides = {})',
    'order_id: order?.id || null,',
    'invoice_id: order?.invoice_id || null,',
    'await syncOrderStopLinks({ ...existing, ...data, invoice_id: invoice.id }, req, { invoiceId: invoice.id });',
    "await syncOrderStopLinks({ ...order, invoice_id: invoice.id, route_id: routeId || null }, req, { invoiceId: invoice.id, routeId: routeId || null });",
  ]) {
    assert.ok(ordersRouteSource.includes(marker), `orders route missing linkage marker ${marker}`);
  }
});

test('stops route resolves linked invoices through stop.order_id before falling back to note parsing', () => {
  for (const marker of [
    'if (stop.order_id) {',
    ".from('orders').select('id, invoice_id, order_number, company_id, location_id').eq('id', stop.order_id).single();",
    ".eq('order_id', order.id)",
    'const orderNumber = extractOrderNumberFromStopNotes(stop.notes);',
  ]) {
    assert.ok(stopsRouteSource.includes(marker), `stops route missing linkage marker ${marker}`);
  }
});
