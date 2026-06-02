'use strict';

const express = require('express');
const { supabase } = require('../services/supabase');
const { generateOrderIntakeDraft } = require('../services/ai');
const logger = require('../services/logger');

const router = express.Router();

const SMS_WEBHOOK_SECRET = process.env.SMS_WEBHOOK_SECRET || '';
const SMS_COMPANY_ID = process.env.SMS_COMPANY_ID || process.env.DEFAULT_COMPANY_ID || '';
const SMS_LOCATION_ID = process.env.SMS_LOCATION_ID || process.env.DEFAULT_LOCATION_ID || '';

function normalizeField(body, ...keys) {
  for (const key of keys) {
    const value = body[key] ?? body[key.toLowerCase()] ?? body[key.toUpperCase()];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return null;
}

// POST /api/webhooks/sms-inbound
// Compatible with Textbox native webhook and Zapier webhook payloads.
// Secure with x-webhook-secret header or ?secret= query param.
router.post('/inbound', async (req, res) => {
  const provided = req.headers['x-webhook-secret'] || req.query.secret || '';
  if (!SMS_WEBHOOK_SECRET) {
    logger.warn('SMS_WEBHOOK_SECRET is not set — rejecting all inbound SMS webhook requests');
    return res.status(401).json({ error: 'Webhook not configured' });
  }
  if (provided !== SMS_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = req.body || {};
  const from = normalizeField(body, 'from', 'From', 'sender', 'phone', 'from_number', 'FromNumber');
  const text = normalizeField(body, 'body', 'Body', 'message', 'text', 'content', 'Message', 'Text');

  if (!text) {
    return res.status(200).json({ status: 'ignored', reason: 'Empty message body' });
  }

  logger.info({ from, textLength: text.length }, 'SMS inbound webhook received');

  let parsed;
  try {
    parsed = await generateOrderIntakeDraft(text);
  } catch (err) {
    logger.error({ err: err.message }, 'SMS order parsing failed');
    parsed = { customer_name_hint: null, order_notes: null, items: [], warnings: ['AI parsing unavailable — review message manually.'] };
  }

  const orderNumber = `SMS-${Date.now().toString(36).toUpperCase()}`;

  const orderRow = {
    order_number: orderNumber,
    customer_name: parsed.customer_name_hint || (from ? `SMS from ${from}` : 'SMS Order'),
    customer_phone: from || null,
    notes: [
      parsed.order_notes,
      `Original message: ${text}`,
      parsed.warnings && parsed.warnings.length ? `Warnings: ${parsed.warnings.join('; ')}` : null,
    ].filter(Boolean).join('\n'),
    items: (parsed.items || []).map((item) => ({
      name: item.name,
      unit: item.unit || 'each',
      requested_weight: item.unit === 'lb' ? item.amount : null,
      requested_qty: item.unit !== 'lb' ? item.amount : null,
      unit_price: item.unit_price || 0,
      notes: item.notes || '',
      item_number: item.item_number || '',
    })),
    status: 'pending',
    source: 'sms',
    draft: true,
    ...(SMS_COMPANY_ID && { company_id: SMS_COMPANY_ID }),
    ...(SMS_LOCATION_ID && { location_id: SMS_LOCATION_ID }),
  };

  const { data, error } = await supabase
    .from('orders')
    .insert(orderRow)
    .select('id, order_number')
    .single();

  if (error) {
    logger.error({ err: error.message }, 'Failed to create SMS draft order');
    return res.status(500).json({ error: 'Failed to create draft order' });
  }

  logger.info({ order_id: data.id, order_number: data.order_number, from }, 'SMS draft order created');
  return res.status(200).json({ status: 'created', order_id: data.id, order_number: data.order_number });
});

module.exports = router;
