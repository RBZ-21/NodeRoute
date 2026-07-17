const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..', '..');
const ordersRouteSource = fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'orders.js'), 'utf8');
const invoiceEmailServiceSource = fs.readFileSync(path.join(repoRoot, 'backend', 'services', 'invoice-email.js'), 'utf8');

test('fulfillment route sends invoice email through shared service when possible', () => {
  for (const marker of [
    "const { sendInvoiceEmail } = require('../services/invoice-email');",
    'async function sendFulfillmentInvoiceIfPossible(invoice)',
    "return await sendInvoiceEmail(invoice, 'Invoice');",
    'const emailResult = await sendFulfillmentInvoiceIfPossible(invoice);',
    'emailSent: !!emailResult.sent',
  ]) {
    assert.ok(ordersRouteSource.includes(marker), `orders route missing marker ${marker}`);
  }
});

test('manual delivered orders also send the linked invoice email and surface the result', () => {
  for (const marker of [
    'async function markOrderDelivered(order, req, res)',
    "const emailResult = await sendInvoiceEmail(",
    "emailSent: deliverySync.emailSent,",
    "emailError: deliverySync.emailError || null,",
  ]) {
    assert.ok(ordersRouteSource.includes(marker), `orders route missing delivered-email marker ${marker}`);
  }
});

test('shared invoice email service owns delivery logic for invoice attachments', () => {
  for (const marker of [
    "const { createMailer } = require('./email');",
    "const { buildInvoicePDF } = require('./pdf');",
    "const { loadInvoiceDocument, snapshotInvoiceDocument } = require('./invoice-document');",
    'html: renderInvoiceEmailHtml(document)',
    'filename: `invoice-${invoiceLabel}.pdf`',
    'document_snapshot: snapshotInvoiceDocument(document)',
    'scopeQueryByContext(updateQuery, context)',
  ]) {
    assert.ok(invoiceEmailServiceSource.includes(marker), `invoice email service missing marker ${marker}`);
  }
});
