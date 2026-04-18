const express = require('express');
const { supabase } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { forecastDemand } = require('../services/ai');

const router = express.Router();

// GET /api/forecast/orders
// Returns per-customer order cadence and monthly volume data for the
// forecasting dashboard. Pre-aggregates data optimised for larger datasets.
router.get('/orders', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const MONTHS = 12;
  const since  = new Date(Date.now() - MONTHS * 31 * 86400000).toISOString();

  const { data: orders, error } = await supabase
    .from('orders')
    .select('id,customer,customer_name,description,item_name,date,created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });

  // Monthly buckets
  const now = new Date();
  const monthly = [];
  for (let i = MONTHS - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    const count = (orders || []).filter(o => {
      const od = new Date(o.date || o.created_at);
      return od.getMonth() === d.getMonth() && od.getFullYear() === d.getFullYear();
    }).length;
    monthly.push({ label, count, year: d.getFullYear(), month: d.getMonth() + 1 });
  }

  // Customer cadence
  const byCustomer = {};
  (orders || []).forEach(o => {
    const name = o.customer || o.customer_name || 'Unknown';
    if (!byCustomer[name]) byCustomer[name] = [];
    byCustomer[name].push(new Date(o.date || o.created_at).toISOString());
  });
  const cadence = Object.entries(byCustomer).map(([customer, dates]) => {
    const sorted = dates.sort();
    const last   = sorted[sorted.length - 1];
    const daysSince = Math.round((Date.now() - new Date(last)) / 86400000);
    let avgCadence = null;
    if (sorted.length > 1) {
      const gaps = [];
      for (let i = 1; i < sorted.length; i++)
        gaps.push((new Date(sorted[i]) - new Date(sorted[i-1])) / 86400000);
      avgCadence = Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length);
    }
    return {
      customer,
      order_count: sorted.length,
      last_order: last,
      days_since: daysSince,
      avg_cadence_days: avgCadence,
      next_order_in_days: avgCadence ? Math.max(0, avgCadence - daysSince) : null,
    };
  }).sort((a, b) => b.order_count - a.order_count);

  res.json({ monthly, cadence });
});

// ── AI DEMAND FORECASTING ─────────────────────────────────────────────────────

// GET /api/forecast/inventory/:itemNumber — AI forecast for one product
router.get('/inventory/:itemNumber', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { itemNumber } = req.params;
  const days = Math.min(parseInt(req.query.days) || 14, 90);

  const { data: product, error: pErr } = await supabase
    .from('seafood_inventory')
    .select('item_number,description,category,unit,cost,on_hand_qty')
    .eq('item_number', itemNumber)
    .single();
  if (pErr || !product) return res.status(404).json({ error: 'Product not found' });

  const since = new Date(Date.now() - 84 * 86400000).toISOString(); // 12 weeks
  const { data: history, error: hErr } = await supabase
    .from('inventory_stock_history')
    .select('change_qty,change_type,created_at')
    .eq('item_number', itemNumber)
    .gte('created_at', since)
    .order('created_at', { ascending: false });
  if (hErr) return res.status(500).json({ error: hErr.message });

  try {
    const forecast = await forecastDemand(product, history || [], days);
    res.json(forecast);
  } catch (err) {
    if (err.message.includes('ANTHROPIC_API_KEY')) return res.status(503).json({ error: err.message });
    res.status(500).json({ error: 'AI forecast failed: ' + err.message });
  }
});

// GET /api/forecast/inventory — AI forecast for all products (batch)
router.get('/inventory', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 14, 90);

  const { data: products, error: pErr } = await supabase
    .from('seafood_inventory')
    .select('item_number,description,category,unit,cost,on_hand_qty')
    .order('category');
  if (pErr) return res.status(500).json({ error: pErr.message });

  const since = new Date(Date.now() - 84 * 86400000).toISOString();
  const { data: allHistory, error: hErr } = await supabase
    .from('inventory_stock_history')
    .select('item_number,change_qty,change_type,created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false });
  if (hErr) return res.status(500).json({ error: hErr.message });

  const historyByItem = {};
  (allHistory || []).forEach(h => {
    if (!historyByItem[h.item_number]) historyByItem[h.item_number] = [];
    historyByItem[h.item_number].push(h);
  });

  // Run forecasts with concurrency limit of 3 to avoid rate limits
  const results = [];
  const CONCURRENCY = 3;
  for (let i = 0; i < products.length; i += CONCURRENCY) {
    const batch = products.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async p => {
        try {
          return await forecastDemand(p, historyByItem[p.item_number] || [], days);
        } catch (err) {
          return {
            product_id: p.item_number,
            product_name: p.description,
            forecast_period_days: days,
            predicted_demand_units: 0,
            reorder_recommended: false,
            suggested_reorder_quantity: 0,
            confidence: 'low',
            trend: 'stable',
            reasoning: 'Forecast unavailable: ' + err.message,
          };
        }
      })
    );
    results.push(...batchResults);
  }

  res.json(results);
});

module.exports = router;
