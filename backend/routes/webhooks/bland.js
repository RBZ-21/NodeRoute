'use strict';

const express = require('express');
const { supabase } = require('../../services/supabase');
const logger = require('../../services/logger');
const { parseOrderFromTranscript } = require('../../lib/orderParser');
const { sendOrderAlert } = require('../../lib/notifications');

const router = express.Router();

router.post('/', async (req, res) => {
  const secret = process.env.BLAND_WEBHOOK_SECRET || '';
  if (!secret || req.query.secret !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { status, transcript, summary, call_id, from } = req.body || {};

  // Only process completed calls that have a transcript
  if (status !== 'completed' || !transcript) {
    return res.json({ ok: true });
  }

  try {
    const parsed = await parseOrderFromTranscript(transcript, summary || null);

    const { data: order, error } = await supabase
      .from('orders')
      .insert({
        source: 'phone',
        status: 'draft',
        caller_phone: from || null,
        call_id: call_id || null,
        transcript,
        line_items: parsed.items || [],
        customer_name: parsed.customerName || null,
        business_name: parsed.businessName || null,
        notes: parsed.notes || null,
        raw_summary: summary || null,
        needs_callback: parsed.needsCallback || false,
      })
      .select()
      .single();

    if (error) throw error;

    await sendOrderAlert(order);

    return res.json({ success: true, order_id: order.id });
  } catch (err) {
    logger.error({ err: err.message }, 'Bland webhook processing error');
    return res.status(500).json({ error: 'Failed to process call' });
  }
});

module.exports = router;
