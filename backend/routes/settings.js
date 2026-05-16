'use strict';

const express = require('express');
const { supabase } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const {
  MAX_LOGO_DATA_URL_LENGTH,
  CUTOFF_HOUR_OPTIONS,
  CUTOFF_DAY_OPTIONS,
  normalizeCompanySettings,
  normalizeLogoDataUrl,
  normalizeCutoffHour,
  normalizeCutoffDay,
} = require('../services/company-settings');

const router = express.Router();

// GET /api/settings/company
router.get('/company', authenticateToken, async (req, res) => {
  if (!req.context?.companyId) {
    return res.json({
      ...normalizeCompanySettings({}, req.context?.companyName),
      cutoffHourOptions: CUTOFF_HOUR_OPTIONS,
      cutoffDayOptions:  CUTOFF_DAY_OPTIONS,
    });
  }

  const { data, error } = await supabase
    .from('companies')
    .select('id, settings')
    .eq('id', req.context.companyId)
    .single();

  if (error) return res.status(500).json({ error: error.message });

  res.json({
    ...normalizeCompanySettings(data?.settings, req.context?.companyName),
    cutoffHourOptions: CUTOFF_HOUR_OPTIONS,
    cutoffDayOptions:  CUTOFF_DAY_OPTIONS,
  });
});

// PATCH /api/settings/company
router.patch('/company', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  if (!req.context?.companyId) {
    return res.status(400).json({ error: 'No company context available' });
  }

  const businessName = String(req.body?.businessName || '').trim();
  const invoiceLogoDataUrl = req.body?.invoiceLogoDataUrl;
  const normalizedLogo = normalizeLogoDataUrl(invoiceLogoDataUrl);
  if (invoiceLogoDataUrl && !normalizedLogo) {
    return res.status(400).json({ error: `Invoice logo must be a PNG or JPG image under ${Math.floor(MAX_LOGO_DATA_URL_LENGTH / 1024)} KB.` });
  }

  // Validate cutoff fields if provided
  const rawCutoffHour = req.body?.orderCutoffHour;
  const rawCutoffDay  = req.body?.orderCutoffDay;
  const cutoffHour = rawCutoffHour !== undefined ? normalizeCutoffHour(rawCutoffHour) : undefined;
  const cutoffDay  = rawCutoffDay  !== undefined ? normalizeCutoffDay(rawCutoffDay)   : undefined;

  if (rawCutoffHour !== undefined && cutoffHour !== normalizeCutoffHour(rawCutoffHour)) {
    return res.status(400).json({ error: 'Invalid orderCutoffHour value.' });
  }
  if (rawCutoffDay !== undefined && !['day_of', 'day_before'].includes(rawCutoffDay)) {
    return res.status(400).json({ error: 'orderCutoffDay must be "day_of" or "day_before".' });
  }

  const { data: company, error: loadError } = await supabase
    .from('companies')
    .select('id, settings')
    .eq('id', req.context.companyId)
    .single();

  if (loadError) return res.status(500).json({ error: loadError.message });

  const existing = (company?.settings && typeof company.settings === 'object') ? company.settings : {};

  const mergedSettings = {
    ...existing,
    force_driver_signature: !!req.body?.forceDriverSignature,
    force_driver_proof_of_delivery: !!req.body?.forceDriverProofOfDelivery,
    business_name: businessName || req.context.companyName || '',
    invoice_logo_data_url: normalizedLogo,
    // Preserve existing cutoff values if not supplied in this request
    order_cutoff_hour: cutoffHour !== undefined ? cutoffHour : (existing.order_cutoff_hour ?? 14),
    order_cutoff_day:  cutoffDay  !== undefined ? cutoffDay  : (existing.order_cutoff_day  ?? 'day_of'),
  };

  const { data, error } = await supabase
    .from('companies')
    .update({ settings: mergedSettings })
    .eq('id', req.context.companyId)
    .select('settings')
    .single();

  if (error) return res.status(500).json({ error: error.message });

  res.json({
    ...normalizeCompanySettings(data?.settings, req.context?.companyName),
    cutoffHourOptions: CUTOFF_HOUR_OPTIONS,
    cutoffDayOptions:  CUTOFF_DAY_OPTIONS,
  });
});

module.exports = router;
