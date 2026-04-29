const express = require('express');
const { supabase } = require('../services/supabase');
const { filterRowsByContext } = require('../services/operating-context');
const { findOrCreateCustomer, createPaymentIntent, createCheckoutSession } = require('../services/stripe');
const {
  PORTAL_PAYMENT_ENABLED,
  PORTAL_PAYMENT_PROVIDER,
  PORTAL_PAYMENT_SUPPORT_EMAIL,
  PORTAL_PAYMENT_CURRENCY,
  PORTAL_PAYMENT_STUB_CHECKOUT_URL,
  isMissingPortalPaymentTables,
  paymentTablesUnavailableResponse,
  isStripeProviderEnabled,
  invoiceIsOpen,
  toMoney,
  recordPortalPaymentEvent,
  loadPortalPaymentState,
  portalInvoiceBalanceSummary,
} = require('./portal-payment-utils');

module.exports = function buildInvoicePaymentsRouter({ authenticatePortalToken }) {
  const router = express.Router();

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
        const customer = await findOrCreateCustomer({
          email: req.customerEmail,
          name: req.customerName,
          metadata: {
            portal_customer_email: req.customerEmail,
            company_id: req.portalContext.companyId || '',
            location_id: req.portalContext.activeLocationId || '',
          },
        });
        const baseUrl = process.env.BASE_URL || 'http://localhost:3001';
        const session = await createCheckoutSession({
          customerId: customer.id,
          amount: balance.openBalance,
          currency: PORTAL_PAYMENT_CURRENCY,
          successUrl: `${baseUrl}/portal?payment=success`,
          cancelUrl: `${baseUrl}/portal?payment=cancelled`,
          metadata: {
            source: 'portal_checkout',
            customer_email: req.customerEmail,
            company_id: req.portalContext.companyId || '',
            location_id: req.portalContext.activeLocationId || '',
          },
        });

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
      return res.status(500).json({ error: error.message || 'Could not start checkout session' });
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

      const customer = await findOrCreateCustomer({
        email: req.customerEmail,
        name: req.customerName,
        metadata: {
          portal_customer_email: req.customerEmail,
          company_id: req.portalContext.companyId || '',
          location_id: req.portalContext.activeLocationId || '',
        },
      });

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
          company_id: req.portalContext.companyId || '',
          location_id: req.portalContext.activeLocationId || '',
        },
        idempotencyKey: `portal-invoice-pay-${invoiceRow.id}-${Date.now()}`,
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
        await supabase.from('invoices').update({ status: 'paid', sent_at: new Date().toISOString() }).eq('id', invoiceRow.id);
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
