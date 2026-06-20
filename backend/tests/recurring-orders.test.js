'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const supabasePath = require.resolve('../services/supabase');

// Minimal fake supabase covering the recurring generator's calls:
//   recurring_orders: select().eq(active,true)  /  update().eq(id)
//   orders:           select().eq().eq().limit()  /  insert().select().single()
//   stops:            insert().select().single()
//   routes:           select().eq(id).single() / update().eq(id)
function makeSupabase(tables) {
  class Query {
    constructor(table) {
      this.table = table;
      this.rows = [...(tables[table] || [])];
      this.singleRow = false;
      this.inserting = null;
      this.patch = null;
      this.matchId = null;
    }
    select() { return this; }
    eq(field, value) {
      if (this.patch) { this.matchId = this.matchId ?? {}; this.matchId[field] = value; return this; }
      this.rows = this.rows.filter((row) => String(row[field] ?? '') === String(value ?? ''));
      return this;
    }
    limit() { return this; }
    update(patch) { this.patch = patch; return this; }
    insert(records) {
      const list = (Array.isArray(records) ? records : [records]);
      // Enforce the unique (recurring_order_id, recurring_run_date) guard.
      const target = (tables[this.table] = tables[this.table] || []);
      for (const rec of list) {
        const dup = target.find((r) =>
          r.recurring_order_id && rec.recurring_order_id &&
          String(r.recurring_order_id) === String(rec.recurring_order_id) &&
          String(r.recurring_run_date) === String(rec.recurring_run_date));
        if (dup) { this.error = { code: '23505', message: 'duplicate key' }; this.inserting = []; return this; }
      }
      this.inserting = list.map((r, i) => ({ id: `ord-${target.length + i + 1}`, ...r }));
      target.push(...this.inserting);
      this.rows = this.inserting;
      return this;
    }
    single() { this.singleRow = true; return this; }
    then(resolve) {
      if (this.patch) {
        const tableRows = tables[this.table] || [];
        for (const row of tableRows) {
          if (this.matchId && String(row.id) === String(this.matchId.id)) Object.assign(row, this.patch);
        }
        return Promise.resolve({ data: null, error: null }).then(resolve);
      }
      if (this.error) return Promise.resolve({ data: null, error: this.error }).then(resolve);
      const data = this.singleRow ? (this.rows[0] || null) : this.rows;
      return Promise.resolve({ data, error: null }).then(resolve);
    }
  }
  return { from: (table) => new Query(table) };
}

function loadServiceWithSupabase(tables) {
  delete require.cache[supabasePath];
  require.cache[supabasePath] = {
    id: supabasePath,
    filename: supabasePath,
    loaded: true,
    exports: { supabase: makeSupabase(tables) },
  };
  delete require.cache[require.resolve('../services/recurring-orders')];
  return require('../services/recurring-orders');
}

test('computeNextRunDate finds the next scheduled weekday', () => {
  const service = loadServiceWithSupabase({});
  // 2026-06-15 is a Monday (UTC). Schedule = Wed(3)/Fri(5).
  const from = new Date('2026-06-15T12:00:00Z');
  assert.equal(service.computeNextRunDate([3, 5], from), '2026-06-17'); // Wednesday
});

test('recurring generation is idempotent — running twice does not duplicate orders', async () => {
  // Target date 2026-06-17 (Wednesday, UTC day 3).
  const target = new Date('2026-06-17T12:00:00Z');
  const tables = {
    recurring_orders: [
      { id: 'rec-1', company_id: 'co-1', location_id: 'loc-1', customer_name: 'Standing Cafe', customer_address: '100 Dock St', schedule_days: [3, 5], items: [{ item_number: 'SAL-01', name: 'Salmon', quantity: 4, unit: 'lb', unit_price: 12 }], active: true, route_template_id: 'route-9' },
      { id: 'rec-2', company_id: 'co-1', customer_name: 'Tuesday Only', schedule_days: [2], items: [{ item_number: 'TUN-01', name: 'Tuna', quantity: 2, unit: 'lb', unit_price: 18 }], active: true },
    ],
    orders: [],
    stops: [],
    routes: [{ id: 'route-9', company_id: 'co-1', stop_ids: [], active_stop_ids: [] }],
  };
  const service = loadServiceWithSupabase(tables);

  const first = await service.runRecurringOrderGeneration(target);
  assert.equal(first.due, 1); // only rec-1 is due on Wednesday
  assert.equal(first.created, 1);
  assert.equal(tables.orders.length, 1);
  assert.equal(tables.orders[0].source, 'recurring');
  assert.equal(tables.orders[0].route_id, 'route-9'); // pre-assigned to route template
  assert.equal(tables.orders[0].status, 'pending');
  assert.equal(tables.stops.length, 1);
  assert.equal(tables.stops[0].route_id, 'route-9');
  assert.equal(tables.stops[0].company_id, 'co-1');
  assert.equal(tables.stops[0].location_id, 'loc-1');
  assert.equal(tables.orders[0].stop_id, tables.stops[0].id);
  assert.deepEqual(tables.routes[0].stop_ids, [tables.stops[0].id]);
  assert.deepEqual(tables.routes[0].active_stop_ids, [tables.stops[0].id]);

  const second = await service.runRecurringOrderGeneration(target);
  assert.equal(second.created, 0);
  assert.equal(second.skipped, 1);
  assert.equal(tables.orders.length, 1); // no duplicate
});
