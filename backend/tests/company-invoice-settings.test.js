'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeCompanySettings } = require('../services/company-settings');

test('normalizes editable invoice identity and legal settings', () => {
  const settings = normalizeCompanySettings({
    invoice_address: '2019-C Cherry Hill Lane\nCharleston, SC 29405',
    invoice_phone: '(843) 577-3531',
    invoice_fax: '(843) 722-2445',
    invoice_after_hours_phone: '(843) 723-1278',
    invoice_remit_to: '2019-C Cherry Hill Lane\nCharleston, SC 29405',
    invoice_sales_terms: 'Sales terms',
    invoice_credit_terms: 'Credit terms',
    invoice_copy_label: 'CUSTOMER COPY',
    invoice_safety_notice: 'ALL SEAFOOD SHOULD BE FULLY COOKED',
  });

  assert.equal(settings.invoiceAddress, '2019-C Cherry Hill Lane\nCharleston, SC 29405');
  assert.equal(settings.invoicePhone, '(843) 577-3531');
  assert.equal(settings.invoiceFax, '(843) 722-2445');
  assert.equal(settings.invoiceAfterHoursPhone, '(843) 723-1278');
  assert.equal(settings.invoiceCopyLabel, 'CUSTOMER COPY');
  assert.equal(settings.invoiceSafetyNotice, 'ALL SEAFOOD SHOULD BE FULLY COOKED');
});

test('falls back to company profile phone and address', () => {
  const settings = normalizeCompanySettings({}, 'Fallback Seller', {
    name: 'Profile Seller',
    phone: '843-555-0100',
    address: '1 Market Street',
    city: 'Charleston',
    state: 'SC',
    zip: '29401',
  });

  assert.equal(settings.businessName, 'Fallback Seller');
  assert.equal(settings.invoicePhone, '843-555-0100');
  assert.equal(settings.invoiceAddress, '1 Market Street\nCharleston, SC 29401');
  assert.equal(settings.invoiceRemitTo, '1 Market Street\nCharleston, SC 29401');
});

test('bounds long invoice settings before rendering or persistence', () => {
  const settings = normalizeCompanySettings({
    invoice_address: 'a'.repeat(700),
    invoice_sales_terms: 's'.repeat(5000),
    invoice_copy_label: 'c'.repeat(300),
  });

  assert.equal(settings.invoiceAddress.length, 500);
  assert.equal(settings.invoiceSalesTerms.length, 4000);
  assert.equal(settings.invoiceCopyLabel.length, 200);
});
