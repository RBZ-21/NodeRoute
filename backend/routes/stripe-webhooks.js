const { supabase } = require('../services/supabase');
const { verifyWebhookSignature, isStripeWebhookConfigured } = require('../services/stripe');

function toMoneyFromCents(amountCents) {
  return parseFloat(((parseInt(amountCents || 0, 10) || 0) / 100).toFixed(2));
}

function openStatusSet() {
  return new Set(['pending', 'signed', 'sent']);
}

function scopeFromMetadata(metadata = {}) {
  return {
    customer_email: String(metadata.customer_email || '').trim().toLowerCase(),
    company_id: metadata.company_id || null,
    location_id: metadata.location_id || null,
  };
}

async function markInvoicesPaid(metadata = {}) {
  const scope = scopeFromMetadata(metadata);
  const source = String(metadata.source || '').trim();
  const invoiceId = String(metadata.invoice_id || '').trim();

  if (invoiceId) {
    await supabase
      .from('invoices')
      .update({ status: 'paid', sent_at: new Date().toISOString() })
      .eq('id', invoiceId);
    return;
  }

  if (source === 'portal_checkout' && scope.customer_email) {
    const { data } = await supabase
      .from('invoices')
      .select('id,status')
      .ilike('customer_email', scope.customer_email)
      .order('created_at', { ascending: true });
    const openSet = openStatusSet();
    const open = (data || []).filter((invoice) => openSet.has(String(invoice.status || '').toLowerCase()));
    for (const invoice of open) {
      await supabase
        .from('invoices')
        .update({ status: 'paid', sent_at: new Date().toISOString() })
        .eq('id', invoice.id);
    }
  }
}

async function logPortalPaymentEvent({ eventType, amount, currency, metadata, status, message }) {
  const scope = scopeFromMetadata(metadata);
  const payload = {
    customer_email: scope.customer_email || null,
    company_id: scope.company_id,
    location_id: scope.location_id,
    event_type: eventType,
    amount: parseFloat((parseFloat(amount || 0) || 0).toFixed(2)),
    currency: String(currency || 'usd').toLowerCase(),
    method_id: null,
    method_type: null,
    provider: 'stripe',
    status,
    message,
    created_at: new Date().toISOString(),
  };

  try {
    await supabase.from('portal_payment_events').insert([payload]);
  } catch (error) {
    // Do not fail webhook delivery due to audit logging failures.
  }
}

async function stripeWebhookHandler(req, res) {
  const signature = req.headers['stripe-signature'];
  const rawBody = Buffer.isBuffer(req.body)
    ? req.body.toString('utf8')
    : typeof req.body === 'string'
      ? req.body
      : JSON.stringify(req.body || {});

  if (!isStripeWebhookConfigured()) {
    return res.status(503).json({ error: 'Stripe webhook is not configured' });
  }

  let event;
  try {
    verifyWebhookSignature(rawBody, signature);
    event = JSON.parse(rawBody);
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Invalid Stripe webhook payload' });
  }

  try {
    if (event.type === 'payment_intent.succeeded') {
      const intent = event.data?.object || {};
      const metadata = intent.metadata || {};
      await markInvoicesPaid(metadata);
      await logPortalPaymentEvent({
        eventType: 'stripe_payment_intent_succeeded',
        amount: toMoneyFromCents(intent.amount_received || intent.amount),
        currency: intent.currency,
        metadata,
        status: 'succeeded',
        message: `Stripe payment intent ${intent.id} succeeded`,
      });
    }

    if (event.type === 'payment_intent.payment_failed') {
      const intent = event.data?.object || {};
      const metadata = intent.metadata || {};
      await logPortalPaymentEvent({
        eventType: 'stripe_payment_intent_failed',
        amount: toMoneyFromCents(intent.amount),
        currency: intent.currency,
        metadata,
        status: 'failed',
        message: intent.last_payment_error?.message || `Stripe payment intent ${intent.id} failed`,
      });
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data?.object || {};
      const metadata = session.metadata || {};
      if (String(session.payment_status || '').toLowerCase() === 'paid') {
        await markInvoicesPaid(metadata);
      }
      await logPortalPaymentEvent({
        eventType: 'stripe_checkout_completed',
        amount: toMoneyFromCents(session.amount_total),
        currency: session.currency,
        metadata,
        status: String(session.payment_status || 'completed').toLowerCase(),
        message: `Stripe checkout session ${session.id} completed`,
      });
    }

    res.json({ received: true });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to process Stripe webhook' });
  }
}

module.exports = { stripeWebhookHandler };
