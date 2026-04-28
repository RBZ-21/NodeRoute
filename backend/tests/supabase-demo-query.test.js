const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

// Each test gets a fresh in-memory DemoQuery state by pointing to a unique
// backup directory and clearing the module cache so localState resets.
function freshSupabase() {
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-sdb-'));
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

test('DemoQuery .is(field, null) returns only rows where field is null', async () => {
  const { supabase, cleanup } = freshSupabase();
  try {
    const now = new Date().toISOString();
    await supabase.from('dwell_records').insert({ id: 'dr-1', stop_id: 's1', route_id: 'r1', driver_id: 'd1', arrived_at: now, departed_at: null });
    await supabase.from('dwell_records').insert({ id: 'dr-2', stop_id: 's2', route_id: 'r1', driver_id: 'd1', arrived_at: now, departed_at: now });

    const { data } = await supabase.from('dwell_records').select('id').is('departed_at', null);

    assert.equal(data.length, 1);
    assert.equal(data[0].id, 'dr-1');
  } finally {
    cleanup();
  }
});

test('DemoQuery .is(field, null) excludes all rows when none are null', async () => {
  const { supabase, cleanup } = freshSupabase();
  try {
    const now = new Date().toISOString();
    await supabase.from('dwell_records').insert({ id: 'dr-1', stop_id: 's1', route_id: 'r1', driver_id: 'd1', arrived_at: now, departed_at: now });

    const { data } = await supabase.from('dwell_records').select('id').is('departed_at', null);

    assert.equal(data.length, 0);
  } finally {
    cleanup();
  }
});

test('DemoQuery .in(field, values) returns only matching rows', async () => {
  const { supabase, cleanup } = freshSupabase();
  try {
    await supabase.from('stops').insert({ id: 'stop-a', name: 'Stop A', address: '1 Main St' });
    await supabase.from('stops').insert({ id: 'stop-b', name: 'Stop B', address: '2 Main St' });
    await supabase.from('stops').insert({ id: 'stop-c', name: 'Stop C', address: '3 Main St' });

    const { data } = await supabase.from('stops').select('id').in('id', ['stop-a', 'stop-c']);

    assert.equal(data.length, 2);
    assert.deepEqual(data.map((r) => r.id).sort(), ['stop-a', 'stop-c']);
  } finally {
    cleanup();
  }
});

test('DemoQuery .in(field, []) returns nothing', async () => {
  const { supabase, cleanup } = freshSupabase();
  try {
    await supabase.from('stops').insert({ id: 'stop-a', name: 'Stop A', address: '1 Main St' });

    const { data } = await supabase.from('stops').select('id').in('id', []);

    assert.equal(data.length, 0);
  } finally {
    cleanup();
  }
});

test('DemoQuery chaining .eq() and .is() applies both filters', async () => {
  const { supabase, cleanup } = freshSupabase();
  try {
    const now = new Date().toISOString();
    // route r1 — one active, one completed
    await supabase.from('dwell_records').insert({ id: 'dr-1', stop_id: 's1', route_id: 'r1', driver_id: 'd1', arrived_at: now, departed_at: null });
    await supabase.from('dwell_records').insert({ id: 'dr-2', stop_id: 's2', route_id: 'r1', driver_id: 'd1', arrived_at: now, departed_at: now });
    // different route — active
    await supabase.from('dwell_records').insert({ id: 'dr-3', stop_id: 's3', route_id: 'r2', driver_id: 'd1', arrived_at: now, departed_at: null });

    const { data } = await supabase.from('dwell_records').select('id').eq('route_id', 'r1').is('departed_at', null);

    assert.equal(data.length, 1);
    assert.equal(data[0].id, 'dr-1');
  } finally {
    cleanup();
  }
});

test('DemoQuery .in() combined with .eq() narrows correctly', async () => {
  const { supabase, cleanup } = freshSupabase();
  try {
    await supabase.from('stops').insert({ id: 'stop-a', name: 'Alpha', address: '1 St' });
    await supabase.from('stops').insert({ id: 'stop-b', name: 'Beta',  address: '2 St' });
    await supabase.from('stops').insert({ id: 'stop-c', name: 'Gamma', address: '3 St' });

    // Ask for stop-a and stop-b, but also filter by name — only stop-a should match
    const { data } = await supabase.from('stops').select('id').in('id', ['stop-a', 'stop-b']).eq('name', 'Alpha');

    assert.equal(data.length, 1);
    assert.equal(data[0].id, 'stop-a');
  } finally {
    cleanup();
  }
});

test('DemoQuery .is() correctly handles update + re-query for depart flow', async () => {
  const { supabase, cleanup } = freshSupabase();
  try {
    const now = new Date().toISOString();
    await supabase.from('dwell_records').insert({ id: 'dr-1', stop_id: 's1', route_id: 'r1', driver_id: 'd1', arrived_at: now, departed_at: null, dwell_ms: null });

    // Simulate departure: update record then confirm .is(null) no longer finds it
    const laterMs = Date.now() + 300000;
    const departedAt = new Date(laterMs).toISOString();
    await supabase.from('dwell_records').update({ departed_at: departedAt, dwell_ms: 300000 }).eq('id', 'dr-1');

    const { data: active } = await supabase.from('dwell_records').select('id').is('departed_at', null);
    assert.equal(active.length, 0);

    const { data: completed } = await supabase.from('dwell_records').select('id, dwell_ms').eq('id', 'dr-1');
    assert.equal(completed[0].dwell_ms, 300000);
  } finally {
    cleanup();
  }
});

test('ResilientQuery.buildQuery passes is and in filters through to real client', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'supabase.js'),
    'utf8'
  );
  assert.ok(src.includes("filter.type === 'is' && typeof query.is === 'function'"), 'buildQuery should forward is filter');
  assert.ok(src.includes("filter.type === 'in' && typeof query.in === 'function'"), 'buildQuery should forward in filter');
  assert.ok(src.includes("filter.value === null ? value == null : value === filter.value"), 'matchesFilter should handle is null check');
  assert.ok(src.includes("filter.value.map(String).includes(String(value))"), 'matchesFilter should handle in array check');
});
