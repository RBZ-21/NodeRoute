const express = require('express');
const { authenticateToken, requireRole } = require('../middleware/auth');

const buildOpsAdminRouter = require('./ops/admin-routes');

// This file only mounts sub-routers; it issues no Supabase queries of its own.
// See backend/tests/tenant-scoping-consistency.test.js for the scoping regression check.
const router = express.Router();
router.use(authenticateToken, requireRole('admin', 'manager'));

router.use('/', buildOpsAdminRouter());
router.use('/', require('./ops-purchasing'));

module.exports = router;
