const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { coordinateRouteOptimization, heuristicRouteOptimization } = require('../services/ai');

const repoRoot = path.resolve(__dirname, '..', '..');

test('route optimization heuristic uses GPS coordinates when stops are geocoded', () => {
  const result = heuristicRouteOptimization([
    { id: 'stop-a', address: '1 Dock St', lat: 41.0, lng: -71.0 },
    { id: 'stop-c', address: '9 Pier Ave', lat: 41.25, lng: -70.7 },
    { id: 'stop-b', address: '3 Harbor Rd', lat: 41.01, lng: -71.01 },
    { id: 'stop-d', address: 'No GPS Ln' },
  ]);

  assert.deepEqual(result.optimized_stop_ids, ['stop-a', 'stop-b', 'stop-c', 'stop-d']);
  assert.match(result.reasoning, /GPS coordinates/i);
  assert.equal(result.key_changes.some((change) => /recorded coordinates/i.test(change)), true);
});

test('coordinate optimizer returns null when there are not enough coordinates to sequence', () => {
  const result = coordinateRouteOptimization([
    { id: 'stop-a', address: '1 Main St 02108' },
    { id: 'stop-b', address: '2 Main St 02110' },
  ]);

  assert.equal(result, null);
});

test('route optimization heuristic still falls back to address clustering when GPS is unavailable', () => {
  const result = heuristicRouteOptimization([
    { id: 'stop-c', address: '99 Elm St Boston MA 02110' },
    { id: 'stop-a', address: '12 Bay St Boston MA 02108' },
    { id: 'stop-b', address: '50 Dock Rd Boston MA 02109' },
  ]);

  assert.deepEqual(result.optimized_stop_ids, ['stop-a', 'stop-b', 'stop-c']);
  assert.match(result.reasoning, /zip code zone/i);
});

test('AI route optimization endpoint requests stop coordinates and customer delivery windows', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'ai.js'), 'utf8');

  assert.ok(source.includes("select('id,address,customer_id,status,lat,lng,company_id,location_id')"), 'route optimization endpoint should fetch stop coordinates');
  assert.ok(source.includes('preferred_delivery_window'), 'route optimization endpoint should include customer delivery windows');
});

test('routes driver migration links driver_id to users.id with null-safe cleanup', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'supabase', 'migrations', '20260510_routes_driver_user_fk.sql'), 'utf8');

  assert.match(source, /update public\.routes as route/i);
  assert.match(source, /references public\.users\(id\)/i);
  assert.match(source, /on delete set null/i);
});

test('route map waypoint builder preserves active stop order and skips ungeocoded stops', () => {
  const { buildRouteWaypointLatLngs } = require('../services/google-maps');
  const route = {
    id: 'route-sequence',
    stop_ids: ['stop-a', 'stop-b', 'stop-c'],
    active_stop_ids: ['stop-b', 'stop-a', 'stop-c'],
  };
  const stops = [
    { id: 'stop-a', name: 'First in original', address: '1 Dock St', lat: 32.781, lng: -79.931 },
    { id: 'stop-b', name: 'First active', address: '2 Pier Ave', lat: '32.785', lng: '-79.928' },
    { id: 'stop-c', name: 'Missing GPS', address: '3 Harbor Rd', lat: null, lng: null },
  ];

  assert.deepEqual(buildRouteWaypointLatLngs(route, stops), [
    { stop_id: 'stop-b', sequence: 1, lat: 32.785, lng: -79.928, name: 'First active', address: '2 Pier Ave' },
    { stop_id: 'stop-a', sequence: 2, lat: 32.781, lng: -79.931, name: 'First in original', address: '1 Dock St' },
  ]);
});
