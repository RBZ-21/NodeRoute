'use strict';

const express = require('express');
const { supabase } = require('../../services/supabase');
const logger = require('../../services/logger');
const { DEFAULT_COMPANY_ID } = require('../../lib/config');

const router = express.Router();

function resolveCompanyScope(req) {
  const headerCompany = String(req.headers['x-company-id'] || '').trim();
  const configuredCompany = String(process.env.BLAND_COMPANY_ID || DEFAULT_COMPANY_ID || '').trim();
  if (headerCompany && configuredCompany && headerCompany !== configuredCompany) {
    return { companyId: null, mismatch: true };
  }
  return { companyId: headerCompany || configuredCompany, mismatch: false };
}

// GET /api/public/inventory
// Validates x-api-key header against BLAND_INVENTORY_KEY.
// Returns inventory scoped to a single tenant (BLAND_COMPANY_ID or DEFAULT_COMPANY_ID).
router.get('/', async (req, res) => {
  const key = process.env.BLAND_INVENTORY_KEY || '';
  if (!key || req.headers['x-api-key'] !== key) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { companyId, mismatch } = resolveCompanyScope(req);
  if (mismatch) return res.status(403).json({ error: 'Company scope not allowed' });
  if (!companyId) {
    return res.status(503).json({ error: 'Public inventory integration is not configured for a tenant' });
  }

  const { data, error } = await supabase
    .from('inventory')
    .select('item, category, unit, unit_size, on_hand_qty')
    .eq('company_id', companyId);

  if (error) {
    logger.error({ err: error.message, companyId }, 'Public inventory query failed');
    return res.status(500).json({ error: 'Failed to retrieve inventory' });
  }

  return res.json({ inventory: data || [], company_id: companyId });
});

module.exports = router;
