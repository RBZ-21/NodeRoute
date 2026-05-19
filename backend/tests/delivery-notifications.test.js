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
    exports: { sendSms },
  };
  return require('../services/delivery-notifications');
}

function makeSupabase(tables) {
  class Query {
    constructor(table) {
      this.rows = [...(tables[table] || [])];
      this.singleRow = false;
    }

    select() { return this; }

    eq(field, value) {
      this.rows = this.rows.filter((row) => String(row[field] ?? '') === String(value ?? ''));
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
