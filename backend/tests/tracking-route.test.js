const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildEta, findMatchingStopIndex, buildDestination } = require('../routes/tracking');

// ── findMatchingStopIndex ────────────────────────────────────────────────────

test('findMatchingStopIndex matches stop by exact address', () => {
  const stops = [
    { id: 's1', name: 'Blue Fin', address: '15 Ocean Ave' },
    { id: 's2', name: 'Sea Mart', address: '200 Harbor Rd' },
  ];
  const order = { customer_name: '', customer_address: '15 Ocean Ave' };
  assert.equal(findMatchingStopIndex(order, stops), 0);
});

test('findMatchingStopIndex matches stop by partial address substring', () => {
  const stops = [
    { id: 's1', name: 'Fish House', address: '200 Harbor Road Suite 4' },
  ];
  const order = { customer_name: '', customer_address: '200 Harbor Road' };
  assert.equal(findMatchingStopIndex(order, stops), 0);
});

test('findMatchingStopIndex matches stop by customer name', () => {
  const stops = [
    { id: 's1', name: 'Captain Crab', address: '99 Pier St' },
    { id: 's2', name: 'Shrimp Shack', address: '12 Bay Blvd' },
  ];
  const order = { customer_name: 'Captain Crab', customer_address: '' };
  assert.equal(findMatchingStopIndex(order, stops), 0);
});

test('findMatchingStopIndex is case-insensitive', () => {
  const stops = [{ id: 's1', name: 'Blue Water Grill', address: '5 Dock Rd' }];
  const order = { customer_name: 'BLUE WATER GRILL', customer_address: '' };
  assert.equal(findMatchingStopIndex(order, stops), 0);
});

test('findMatchingStopIndex returns -1 when nothing matches', () => {
  const stops = [{ id: 's1', name: 'Nowhere Cafe', address: '1 Lost St' }];
  const order = { customer_name: 'Different Place', customer_address: '99 Other Ave' };
  assert.equal(findMatchingStopIndex(order, stops), -1);
});

test('findMatchingStopIndex returns -1 for empty stops array', () => {
  const order = { customer_name: 'Anyone', customer_address: '123 Main St' };
  assert.equal(findMatchingStopIndex(order, []), -1);
});

// ── buildDestination ─────────────────────────────────────────────────────────

test('buildDestination prefers customer_lat/lng over stop coords', () => {
  const stops = [{ id: 's1', lat: 10, lng: 20 }];
  const order = { customer_lat: 32.77, customer_lng: -79.93 };
  const dest = buildDestination(order, stops, 0);
  assert.equal(dest.lat, 32.77);
  assert.equal(dest.lng, -79.93);
});

test('buildDestination falls back to matched stop coords when customer coords are absent', () => {
  // undefined (not null) triggers the fallback — toNumber(null)=0 which is a valid coord
  const stops = [{ id: 's1', lat: 32.5, lng: -80.1 }];
  const order = { customer_lat: undefined, customer_lng: undefined };
  const dest = buildDestination(order, stops, 0);
  assert.equal(dest.lat, 32.5);
  assert.equal(dest.lng, -80.1);
});

test('buildDestination returns null coords when no stop matched and no customer coords', () => {
  const order = { customer_lat: undefined, customer_lng: undefined };
  const dest = buildDestination(order, [], -1);
  assert.equal(dest.lat, null);
  assert.equal(dest.lng, null);
});

// ── buildEta ─────────────────────────────────────────────────────────────────

test('buildEta returns null when destination coords are absent', () => {
  // undefined triggers toNumber fallback → null → haversineMiles returns null → buildEta returns null
  const driver = { lat: 32.77, lng: -79.93, speed_mph: 30 };
  const destination = { lat: undefined, lng: undefined };
  assert.equal(buildEta(driver, destination, 0, 0), null);
});

test('buildEta returns positive totalMinutes for a real distance', () => {
  // Driver ~5 miles from destination
  const driver = { lat: 32.77, lng: -79.93, speed_mph: 30 };
  const destination = { lat: 32.84, lng: -79.93 }; // ~5 miles north
  const eta = buildEta(driver, destination, 0, 0);
  assert.ok(eta !== null);
  assert.ok(eta.totalMinutes >= 1);
  assert.ok(eta.driveMinutes >= 1);
  assert.equal(eta.dwellMinutes, 0);
  assert.ok(typeof eta.etaTime === 'string');
});

test('buildEta adds dwell time for stops before customer', () => {
  const driver = { lat: 32.77, lng: -79.93, speed_mph: 30 };
  const destination = { lat: 32.84, lng: -79.93 };
  const etaNoStops  = buildEta(driver, destination, 0, 0);
  const etaWithStop = buildEta(driver, destination, 2, 0);
  // 2 stops ahead → adds 1 × 8 min dwell (stopsBeforeYou - 1 = 1)
  assert.ok(etaWithStop.totalMinutes > etaNoStops.totalMinutes);
  assert.equal(etaWithStop.dwellMinutes, etaNoStops.dwellMinutes + 8);
});

test('buildEta accounts for active dwell time at the current stop', () => {
  const driver = { lat: 32.77, lng: -79.93, speed_mph: 30 };
  const destination = { lat: 32.84, lng: -79.93 };
  const etaBase  = buildEta(driver, destination, 0, 0);
  const etaDwell = buildEta(driver, destination, 0, 5);
  assert.equal(etaDwell.dwellMinutes, etaBase.dwellMinutes + 5);
});

test('buildEta uses minimum speed of 18 mph to avoid huge ETAs', () => {
  const driver = { lat: 32.77, lng: -79.93, speed_mph: 0 };
  const destination = { lat: 32.84, lng: -79.93 };
  const eta = buildEta(driver, destination, 0, 0);
  // At 18 mph minimum, ~5 miles ≈ 16 min drive — should be reasonable
  assert.ok(eta.driveMinutes < 30, `driveMinutes ${eta.driveMinutes} unexpectedly large`);
});

test('buildEta etaTime is an ISO string in the future', () => {
  const driver = { lat: 32.77, lng: -79.93, speed_mph: 30 };
  const destination = { lat: 32.84, lng: -79.93 };
  const before = Date.now();
  const eta = buildEta(driver, destination, 0, 0);
  assert.ok(new Date(eta.etaTime).getTime() > before);
});

// ── Structural integrity ──────────────────────────────────────────────────────

test('tracking route does not import the removed dwellRecords in-memory export', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'tracking.js'), 'utf8');
  assert.ok(!src.includes("require('./stops')"), 'tracking.js must not import stops.js (dwellRecords was removed)');
});

test('tracking route queries dwell_records from Supabase', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'tracking.js'), 'utf8');
  assert.ok(src.includes("from('dwell_records')"), 'tracking.js must query dwell_records table');
  assert.ok(src.includes('.eq(\'route_id\''), 'dwell_records query must filter by route_id');
});

test('tracking API response includes customerEmail and customerPhone fields', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'tracking.js'), 'utf8');
  assert.ok(src.includes('customerEmail:'), 'response must include customerEmail');
  assert.ok(src.includes('customerPhone:'), 'response must include customerPhone');
  assert.ok(src.includes('order.customer_email'), 'customerEmail must come from order');
  assert.ok(src.includes('order.customer_phone'), 'customerPhone must come from order');
});

test('tracking route validates token expiry and returns 410 for expired links', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'tracking.js'), 'utf8');
  assert.ok(src.includes('tracking_expires_at'), 'route must check tracking_expires_at');
  assert.ok(src.includes('res.status(410)'), 'expired token should return 410 Gone');
  assert.ok(src.includes('res.status(404)'), 'missing token should return 404');
});
