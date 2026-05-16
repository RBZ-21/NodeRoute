'use strict';
/**
 * Stripe service helpers.
 *
 * verifyWebhookSignature — validates the Stripe-Signature header and rejects
 * payloads with missing, non-numeric, or stale timestamps before Stripe's own
 * library can parse them. This prevents replay attacks and forged events.
 */
const Stripe = require('stripe');
const config = require('../lib/config');

let _client = null;
function getClient() {
  if (!_client) _client = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2023-10-16' });
  return _client;
}

/**
 * Parse and validate a raw Stripe-Signature header value.
 * Returns { t, signatures } or throws with a descriptive message.
 *
 * Rejects:
 *  - missing header
 *  - missing t= component
 *  - non-numeric timestamp
 *  - timestamp more than STRIPE_WEBHOOK_TOLERANCE_SECONDS in the past
 *  - timestamp more than STRIPE_WEBHOOK_TOLERANCE_SECONDS in the future (clock skew guard)
 */
function verifyWebhookSignature(rawBody, sigHeader, secret) {
  if (!sigHeader) throw new Error('Missing Stripe-Signature header');

  const parts = {};
  for (const part of sigHeader.split(',')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    parts[key] = val;
  }

  if (!parts.t) throw new Error('Stripe-Signature missing t= timestamp');

  const ts = Number(parts.t);
  if (!Number.isFinite(ts) || isNaN(ts))
    throw new Error('Stripe-Signature t= is not a valid numeric timestamp');

  const nowSec  = Math.floor(Date.now() / 1000);
  const tolerance = config.STRIPE_WEBHOOK_TOLERANCE_SECONDS;
  const age      = nowSec - ts;

  if (age > tolerance)
    throw new Error(`Stripe webhook timestamp is stale (${age}s old, tolerance ${tolerance}s)`);
  if (age < -tolerance)
    throw new Error(`Stripe webhook timestamp is too far in the future (${Math.abs(age)}s, tolerance ${tolerance}s)`);

  // Delegate full signature verification to the official library
  return getClient().webhooks.constructEvent(rawBody, sigHeader, secret);
}

module.exports = { getClient, verifyWebhookSignature };
