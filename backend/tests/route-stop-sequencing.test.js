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

// ── synchronizeRouteStopAssignments → single RPC ──────────────────────────────

const { synchronizeRouteStopAssignments } = (() => {
  // Reach into the module internals via a thin re-export shim so we can test
  // without altering the public API surface.
  const mod = require('../services/route-stop-sync');
  // synchronizeRouteStopAssignments is not exported — re-export only what we
  // need by wrapping syncRouteMutation's internal call pattern. Instead, test
  // the function directly by requiring it after adding it to the export list in
  // a way that doesn't break callers. Since the spec says NOT to change the
  // public exports, we exercise it through a minimal supabase mock passed to
  // syncRouteMutation, which delegates to synchronizeRouteStopAssignments.
  return mod;
})();

test('synchronizeRouteStopAssignments calls rpc with correct name and array params', async () => {
  let capturedRpcName;
  let capturedRpcParams;

  const mockSupabase = {
    from: (table) => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'route-1', stop_ids: [], active_stop_ids: [] }, error: null }) }) }),
      update: (payload) => ({ eq: () => ({ select: () => ({ single: async () => ({ data: payload, error: null }) }) }) }),
    }),
    rpc: async (name, params) => {
      capturedRpcName = name;
      capturedRpcParams = params;
      return { error: null };
    },
  };

  // syncRouteMutation calls synchronizeRouteStopAssignments internally
  const { syncRouteMutation } = require('../services/route-stop-sync');
  await syncRouteMutation(mockSupabase, {
    routeId: 'route-1',
    stopIds: ['stop-a', 'stop-b', 'stop-c'],
    activeStopIds: ['stop-c', 'stop-a'],
    action: 'update',
    actor: {},
    context: {},
    metadata: {},
  });

  assert.equal(capturedRpcName, 'sync_route_stop_assignments', 'rpc must be called with correct function name');
  assert.ok(Array.isArray(capturedRpcParams.p_stop_ids), 'p_stop_ids must be an array, not a comma-separated string');
  assert.ok(Array.isArray(capturedRpcParams.p_active_stop_ids), 'p_active_stop_ids must be an array, not a comma-separated string');
  assert.equal(capturedRpcParams.p_route_id, 'route-1');
});

test('synchronizeRouteStopAssignments propagates rpc error without proceeding', async () => {
  const rpcError = new Error('DB constraint violation');
  let rpcCallCount = 0;

  const mockSupabase = {
    from: (table) => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'route-1', stop_ids: [], active_stop_ids: [] }, error: null }) }) }),
      update: (payload) => ({ eq: () => ({ select: () => ({ single: async () => ({ data: payload, error: null }) }) }) }),
    }),
    rpc: async () => {
      rpcCallCount += 1;
      return { error: rpcError };
    },
  };

  const { syncRouteMutation } = require('../services/route-stop-sync');
  const result = await syncRouteMutation(mockSupabase, {
    routeId: 'route-1',
    stopIds: ['stop-a'],
    activeStopIds: ['stop-a'],
    action: 'update',
    actor: {},
    context: {},
    metadata: {},
  });

  assert.equal(rpcCallCount, 1, 'rpc should be called exactly once');
  assert.ok(result.error, 'result must contain the error');
  assert.equal(result.error, rpcError, 'error must be the rpc error, not wrapped');
  assert.ok(!result.data, 'data must be null/falsy on error');
});
