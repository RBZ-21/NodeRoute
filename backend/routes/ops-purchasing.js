const express = require('express');

const buildOpsPurchasingPlanningRouter = require('./ops/purchasing-planning-routes');
const buildOpsPurchasingOrderRouter = require('./ops/purchasing-order-routes');

// This file only mounts sub-routers; it issues no Supabase queries of its own.
// See backend/tests/tenant-scoping-consistency.test.js for the scoping regression check.
const router = express.Router();

router.use('/', buildOpsPurchasingPlanningRouter());
router.use('/', buildOpsPurchasingOrderRouter());

module.exports = router;
