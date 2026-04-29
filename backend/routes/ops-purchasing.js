const express = require('express');

const router = express.Router();

router.use('/', require('./ops-projections'));
router.use('/', require('./ops-po-drafts'));
router.use('/', require('./ops-vendor-pos'));

module.exports = router;
