const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..', '..');
const migrationSource = fs.readFileSync(
  path.join(repoRoot, 'supabase', 'migrations', '20260515_harden_sensitive_rls_and_dwell_scope.sql'),
  'utf8'
);
const stopsSource = fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'stops.js'), 'utf8');
const trackingSource = fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'tracking.js'), 'utf8');

test('dwell_records gain tenant scope columns and backfill coverage', () => {
  assert.match(migrationSource, /alter table if exists public\.dwell_records/i);
  assert.match(migrationSource, /add column if not exists company_id uuid/i);
  assert.match(migrationSource, /add column if not exists location_id uuid/i);
  assert.match(migrationSource, /update public\.dwell_records as dr[\s\S]*from public\.stops as s/i);
  assert.match(migrationSource, /update public\.dwell_records as dr[\s\S]*from public\.routes as r/i);
  assert.match(migrationSource, /idx_dwell_records_company_id/i);
  assert.match(migrationSource, /idx_dwell_records_location_id/i);
});

test('sensitive Supabase tables are locked to service-role-only policies', () => {
  for (const tableName of [
    'driver_locations',
    'temperature_logs',
    'route_mutation_audit_logs',
    'dwell_records',
    'portal_challenges',
    'portal_auth_attempts',
  ]) {
    assert.match(
      migrationSource,
      new RegExp(`create policy ${tableName}_service_role_only[\\s\\S]*on public\\.${tableName}[\\s\\S]*auth\\.role\\(\\) = 'service_role'`, 'i'),
      `missing service-role-only policy for ${tableName}`
    );
  }
});

test('stop arrival writes dwell records through the scope-aware insert helper', () => {
  assert.ok(
    stopsSource.includes("insertRecordWithOptionalScope(supabase, 'dwell_records'"),
    'stops arrive should use insertRecordWithOptionalScope for dwell records'
  );
});

test('tracking flow scopes dwell telemetry to the route context before computing ETA', () => {
  assert.ok(
    trackingSource.includes('filterRowsByContext(dwellRows || [], trackingContext)'),
    'tracking ETA should scope dwell rows by the derived tracking context'
  );
});
