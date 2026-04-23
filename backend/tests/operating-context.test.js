const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildRequestContext,
  buildScopeFields,
  filterRowsByContext,
  rowMatchesContext,
  userResponseWithContext,
} = require('../services/operating-context');

test('buildRequestContext honors allowed requested locations', () => {
  const user = {
    id: 'u1',
    email: 'ops@example.com',
    role: 'manager',
    company_id: 'company-a',
    location_id: 'loc-a',
    accessible_location_ids: ['loc-a', 'loc-b'],
  };
  const req = { headers: { 'x-location-id': 'loc-b' }, query: {}, body: {} };

  const context = buildRequestContext(req, user);

  assert.equal(context.companyId, 'company-a');
  assert.equal(context.locationId, 'loc-a');
  assert.equal(context.activeLocationId, 'loc-b');
});

test('buildRequestContext honors allowed requested company', () => {
  const user = {
    id: 'u1',
    role: 'admin',
    company_id: 'company-a',
    accessible_company_ids: ['company-a', 'company-b'],
  };
  const req = { headers: { 'x-company-id': 'company-b' }, query: {}, body: {} };

  const context = buildRequestContext(req, user);

  assert.equal(context.companyId, 'company-a');
  assert.equal(context.activeCompanyId, 'company-b');
});

test('buildRequestContext rejects inaccessible requested company', () => {
  const user = {
    id: 'u1',
    role: 'manager',
    company_id: 'company-a',
    accessible_company_ids: ['company-a'],
  };
  const req = { headers: { 'x-company-id': 'company-z' }, query: {}, body: {} };

  const context = buildRequestContext(req, user);

  assert.equal(context.activeCompanyId, 'company-a');
});

test('buildRequestContext rejects inaccessible requested locations', () => {
  const user = {
    id: 'u1',
    role: 'manager',
    company_id: 'company-a',
    location_id: 'loc-a',
    accessible_location_ids: ['loc-a'],
  };
  const req = { headers: { 'x-location-id': 'loc-z' }, query: {}, body: {} };

  const context = buildRequestContext(req, user);

  assert.equal(context.activeLocationId, 'loc-a');
});

test('rowMatchesContext enforces company and active location boundaries', () => {
  const context = {
    companyId: 'company-a',
    activeCompanyId: 'company-a',
    accessibleCompanyIds: ['company-a'],
    activeLocationId: 'loc-a',
    accessibleLocationIds: ['loc-a'],
    isGlobalOperator: false,
  };

  assert.equal(rowMatchesContext({ company_id: 'company-a', location_id: 'loc-a' }, context), true);
  assert.equal(rowMatchesContext({ company_id: 'company-b', location_id: 'loc-a' }, context), false);
  assert.equal(rowMatchesContext({ company_id: 'company-a', location_id: 'loc-b' }, context), false);
});

test('filterRowsByContext keeps legacy unscoped rows visible', () => {
  const context = {
    companyId: 'company-a',
    activeCompanyId: 'company-a',
    accessibleCompanyIds: ['company-a'],
    activeLocationId: 'loc-a',
    accessibleLocationIds: ['loc-a'],
    isGlobalOperator: false,
  };
  const rows = [
    { id: 1, company_id: 'company-a', location_id: 'loc-a' },
    { id: 2 },
    { id: 3, company_id: 'company-b', location_id: 'loc-a' },
  ];

  assert.deepEqual(filterRowsByContext(rows, context).map(row => row.id), [1, 2]);
});

test('buildScopeFields uses active location for new records', () => {
  const scoped = buildScopeFields({
    companyId: 'company-a',
    activeCompanyId: 'company-b',
    locationId: 'loc-a',
    activeLocationId: 'loc-b',
  });

  assert.deepEqual(scoped, { company_id: 'company-b', location_id: 'loc-b' });
});

test('userResponseWithContext never includes password hashes', () => {
  const response = userResponseWithContext({
    id: 'u1',
    name: 'Manager',
    email: 'm@example.com',
    role: 'manager',
    password_hash: 'secret',
    company_id: 'company-a',
  });

  assert.equal(response.password_hash, undefined);
  assert.equal(response.companyId, 'company-a');
  assert.equal(response.activeCompanyId, 'company-a');
});
