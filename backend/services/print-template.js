// Simple HTML print template generator for orders
// Produces a compact order slip including customer, items and timestamp.
"use strict";

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatLine(item) {
  const name = escapeHtml(item.name || item.description || '');
  const unit = item.unit || 'ea';
  // Prefer actual weight for weight-based items, otherwise quantity
  const weight = (typeof item.actual_weight === 'number' && item.actual_weight > 0)
    ? `${item.actual_weight.toFixed(3)} lb`
    : (typeof item.quantity === 'number' ? `${item.quantity} ${unit}` : '');
  return `- ${name} ${weight}`.trim();
}

function renderOrderSlip(order) {
  const lines = (order.items || []).map((it) => formatLine(it)).filter((l) => l).join('\n');
  const ts = new Date(order.created_at || order.createdAt || Date.now()).toISOString();
  return `Order Slip - ${escapeHtml(order.order_number || order.id)}\nCustomer: ${escapeHtml(order.customer_name || '')}\nDate: ${escapeHtml(ts)}\n\nItems:\n${lines}\n\nTotal: ${escapeHtml(order.total || '')}`;
}

module.exports = {
  renderOrderSlip,
};
