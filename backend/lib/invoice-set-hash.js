'use strict';

const crypto = require('crypto');

function normalizeInvoiceTotal(value) {
  return (Math.round((Number.parseFloat(value) || 0) * 100) / 100).toFixed(2);
}

function canonicalInvoiceSet(invoices = []) {
  return invoices
    .map((invoice) => ({
      id: String(invoice?.id || ''),
      status: String(invoice?.status || '').trim().toLowerCase(),
      total: normalizeInvoiceTotal(invoice?.total),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function hashInvoiceSet(invoices = []) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalInvoiceSet(invoices)))
    .digest('hex');
}

function parseInvoiceIds(value) {
  return String(value || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

module.exports = {
  canonicalInvoiceSet,
  hashInvoiceSet,
  normalizeInvoiceTotal,
  parseInvoiceIds,
};
