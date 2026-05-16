const express = require('express');

const buildPortalAuthRouter = require('./portal/auth-routes');
const { authenticatePortalToken } = require('./portal/shared');

const router = express.Router();

router.use('/', buildPortalAuthRouter());
router.use('/', require('./portal-payments')({ authenticatePortalToken }));
router.use('/', require('./portal-customer')({ authenticatePortalToken }));

module.exports = router;
