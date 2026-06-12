'use strict';

const crypto = require('crypto');
const express = require('express');
const { supabase } = require('../../services/supabase');
const logger = require('../../services/logger');
const { parseOrderFromTranscript } = require('../../lib/orderParser');
const { sendOrderAlert } = require('../../lib/notifications');
const { DEFAULT_COMPANY_ID, DEFAULT_LOCATION_ID } = require('../../lib/config');

const router = express.Router();

function timingSafeMatch(incoming, expected) {
  const a = Buffer.from(String(incoming || ''), 'utf8');
  const b = Buffer.from(String(expected || ''), 'utf8');
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Per-company webhook secrets, so each tenant's Bland agent posts with its
 * own credential and orders land in the right company.
 *
 *   BLAND_COMPANY_SECRETS='{"<secret-for-acme>":"<acme-company-id>", ...}'
 *
 * The shared BLAND_WEBHOOK_SECRET remains supported for single-tenant
 * deployments and maps to DEFAULT_COMPANY_ID.
 */
function parseCompanySecrets() {
  const raw = process.env.BLAND_COMPANY_SECRETS || '';
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    logger.error({ err: err.message }, 'BLAND_COMPANY_SECRETS is not valid JSON — per-company webhook auth disabled');
    return {};
  }
}

/**
 * Resolve the caller's secret to a company.
 * Returns { authorized, companyId }. Fail-closed: no configured secrets, or
 * no match, means unauthorized. A matched secret with no resolvable company
 * is authorized:false at the order level (handled by the route with a 400).
 *
 * The secret is read from the Authorization header (raw value or
 * "Bearer <secret>") — never from the query string, which would leak it
 * into access logs. If the Bland dashboard cannot send custom headers for
 * your plan, do NOT fall back to query params; instead have Bland sign the
 * payload (HMAC of the raw body with the shared secret in an
 * X-Bland-Signature header) and verify the digest here with
 * crypto.timingSafeEqual, mirroring services/stripe.js verifyWebhookSignature.
 */
function resolveWebhookCompany(req) {
  const header = String(req.headers.authorization || '');
  const incoming = header.replace(/^Bearer\s+/i, '').trim();
  if (!incoming) return { authorized: false, companyId: null };

  for (const [secret, companyId] of Object.entries(parseCompanySecrets())) {
    if (timingSafeMatch(incoming, secret)) {
      return { authorized: true, companyId: String(companyId || '').trim() || DEFAULT_COMPANY_ID || null };
    }
  }

  const sharedSecret = process.env.BLAND_WEBHOOK_SECRET || '';
  if (sharedSecret && timingSafeMatch(incoming, sharedSecret)) {
    return { authorized: true, companyId: DEFAULT_COMPANY_ID || null };
  }

  return { authorized: false, companyId: null };
}

router.post('/', async (req, res) => {
  const { authorized, companyId } = resolveWebhookCompany(req);
  if (!authorized) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!companyId) {
    // Never create an order without a tenant — it would be invisible to every
    // company's scoped queries and unreachable from the dashboard.
    logger.error('Bland webhook rejected: secret matched but no company mapping and DEFAULT_COMPANY_ID is unset');
    return res.status(400).json({ error: 'Webhook is not mapped to a company' });
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
        company_id: companyId,
        location_id: DEFAULT_LOCATION_ID || null,
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
