const express = require('express');
const {
  PORTAL_PAYMENT_PROVIDER,
  PORTAL_PAYMENT_SUPPORT_EMAIL,
  STRIPE_PUBLISHABLE_KEY,
  PORTAL_PAYMENT_CURRENCY,
  PORTAL_PAYMENT_STUB_CHECKOUT_URL,
  AUTOPAY_METHOD_TYPES,
  isMissingPortalPaymentTables,
  paymentTablesUnavailableResponse,
  isStripeProviderEnabled,
  loadPortalPaymentState,
  portalInvoiceBalanceSummary,
  PORTAL_PAYMENT_ENABLED,
} = require('./portal-payment-utils');

module.exports = function buildPaymentConfigRouter({ authenticatePortalToken }) {
  const router = express.Router();

  router.get('/payments/config', authenticatePortalToken, async (req, res) => {
    try {
      const balance = await portalInvoiceBalanceSummary(req.customerEmail, req.portalContext);
      const paymentState = await loadPortalPaymentState(req);
      const providerEnabled =
        (isStripeProviderEnabled()) ||
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

  return router;
};
