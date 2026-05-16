const express = require('express');
const { authenticateToken, requireRole } = require('../middleware/auth');

const buildOpsAdminRouter = require('./ops/admin-routes');

const router = express.Router();
router.use(authenticateToken, requireRole('admin'));

router.use('/', buildOpsAdminRouter());
router.use('/', require('./ops-purchasing'));

module.exports = router;
