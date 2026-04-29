const express = require('express');

const buildOpsPurchasingPlanningRouter = require('./ops/purchasing-planning-routes');
const buildOpsPurchasingOrderRouter = require('./ops/purchasing-order-routes');

const router = express.Router();

router.use('/', buildOpsPurchasingPlanningRouter());
router.use('/', buildOpsPurchasingOrderRouter());

module.exports = router;
