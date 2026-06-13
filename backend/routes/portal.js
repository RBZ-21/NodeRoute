const express = require('express');

const buildPortalAuthRouter = require('./portal/auth-routes');
const { supabase } = require('../services/supabase');
const { authenticatePortalToken, requirePortalOrdering } = require('./portal/shared');

const router = express.Router();

router.use('/', buildPortalAuthRouter());
router.use('/', require('./portal-payments')({ authenticatePortalToken }));
router.use('/', require('./portal-customer')({ authenticatePortalToken }));

// Add-on availability for the portal UI (gate the catalog vs. the upsell card).
// Auth required but NOT the feature gate — this tells the client which to show.
router.get('/ordering-status', authenticatePortalToken, async (req, res) => {
  try {
    const companyId = req.portalContext?.companyId || null;
    if (!companyId) return res.json({ enabled: false });
    const { data, error } = await supabase
      .from('companies')
      .select('portal_ordering_enabled')
      .eq('id', companyId)
      .single();
    if (error) return res.json({ enabled: false });
    res.json({ enabled: data?.portal_ordering_enabled === true });
  } catch {
    res.json({ enabled: false });
  }
});

router.use('/', require('./portal-ordering')({ authenticatePortalToken, requirePortalOrdering }));

module.exports = router;
