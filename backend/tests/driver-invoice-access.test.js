const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isRouteAssignedToUser,
  loadDriverInvoiceScope,
  normalize,
  stopMatchesInvoice,
} = require('../services/driver-invoice-access');

function mockSupabase({ routes = [], stops = [], invoices = [] }) {
  return {
    from(table) {
      return {
        select() {
          return {
            order() {
              if (table === 'routes') return Promise.resolve({ data: routes, error: null });
              if (table === 'invoices') return Promise.resolve({ data: invoices, error: null });
              return Promise.resolve({ data: [], error: null });
            },
            then(resolve, reject) {
              if (table === 'stops') return Promise.resolve({ data: stops, error: null }).then(resolve, reject);
              return Promise.resolve({ data: [], error: null }).then(resolve, reject);
            },
          };
        },
      };
    },
  };
}

test('normalize trims, lowercases, and collapses whitespace', () => {
  assert.equal(normalize('  The   Harbor  Market '), 'the harbor market');
});

test('isRouteAssignedToUser matches id, email, or display name', () => {
  const user = { id: 'driver-1', email: 'driver@example.com', name: 'Jamie Driver' };

  assert.equal(isRouteAssignedToUser({ driver_id: 'driver-1' }, user), true);
  assert.equal(isRouteAssignedToUser({ driver_email: 'DRIVER@example.com' }, user), true);
  assert.equal(isRouteAssignedToUser({ driver: ' jamie   driver ' }, user), true);
  assert.equal(isRouteAssignedToUser({ driver_id: 'driver-2', driver: 'Someone Else' }, user), false);
});

test('stopMatchesInvoice supports exact and contained names/addresses', () => {
  assert.equal(stopMatchesInvoice({ name: 'Harbor Market' }, { customer_name: 'Harbor Market' }), true);
  assert.equal(stopMatchesInvoice({ address: '100 Dock St, Boston' }, { customer_address: '100 Dock St' }), true);
  assert.equal(stopMatchesInvoice({ name: 'North Pier Seafood' }, { customer_name: 'Pier' }), true);
  assert.equal(stopMatchesInvoice({ name: 'Harbor Market' }, { customer_name: 'Uptown Cafe' }), false);
});

test('loadDriverInvoiceScope returns only invoices assigned to driver routes', async () => {
  const user = { id: 'driver-1', email: 'driver@example.com', name: 'Jamie Driver' };
  const context = { companyId: 'company-a', activeLocationId: 'loc-a', accessibleLocationIds: ['loc-a'], isGlobalOperator: false };
  const supabase = mockSupabase({
    routes: [
      { id: 'route-1', name: 'North', driver_id: 'driver-1', stop_ids: ['stop-1'], company_id: 'company-a', location_id: 'loc-a' },
      { id: 'route-2', name: 'South', driver_id: 'driver-2', stop_ids: ['stop-2'], company_id: 'company-a', location_id: 'loc-a' },
    ],
    stops: [
      { id: 'stop-1', name: 'Harbor Market', address: '100 Dock St', company_id: 'company-a', location_id: 'loc-a' },
      { id: 'stop-2', name: 'Uptown Cafe', address: '200 Main St', company_id: 'company-a', location_id: 'loc-a' },
    ],
    invoices: [
      { id: 'inv-1', customer_name: 'Harbor Market', company_id: 'company-a', location_id: 'loc-a' },
      { id: 'inv-2', customer_name: 'Uptown Cafe', company_id: 'company-a', location_id: 'loc-a' },
      { id: 'inv-3', route_id: 'route-1', customer_name: 'Other', company_id: 'company-a', location_id: 'loc-a' },
      { id: 'inv-4', driver_name: 'Jamie Driver', customer_name: 'Manual', company_id: 'company-a', location_id: 'loc-a' },
      { id: 'inv-5', customer_name: 'Harbor Market', company_id: 'company-b', location_id: 'loc-a' },
    ],
  });

  const scope = await loadDriverInvoiceScope(supabase, user, context);

  assert.deepEqual(scope.invoices.map(invoice => invoice.id), ['inv-1', 'inv-3', 'inv-4']);
  assert.equal(scope.assignedInvoiceIds.has('inv-2'), false);
  assert.equal(scope.assignedInvoiceIds.has('inv-5'), false);
});
