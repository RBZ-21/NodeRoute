const test = require('node:test');
const assert = require('node:assert/strict');

const smsPath = require.resolve('../services/sms');
const notificationsPath = require.resolve('../services/delivery-notifications');

function loadNotifications(sendSms) {
  delete require.cache[notificationsPath];
  require.cache[smsPath] = {
    id: smsPath,
    filename: smsPath,
    loaded: true,
    exports: {
      sendSms,
      maskPhone(value) {
        const digits = String(value || '').replace(/\D/g, '');
        return digits ? `***${digits.slice(-4)}` : '[redacted]';
      },
    },
  };
  return require('../services/delivery-notifications');
}

function makeSupabase(tables) {
  class Query {
    constructor(table) {
      this.table = table;
      this.rows = [...(tables[table] || [])];
      this.singleRow = false;
      this.patch = null;
    }

    select() { return this; }
    order() { return this; }

    eq(field, value) {
      this.rows = this.rows.filter((row) => String(row[field] ?? '') === String(value ?? ''));
      return this;
    }

    in(field, values) {
      const wanted = new Set((values || []).map((value) => String(value)));
      this.rows = this.rows.filter((row) => wanted.has(String(row[field])));
      return this;
    }

    not(field, operator, value) {
      if (operator === 'is' && value === null) {
        this.rows = this.rows.filter((row) => row[field] !== null && row[field] !== undefined);
      }
      return this;
    }

    gt(field, value) {
      this.rows = this.rows.filter((row) => Number(row[field]) > Number(value));
      return this;
    }

    lt(field, value) {
      this.rows = this.rows.filter((row) => Number(row[field]) < Number(value));
      return this;
    }

    gte(field, value) {
      this.rows = this.rows.filter((row) => new Date(row[field]).getTime() >= new Date(value).getTime());
      return this;
    }

    insert(records) {
      const list = Array.isArray(records) ? records : [records];
      const target = (tables[this.table] = tables[this.table] || []);
      for (const record of list) target.push({ id: `gen-${target.length + 1}`, ...record });
      this.rows = list;
      return this;
    }

    update(patch) {
      this.patch = patch;
      return this;
    }

    limit(count) {
      this.rows = this.rows.slice(0, count);
      return this;
    }

    single() {
      this.singleRow = true;
      return this;
    }

    then(resolve) {
      if (this.patch) {
        const tableRows = tables[this.table] || [];
        const matchingIds = new Set(this.rows.map((row) => row.id));
        for (const row of tableRows) {
          if (matchingIds.has(row.id)) Object.assign(row, this.patch);
        }
        this.rows = this.rows.map((row) => ({ ...row, ...this.patch }));
      }
      const data = this.singleRow ? (this.rows[0] || null) : this.rows;
      return Promise.resolve({ data, error: null }).then(resolve);
    }
  }

  return {
    from(table) {
      return new Query(table);
    },
  };
}

test('notifyDriverArriving calls sendSms when phone is present', async () => {
  const sent = [];
  const notifications = loadNotifications(async (to, body) => {
    sent.push({ to, body });
    return { success: true, sid: 'SM123' };
  });
  const supabase = makeSupabase({
    stops: [{ id: 'stop-1', address: '100 Main St' }],
    orders: [{ id: 'order-1', stop_id: 'stop-1', customer_phone: '(843) 555-0100' }],
  });

  await notifications.notifyDriverArriving(supabase, 'stop-1', 'route-1');

  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, '+18435550100');
  assert.match(sent[0].body, /arriving now at 100 Main St/);
});

test('notifyDriverArriving does not throw when phone is missing', async () => {
  const notifications = loadNotifications(async () => {
    throw new Error('sendSms should not be called');
  });
  const supabase = makeSupabase({
    stops: [{ id: 'stop-1', address: '100 Main St' }],
    orders: [{ id: 'order-1', stop_id: 'stop-1', customer_phone: null }],
  });

  await assert.doesNotReject(() => notifications.notifyDriverArriving(supabase, 'stop-1', 'route-1'));
});

test('notifyDeliveryCompleted does not throw when sendSms throws', async () => {
  const notifications = loadNotifications(async () => {
    throw new Error('Twilio exploded');
  });
  const supabase = makeSupabase({
    stops: [{ id: 'stop-1', address: '100 Main St' }],
    orders: [{ id: 'order-1', stop_id: 'stop-1', customer_phone: '+18435550100' }],
  });

  await assert.doesNotReject(() => notifications.notifyDeliveryCompleted(supabase, 'stop-1', 'order-1'));
});

test('notifyUpcomingStops sends SMS to the stop 3 positions into the remaining queue', async () => {
  const sent = [];
  const notifications = loadNotifications(async (to, body) => {
    sent.push({ to, body });
    return { success: true, sid: 'SM456' };
  });
  const supabase = makeSupabase({
    routes: [{ id: 'route-1', active_stop_ids: ['s0', 's1', 's2', 's3', 's4'] }],
    stops: [
      { id: 's0', status: 'completed', address: '0 Dock St' },
      { id: 's1', status: 'completed', address: '1 Dock St' },
      { id: 's2', status: 'pending', address: '2 Dock St' },
      { id: 's3', status: 'pending', address: '3 Dock St' },
      { id: 's4', status: 'pending', address: '4 Dock St' },
    ],
    // Remaining queue is [s2, s3, s4]; 3 stops away = s4 (index NOTIFY_AT_STOPS_AWAY - 1).
    orders: [
      { id: 'o4', stop_id: 's4', customer_name: 'Sea Mart', customer_phone: '(843) 555-0104', tracking_token: 'tok-4' },
    ],
    dwell_records: [
      { dwell_ms: 600000, arrived_at: '2026-05-19T10:00:00Z' },
      { dwell_ms: 600000, arrived_at: '2026-05-19T10:01:00Z' },
      { dwell_ms: 600000, arrived_at: '2026-05-19T10:02:00Z' },
      { dwell_ms: 600000, arrived_at: '2026-05-19T10:03:00Z' },
      { dwell_ms: 600000, arrived_at: '2026-05-19T10:04:00Z' },
    ],
  });

  await notifications.notifyUpcomingStops(supabase, 'route-1', 's1', {});

  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, '+18435550104');
  assert.match(sent[0].body, /3 stops away/);
  assert.match(sent[0].body, /~30 minutes/);
});

test('notifyRouteDispatched sends only to orders in the active route queue', async () => {
  const sent = [];
  const notifications = loadNotifications(async (to, body) => {
    sent.push({ to, body });
    return { success: true, sid: 'SM-DISPATCH' };
  });
  const supabase = makeSupabase({
    routes: [{ id: 'route-1', stop_ids: ['active-stop', 'inactive-stop'], active_stop_ids: ['active-stop'] }],
    orders: [
      { id: 'active-order', route_id: 'route-1', stop_id: 'active-stop', customer_name: 'Active Cafe', customer_phone: '(843) 555-0200', tracking_token: 'active-token', status: 'pending' },
      { id: 'stale-order', route_id: 'route-1', stop_id: 'inactive-stop', customer_name: 'Stale Cafe', customer_phone: '(843) 555-0201', tracking_token: 'stale-token', status: 'pending' },
    ],
  });

  const result = await notifications.notifyRouteDispatched(supabase, 'route-1', 'https://app.example/track?t=');

  assert.equal(result.sent, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, '+18435550200');
  assert.match(sent[0].body, /active-token/);
});

test('notifyUpcomingStops skips stops already proximity notified', async () => {
  const sent = [];
  const notifications = loadNotifications(async (to, body) => {
    sent.push({ to, body });
    return { success: true, sid: 'SM456' };
  });
  const supabase = makeSupabase({
    routes: [{ id: 'route-1', active_stop_ids: ['s0', 's1', 's2', 's3', 's4'] }],
    stops: [
      { id: 's0', status: 'completed' },
      { id: 's1', status: 'completed' },
      { id: 's2', status: 'pending' },
      { id: 's3', status: 'pending' },
      { id: 's4', status: 'pending', proximity_notified_at: '2026-05-19T10:00:00Z' },
    ],
    orders: [
      { id: 'o4', stop_id: 's4', customer_name: 'Sea Mart', customer_phone: '(843) 555-0104', tracking_token: 'tok-4' },
    ],
  });

  await notifications.notifyUpcomingStops(supabase, 'route-1', 's1', {});

  assert.equal(sent.length, 0);
});

test('notifyUpcomingStops does not throw when sendSms rejects', async () => {
  const notifications = loadNotifications(async () => {
    throw new Error('Twilio exploded');
  });
  const supabase = makeSupabase({
    routes: [{ id: 'route-1', active_stop_ids: ['s0', 's1', 's2', 's3', 's4'] }],
    stops: [
      { id: 's0', status: 'completed' },
      { id: 's1', status: 'completed' },
      { id: 's2', status: 'pending' },
      { id: 's3', status: 'pending' },
      { id: 's4', status: 'pending' },
    ],
    orders: [
      { id: 'o3', stop_id: 's3', customer_name: 'Sea Mart', customer_phone: '(843) 555-0103', tracking_token: 'tok-3' },
    ],
    dwell_records: [
      { dwell_ms: 600000, arrived_at: '2026-05-19T10:00:00Z' },
      { dwell_ms: 600000, arrived_at: '2026-05-19T10:01:00Z' },
      { dwell_ms: 600000, arrived_at: '2026-05-19T10:02:00Z' },
      { dwell_ms: 600000, arrived_at: '2026-05-19T10:03:00Z' },
      { dwell_ms: 600000, arrived_at: '2026-05-19T10:04:00Z' },
    ],
  });

  await assert.doesNotReject(() => notifications.notifyUpcomingStops(supabase, 'route-1', 's1', {}));
});

test('notifyDeliveryCompleted skips when the customer has opted out of SMS', async () => {
  const sent = [];
  const notifications = loadNotifications(async (to, body) => {
    sent.push({ to, body });
    return { success: true, sid: 'SM999' };
  });
  const supabase = makeSupabase({
    stops: [{ id: 'stop-1', address: '100 Main St' }],
    orders: [{ id: 'order-1', stop_id: 'stop-1', customer_id: 'cust-1', customer_phone: '+18435550100' }],
    Customers: [{ id: 'cust-1', sms_notifications_enabled: false }],
  });

  const result = await notifications.notifyDeliveryCompleted(supabase, 'stop-1', 'order-1');

  assert.equal(sent.length, 0);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'sms_notifications_disabled');
});

test('delivery events are logged to outbound_messages and de-duplicated per stop', async () => {
  const sent = [];
  const notifications = loadNotifications(async (to, body) => {
    sent.push({ to, body });
    return { success: true, sid: 'SM-DEDUP' };
  });
  const tables = {
    stops: [{ id: 'stop-1', address: '100 Main St' }],
    orders: [{ id: 'order-1', stop_id: 'stop-1', customer_id: 'cust-1', customer_phone: '+18435550100' }],
    Customers: [{ id: 'cust-1', sms_notifications_enabled: true }],
    outbound_messages: [],
  };
  const supabase = makeSupabase(tables);

  const first = await notifications.notifyDeliveryCompleted(supabase, 'stop-1', 'order-1');
  assert.equal(first.sent, true);
  assert.equal(sent.length, 1);
  // The send was logged.
  assert.equal(tables.outbound_messages.filter((m) => m.status === 'sent' && m.event === 'delivery_completed').length, 1);

  // A second completion for the same stop must not re-send.
  const second = await notifications.notifyDeliveryCompleted(supabase, 'stop-1', 'order-1');
  assert.equal(second.skipped, true);
  assert.equal(second.reason, 'duplicate_event');
  assert.equal(sent.length, 1);
});
