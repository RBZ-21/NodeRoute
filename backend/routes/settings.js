const express = require('express');
const { supabase } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const {
  MAX_LOGO_DATA_URL_LENGTH,
  normalizeCompanySettings,
  normalizeLogoDataUrl,
} = require('../services/company-settings');

const router = express.Router();

router.get('/company', authenticateToken, async (req, res) => {
  if (!req.context?.companyId) {
    return res.json(normalizeCompanySettings({}, req.context?.companyName));
  }

  const { data, error } = await supabase
    .from('companies')
    .select('id, settings')
    .eq('id', req.context.companyId)
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(normalizeCompanySettings(data?.settings, req.context?.companyName));
});

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

  const { data: company, error: loadError } = await supabase
    .from('companies')
    .select('id, settings')
    .eq('id', req.context.companyId)
    .single();

  if (loadError) return res.status(500).json({ error: loadError.message });

  const mergedSettings = {
    ...(company?.settings && typeof company.settings === 'object' ? company.settings : {}),
    force_driver_signature: !!req.body?.forceDriverSignature,
    force_driver_proof_of_delivery: !!req.body?.forceDriverProofOfDelivery,
    business_name: businessName || req.context.companyName || '',
    invoice_logo_data_url: normalizedLogo,
  };

  const { data, error } = await supabase
    .from('companies')
    .update({ settings: mergedSettings })
    .eq('id', req.context.companyId)
    .select('settings')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(normalizeCompanySettings(data?.settings, req.context?.companyName));
});

module.exports = router;
