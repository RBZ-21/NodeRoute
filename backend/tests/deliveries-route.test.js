const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { mapOrderStatus, findMatchingStop } = require('../routes/deliveries');

// ── mapOrderStatus ────────────────────────────────────────────────────────────

test('mapOrderStatus returns delivered for invoiced orders', () => {
  assert.equal(mapOrderStatus({ status: 'invoiced' }, false), 'delivered');
});

test('mapOrderStatus returns delivered for delivered orders', () => {
  assert.equal(mapOrderStatus({ status: 'delivered' }, false), 'delivered');
});

test('mapOrderStatus returns failed for failed orders', () => {
  assert.equal(mapOrderStatus({ status: 'failed' }, false), 'failed');
});

test('mapOrderStatus returns in-transit when driver is active', () => {
  assert.equal(mapOrderStatus({ status: 'pending' }, true), 'in-transit');
});

test('mapOrderStatus returns in-transit for in_process orders even without active driver', () => {
  assert.equal(mapOrderStatus({ status: 'in_process' }, false), 'in-transit');
});

test('mapOrderStatus returns in-transit for processed orders', () => {
  assert.equal(mapOrderStatus({ status: 'processed' }, false), 'in-transit');
});

test('mapOrderStatus returns pending for new orders with no active driver', () => {
  assert.equal(mapOrderStatus({ status: 'pending' }, false), 'pending');
});

test('mapOrderStatus delivered takes priority over active driver', () => {
  // delivered status wins regardless of whether there is an active driver
  assert.equal(mapOrderStatus({ status: 'invoiced' }, true), 'delivered');
});

// ── findMatchingStop ──────────────────────────────────────────────────────────

test('findMatchingStop returns stop matched by exact address', () => {
  const stops = [
    { id: 's1', name: 'Blue Fin', address: '15 Ocean Ave' },
    { id: 's2', name: 'Sea Mart', address: '200 Harbor Rd' },
  ];
  const order = { customer_name: '', customer_address: '15 Ocean Ave' };
  const stop = findMatchingStop(order, stops);
  assert.equal(stop.id, 's1');
});

test('findMatchingStop returns stop matched by customer name', () => {
  const stops = [
    { id: 's1', name: 'Captain Crab', address: '99 Pier St' },
    { id: 's2', name: 'Shrimp Shack', address: '12 Bay Blvd' },
  ];
  const order = { customer_name: 'Shrimp Shack', customer_address: '' };
  const stop = findMatchingStop(order, stops);
  assert.equal(stop.id, 's2');
});

test('findMatchingStop matches partial address overlap', () => {
  const stops = [{ id: 's1', name: 'Cafe', address: '100 Main Street Suite 4' }];
  const order = { customer_name: '', customer_address: '100 Main Street' };
  const stop = findMatchingStop(order, stops);
  assert.equal(stop.id, 's1');
});

test('findMatchingStop is case-insensitive for name matching', () => {
  const stops = [{ id: 's1', name: 'Blue Water Grill', address: '5 Dock Rd' }];
  const order = { customer_name: 'BLUE WATER GRILL', customer_address: '' };
  const stop = findMatchingStop(order, stops);
  assert.equal(stop.id, 's1');
});

test('findMatchingStop returns null when nothing matches', () => {
  const stops = [{ id: 's1', name: 'Nowhere Cafe', address: '1 Lost St' }];
  const order = { customer_name: 'Other Place', customer_address: '99 Other Ave' };
  assert.equal(findMatchingStop(order, stops), null);
});

test('findMatchingStop returns null for empty stop list', () => {
  const order = { customer_name: 'Anyone', customer_address: '123 Main St' };
  assert.equal(findMatchingStop(order, []), null);
});

// ── Structural integrity ──────────────────────────────────────────────────────

test('deliveries loadDashboardContext queries dwell_records from Supabase not memory', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'deliveries.js'), 'utf8');
  assert.ok(src.includes("from('dwell_records')"), 'deliveries.js must query dwell_records table');
  assert.ok(!src.includes("require('./stops')"), 'deliveries.js must not import stops.js (no in-memory dwell)');
});

test('deliveries users query selects phone and vehicle_id columns', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'deliveries.js'), 'utf8');
  assert.ok(src.includes('phone, vehicle_id'), 'users SELECT must include phone and vehicle_id');
});

test('deliveries driver summary uses real DB fields not hardcoded placeholders', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'deliveries.js'), 'utf8');
  assert.ok(!src.includes("'Assigned Vehicle'"), 'vehicleId must not be hardcoded');
  assert.ok(src.includes('user.vehicle_id'), 'vehicleId must come from user record');
  assert.ok(src.includes('user.phone'), 'phone must come from user record');
});

test('deliveries dwell query uses snake_case DB field names', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'deliveries.js'), 'utf8');
  assert.ok(src.includes('stop_id'), 'must use stop_id (not stopId)');
  assert.ok(src.includes('arrived_at'), 'must use arrived_at (not arrivedAt)');
  assert.ok(src.includes('departed_at'), 'must use departed_at (not departedAt)');
  assert.ok(src.includes('dwell_ms'), 'must use dwell_ms (not dwellMs)');
});

test('deliveries stats endpoint is gated to admin and manager roles', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'deliveries.js'), 'utf8');
  assert.ok(src.includes("requireRole('admin', 'manager')"), 'stats must require admin or manager role');
});

test('deliveries status patch validates allowed statuses and checks context', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'deliveries.js'), 'utf8');
  assert.ok(src.includes("'Invalid delivery status'"), 'patch must reject unknown statuses');
  assert.ok(src.includes('rowMatchesContext'), 'patch must check operating context');
});
