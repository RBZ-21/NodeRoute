'use strict';

const express = require('express');
const { supabase } = require('../../services/supabase');
const logger = require('../../services/logger');
const { parseOrderFromTranscript } = require('../../lib/orderParser');
const { sendOrderAlert } = require('../../lib/notifications');
const { DEFAULT_COMPANY_ID, DEFAULT_LOCATION_ID } = require('../../lib/config');

const router = express.Router();

function verifyWebhookSecret(req) {
  const secret = process.env.BLAND_WEBHOOK_SECRET || '';
  if (!secret) return false;

  const authHeader = String(req.headers.authorization || '');
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7) === secret;
  }

  const headerSecret = req.headers['x-webhook-secret'] || req.headers['x-bland-webhook-secret'];
  if (headerSecret && headerSecret === secret) return true;

  // Deprecated — query param may appear in access logs.
  return req.query.secret === secret;
}

function resolveTenantScope() {
  const companyId = String(process.env.BLAND_DEFAULT_COMPANY_ID || DEFAULT_COMPANY_ID || '').trim();
  const locationId = String(process.env.BLAND_DEFAULT_LOCATION_ID || DEFAULT_LOCATION_ID || '').trim() || null;
  return { companyId: companyId || null, locationId };
}

router.post('/', async (req, res) => {
  if (!verifyWebhookSecret(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { companyId, locationId } = resolveTenantScope();
  if (!companyId) {
    logger.error('Bland webhook rejected: BLAND_DEFAULT_COMPANY_ID or DEFAULT_COMPANY_ID is not configured');
    return res.status(503).json({ error: 'Phone order integration is not configured' });
  }

  const { status, transcript, summary, call_id, from } = req.body || {};

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
        company_id: companyId,
        location_id: locationId,
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
