const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// ── Structural checks for stops.js dwell changes ─────────────────────────────

test('stops.js arrive endpoint writes to Supabase dwell_records not in-memory array', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'stops.js'), 'utf8');
  assert.ok(src.includes("from('dwell_records')"), 'arrive must query dwell_records table');
  assert.ok(src.includes("from('dwell_records').insert("), 'arrive must insert a dwell_record row');
});

test('stops.js depart endpoint updates existing dwell_record row in Supabase', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'stops.js'), 'utf8');
  assert.ok(src.includes(".update({ departed_at:"), 'depart must update departed_at in Supabase');
  assert.ok(src.includes('dwell_ms:'), 'depart must persist computed dwell_ms');
});

test('stops.js uses snake_case column names in dwell_records inserts and queries', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'stops.js'), 'utf8');
  assert.ok(src.includes('stop_id:'), 'must use stop_id not stopId');
  assert.ok(src.includes('route_id:'), 'must use route_id not routeId');
  assert.ok(src.includes('driver_id:'), 'must use driver_id not driverId');
  assert.ok(src.includes('arrived_at:'), 'must use arrived_at not arrivedAt');
  assert.ok(src.includes('departed_at:'), 'must use departed_at not departedAt');
});

test('stops.js does not export dwellRecords in-memory array', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'stops.js'), 'utf8');
  assert.ok(!src.includes('dwellRecords'), 'stops.js must not reference in-memory dwellRecords');
});

test('stops.js arrive is idempotent — re-arrival returns existing open record', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'stops.js'), 'utf8');
  // The arrive handler queries for an existing open record first and returns early if found
  assert.ok(src.includes('.is(\'departed_at\', null)'), 'arrive must check for open dwell record via .is(null)');
  assert.ok(src.includes('if (existing && existing[0]) return res.json(existing[0])'), 'arrive must return early when already checked in');
});

test('server.js GET /api/dwell uses Supabase not in-memory array', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok(!src.includes('dwellRecords'), 'server.js must not reference in-memory dwellRecords');
  assert.ok(src.includes("from('dwell_records')"), 'GET /api/dwell must query dwell_records table');
  assert.ok(src.includes("eq('driver_id', req.user.id)"), 'GET /api/dwell must scope to driver by driver_id');
});

// ── Demo client round-trip for dwell record lifecycle ─────────────────────────

function freshSupabase() {
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-dwell-'));
  const prev = process.env.NODEROUTE_BACKUP_PATH;
  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}services${path.sep}supabase.js`)) delete require.cache[key];
  }
  const { supabase } = require('../services/supabase');
  return {
    supabase,
    cleanup() {
      if (prev === undefined) delete process.env.NODEROUTE_BACKUP_PATH;
      else process.env.NODEROUTE_BACKUP_PATH = prev;
      for (const key of Object.keys(require.cache)) {
        if (key.includes(`${path.sep}services${path.sep}supabase.js`)) delete require.cache[key];
      }
      fs.rmSync(backupPath, { recursive: true, force: true });
    },
  };
}

test('dwell record insert → depart update → query lifecycle works end-to-end in demo mode', async () => {
  const { supabase, cleanup } = freshSupabase();
  try {
    const arrivedAt = new Date().toISOString();
    const record = { id: 'dwell-test-1', stop_id: 'stop-42', route_id: 'route-7', driver_id: 'driver-3', arrived_at: arrivedAt, departed_at: null, dwell_ms: null };

    // Arrive: insert the record
    const { data: inserted, error: insertErr } = await supabase.from('dwell_records').insert(record).select().single();
    assert.equal(insertErr, null);
    assert.equal(inserted.stop_id, 'stop-42');
    assert.equal(inserted.departed_at, null);

    // Confirm active record is found via .is(null) filter
    const { data: active } = await supabase.from('dwell_records').select('id').eq('route_id', 'route-7').is('departed_at', null).limit(1);
    assert.equal(active.length, 1);
    assert.equal(active[0].id, 'dwell-test-1');

    // Depart: update with departure time and computed dwell_ms
    const departedAt = new Date(Date.now() + 420000).toISOString(); // 7 minutes later
    const dwellMs = new Date(departedAt) - new Date(arrivedAt);
    const { data: updated, error: updateErr } = await supabase
      .from('dwell_records')
      .update({ departed_at: departedAt, dwell_ms: dwellMs })
      .eq('id', 'dwell-test-1')
      .select()
      .single();
    assert.equal(updateErr, null);
    assert.ok(updated.departed_at !== null);
    assert.ok(updated.dwell_ms > 0);

    // Confirm active record is gone
    const { data: noActive } = await supabase.from('dwell_records').select('id').is('departed_at', null);
    assert.equal(noActive.length, 0);

    // Completed record is fetchable
    const { data: completed } = await supabase.from('dwell_records').select('*').eq('id', 'dwell-test-1');
    assert.equal(completed.length, 1);
    assert.ok(completed[0].dwell_ms > 0);
  } finally {
    cleanup();
  }
});

test('dwell_records query in deliveries uses snake_case field names for duration calculation', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'deliveries.js'), 'utf8');
  // stopDurationMinutes uses dwell_ms and arrived_at from DB records
  assert.ok(src.includes('dwell_ms / 60000'), 'stop duration must read dwell_ms from DB record');
  assert.ok(src.includes("activeDwell?.arrived_at"), 'active dwell timing must use arrived_at from DB');
  assert.ok(src.includes("completedDwell?.departed_at"), 'end time must use departed_at from DB');
});
