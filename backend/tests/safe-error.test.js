'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { apiError } = require('../lib/safe-error');

test('apiError builds a consistent payload with optional code and details', () => {
  const { status, payload } = apiError('Customer is on credit hold', {
    code: 'CUSTOMER_CREDIT_HOLD',
    status: 402,
    details: { available_credit: 0 },
  });
  assert.equal(status, 402);
  assert.deepEqual(payload, {
    error: 'Customer is on credit hold',
    code: 'CUSTOMER_CREDIT_HOLD',
    details: { available_credit: 0 },
  });
});

test('apiError defaults to status 400 and omits code/details when not provided', () => {
  const { status, payload } = apiError('Invalid request');
  assert.equal(status, 400);
  assert.deepEqual(payload, { error: 'Invalid request' });
});
