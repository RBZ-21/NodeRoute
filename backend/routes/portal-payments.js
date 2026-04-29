const express = require('express');
const buildPaymentConfigRouter = require('./portal-payment-config');
const buildPaymentMethodsRouter = require('./portal-payment-methods');
const buildAutopayRouter = require('./portal-autopay');
const buildInvoicePaymentsRouter = require('./portal-invoice-payments');

module.exports = function buildPaymentsRouter({ authenticatePortalToken }) {
  const router = express.Router();
  router.use('/', buildPaymentConfigRouter({ authenticatePortalToken }));
  router.use('/', buildPaymentMethodsRouter({ authenticatePortalToken }));
  router.use('/', buildAutopayRouter({ authenticatePortalToken }));
  router.use('/', buildInvoicePaymentsRouter({ authenticatePortalToken }));
  return router;
};
