'use strict';

const express = require('express');
const { supabase } = require('../services/supabase');
const { generateOrderIntakeDraft } = require('../services/ai');
const logger = require('../services/logger');

const router = express.Router();

const BLAND_AI_SECRET  = process.env.BLAND_AI_SECRET  || '';
const SMS_COMPANY_ID   = process.env.SMS_COMPANY_ID   || process.env.DEFAULT_COMPANY_ID   || '';
const SMS_LOCATION_ID  = process.env.SMS_LOCATION_ID  || process.env.DEFAULT_LOCATION_ID  || '';

// POST /api/webhooks/call/inbound
// Receives Bland AI post-call webhook. Extracts order intent from the transcript,
// then creates a draft order for manager review — same flow as inbound SMS.
router.post('/inbound', async (req, res) => {
  const provided = req.headers['x-webhook-secret'] || req.query.secret || '';
  if (!BLAND_AI_SECRET) {
    logger.warn('BLAND_AI_SECRET is not set — rejecting all Bland AI call webhook requests');
    return res.status(401).json({ error: 'Webhook not configured' });
  }
  if (provided !== BLAND_AI_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = req.body || {};

  // Only process completed calls
  const completed = body.completed ?? body.status === 'completed' ?? body.call_status === 'completed';
  if (!completed) {
    return res.status(200).json({ status: 'ignored', reason: 'Call not yet completed' });
  }

  const callId = body.call_id || body.c_id || null;
  const from   = body.from   || body.caller || null;

  // Build order text from transcript — prefer user utterances only, fall back to full concatenated transcript
  const transcripts = Array.isArray(body.transcripts) ? body.transcripts : [];
  const userUtterances = transcripts
    .filter((t) => String(t?.role || t?.speaker || '').toLowerCase() === 'user')
    .map((t) => String(t?.text || t?.content || '').trim())
    .filter(Boolean);

  const orderText = userUtterances.length
    ? userUtterances.join('\n')
    : String(body.concatenated_transcript || body.summary || '').trim();

  if (!orderText) {
    logger.info({ callId, from }, 'Bland AI call webhook: no transcript content — ignoring');
    return res.status(200).json({ status: 'ignored', reason: 'No transcript content' });
  }

  logger.info({ callId, from, textLength: orderText.length }, 'Bland AI call webhook received');

  let parsed;
  try {
    parsed = await generateOrderIntakeDraft(orderText);
  } catch (err) {
    logger.error({ err: err.message, callId }, 'Call order parsing failed');
    parsed = { customer_name_hint: null, order_notes: null, items: [], warnings: ['AI parsing unavailable — review call transcript manually.'] };
  }

  const orderNumber = `CALL-${Date.now().toString(36).toUpperCase()}`;

  const orderRow = {
    order_number: orderNumber,
    customer_name: parsed.customer_name_hint || (from ? `Call from ${from}` : 'Phone Order'),
    customer_phone: from || null,
    notes: [
      parsed.order_notes,
      `Call transcript: ${orderText}`,
      callId ? `Bland AI call ID: ${callId}` : null,
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
    source: 'call',
    draft: true,
    ...(SMS_COMPANY_ID  && { company_id:  SMS_COMPANY_ID  }),
    ...(SMS_LOCATION_ID && { location_id: SMS_LOCATION_ID }),
  };

  const { data, error } = await supabase
    .from('orders')
    .insert(orderRow)
    .select('id, order_number')
    .single();

  if (error) {
    logger.error({ err: error.message, callId }, 'Failed to create call draft order');
    return res.status(500).json({ error: 'Failed to create draft order' });
  }

  logger.info({ order_id: data.id, order_number: data.order_number, callId, from }, 'Call draft order created');
  return res.status(200).json({ status: 'created', order_id: data.id, order_number: data.order_number });
});

module.exports = router;
