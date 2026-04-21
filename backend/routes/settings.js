const express = require('express');
const { supabase } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

function normalizeCompanySettings(settings) {
  const source = settings && typeof settings === 'object' ? settings : {};
  return {
    forceDriverSignature: !!(source.force_driver_signature || source.forceDriverSignature),
  };
}

router.get('/company', authenticateToken, async (req, res) => {
  if (!req.context?.companyId) {
    return res.json(normalizeCompanySettings({}));
  }

  const { data, error } = await supabase
    .from('companies')
    .select('id, settings')
    .eq('id', req.context.companyId)
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(normalizeCompanySettings(data?.settings));
});

router.patch('/company', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  if (!req.context?.companyId) {
    return res.status(400).json({ error: 'No company context available' });
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
  };

  const { data, error } = await supabase
    .from('companies')
    .update({ settings: mergedSettings })
    .eq('id', req.context.companyId)
    .select('settings')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(normalizeCompanySettings(data?.settings));
});

module.exports = router;
