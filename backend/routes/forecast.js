const express = require('express');
const { supabase } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');

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

module.exports = router;
