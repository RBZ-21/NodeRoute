const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildRequestContext,
  filterRowsByContext,
  rowMatchesContext,
} = require('../services/operating-context');

test('tenant context ignores forged company and location headers outside allowed scope', () => {
  const user = {
    id: 'ops-1',
    email: 'ops@example.com',
    company_id: 'company-a',
    location_id: 'loc-a',
    accessible_company_ids: ['company-a'],
    accessible_location_ids: ['loc-a'],
  };

  const context = buildRequestContext({
    headers: {
      'x-company-id': 'company-b',
      'x-location-id': 'loc-b',
    },
    query: {},
    body: {},
  }, user);

  assert.equal(context.activeCompanyId, 'company-a');
  assert.equal(context.activeLocationId, 'loc-a');
  assert.equal(context.requestedCompanyId, 'company-b');
  assert.equal(context.requestedLocationId, 'loc-b');
});

test('tenant filtering rejects cross-company rows for route and temperature-log data', () => {
  const context = {
    companyId: 'company-a',
    activeCompanyId: 'company-a',
    accessibleCompanyIds: ['company-a'],
    locationId: 'loc-a',
    activeLocationId: 'loc-a',
    accessibleLocationIds: ['loc-a'],
    isGlobalOperator: false,
  };

  const rows = [
    { id: 'route-1', company_id: 'company-a', location_id: 'loc-a', route_id: 'route-1' },
    { id: 'route-2', company_id: 'company-b', location_id: 'loc-b', route_id: 'route-2' },
  ];

  assert.equal(rowMatchesContext(rows[0], context), true);
  assert.equal(rowMatchesContext(rows[1], context), false);
  assert.deepEqual(filterRowsByContext(rows, context), [rows[0]]);
});

test('global operators may intentionally cross tenant boundaries', () => {
  const context = {
    companyId: 'company-a',
    activeCompanyId: 'company-b',
    accessibleCompanyIds: ['company-a', 'company-b'],
    locationId: 'loc-a',
    activeLocationId: 'loc-b',
    accessibleLocationIds: ['loc-a', 'loc-b'],
    isGlobalOperator: true,
  };

  const foreignRow = { id: 'audit-1', company_id: 'company-b', location_id: 'loc-b' };
  assert.equal(rowMatchesContext(foreignRow, context), true);
});
