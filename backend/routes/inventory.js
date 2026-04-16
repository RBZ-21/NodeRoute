const express = require('express');
const { supabase, dbQuery } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { createMailer } = require('../services/email');

const router = express.Router();

// ── SEAFOOD INVENTORY (Supabase table: seafood_inventory) ────────────────────
// Column names (updated to match current database):
//   id uuid PK, description text NOT NULL (product name),
//   category text, item_number text, unit text,
//   cost numeric, on_hand_qty numeric, on_hand_weight numeric,
//   lot_item text, created_at timestamptz DEFAULT now()
// Analytics columns (migration 20260415_inventory_enhancements):
//   avg_yield numeric, yield_count integer, updated_at timestamptz, alert_sent_at timestamptz

router.get('/', authenticateToken, async (req, res) => {
  const data = await dbQuery(supabase.from('seafood_inventory').select('*').order('category', { ascending: true }), res);
  if (!data) return;
  res.json(data);
});

router.post('/', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { description, category, item_number, unit, cost, on_hand_qty, on_hand_weight, lot_item } = req.body;
  if (!description) return res.status(400).json({ error: 'Product description required' });
  const data = await dbQuery(supabase.from('seafood_inventory').insert([{
    description,
    category:       category       || 'Other',
    item_number:    item_number    || '',
    unit:           unit           || 'lb',
    cost:           parseFloat(cost)           || 0,
    on_hand_qty:    parseFloat(on_hand_qty)    || 0,
    on_hand_weight: parseFloat(on_hand_weight) || 0,
    lot_item:       lot_item       || 'N',
  }]).select().single(), res);
  if (!data) return;
  res.json(data);
});

// ── ANALYTICS & PREDICTIONS ──────────────────────────────────────────────────
// Must be registered BEFORE /:id routes to avoid route shadowing.

router.get('/analytics', authenticateToken, async (req, res) => {
  const WINDOW_DAYS = 30;
  const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString();

  const { data: products, error: pErr } = await supabase
    .from('seafood_inventory')
    .select('id,description,category,unit,on_hand_qty,avg_yield,yield_count')
    .order('category');
  if (pErr) return res.status(500).json({ error: pErr.message });

  const { data: history, error: hErr } = await supabase
    .from('inventory_stock_history')
    .select('product_id,change_qty,created_at')
    .lt('change_qty', 0)
    .gte('created_at', since);
  if (hErr) return res.status(500).json({ error: hErr.message });

  const usageMap = {};
  (history || []).forEach(h => {
    usageMap[h.product_id] = (usageMap[h.product_id] || 0) + Math.abs(h.change_qty);
  });

  const today = new Date();
  const analytics = products.map(p => {
    const totalUsed    = usageMap[p.id] || 0;
    const dailyUsage   = parseFloat((totalUsed / WINDOW_DAYS).toFixed(4));
    const currentStock = parseFloat(p.on_hand_qty) || 0;
    let daysRemaining  = null;
    let predictedDate  = null;
    if (dailyUsage > 0 && currentStock > 0) {
      daysRemaining = parseFloat((currentStock / dailyUsage).toFixed(1));
      const d = new Date(today);
      d.setDate(d.getDate() + Math.round(daysRemaining));
      predictedDate = d.toISOString().split('T')[0];
    }
    return {
      ...p,
      daily_usage:    dailyUsage,
      total_used_30d: parseFloat(totalUsed.toFixed(2)),
      days_remaining: daysRemaining,
      predicted_restock_date: predictedDate,
      has_history: totalUsed > 0,
    };
  });

  res.json(analytics);
});

// POST /api/inventory/alerts/send
function buildInventoryAlertEmail(outOfStock, lowStock, analytics) {
  const rows = (items, label, color) =>
    items.map(i => {
      const pred = analytics.find(a => a.id === i.id);
      const daysInfo = pred?.days_remaining != null
        ? `<span style="color:#888;font-size:11px"> · Est. ${pred.days_remaining}d remaining</span>` : '';
      return `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #2a2a2a">${i.description}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #2a2a2a;color:#888">${i.category||'Other'}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #2a2a2a;color:${color};font-weight:600">${label}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #2a2a2a">${i.on_hand_qty != null ? i.on_hand_qty + ' ' + (i.unit||'') : '—'}${daysInfo}</td>
      </tr>`;
    }).join('');

  const allRows = rows(outOfStock, 'OUT OF STOCK', '#ef4444') + rows(lowStock, 'LOW STOCK', '#f59e0b');
  return `
<div style="font-family:sans-serif;background:#111;color:#e5e7eb;padding:24px;border-radius:8px;max-width:640px">
  <h2 style="color:#3dba7f;margin:0 0 4px">Inventory Alert</h2>
  <p style="color:#888;margin:0 0 20px;font-size:13px">Automated low-stock report — ${new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</p>
  <table style="width:100%;border-collapse:collapse;font-size:13px">
    <thead><tr style="background:#1a1a1a">
      <th style="padding:8px 10px;text-align:left;color:#aaa">Product</th>
      <th style="padding:8px 10px;text-align:left;color:#aaa">Category</th>
      <th style="padding:8px 10px;text-align:left;color:#aaa">Status</th>
      <th style="padding:8px 10px;text-align:left;color:#aaa">On Hand</th>
    </tr></thead>
    <tbody>${allRows}</tbody>
  </table>
  <p style="color:#555;font-size:11px;margin-top:16px">Sent by NodeRoute Inventory Management</p>
</div>`;
}

router.post('/alerts/send', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const mailer = createMailer();
  if (!mailer) return res.status(503).json({ error: 'Email not configured (SMTP_HOST missing)' });

  const { data: products, error } = await supabase.from('seafood_inventory').select('*');
  if (error) return res.status(500).json({ error: error.message });

  const LOW_THRESHOLD = 10;
  const outOfStock = products.filter(i => (i.on_hand_qty || 0) <= 0);
  const lowStock   = products.filter(i => (i.on_hand_qty || 0) > 0 && (i.on_hand_qty || 0) <= LOW_THRESHOLD);

  if (!outOfStock.length && !lowStock.length)
    return res.json({ sent: false, message: 'All stock levels are healthy — no alert needed.' });

  const WINDOW = 30;
  const since  = new Date(Date.now() - WINDOW * 86400000).toISOString();
  const { data: history } = await supabase
    .from('inventory_stock_history')
    .select('product_id,change_qty')
    .lt('change_qty', 0)
    .gte('created_at', since);
  const usageMap = {};
  (history || []).forEach(h => { usageMap[h.product_id] = (usageMap[h.product_id] || 0) + Math.abs(h.change_qty); });
  const analytics = products.map(p => {
    const used = usageMap[p.id] || 0;
    const daily = used / WINDOW;
    const stock = parseFloat(p.on_hand_qty) || 0;
    return { id: p.id, days_remaining: daily > 0 && stock > 0 ? parseFloat((stock / daily).toFixed(1)) : null };
  });

  const html = buildInventoryAlertEmail(outOfStock, lowStock, analytics);
  const to   = req.body.email || process.env.SMTP_USER || process.env.EMAIL_FROM;
  try {
    await mailer.sendMail({
      from: process.env.EMAIL_FROM || process.env.SMTP_USER,
      to,
      subject: `Inventory Alert — ${outOfStock.length} out of stock, ${lowStock.length} low`,
      html,
    });
    const affectedIds = [...outOfStock, ...lowStock].map(i => i.id);
    await supabase.from('seafood_inventory')
      .update({ alert_sent_at: new Date().toISOString() })
      .in('id', affectedIds);
    res.json({ sent: true, to, out_of_stock: outOfStock.length, low_stock: lowStock.length });
  } catch (e) {
    res.status(500).json({ error: 'Email send failed: ' + e.message });
  }
});

// POST /api/inventory/:id/restock — add stock and log history
router.post('/:id/restock', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { qty, notes } = req.body;
  const addQty = parseFloat(qty);
  if (!addQty || addQty <= 0) return res.status(400).json({ error: 'qty must be > 0' });

  const { data: item, error: fetchErr } = await supabase
    .from('seafood_inventory').select('on_hand_qty,description').eq('id', req.params.id).single();
  if (fetchErr) return res.status(404).json({ error: 'Product not found' });

  const newQty = (parseFloat(item.on_hand_qty) || 0) + addQty;
  const { data, error } = await supabase
    .from('seafood_inventory')
    .update({ on_hand_qty: newQty, updated_at: new Date().toISOString() })
    .eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  await supabase.from('inventory_stock_history').insert([{
    product_id: req.params.id,
    change_qty: addQty,
    new_qty: newQty,
    change_type: 'restock',
    notes: notes || null,
    created_by: req.user.name || req.user.email,
  }]);

  res.json(data);
});

// POST /api/inventory/:id/adjust — manual depletion, waste, or correction
router.post('/:id/adjust', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { delta, change_type, notes } = req.body;
  const d = parseFloat(delta);
  if (d == null || isNaN(d)) return res.status(400).json({ error: 'delta (number) required' });
  const type = change_type || (d < 0 ? 'depletion' : 'adjustment');

  const { data: item, error: fetchErr } = await supabase
    .from('seafood_inventory').select('on_hand_qty').eq('id', req.params.id).single();
  if (fetchErr) return res.status(404).json({ error: 'Product not found' });

  const newQty = parseFloat(((parseFloat(item.on_hand_qty) || 0) + d).toFixed(4));
  const { data, error } = await supabase
    .from('seafood_inventory')
    .update({ on_hand_qty: newQty, updated_at: new Date().toISOString() })
    .eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  await supabase.from('inventory_stock_history').insert([{
    product_id: req.params.id,
    change_qty: d,
    new_qty: newQty,
    change_type: type,
    notes: notes || null,
    created_by: req.user.name || req.user.email,
  }]);

  res.json(data);
});

// GET /api/inventory/:id/history — stock movement log
router.get('/:id/history', authenticateToken, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const { data, error } = await supabase
    .from('inventory_stock_history')
    .select('*')
    .eq('product_id', req.params.id)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/inventory/:id/yield — log a cutting session, update running average
router.post('/:id/yield', authenticateToken, async (req, res) => {
  const { raw_weight, yield_weight, notes } = req.body;
  const raw     = parseFloat(raw_weight);
  const yielded = parseFloat(yield_weight);
  if (!raw || raw <= 0)         return res.status(400).json({ error: 'raw_weight must be > 0' });
  if (!yielded || yielded <= 0) return res.status(400).json({ error: 'yield_weight must be > 0' });
  if (yielded > raw)            return res.status(400).json({ error: 'yield_weight cannot exceed raw_weight' });

  const yield_pct = parseFloat(((yielded / raw) * 100).toFixed(2));

  await supabase.from('inventory_yield_log').insert([{
    product_id:   req.params.id,
    raw_weight:   raw,
    yield_weight: yielded,
    yield_pct,
    notes: notes || null,
    logged_by: req.user.name || req.user.email,
  }]);

  const { data: item, error: fetchErr } = await supabase
    .from('seafood_inventory')
    .select('avg_yield,yield_count')
    .eq('id', req.params.id).single();
  if (fetchErr) return res.status(404).json({ error: 'Product not found' });

  const n      = (item?.yield_count || 0) + 1;
  const newAvg = parseFloat((((item?.avg_yield || 0) * (n - 1) + yield_pct) / n).toFixed(2));

  const { data, error } = await supabase
    .from('seafood_inventory')
    .update({ avg_yield: newAvg, yield_count: n, updated_at: new Date().toISOString() })
    .eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  res.json({ ...data, yield_pct, sample_count: n });
});

// GET /api/inventory/:id/yield — yield history for a product
router.get('/:id/yield', authenticateToken, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const { data, error } = await supabase
    .from('inventory_yield_log')
    .select('*')
    .eq('product_id', req.params.id)
    .order('logged_at', { ascending: false })
    .limit(limit);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── EXISTING CRUD (must come after named sub-routes) ─────────────────────────

router.patch('/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const allowed = ['description','category','item_number','unit','cost','on_hand_qty','on_hand_weight','lot_item'];
  const fields = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) fields[k] = req.body[k]; });
  const data = await dbQuery(supabase.from('seafood_inventory').update(fields).eq('id', req.params.id).select().single(), res);
  if (!data) return;
  res.json(data);
});

router.delete('/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const data = await dbQuery(supabase.from('seafood_inventory').delete().eq('id', req.params.id), res);
  if (data === null) return;
  res.json({ message: 'Deleted' });
});

module.exports = router;
