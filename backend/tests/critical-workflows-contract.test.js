const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { wrapAsyncHandler } = require('../lib/async-route-handler');

const {
  enforceDeliveryLimit,
  enforceDriverLimit,
  sendPlanLimitError,
} = require('../services/plan-limits');

function createSupabaseMock({ plan = 'starter', count = 0 } = {}) {
  return {
    calls: [],
    from(table) {
      const state = { table, filters: [] };
      const query = {
        select(columns, options) {
          state.columns = columns;
          state.options = options || {};
          return this;
        },
        eq(column, value) {
          state.filters.push(['eq', column, value]);
          return this;
        },
        in(column, value) {
          state.filters.push(['in', column, value]);
          return { count, error: null };
        },
        gte(column, value) {
          state.filters.push(['gte', column, value]);
          return { count, error: null };
        },
        single() {
          return { data: { id: 'company-1', plan }, error: null };
        },
      };
      this.calls.push(state);
      return query;
    },
  };
}

test('order creation unit: delivery plan limit blocks over-limit companies', async () => {
  const supabase = createSupabaseMock({ plan: 'trial', count: 100 });
  await assert.rejects(
    () => enforceDeliveryLimit(supabase, { companyId: 'company-1' }),
    (error) => error.code === 'PLAN_LIMIT_EXCEEDED' && error.details.limit === 100
  );
  const companyLookup = supabase.calls.find((call) => call.table === 'companies');
  assert.equal(companyLookup.columns, 'id, plan, status');
});

test('driver assignment unit: driver plan limit blocks over-limit invites', async () => {
  const supabase = createSupabaseMock({ plan: 'starter', count: 5 });
  await assert.rejects(
    () => enforceDriverLimit(supabase, { companyId: 'company-1' }),
    (error) => error.code === 'PLAN_LIMIT_EXCEEDED' && error.details.limit === 5
  );
});

test('delivery status update unit: plan-limit errors serialize with payment-required status', () => {
  const sent = {};
  const res = {
    status(code) {
      sent.status = code;
      return this;
    },
    json(payload) {
      sent.payload = payload;
    },
  };
  const handled = sendPlanLimitError(res, {
    code: 'PLAN_LIMIT_EXCEEDED',
    status: 402,
    message: 'Monthly delivery limit reached for current plan',
    details: { limit: 100, current: 100 },
  });
  assert.equal(handled, true);
  assert.equal(sent.status, 402);
  assert.equal(sent.payload.error, 'PLAN_LIMIT_EXCEEDED');
});

test('critical route integration contract: private order API is mounted behind auth', () => {
  const serverPath = path.join(__dirname, '..', 'server.js');
  const source = fs.readFileSync(serverPath, 'utf8');
  const publicIndex = source.indexOf("app.use('/api/track', trackingRouter)");
  const privateIndex = source.indexOf("app.use('/api/orders', requireApiAuth, ordersRouter)");
  assert.ok(privateIndex > 0, 'orders API must be mounted with requireApiAuth');
  assert.ok(publicIndex > 0 && publicIndex < source.indexOf("app.use('/api', requireApiAuth, deliveriesRouter)"), 'public tracking route must stay before broad protected /api mount');
});
test('async route wrapper forwards rejected handlers to Express next', async () => {
  const expected = new Error('boom');
  let received = null;
  const wrapped = wrapAsyncHandler(async () => {
    throw expected;
  });

  await wrapped({}, {}, (error) => {
    received = error;
  });

  assert.equal(received, expected);
});

test('server installs async route wrapper before loading route modules', () => {
  const serverPath = path.join(__dirname, '..', 'server.js');
  const source = fs.readFileSync(serverPath, 'utf8');
  const installIndex = source.indexOf('installAsyncRouteHandlerWrapping(express);');
  const routeIndex = source.indexOf("const authRouter          = require('./routes/auth');");
  assert.ok(installIndex > 0, 'server must install async route wrapping');
  assert.ok(routeIndex > installIndex, 'async route wrapping must be installed before route modules register handlers');
});
