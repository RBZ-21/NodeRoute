'use strict';
/**
 * Onboarding route — handles wizard completion for new companies.
 *
 * POST /api/onboarding/complete
 *   Saves all wizard selections to company_config and optionally seeds the
 *   products table from the chosen template.
 *
 * GET /api/onboarding/templates
 *   Returns the list of available inventory templates (names only).
 */
const path    = require('path');
const fs      = require('fs');
const express = require('express');
const { z }   = require('zod');
const { supabase } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// Template seed file lives at ../../supabase/seeds/inventory_templates.json
const TEMPLATES_PATH = path.join(__dirname, '../../supabase/seeds/inventory_templates.json');
let _templates = null;
function getTemplates() {
  if (!_templates) {
    try {
      _templates = JSON.parse(fs.readFileSync(TEMPLATES_PATH, 'utf8'));
    } catch {
      _templates = {};
    }
  }
  return _templates;
}

const VALID_BUSINESS_TYPES = [
  'seafood', 'meat', 'produce', 'dairy',
  'liquor', 'paper', 'broadline', 'wholesale',
];
const VALID_UNITS     = ['each', 'case', 'lb', 'catch_weight', 'gallon', 'pallet'];
const VALID_TEMPLATES = ['seafood', 'liquor', 'produce', 'paper_goods', 'broadline', 'blank'];

const completeSchema = z.object({
  // Step 1
  business_types: z.array(z.enum(VALID_BUSINESS_TYPES)).min(1, 'Select at least one business type'),
  // Step 2
  enabled_units:  z.array(z.enum(VALID_UNITS)).min(1, 'Select at least one unit type'),
  // Step 3
  feat_catch_weight:       z.boolean().default(false),
  feat_fsma_lot_tracking:  z.boolean().default(false),
  feat_cold_chain_notes:   z.boolean().default(false),
  feat_alcohol_compliance: z.boolean().default(false),
  feat_deposit_tracking:   z.boolean().default(false),
  feat_case_to_each:       z.boolean().default(false),
  // Step 4
  catalog_template: z.enum(VALID_TEMPLATES).default('blank'),
  catalog_setup:    z.enum(['template', 'csv', 'blank']).default('blank'),
});

// ── GET /api/onboarding/templates ─────────────────────────────────────────────
router.get('/templates', authenticateToken, (req, res) => {
  const templates = getTemplates();
  const summary = Object.entries(templates).map(([key, products]) => ({
    key,
    label: templateLabel(key),
    product_count: products.length,
    sample_names:  products.slice(0, 3).map((p) => p.name),
  }));
  res.json(summary);
});

// ── POST /api/onboarding/complete ─────────────────────────────────────────────
router.post('/complete', authenticateToken, requireRole('admin'), async (req, res) => {
  const parsed = completeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    });
  }

  const companyId = req.context?.companyId || req.context?.activeCompanyId;
  if (!companyId) return res.status(400).json({ error: 'No company context.' });

  const cfg = parsed.data;

  // 1. Upsert company_config
  const { error: cfgErr } = await supabase
    .from('company_config')
    .upsert(
      {
        company_id:              companyId,
        business_types:          cfg.business_types,
        enabled_units:           cfg.enabled_units,
        feat_catch_weight:       cfg.feat_catch_weight,
        feat_fsma_lot_tracking:  cfg.feat_fsma_lot_tracking,
        feat_cold_chain_notes:   cfg.feat_cold_chain_notes,
        feat_alcohol_compliance: cfg.feat_alcohol_compliance,
        feat_deposit_tracking:   cfg.feat_deposit_tracking,
        feat_case_to_each:       cfg.feat_case_to_each,
        catalog_template:        cfg.catalog_template,
        catalog_setup:           cfg.catalog_setup,
        onboarding_completed:    true,
        updated_at:              new Date().toISOString(),
      },
      { onConflict: 'company_id' },
    );

  if (cfgErr) return res.status(500).json({ error: cfgErr.message });

  // 2. Seed products from template (only if template setup was chosen and products table is empty)
  let seeded = 0;
  if (cfg.catalog_setup === 'template' && cfg.catalog_template !== 'blank') {
    const templates  = getTemplates();
    const products   = templates[cfg.catalog_template] ?? [];

    if (products.length > 0) {
      // Check if company already has products (don't overwrite)
      const { count } = await supabase
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId);

      if ((count ?? 0) === 0) {
        const rows = products.map((p) => ({
          company_id:               companyId,
          item_number:              p.item_number,
          name:                     p.name,
          category:                 p.category    ?? 'General',
          default_unit:             p.default_unit ?? 'each',
          unit:                     p.unit         ?? p.default_unit ?? 'each',
          case_qty:                 p.case_qty     ?? null,
          cost:                     p.cost         ?? 0,
          price_per_unit:           p.price_per_unit ?? p.cost ?? 0,
          is_catch_weight:          p.is_catch_weight          ?? false,
          is_ftl_regulated:         p.is_ftl_regulated         ?? false,
          is_deposit_item:          p.is_deposit_item          ?? false,
          deposit_amount:           p.deposit_amount            ?? null,
          requires_age_verification:p.requires_age_verification ?? false,
          temp_sensitive:           p.temp_sensitive            ?? false,
          lot_item:                 p.is_ftl_regulated ? 'Y' : 'N',
          on_hand_qty:              0,
          on_hand_weight:           0,
          is_active:                true,
        }));

        const { data: inserted, error: seedErr } = await supabase
          .from('products')
          .insert(rows)
          .select('id');

        if (seedErr) {
          // Non-fatal — log but don't fail the onboarding
          console.warn('[onboarding] template seed error:', seedErr.message);
        } else {
          seeded = inserted?.length ?? 0;
        }
      }
    }
  }

  return res.json({
    ok:             true,
    seeded_products:seeded,
    catalog_template: cfg.catalog_template,
  });
});

// ── helpers ───────────────────────────────────────────────────────────────────
function templateLabel(key) {
  const labels = {
    seafood:    'Seafood / Fresh Fish',
    liquor:     'Liquor / Beer / Wine',
    produce:    'Produce',
    paper_goods:'Paper & Janitorial Goods',
    broadline:  'Broadline Food Service',
    blank:      'Start Blank',
  };
  return labels[key] ?? key;
}

module.exports = router;
