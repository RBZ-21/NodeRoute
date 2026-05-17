const test = require('node:test');
const assert = require('node:assert/strict');

const { selectPortalCustomerContext } = require('../routes/portal/shared');

test('selectPortalCustomerContext keeps a single company/location context even with multiple matching records', () => {
  const selected = selectPortalCustomerContext([
    {
      email: 'buyer@example.com',
      name: 'Fresh Fish',
      companyId: 'company-1',
      locationId: 'location-1',
      createdAt: '2026-05-10T10:00:00.000Z',
      source: 'invoice',
    },
    {
      email: 'buyer@example.com',
      name: 'Fresh Fish',
      companyId: 'company-1',
      locationId: 'location-1',
      createdAt: '2026-05-09T10:00:00.000Z',
      source: 'order',
    },
  ]);

  assert.equal(selected.companyId, 'company-1');
  assert.equal(selected.locationId, 'location-1');
});

test('selectPortalCustomerContext rejects ambiguous portal emails shared across tenant contexts', () => {
  assert.throws(
    () => selectPortalCustomerContext([
      {
        email: 'shared@example.com',
        name: 'Company A',
        companyId: 'company-a',
        locationId: 'location-a',
        createdAt: '2026-05-10T10:00:00.000Z',
        source: 'invoice',
      },
      {
        email: 'shared@example.com',
        name: 'Company B',
        companyId: 'company-b',
        locationId: 'location-b',
        createdAt: '2026-05-09T10:00:00.000Z',
        source: 'order',
      },
    ]),
    (error) => error && error.code === 'PORTAL_EMAIL_AMBIGUOUS'
  );
});
