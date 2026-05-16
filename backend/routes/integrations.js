const express = require('express');
const router = express.Router();
const { supabase } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');

// Integration definitions — these are the known integrations in the system.
// Status is persisted in the `integrations` table keyed by `slug`.
const KNOWN_INTEGRATIONS = [
  { slug: 'stripe',         name: 'Stripe' },
  { slug: 'quickbooks',     name: 'QuickBooks' },
  { slug: 'supabase',       name: 'Supabase' },
  { slug: 'email-smtp',     name: 'Email (SMTP)' },
  { slug: 'pdf-service',    name: 'PDF Service' },
];

// Ensure integrations table rows exist for all known integrations
async function ensureRows(orgId) {
  for (const intg of KNOWN_INTEGRATIONS) {
    const { data } = await supabase
      .from('integrations')
      .select('id')
      .eq('slug', intg.slug)
      .eq('org_id', orgId)
      .maybeSingle();
    if (!data) {
      await supabase.from('integrations').insert({
        slug: intg.slug,
        name: intg.name,
        status: 'disconnected',
        org_id: orgId,
        last_sync: null,
      });
    }
  }
}

// GET /api/integrations — list all integrations for this org
router.get('/', authenticateToken, async (req, res) => {
  try {
    const orgId = req.user.org_id || req.user.id;
    await ensureRows(orgId);
    const { data, error } = await supabase
      .from('integrations')
      .select('*')
      .eq('org_id', orgId)
      .order('name');
    if (error) return res.status(500).json({ error: error.message });
    // Normalise to the shape IntegrationsPage expects
    const integrations = (data || []).map((row) => ({
      id: row.slug,
      name: row.name,
      status: row.status || 'disconnected',
      lastSync: row.last_sync || '',
    }));
    res.json(integrations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/integrations/:slug/connect
router.post('/:slug/connect', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const orgId = req.user.org_id || req.user.id;
    const { error } = await supabase
      .from('integrations')
      .update({ status: 'connected', last_sync: new Date().toISOString() })
      .eq('slug', req.params.slug)
      .eq('org_id', orgId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/integrations/:slug/disconnect
router.post('/:slug/disconnect', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const orgId = req.user.org_id || req.user.id;
    const { error } = await supabase
      .from('integrations')
      .update({ status: 'disconnected' })
      .eq('slug', req.params.slug)
      .eq('org_id', orgId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/integrations/:slug/sync
router.post('/:slug/sync', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const orgId = req.user.org_id || req.user.id;
    const { error } = await supabase
      .from('integrations')
      .update({ last_sync: new Date().toISOString() })
      .eq('slug', req.params.slug)
      .eq('org_id', orgId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, syncedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/integrations/:slug/logs — returns a log_url if stored
router.get('/:slug/logs', authenticateToken, async (req, res) => {
  try {
    const orgId = req.user.org_id || req.user.id;
    const { data, error } = await supabase
      .from('integrations')
      .select('log_url')
      .eq('slug', req.params.slug)
      .eq('org_id', orgId)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ url: data?.log_url || '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
