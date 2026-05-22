'use strict';
const express = require('express');
const { z } = require('zod');
const { supabase } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

const VALID_BUSINESS_TYPES = [
  'seafood', 'meat', 'produce', 'dairy',
  'liquor', 'paper', 'broadline', 'wholesale',
];
const VALID_UNITS = ['each', 'case', 'lb', 'catch_weight', 'gallon', 'pallet'];
const VALID_TEMPLATES = ['seafood', 'liquor', 'produce', 'paper_goods', 'broadline', 'blank'];

const patchSchema = z.object({
  business_types:         z.array(z.enum(VALID_BUSINESS_TYPES)).optional(),
  enabled_units:          z.array(z.enum(VALID_UNITS)).optional(),
  feat_catch_weight:      z.boolean().optional(),
  feat_fsma_lot_tracking: z.boolean().optional(),
  feat_cold_chain_notes:  z.boolean().optional(),
  feat_alcohol_compliance:z.boolean().optional(),
  feat_deposit_tracking:  z.boolean().optional(),
  feat_case_to_each:      z.boolean().optional(),
  catalog_template:       z.enum(VALID_TEMPLATES).optional(),
  catalog_setup:          z.enum(['template', 'csv', 'blank']).optional(),
  onboarding_completed:   z.boolean().optional(),
}).strict();

// ── GET /api/company-config ───────────────────────────────────────────────────
// Returns the company_config row for the authenticated user's company.
// Creates a default row if one does not yet exist.
router.get('/', authenticateToken, async (req, res) => {
  const companyId = req.context?.activeCompanyId || req.context?.companyId;
  if (!companyId) return res.status(400).json({ error: 'No company context.' });

  const { data, error } = await supabase
    .from('company_config')
    .select('*')
    .eq('company_id', companyId)
    .single();

  if (error && error.code !== 'PGRST116') {
    return res.status(500).json({ error: error.message });
  }

  if (!data) {
    // Bootstrap a blank config row for this company on first access.
    const { data: created, error: insertErr } = await supabase
      .from('company_config')
      .insert({
        company_id:            companyId,
        business_types:        [],
        enabled_units:         [],
        feat_catch_weight:     false,
        feat_fsma_lot_tracking:false,
        feat_cold_chain_notes: false,
        feat_alcohol_compliance:false,
        feat_deposit_tracking: false,
        feat_case_to_each:     false,
        catalog_template:      'blank',
        catalog_setup:         'blank',
        onboarding_completed:  false,
      })
      .select()
      .single();
    if (insertErr) return res.status(500).json({ error: insertErr.message });
    return res.json(created);
  }

  return res.json(data);
});

// ── PATCH /api/company-config ─────────────────────────────────────────────────
// Updates company_config fields. Admins can update their own company's config.
// Superadmins can update any company by passing ?company_id=<uuid> in the query.
router.patch('/', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(', ') });
  }

  // Superadmin can target a specific company via query param.
  const companyId =
    (req.user?.role === 'superadmin' && req.query.company_id)
      ? req.query.company_id
      : req.context?.activeCompanyId || req.context?.companyId;

  if (!companyId) return res.status(400).json({ error: 'No company context.' });

  const { data, error } = await supabase
    .from('company_config')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('company_id', companyId)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// ── GET /api/company-config/features ─────────────────────────────────────────
// Lightweight endpoint — returns only the feature-flag booleans + enabled units.
// Used by the frontend useCompanyConfig hook for fast hydration.
router.get('/features', authenticateToken, async (req, res) => {
  const companyId = req.context?.activeCompanyId || req.context?.companyId;
  if (!companyId) return res.status(400).json({ error: 'No company context.' });

  const { data, error } = await supabase
    .from('company_config')
    .select(
      'business_types, enabled_units, ' +
      'feat_catch_weight, feat_fsma_lot_tracking, feat_cold_chain_notes, ' +
      'feat_alcohol_compliance, feat_deposit_tracking, feat_case_to_each, ' +
      'catalog_template, onboarding_completed',
    )
    .eq('company_id', companyId)
    .single();

  if (error && error.code !== 'PGRST116') {
    return res.status(500).json({ error: error.message });
  }

  // Return safe defaults when no row exists yet.
  const cfg = data ?? {
    business_types:         [],
    enabled_units:          [],
    feat_catch_weight:      false,
    feat_fsma_lot_tracking: false,
    feat_cold_chain_notes:  false,
    feat_alcohol_compliance:false,
    feat_deposit_tracking:  false,
    feat_case_to_each:      false,
    catalog_template:       'blank',
    onboarding_completed:   false,
  };

  return res.json(cfg);
});

module.exports = router;
