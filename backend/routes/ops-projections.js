const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { loadInventoryAndUsage, buildProjectionRows, buildPurchasingSuggestions } = require('./ops-utils');

const router = express.Router();

router.get('/projections', authenticateToken, async (req, res) => {
  const days = Math.max(1, Math.min(90, parseInt(req.query.days || '30', 10)));
  const lookbackDays = Math.max(7, Math.min(90, parseInt(req.query.lookbackDays || '30', 10)));
  try {
    const { inventory, usageByName } = await loadInventoryAndUsage(lookbackDays);
    const projections = buildProjectionRows(inventory, usageByName, { days, lookbackDays });
    res.json({ days, lookbackDays, generated_at: new Date().toISOString(), projections });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/purchasing-suggestions', authenticateToken, async (req, res) => {
  const coverageDays = Math.max(1, Math.min(90, parseInt(req.query.coverageDays || '30', 10)));
  const leadTimeDays = Math.max(0, Math.min(60, parseInt(req.query.leadTimeDays || '5', 10)));
  const lookbackDays = Math.max(7, Math.min(90, parseInt(req.query.lookbackDays || '30', 10)));
  try {
    const { inventory, usageByName } = await loadInventoryAndUsage(lookbackDays);
    const suggestions = buildPurchasingSuggestions(inventory, usageByName, { coverageDays, leadTimeDays, lookbackDays });
    res.json({ leadTimeDays, coverageDays, lookbackDays, generated_at: new Date().toISOString(), suggestions });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
