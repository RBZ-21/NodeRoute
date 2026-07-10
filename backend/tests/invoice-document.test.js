'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildInvoiceDocument,
  countInvoicePieces,
  snapshotInvoiceDocument,
} = require('../services/invoice-document');

test('buildInvoiceDocument maps the approved customer invoice fields', () => {
  const document = buildInvoiceDocument({
    invoice: {
      id: 'inv-1',
      invoice_number: 'INV-10482',
      customer_name: 'Harbor Kitchen',
      customer_address: '125 Waterfront Drive',
      billing_name: 'Harbor Kitchen LLC',
      billing_contact: 'Morgan Lee',
      billing_address: '100 Harbor Way',
      billing_phone: '843-555-0100',
      billing_email: 'billing@example.test',
      subtotal: 865,
      tax: 77.85,
      total: 942.85,
      created_at: '2026-07-10T12:00:00Z',
      items: [
        {
          item_number: 'FISH-101',
          requested_qty: 3,
          quantity: 3,
          unit: 'case',
          description: 'Grouper',
          lot_number: 'LOT-7021',
          unit_price: 145,
          total: 435,
        },
        {
          item_number: 'SHR-16',
          requested_weight: 20,
          actual_weight: 18.4,
          quantity: 18.4,
          unit: 'lb',
          description: 'Shrimp',
          lot_number: 'LOT-7050',
          unit_price: 13.75,
          total: 253,
        },
      ],
    },
    companySettings: {
      businessName: "Crosby's Seafood",
      invoicePhone: '(843) 577-3531',
      invoiceSafetyNotice: 'ALL SEAFOOD SHOULD BE FULLY COOKED',
    },
    order: {
      created_at: '2026-07-10T11:00:00Z',
      salesperson_name: 'Jordan Reed',
    },
    customer: {
      customer_number: '004',
      payment_terms: 'NET 30 DAYS',
    },
    stop: { scheduled_date: '2026-07-11' },
    route: { name: 'North' },
    driver: { vehicle_id: 'Truck 8' },
  });

  assert.equal(document.seller.businessName, "Crosby's Seafood");
  assert.equal(document.seller.phone, '(843) 577-3531');
  assert.equal(document.soldTo.name, 'Harbor Kitchen LLC');
  assert.equal(document.shippedTo.address, '125 Waterfront Drive');
  assert.equal(document.metadata.customerNumber, '004');
  assert.equal(document.metadata.salesperson, 'Jordan Reed');
  assert.equal(document.metadata.truckRoute, 'Truck 8 / North');
  assert.equal(document.metadata.paymentTerms, 'NET 30 DAYS');
  assert.equal(document.items[0].orderedQuantity, 3);
  assert.equal(document.items[1].orderedQuantity, 20);
  assert.equal(document.items[1].shippedQuantity, 18.4);
  assert.equal(document.totals.pieceCount, 3);
  assert.equal(document.totals.total, 942.85);
});

test('snapshotInvoiceDocument excludes base64 image payloads', () => {
  const snapshot = snapshotInvoiceDocument({
    seller: { businessName: 'Seller', logoDataUrl: 'data:image/png;base64,AAA' },
    signature: { signedAt: '2026-07-10', imageData: 'data:image/png;base64,BBB' },
    proofOfDelivery: { uploadedAt: '2026-07-10', imageData: 'data:image/jpeg;base64,CCC' },
    metadata: {},
    items: [],
    totals: {},
    soldTo: {},
    shippedTo: {},
  });

  assert.equal(snapshot.seller.logoDataUrl, null);
  assert.equal(snapshot.signature.imageData, null);
  assert.equal(snapshot.proofOfDelivery.imageData, null);
  assert.equal(snapshot.seller.businessName, 'Seller');
});

test('countInvoicePieces excludes weight units', () => {
  assert.equal(countInvoicePieces([
    { shippedQuantity: 4, uom: 'case' },
    { shippedQuantity: 18.4, uom: 'lb' },
    { shippedQuantity: 2, uom: 'BG' },
  ]), 6);
});
