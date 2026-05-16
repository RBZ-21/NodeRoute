const express = require('express');
const {
  AUTOPAY_METHOD_TYPES,
  PORTAL_PAYMENT_CURRENCY,
  PORTAL_PAYMENT_ENABLED,
  PORTAL_PAYMENT_PROVIDER,
  PORTAL_PAYMENT_STUB_CHECKOUT_URL,
  PORTAL_PAYMENT_SUPPORT_EMAIL,
  STRIPE_PUBLISHABLE_KEY,
  createSetupIntent,
  ensureStripePortalCustomer,
  isMissingPortalPaymentTables,
  isStripeProviderEnabled,
  loadPortalPaymentState,
  normalizePaymentMethodType,
  paymentTablesUnavailableResponse,
  portalInvoiceBalanceSummary,
} = require('./payments-shared');

module.exports = function buildPortalPaymentProfileRouter({ authenticatePortalToken }) {
  const router = express.Router();

  router.get('/payments/config', authenticatePortalToken, async (req, res) => {
    try {
      const balance = await portalInvoiceBalanceSummary(req.customerEmail, req.portalContext);
      const paymentState = await loadPortalPaymentState(req);
      const providerEnabled =
        isStripeProviderEnabled() ||
        (PORTAL_PAYMENT_ENABLED && PORTAL_PAYMENT_PROVIDER === 'stub' && !!PORTAL_PAYMENT_STUB_CHECKOUT_URL);

      return res.json({
        enabled: providerEnabled,
        provider: PORTAL_PAYMENT_PROVIDER,
        publishable_key: PORTAL_PAYMENT_PROVIDER === 'stripe' ? STRIPE_PUBLISHABLE_KEY : null,
        currency: PORTAL_PAYMENT_CURRENCY,
        support_email: PORTAL_PAYMENT_SUPPORT_EMAIL,
        manual_payment_available: true,
        supported_method_types: AUTOPAY_METHOD_TYPES,
        supports_autopay: true,
        balance,
        payment_methods: paymentState.methods,
        autopay: paymentState.settings,
      });
    } catch (error) {
      if (isMissingPortalPaymentTables(error)) return paymentTablesUnavailableResponse(res);
      return res.status(500).json({ error: error.message || 'Could not load payment configuration' });
    }
  });

  router.get('/payments/profile', authenticatePortalToken, async (req, res) => {
    try {
      const [balance, paymentState] = await Promise.all([
        portalInvoiceBalanceSummary(req.customerEmail, req.portalContext),
        loadPortalPaymentState(req),
      ]);
      return res.json({
        customer_email: req.customerEmail,
        supported_method_types: AUTOPAY_METHOD_TYPES,
        payment_methods: paymentState.methods,
        autopay: paymentState.settings,
        balance,
      });
    } catch (error) {
      if (isMissingPortalPaymentTables(error)) return paymentTablesUnavailableResponse(res);
      return res.status(500).json({ error: error.message || 'Could not load payment profile' });
    }
  });

  router.post('/payments/setup-intent', authenticatePortalToken, async (req, res) => {
    try {
      if (!isStripeProviderEnabled()) {
        return res.status(501).json({
          error: 'Stripe setup intents are not configured yet.',
          code: 'STRIPE_NOT_CONFIGURED',
        });
      }

      const methodType = normalizePaymentMethodType(req.body.method_type || 'debit_card');
      if (!AUTOPAY_METHOD_TYPES.includes(methodType)) {
        return res.status(400).json({ error: 'method_type must be debit_card or ach_bank' });
      }

      const customer = await ensureStripePortalCustomer(req);
      const setupIntent = await createSetupIntent({
        customerId: customer.id,
        methodType,
        metadata: {
          customer_email: req.customerEmail,
          company_id: req.portalContext.companyId || '',
          location_id: req.portalContext.activeLocationId || '',
        },
      });

      return res.json({
        provider: 'stripe',
        publishable_key: STRIPE_PUBLISHABLE_KEY,
        customer_id: customer.id,
        setup_intent_id: setupIntent.id,
        client_secret: setupIntent.client_secret,
        method_type: methodType,
      });
    } catch (error) {
      if (isMissingPortalPaymentTables(error)) return paymentTablesUnavailableResponse(res);
      return res.status(500).json({ error: error.message || 'Could not create setup intent' });
    }
  });

  return router;
};
