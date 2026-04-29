const express = require('express');

const buildPortalPaymentProfileRouter = require('./portal/payment-profile-routes');
const buildPortalPaymentMethodRouter = require('./portal/payment-method-routes');
const buildPortalPaymentCollectionRouter = require('./portal/payment-collection-routes');

module.exports = function buildPaymentsRouter({ authenticatePortalToken }) {
  const router = express.Router();

  router.use('/', buildPortalPaymentProfileRouter({ authenticatePortalToken }));
  router.use('/', buildPortalPaymentMethodRouter({ authenticatePortalToken }));
  router.use('/', buildPortalPaymentCollectionRouter({ authenticatePortalToken }));

  return router;
};
