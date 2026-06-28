const express = require('express');
const { randomUUID } = require('crypto');
const { hashInvoiceSet } = require('../../lib/invoice-set-hash');
const {
  PORTAL_PAYMENT_CURRENCY,
  PORTAL_PAYMENT_ENABLED,
  PORTAL_PAYMENT_PROVIDER,
  PORTAL_PAYMENT_STUB_CHECKOUT_URL,
  PORTAL_PAYMENT_SUPPORT_EMAIL,
  createCheckoutSession,
  createPaymentIntent,
  ensureStripePortalCustomer,
  filterRowsByContext,
  invoiceIsOpen,
  isMissingPortalPaymentTables,
  isStripeProviderEnabled,
  listScopedCustomerInvoices,
  loadPortalPaymentState,
  paymentTablesUnavailableResponse,
  portalInvoiceBalanceSummary,
  recordPortalPaymentEvent,
  stripeCheckoutReadiness,
  supabase,
  toMoney,
} = require('./payments-shared');
const creditEngine = require('../../services/creditEngine');
const logger = require('../../services/logger');

function portalCompanyId(context = {}) {
  return context.activeCompanyId || context.companyId || '';
}

function portalLocationId(context = {}) {
  return context.activeLocationId || context.locationId || '';
}

/**
 * Stripe idempotency key for one user action.
 *
 * Stripe dedupes charges only when the SAME key is sent again, so the key
 * must be stable across retries of the same action. The client may send
 * `idempotency_key` in the body (generated once per tap/click and re-sent on
 * network retry); when absent we mint a UUID, which still guarantees
 * uniqueness per attempt. Never derive the suffix from Date.now() — a retry
 * gets a different timestamp and Stripe would charge twice.
 */
function actionIdempotencySuffix(req) {
  const supplied = String(req.body?.idempotency_key || '').trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(supplied) ? supplied : randomUUID();
}

function scopedInvoiceUpdate(invoiceId, portalContext, updates) {
  let query = supabase
    .from('invoices')
    .update(updates)
    .eq('id', invoiceId);
  const companyId = portalCompanyId(portalContext);
  const locationId = portalLocationId(portalContext);
  if (companyId) query = query.eq('company_id', companyId);
  if (locationId) query = query.eq('location_id', locationId);
  return query;
}

module.exports = function buildPortalPaymentCollectionRouter({ authenticatePortalToken }) {
  const router = express.Router();

  router.post('/payments/autopay/charge-now', authenticatePortalToken, async (req, res) => {
    try {
      if (!isStripeProviderEnabled()) {
        return res.status(501).json({ error: 'Stripe autopay is not configured', code: 'STRIPE_NOT_CONFIGURED' });
      }

      const [invoices, paymentState] = await Promise.all([
        listScopedCustomerInvoices(req.customerEmail, req.portalContext),
        loadPortalPaymentState(req),
      ]);
      const openInvoices = invoices.filter(invoiceIsOpen);
      const openBalance = toMoney(openInvoices.reduce((sum, invoice) => sum + toMoney(invoice.total), 0));

      if (!paymentState.settings.enabled && req.body?.force !== true) {
        return res.status(400).json({ error: 'Autopay is not enabled', code: 'AUTOPAY_DISABLED' });
      }
      if (openBalance <= 0) {
        return res.status(400).json({ error: 'No open balance to pay', code: 'NO_OPEN_BALANCE' });
      }

      const method = paymentState.methods.find((candidate) => candidate.id === paymentState.settings.method_id) || null;
      if (!method) return res.status(400).json({ error: 'Autopay method is missing', code: 'AUTOPAY_METHOD_MISSING' });
      if (String(method.provider || '').toLowerCase() !== 'stripe') {
        return res.status(400).json({ error: 'Autopay method must be a Stripe payment method', code: 'AUTOPAY_METHOD_INVALID' });
      }

      const customer = await ensureStripePortalCustomer(req);
      // One suffix per autopay run; combined with the invoice id below this
      // keeps each invoice's key unique while staying stable on retry.
      const runSuffix = actionIdempotencySuffix(req);
      const maxAmount = Number.isFinite(parseFloat(paymentState.settings.max_amount))
        ? toMoney(paymentState.settings.max_amount)
        : null;
      let runningTotal = 0;
      const processed = [];
      const failures = [];

      for (const invoice of openInvoices) {
        const amount = toMoney(invoice.total);
        if (maxAmount != null && runningTotal + amount > maxAmount) break;

        try {
          const intent = await createPaymentIntent({
            amount,
            currency: PORTAL_PAYMENT_CURRENCY,
            customerId: customer.id,
            paymentMethodId: method.payment_method_ref,
            description: `NodeRoute invoice ${invoice.invoice_number || invoice.id}`,
            metadata: {
              source: 'autopay_charge_now',
              customer_email: req.customerEmail,
              invoice_id: invoice.id,
              company_id: portalCompanyId(req.portalContext),
              location_id: portalLocationId(req.portalContext),
            },
            idempotencyKey: `portal-autopay-${invoice.id}-${runSuffix}`,
          });

          const status = String(intent.status || 'queued');
          await recordPortalPaymentEvent(req, {
            event_type: 'autopay_charge_now',
            amount,
            method_id: method.id,
            method_type: method.method_type,
            provider: 'stripe',
            status,
            message: `Stripe payment intent ${intent.id}`,
          });

          if (status === 'succeeded') {
            const paidAt = new Date().toISOString();
            await scopedInvoiceUpdate(invoice.id, req.portalContext, {
              status: 'paid',
              sent_at: paidAt,
              paid_at: paidAt,
              payment_status: 'paid',
              stripe_payment_intent_id: intent.id,
            });
          }

          runningTotal += amount;
          processed.push({
            invoice_id: invoice.id,
            invoice_number: invoice.invoice_number || null,
            amount,
            intent_id: intent.id,
            status,
          });
        } catch (error) {
          failures.push({
            invoice_id: invoice.id,
            invoice_number: invoice.invoice_number || null,
            amount,
            error: error.message,
          });
          await recordPortalPaymentEvent(req, {
            event_type: 'autopay_charge_now',
            amount,
            method_id: method.id,
            method_type: method.method_type,
            provider: 'stripe',
            status: 'failed',
            message: error.message,
          });
        }
      }

      await supabase
        .from('portal_payment_settings')
        .update({ last_run_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('customer_email', req.customerEmail);

      return res.json({
        message: processed.length
          ? `Processed ${processed.length} invoice payment${processed.length === 1 ? '' : 's'} via autopay.`
          : 'No invoice payments were processed.',
        attempted_open_balance: openBalance,
        charged_amount: toMoney(runningTotal),
        processed,
        failures,
      });
    } catch (error) {
      if (isMissingPortalPaymentTables(error)) return paymentTablesUnavailableResponse(res);
      return res.status(500).json({ error: error.message || 'Could not trigger autopay charge' });
    }
  });

  router.post('/payments/create-checkout-session', authenticatePortalToken, async (req, res) => {
    try {
      const balance = await portalInvoiceBalanceSummary(req.customerEmail, req.portalContext);
      if (balance.openBalance <= 0) {
        return res.status(400).json({ error: 'No open balance to pay', code: 'NO_OPEN_BALANCE' });
      }

      if (!PORTAL_PAYMENT_ENABLED) {
        return res.status(501).json({
          error: 'Online payments are not configured yet. Please use manual payment instructions.',
          code: 'PAYMENT_NOT_CONFIGURED',
          support_email: PORTAL_PAYMENT_SUPPORT_EMAIL,
        });
      }

      if (isStripeProviderEnabled()) {
        const customer = await ensureStripePortalCustomer(req);
        const baseUrl = process.env.BASE_URL || 'http://localhost:3001';
        const invoiceIds = balance.openInvoices.map((invoice) => invoice.id).join(',');
        const invoiceHash = hashInvoiceSet(balance.openInvoices);
        if (invoiceIds.length > 500) {
          return res.status(400).json({
            error: 'Too many open invoices for one checkout session. Please pay individual invoices or contact support.',
            code: 'PORTAL_CHECKOUT_INVOICE_SET_TOO_LARGE',
          });
        }
        const session = await createCheckoutSession({
          customerId: customer.id,
          amount: balance.openBalance,
          currency: PORTAL_PAYMENT_CURRENCY,
          successUrl: `${baseUrl}/portal?tab=payments&payment=success&session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${baseUrl}/portal?tab=payments&payment=cancelled`,
          clientReferenceId: `portal:${portalCompanyId(req.portalContext) || 'global'}:${invoiceHash.slice(0, 24)}`,
          idempotencyKey: `portal-checkout-${portalCompanyId(req.portalContext) || 'global'}-${invoiceHash}-${actionIdempotencySuffix(req)}`,
          metadata: {
            source: 'portal_checkout',
            checkout_type: 'portal_checkout',
            customer_email: req.customerEmail,
            invoice_ids: invoiceIds,
            invoice_hash: invoiceHash,
            company_id: portalCompanyId(req.portalContext),
            location_id: portalLocationId(req.portalContext),
          },
        });

        const sessionMode = session.livemode === true ? 'live' : 'test';
        await recordPortalPaymentEvent(req, {
          event_type: 'checkout_session_created',
          amount: balance.openBalance,
          provider: 'stripe',
          status: 'queued',
          message: `Stripe checkout session ${session.id}`,
        });

        return res.json({
          checkout_url: session.url,
          provider: 'stripe',
          amount_due: balance.openBalance,
          session_id: session.id,
          mode: sessionMode,
          test_mode: sessionMode === 'test',
        });
      }

      if (PORTAL_PAYMENT_PROVIDER === 'stripe') {
        const readiness = stripeCheckoutReadiness();
        return res.status(501).json({
          error: readiness.message,
          code: readiness.code,
          support_email: PORTAL_PAYMENT_SUPPORT_EMAIL,
          test_mode_only: true,
        });
      }

      if (PORTAL_PAYMENT_PROVIDER === 'stub' && PORTAL_PAYMENT_STUB_CHECKOUT_URL) {
        const ref = `portal_${Date.now()}`;
        return res.json({
          checkout_url: `${PORTAL_PAYMENT_STUB_CHECKOUT_URL}${PORTAL_PAYMENT_STUB_CHECKOUT_URL.includes('?') ? '&' : '?'}ref=${encodeURIComponent(ref)}`,
          provider: 'stub',
          amount_due: balance.openBalance,
        });
      }

      return res.status(501).json({
        error: 'Checkout provider not wired yet. Configure your payment provider server-side.',
        code: 'PAYMENT_PROVIDER_NOT_READY',
        support_email: PORTAL_PAYMENT_SUPPORT_EMAIL,
      });
    } catch (error) {
      if (isMissingPortalPaymentTables(error)) return paymentTablesUnavailableResponse(res);
      const log = req.log || logger;
      log.error({
        err: error,
        customer_email: req.customerEmail,
        company_id: portalCompanyId(req.portalContext),
      }, 'portal checkout session creation failed');
      return res.status(500).json({
        error: 'Could not start checkout session. Please try again or contact support.',
        code: 'CHECKOUT_SESSION_FAILED',
        support_email: PORTAL_PAYMENT_SUPPORT_EMAIL,
      });
    }
  });

  router.post('/invoices/:id/pay', authenticatePortalToken, async (req, res) => {
    try {
      if (!isStripeProviderEnabled()) {
        return res.status(501).json({ error: 'Stripe payments are not configured', code: 'STRIPE_NOT_CONFIGURED' });
      }

      const invoiceId = String(req.params.id || '').trim();
      if (!invoiceId) return res.status(400).json({ error: 'Invoice id is required' });

      const { data: invoiceRow, error: invoiceError } = await supabase
        .from('invoices')
        .select('*')
        .eq('id', invoiceId)
        .ilike('customer_email', req.customerEmail)
        .single();
      if (invoiceError || !invoiceRow) return res.status(404).json({ error: 'Invoice not found' });
      if (!filterRowsByContext([invoiceRow], req.portalContext).length) return res.status(404).json({ error: 'Invoice not found' });
      if (!invoiceIsOpen(invoiceRow)) return res.status(400).json({ error: 'Invoice is not open for payment' });

      const amount = toMoney(invoiceRow.total);
      if (amount <= 0) return res.status(400).json({ error: 'Invoice amount must be greater than zero' });

      const paymentState = await loadPortalPaymentState(req);
      const requestedMethodId = String(req.body?.method_id || '').trim();
      const method = paymentState.methods.find((candidate) =>
        candidate.id === (requestedMethodId || paymentState.settings.method_id || '')
        || (!!candidate.is_default && !requestedMethodId && !paymentState.settings.method_id)
      );
      if (!method) {
        return res.status(400).json({ error: 'No default payment method available. Add a payment method first.' });
      }
      if (String(method.provider || '').toLowerCase() !== 'stripe') {
        return res.status(400).json({ error: 'Only Stripe payment methods are supported for this action.' });
      }

      const customer = await ensureStripePortalCustomer(req);
      const intent = await createPaymentIntent({
        amount,
        currency: PORTAL_PAYMENT_CURRENCY,
        customerId: customer.id,
        paymentMethodId: method.payment_method_ref,
        description: `NodeRoute invoice ${invoiceRow.invoice_number || invoiceRow.id}`,
        metadata: {
          source: 'portal_invoice_pay',
          customer_email: req.customerEmail,
          invoice_id: invoiceRow.id,
          company_id: portalCompanyId(req.portalContext),
          location_id: portalLocationId(req.portalContext),
        },
        idempotencyKey: `portal-invoice-pay-${invoiceRow.id}-${actionIdempotencySuffix(req)}`,
      });

      const paymentStatus = String(intent.status || 'queued');
      await recordPortalPaymentEvent(req, {
        event_type: 'invoice_pay',
        amount,
        method_id: method.id,
        method_type: method.method_type,
        provider: 'stripe',
        status: paymentStatus,
        message: `Stripe payment intent ${intent.id}`,
      });

      if (paymentStatus === 'succeeded') {
        const paidAt = new Date().toISOString();
        await scopedInvoiceUpdate(invoiceRow.id, req.portalContext, {
          status: 'paid',
          sent_at: paidAt,
          paid_at: paidAt,
          payment_status: 'paid',
          stripe_payment_intent_id: intent.id,
        });

        // Real-time auto-release: a portal payment may clear a credit hold.
        // Fire-and-forget — failures are logged inside the engine and must
        // not affect the customer-facing payment response.
        creditEngine.recordPaymentReceived({
          customer_id: invoiceRow.customer_id,
          customer_name: invoiceRow.customer_name,
          invoice: invoiceRow,
          amount,
        }).catch(() => {});
      }

      return res.json({
        message: paymentStatus === 'succeeded'
          ? 'Invoice paid successfully.'
          : `Payment is ${paymentStatus}. We will update the invoice once final settlement is confirmed.`,
        invoice_id: invoiceRow.id,
        payment_intent_id: intent.id,
        status: paymentStatus,
      });
    } catch (error) {
      if (isMissingPortalPaymentTables(error)) return paymentTablesUnavailableResponse(res);
      return res.status(500).json({ error: error.message || 'Could not charge invoice' });
    }
  });

  return router;
};
