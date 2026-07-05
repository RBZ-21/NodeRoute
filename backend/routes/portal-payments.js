const express = require('express');

const buildPortalPaymentProfileRouter = require('./portal/payment-profile-routes');
const buildPortalPaymentMethodRouter = require('./portal/payment-method-routes');
const buildPortalPaymentCollectionRouter = require('./portal/payment-collection-routes');

// This file only mounts sub-routers; it issues no Supabase queries of its own.
// See backend/tests/tenant-scoping-consistency.test.js for the scoping regression check.
module.exports = function buildPaymentsRouter({ authenticatePortalToken }) {
  const router = express.Router();

  router.use('/', buildPortalPaymentProfileRouter({ authenticatePortalToken }));
  router.use('/', buildPortalPaymentMethodRouter({ authenticatePortalToken }));
  router.use('/', buildPortalPaymentCollectionRouter({ authenticatePortalToken }));

  return router;
};
