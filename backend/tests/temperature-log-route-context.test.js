const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'test-dev-secret';

const repoRoot = path.resolve(__dirname, '..', '..');
const routeSource = fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'temperature-logs.js'), 'utf8');
const migrationSource = fs.readFileSync(path.join(repoRoot, 'supabase', 'migrations', '20260508000200_temperature_log_route_stop_context.sql'), 'utf8');
const driverPageSource = fs.readFileSync(path.join(repoRoot, 'driver-app', 'src', 'pages', 'TemperatureLogPage.tsx'), 'utf8');

const {
  buildTemperatureLogCsv,
  normalizeTemperaturePayload,
} = require('../routes/temperature-logs');

test('temperature log route stores explicit route and stop context', () => {
  const normalized = normalizeTemperaturePayload({
    temperature: '34.5',
    storage_area: 'Cabin',
    route_id: 'route-1',
    stop_id: 'stop-2',
  }, { name: 'Driver One' });

  assert.equal(normalized.route_id, 'route-1');
  assert.equal(normalized.stop_id, 'stop-2');
  assert.equal(normalized.recorded_by, 'Driver One');
  assert.equal(normalized.temperature, 34.5);
});

test('temperature log CSV export includes route and stop columns', () => {
  const csv = buildTemperatureLogCsv([
    {
      logged_at: '2026-05-08T12:00:00.000Z',
      route_id: 'route-1',
      stop_id: 'stop-2',
      storage_area: 'Cabin',
      temperature: 34.5,
      unit: 'F',
      check_type: 'delivery',
      corrective_action: '',
      initials: 'RD',
      recorded_by: 'Ryan',
      notes: 'All good',
    },
  ]);

  assert.match(csv, /route_id,stop_id,storage_area,temperature/i);
  assert.match(csv, /route-1,stop-2,Cabin,34\.5/i);
});

test('temperature log route and driver UI markers are present', () => {
  assert.ok(routeSource.includes("requireRole('admin', 'manager', 'driver')"), 'drivers should be allowed to submit logs');
  assert.ok(routeSource.includes("router.get('/export.csv'"), 'temperature logs should expose CSV export');
  assert.ok(routeSource.includes('route_id: body.route_id || body.routeId || null'), 'route context should be persisted');
  assert.ok(routeSource.includes('stop_id: body.stop_id || body.stopId || null'), 'stop context should be persisted');
  assert.ok(driverPageSource.includes('route_id: currentRoute?.id || null'), 'driver page should submit current route id');
  assert.ok(driverPageSource.includes('stop_id: stop?.id || null'), 'driver page should submit current stop id');
  assert.ok(migrationSource.includes('add column if not exists route_id text'), 'migration should add route_id');
  assert.ok(migrationSource.includes('add column if not exists stop_id text'), 'migration should add stop_id');
});
