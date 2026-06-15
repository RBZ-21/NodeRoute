'use strict';

/**
 * AI Insights API
 * ───────────────
 * Read/acknowledge the proactive AI analysis results stored by the scheduled
 * job (services/ai-insights.js), plus an on-demand re-run for the active
 * company. All queries are tenant-scoped via the operating context.
 */

const express = require('express');
const { supabase } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { scopeQueryByContext } = require('../services/operating-context');
const { runAiInsightsForCompany } = require('../services/ai-insights');

const router = express.Router();

// GET /api/ai-insights — unacknowledged insights for the active company.
router.get('/', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { data, error } = await scopeQueryByContext(supabase
      .from('ai_insights')
      .select('id,company_id,type,severity,payload,created_at,acknowledged_at'), req.context)
      .is('acknowledged_at', null)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: 'Could not load AI insights: ' + err.message });
  }
});

// POST /api/ai-insights/:id/acknowledge — dismiss an insight banner.
router.post('/:id/acknowledge', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { data, error } = await scopeQueryByContext(supabase
      .from('ai_insights')
      .update({ acknowledged_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .is('acknowledged_at', null), req.context)
      .select('id,acknowledged_at');
    if (error) return res.status(500).json({ error: error.message });
    if (!data?.length) return res.status(404).json({ error: 'Insight not found or already acknowledged' });
    res.json(data[0]);
  } catch (err) {
    res.status(500).json({ error: 'Could not acknowledge insight: ' + err.message });
  }
});

// POST /api/ai-insights/run — manual re-run for the active company only.
router.post('/run', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const companyId = String(req.context?.activeCompanyId || req.context?.companyId || '').trim();
    if (!companyId) return res.status(400).json({ error: 'No active company in session context' });
    const results = await runAiInsightsForCompany(companyId);
    res.json({ companyId, results });
  } catch (err) {
    res.status(500).json({ error: 'AI insights run failed: ' + err.message });
  }
});

module.exports = router;
