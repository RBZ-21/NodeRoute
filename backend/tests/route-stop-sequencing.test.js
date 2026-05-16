const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'test-dev-secret';

const repoRoot = path.resolve(__dirname, '..', '..');
const migrationSource = fs.readFileSync(path.join(repoRoot, 'supabase', 'migrations', '20260508_route_safety_and_audit.sql'), 'utf8');
const routesSource = fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'routes.js'), 'utf8');
const stopsSource = fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'stops.js'), 'utf8');

const {
  buildRouteMutationAuditEntry,
  buildRouteStopPlan,
  normalizeIdArray,
} = require('../services/route-stop-sync');

test('route stop plan keeps assigned stops and active sequence separate', () => {
  const plan = buildRouteStopPlan('route-1', [' stop-a ', 'stop-b', 'stop-c'], ['stop-c', 'stop-a']);

  assert.deepEqual(plan.assignedStopIds, ['stop-a', 'stop-b', 'stop-c']);
  assert.deepEqual(plan.activeStopIds, ['stop-c', 'stop-a']);
  assert.deepEqual(plan.sequencedStopIds, ['stop-c', 'stop-a']);
  assert.equal(plan.sequenceMap.get('stop-c'), 1);
  assert.equal(plan.sequenceMap.get('stop-b'), undefined);
});

test('route audit entry captures before/after route arrays', () => {
  const entry = buildRouteMutationAuditEntry({
    routeId: 'route-1',
    action: 'defer',
    actor: { id: 'user-1', email: 'ops@example.com', role: 'manager' },
    beforeStopIds: ['stop-a', 'stop-b'],
    afterStopIds: ['stop-a', 'stop-b'],
    beforeActiveStopIds: ['stop-a', 'stop-b'],
    afterActiveStopIds: ['stop-b', 'stop-a'],
    metadata: { stopId: 'stop-a' },
  });

  assert.equal(entry.route_id, 'route-1');
  assert.equal(entry.action, 'defer');
  assert.deepEqual(entry.before_active_stop_ids, ['stop-a', 'stop-b']);
  assert.deepEqual(entry.after_active_stop_ids, ['stop-b', 'stop-a']);
  assert.equal(entry.metadata.stopId, 'stop-a');
});

test('route safety migration and route handlers include sequence and audit markers', () => {
  assert.match(migrationSource, /add column if not exists stop_seq integer/i);
  assert.match(migrationSource, /create unique index if not exists idx_stops_route_stop_seq_unique/i);
  assert.match(migrationSource, /create table if not exists public\.route_mutation_audit_logs/i);
  assert.ok(routesSource.includes("require('../services/route-stop-sync')"), 'routes should use shared route stop sync service');
  assert.ok(routesSource.includes("action: 'create'"), 'route create should emit audit action');
  assert.ok(routesSource.includes("action: 'delete'"), 'route delete should emit audit action');
  assert.ok(stopsSource.includes("action: 'move_to_end'"), 'stop move-to-end should emit route mutation audit');
  assert.ok(stopsSource.includes("action: 'defer'"), 'stop defer should emit route mutation audit');
});

test('route stop helper normalizes duplicate ids', () => {
  assert.deepEqual(normalizeIdArray([' stop-a ', 'stop-a', '', null, 'stop-b']), ['stop-a', 'stop-b']);
});
