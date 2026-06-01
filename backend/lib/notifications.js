'use strict';

const { sendSms } = require('../services/sms');
const logger = require('../services/logger');

async function sendOrderAlert(order) {
  const staffPhone = process.env.STAFF_PHONE || '';
  if (!staffPhone) {
    logger.warn('[notifications] STAFF_PHONE not set — skipping phone order SMS alert');
    return;
  }

  const header = order.business_name || order.caller_phone || 'Unknown Caller';

  const itemLines = (order.line_items || []).map((item) => {
    const flag = typeof item.confidence === 'number' && item.confidence < 0.7 ? ' ⚠️' : '';
    return `  ${item.quantity} ${item.unit} ${item.product}${flag}`;
  });

  const lines = [
    `📦 Phone Order: ${header}`,
    ...itemLines,
    order.needs_callback ? '🔴 NEEDS CALLBACK' : null,
    `Review: /orders/${order.id}`,
  ].filter(Boolean);

  const result = await sendSms(staffPhone, lines.join('\n'));
  if (!result.success) {
    logger.error({ error: result.error }, '[notifications] Failed to send phone order SMS alert');
  }
}

module.exports = { sendOrderAlert };
