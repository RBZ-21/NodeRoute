const express = require('express');
const { supabase, dbQuery } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { createMailer } = require('../services/email');
const { analyzeInventory, generateReorderAlert } = require('../services/ai');
const {
  applyInventoryLedgerEntry,
  transferInventoryLedgerEntry,
  toNumber,
} = require('../services/inventory-ledger');
const {
  filterRowsByContext,
  insertRecordWithOptionalScope,
  rowMatchesContext,
} = require('../services/operating-context');

const router = express.Router();

// Products whose names match this pattern require a lot number on every receipt.
const LOT_REQUIRED = /\b(mussel|clam|oyster)s?\b/i;
const needsLot = desc => LOT_REQUIRED.test(desc || '');

// ── SEAFOOD INVENTORY (Supabase table: seafood_inventory) ────────────────────
// Column names (updated to match current database):
//   id uuid PK, description text NOT NULL (product name),
//   category text, item_number text, unit text,
//   cost numeric, on_hand_qty numeric, on_hand_weight numeric, notes text,
//   lot_item text, created_at timestamptz DEFAULT now()
// Analytics columns (migration 20260415_inventory_enhancements):
//   avg_yield numeric, yield_count integer, updated_at timestamptz, alert_sent_at timestamptz

router.get('/', authenticateToken, async (req, res) => {
  const data = await dbQuery(supabase.from('seafood_inventory').select('*').order('category', { ascending: true }), res);
  if (!data) return;
  res.json(filterRowsByContext(data, req.context));
});

router.post('/', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { description, category, item_number, unit, cost, on_hand_qty, on_hand_weight, lot_item, notes } = req.body;
  if (!description) return res.status(400).json({ error: 'Product description required' });
  const insertResult = await insertRecordWithOptionalScope(supabase, 'seafood_inventory', {
    description,
    category:       category       || 'Other',
    item_number:    item_number    || '',
    unit:           unit           || 'lb',
    cost:           parseFloat(cost)           || 0,
    on_hand_qty:    parseFloat(on_hand_qty)    || 0,
    on_hand_weight: parseFloat(on_hand_weight) || 0,
    lot_item:       needsLot(description) ? 'Y' : (lot_item || 'N'),
    notes:          notes || null,
  }, req.context);
  if (insertResult.error) return res.status(500).json({ error: insertResult.error.message });
  const data = insertResult.data;
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
    .select('item_number,description,category,unit,on_hand_qty,avg_yield,yield_count')
    .order('category');
  if (pErr) return res.status(500).json({ error: pErr.message });

  const { data: history, error: hErr } = await supabase
    .from('inventory_stock_history')
    .select('item_number,change_qty,created_at')
    .lt('change_qty', 0)
    .gte('created_at', since);
  if (hErr) return res.status(500).json({ error: hErr.message });

  const usageMap = {};
  (history || []).forEach(h => {
    usageMap[h.item_number] = (usageMap[h.item_number] || 0) + Math.abs(h.change_qty);
  });

  const today = new Date();
  const analytics = products.map(p => {
    const totalUsed    = usageMap[p.item_number] || 0;
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
  if (!mailer) return res.status(503).json({ error: 'Email not configured (RESEND_API_KEY missing)' });

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
    .select('item_number,change_qty')
    .lt('change_qty', 0)
    .gte('created_at', since);
  const usageMap = {};
  (history || []).forEach(h => { usageMap[h.item_number] = (usageMap[h.item_number] || 0) + Math.abs(h.change_qty); });
  const analytics = products.map(p => {
    const used = usageMap[p.item_number] || 0;
    const daily = used / WINDOW;
    const stock = parseFloat(p.on_hand_qty) || 0;
    return { id: p.id, days_remaining: daily > 0 && stock > 0 ? parseFloat((stock / daily).toFixed(1)) : null };
  });

  const html = buildInventoryAlertEmail(outOfStock, lowStock, analytics);
  const to   = req.body.email || process.env.EMAIL_FROM;
  try {
    await mailer.sendMail({
      from: process.env.EMAIL_FROM,
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

// GET /api/inventory/ai-analysis — full warehouse AI inventory health check
router.get('/ai-analysis', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { data: products, error: pErr } = await supabase
    .from('seafood_inventory')
    .select('item_number,description,category,unit,cost,on_hand_qty')
    .order('category');
  if (pErr) return res.status(500).json({ error: pErr.message });

  const since = new Date(Date.now() - 28 * 86400000).toISOString(); // 4 weeks
  const { data: history, error: hErr } = await supabase
    .from('inventory_stock_history')
    .select('item_number,change_qty,created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false });
  if (hErr) return res.status(500).json({ error: hErr.message });

  const historyByItem = {};
  (history || []).forEach(h => {
    if (!historyByItem[h.item_number]) historyByItem[h.item_number] = [];
    historyByItem[h.item_number].push(h);
  });

  // Fetch active lots with expiry dates within 30 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + 30);
  const { data: expiringLots } = await supabase
    .from('inventory_lots')
    .select('item_number,lot_number,expiry_date,qty_on_hand')
    .eq('status', 'active')
    .not('expiry_date', 'is', null)
    .lte('expiry_date', cutoff.toISOString().split('T')[0])
    .order('expiry_date', { ascending: true });

  try {
    const analysis = await analyzeInventory(products, historyByItem, expiringLots || []);
    res.json(analysis);
  } catch (err) {
    if (err.message.includes('OPENAI_API_KEY')) return res.status(503).json({ error: err.message });
    res.status(500).json({ error: 'AI analysis failed: ' + err.message });
  }
});

// ── LOT / BATCH & EXPIRY TRACKING ────────────────────────────────────────────
// All /lots routes must be registered BEFORE /:id routes to prevent shadowing.

// GET /api/inventory/lots — all lots, enriched with product description
router.get('/lots', authenticateToken, async (req, res) => {
  const { data: lots, error } = await supabase
    .from('inventory_lots')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  // Enrich with product descriptions in one extra query
  const itemNumbers = [...new Set((lots || []).map(l => l.item_number))];
  let descMap = {};
  if (itemNumbers.length) {
    const { data: prods } = await supabase
      .from('seafood_inventory')
      .select('item_number,description')
      .in('item_number', itemNumbers);
    (prods || []).forEach(p => { descMap[p.item_number] = p.description; });
  }
  res.json((lots || []).map(l => ({ ...l, item_description: descMap[l.item_number] || null })));
});

// POST /api/inventory/lots — create a new lot and optionally bump product on_hand_qty
router.post('/lots', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const {
    item_number, lot_number, batch_number, supplier_name, country_of_origin,
    certifications, storage_temp, received_date, expiry_date, best_before_date,
    qty_received, cost_per_unit, status, notes,
  } = req.body;
  if (!item_number) return res.status(400).json({ error: 'item_number required' });
  if (!lot_number)  return res.status(400).json({ error: 'lot_number required' });
  const qty = parseFloat(qty_received) || 0;
  if (qty <= 0) return res.status(400).json({ error: 'qty_received must be > 0' });

  const { data, error } = await supabase.from('inventory_lots').insert([{
    item_number,
    lot_number,
    batch_number:       batch_number       || null,
    supplier_name:      supplier_name      || null,
    country_of_origin:  country_of_origin  || null,
    certifications:     certifications     || null,
    storage_temp:       storage_temp       || null,
    received_date:      received_date      || new Date().toISOString().split('T')[0],
    expiry_date:        expiry_date        || null,
    best_before_date:   best_before_date   || null,
    qty_received:       qty,
    qty_on_hand:        qty,
    cost_per_unit:      parseFloat(cost_per_unit) || 0,
    status:             status             || 'active',
    notes:              notes              || null,
    created_by:         req.user.name      || req.user.email,
  }]).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Bump master product stock through unified ledger posting.
  const { data: prod } = await supabase.from('seafood_inventory').select('*').eq('item_number', item_number).single();
  if (prod) {
    try {
      await applyInventoryLedgerEntry({
        itemNumber: item_number,
        deltaQty: qty,
        changeType: 'restock',
        notes: `Lot ${lot_number}${supplier_name ? ' · ' + supplier_name : ''}`,
        createdBy: req.user.name || req.user.email,
        lotId: data.id,
        unitCost: parseFloat(cost_per_unit) || 0,
      });
    } catch (ledgerErr) {
      return res.status(500).json({ error: ledgerErr.message });
    }
  }

  res.json({ ...data, item_description: prod?.description || null });
});

// GET /api/inventory/lots/expiring — lots expiring within N days (default 30)
router.get('/lots/expiring', authenticateToken, async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 30, 365);
  const future = new Date();
  future.setDate(future.getDate() + days);
  const { data, error } = await supabase
    .from('inventory_lots')
    .select('*')
    .eq('status', 'active')
    .not('expiry_date', 'is', null)
    .lte('expiry_date', future.toISOString().split('T')[0])
    .order('expiry_date', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// PATCH /api/inventory/lots/:lotId — update lot fields
router.patch('/lots/:lotId', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const allowed = [
    'lot_number','batch_number','supplier_name','country_of_origin','certifications',
    'storage_temp','received_date','expiry_date','best_before_date',
    'qty_on_hand','cost_per_unit','status','notes',
  ];
  const fields = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) fields[k] = req.body[k]; });
  const { data, error } = await supabase.from('inventory_lots').update(fields).eq('id', req.params.lotId).select().single();
  if (error) return res.status(500).json({ error: error.message });
  const { data: prod } = await supabase.from('seafood_inventory').select('description').eq('item_number', data.item_number).single();
  res.json({ ...data, item_description: prod?.description || null });
});

// POST /api/inventory/lots/:lotId/deplete — remove qty from a specific lot
router.post('/lots/:lotId/deplete', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { qty, change_type, notes } = req.body;
  const removeQty = parseFloat(qty);
  if (!removeQty || removeQty <= 0) return res.status(400).json({ error: 'qty must be > 0' });

  const { data: lot, error: lotErr } = await supabase.from('inventory_lots').select('*').eq('id', req.params.lotId).single();
  if (lotErr || !lot) return res.status(404).json({ error: 'Lot not found' });
  if (removeQty > (parseFloat(lot.qty_on_hand) || 0))
    return res.status(400).json({ error: `Cannot deplete more than qty on hand (${lot.qty_on_hand})` });

  const newLotQty = parseFloat(((parseFloat(lot.qty_on_hand) || 0) - removeQty).toFixed(4));
  const newLotStatus = newLotQty <= 0 ? 'depleted' : lot.status;

  const { data: updLot, error: updErr } = await supabase
    .from('inventory_lots')
    .update({ qty_on_hand: newLotQty, status: newLotStatus })
    .eq('id', req.params.lotId)
    .select().single();
  if (updErr) return res.status(500).json({ error: updErr.message });

  // Deduct from master product qty through unified ledger posting.
  let ledger;
  try {
    ledger = await applyInventoryLedgerEntry({
      itemNumber: lot.item_number,
      deltaQty: -removeQty,
      changeType: change_type || 'depletion',
      notes: notes || `Lot ${lot.lot_number}`,
      createdBy: req.user.name || req.user.email,
      lotId: lot.id,
    });
  } catch (ledgerErr) {
    return res.status(500).json({ error: ledgerErr.message });
  }
  const updProd = ledger.item_after;

  res.json({
    lot:     { ...updLot, item_description: ledger.item_before?.description || null },
    product: updProd,
  });
});

// DELETE /api/inventory/lots/:lotId
router.delete('/lots/:lotId', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { error } = await supabase.from('inventory_lots').delete().eq('id', req.params.lotId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Lot deleted' });
});

// ─────────────────────────────────────────────────────────────────────────────

// POST /api/inventory/count — replace product stock quantities after a physical count
router.post('/count', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const entries = Array.isArray(req.body.items) ? req.body.items : [];
  const countNotes = req.body.notes || 'Physical inventory count';
  const normalized = entries
    .map(entry => ({
      item_number: String(entry.item_number || '').trim(),
      counted_qty: parseFloat(entry.counted_qty),
    }))
    .filter(entry => entry.item_number && Number.isFinite(entry.counted_qty) && entry.counted_qty >= 0);

  if (!normalized.length) return res.status(400).json({ error: 'At least one counted item is required' });

  const itemNumbers = normalized.map(entry => entry.item_number);
  const { data: existing, error: fetchErr } = await supabase
    .from('seafood_inventory')
    .select('*')
    .in('item_number', itemNumbers);
  if (fetchErr) return res.status(500).json({ error: fetchErr.message });

  const existingByNumber = new Map((filterRowsByContext(existing || [], req.context)).map(item => [item.item_number, item]));
  const updatedItems = [];

  for (const entry of normalized) {
    const current = existingByNumber.get(entry.item_number);
    if (!current) continue;

    try {
      const ledger = await applyInventoryLedgerEntry({
        itemNumber: entry.item_number,
        changeType: 'count',
        notes: countNotes,
        createdBy: req.user.name || req.user.email,
        setAbsoluteQty: parseFloat(entry.counted_qty.toFixed(4)),
        preventNegative: false,
      });
      updatedItems.push(ledger.item_after);
    } catch (ledgerErr) {
      return res.status(500).json({ error: ledgerErr.message });
    }
  }

  res.json({ updated: updatedItems.length, items: updatedItems });
});

// POST /api/inventory/:id/restock — add stock and log history
router.post('/:id/restock', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { qty, notes } = req.body;
  const addQty = parseFloat(qty);
  if (!addQty || addQty <= 0) return res.status(400).json({ error: 'qty must be > 0' });

  const { data: item, error: fetchErr } = await supabase
    .from('seafood_inventory').select('*').eq('item_number', req.params.id).single();
  if (fetchErr) return res.status(404).json({ error: 'Product not found' });

  if (item.lot_item === 'Y') {
    return res.status(422).json({
      error: `${item.description} requires a lot number on every receipt. Use "Add Lot" to record this shipment.`,
      requires_lot: true,
    });
  }

  try {
    const ledger = await applyInventoryLedgerEntry({
      itemNumber: req.params.id,
      deltaQty: addQty,
      changeType: 'restock',
      notes: notes || null,
      createdBy: req.user.name || req.user.email,
    });
    res.json(ledger.item_after);
  } catch (ledgerErr) {
    res.status(500).json({ error: ledgerErr.message });
  }
});

// POST /api/inventory/:id/adjust — manual depletion, waste, or correction
router.post('/:id/adjust', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { delta, change_type, notes } = req.body;
  const d = parseFloat(delta);
  if (d == null || isNaN(d)) return res.status(400).json({ error: 'delta (number) required' });
  const type = change_type || (d < 0 ? 'depletion' : 'adjustment');

  try {
    const ledger = await applyInventoryLedgerEntry({
      itemNumber: req.params.id,
      deltaQty: d,
      changeType: type,
      notes: notes || null,
      createdBy: req.user.name || req.user.email,
    });
    res.json(ledger.item_after);
  } catch (ledgerErr) {
    if (ledgerErr.code === 'LEDGER_ITEM_NOT_FOUND') return res.status(404).json({ error: 'Product not found' });
    if (ledgerErr.code === 'LEDGER_NEGATIVE_STOCK') return res.status(400).json({ error: ledgerErr.message });
    res.status(500).json({ error: ledgerErr.message });
  }
});

// POST /api/inventory/:id/pick — pick stock for an order or outbound workflow
router.post('/:id/pick', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const qty = parseFloat(req.body.qty);
  if (!qty || qty <= 0) return res.status(400).json({ error: 'qty must be > 0' });
  const orderRef = String(req.body.order_id || req.body.order_number || '').trim();
  const notes = String(req.body.notes || '').trim();

  try {
    const ledger = await applyInventoryLedgerEntry({
      itemNumber: req.params.id,
      deltaQty: -qty,
      changeType: 'pick',
      notes: notes || (orderRef ? `Order pick ${orderRef}` : 'Order pick'),
      createdBy: req.user.name || req.user.email,
    });
    res.json(ledger.item_after);
  } catch (ledgerErr) {
    if (ledgerErr.code === 'LEDGER_ITEM_NOT_FOUND') return res.status(404).json({ error: 'Product not found' });
    if (ledgerErr.code === 'LEDGER_NEGATIVE_STOCK') return res.status(400).json({ error: ledgerErr.message });
    res.status(500).json({ error: ledgerErr.message });
  }
});

// POST /api/inventory/:id/spoilage — record spoiled/wasted inventory
router.post('/:id/spoilage', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const qty = parseFloat(req.body.qty);
  if (!qty || qty <= 0) return res.status(400).json({ error: 'qty must be > 0' });
  const reason = String(req.body.reason || '').trim();
  const notes = String(req.body.notes || '').trim();

  try {
    const ledger = await applyInventoryLedgerEntry({
      itemNumber: req.params.id,
      deltaQty: -qty,
      changeType: 'spoilage',
      notes: [reason ? `Reason: ${reason}` : null, notes || null].filter(Boolean).join(' | ') || 'Spoilage',
      createdBy: req.user.name || req.user.email,
    });
    res.json(ledger.item_after);
  } catch (ledgerErr) {
    if (ledgerErr.code === 'LEDGER_ITEM_NOT_FOUND') return res.status(404).json({ error: 'Product not found' });
    if (ledgerErr.code === 'LEDGER_NEGATIVE_STOCK') return res.status(400).json({ error: ledgerErr.message });
    res.status(500).json({ error: ledgerErr.message });
  }
});

// POST /api/inventory/transfer — move stock from one item to another item
router.post('/transfer', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const fromItemNumber = String(req.body.from_item_number || '').trim();
  const toItemNumber = String(req.body.to_item_number || '').trim();
  const qty = parseFloat(req.body.qty);
  const notes = String(req.body.notes || '').trim();
  if (!fromItemNumber || !toItemNumber) {
    return res.status(400).json({ error: 'from_item_number and to_item_number are required' });
  }
  if (!qty || qty <= 0) return res.status(400).json({ error: 'qty must be > 0' });

  try {
    const result = await transferInventoryLedgerEntry({
      fromItemNumber,
      toItemNumber,
      qty,
      notes,
      createdBy: req.user.name || req.user.email,
    });
    res.json(result);
  } catch (ledgerErr) {
    if (ledgerErr.code === 'LEDGER_ITEM_NOT_FOUND') return res.status(404).json({ error: ledgerErr.message });
    if (ledgerErr.code === 'LEDGER_NEGATIVE_STOCK' || ledgerErr.code === 'LEDGER_INVALID_TRANSFER_TARGET') {
      return res.status(400).json({ error: ledgerErr.message });
    }
    res.status(500).json({ error: ledgerErr.message });
  }
});

// GET /api/inventory/ledger — unified stock movement ledger
router.get('/ledger', authenticateToken, async (req, res) => {
  const limit = Math.max(1, Math.min(parseInt(req.query.limit || '200', 10), 500));
  const itemNumber = String(req.query.item_number || '').trim();
  const changeType = String(req.query.change_type || '').trim().toLowerCase();

  let query = supabase
    .from('inventory_stock_history')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (itemNumber) query = query.eq('item_number', itemNumber);
  if (changeType) query = query.eq('change_type', changeType);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const rows = Array.isArray(data) ? data : [];
  const summary = rows.reduce((acc, row) => {
    const delta = toNumber(row.change_qty, 0);
    acc.total_delta = parseFloat((acc.total_delta + delta).toFixed(4));
    acc.inbound_qty = parseFloat((acc.inbound_qty + (delta > 0 ? delta : 0)).toFixed(4));
    acc.outbound_qty = parseFloat((acc.outbound_qty + (delta < 0 ? Math.abs(delta) : 0)).toFixed(4));
    return acc;
  }, { count: rows.length, total_delta: 0, inbound_qty: 0, outbound_qty: 0 });

  res.json({ summary, entries: rows });
});

// GET /api/inventory/:id/history — stock movement log
router.get('/:id/history', authenticateToken, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const { data, error } = await supabase
    .from('inventory_stock_history')
    .select('*')
    .eq('item_number', req.params.id)
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
    item_number:  req.params.id,
    raw_weight:   raw,
    yield_weight: yielded,
    yield_pct,
    notes: notes || null,
    logged_by: req.user.name || req.user.email,
  }]);

  const { data: item, error: fetchErr } = await supabase
    .from('seafood_inventory')
    .select('avg_yield,yield_count')
    .eq('item_number', req.params.id).single();
  if (fetchErr) return res.status(404).json({ error: 'Product not found' });

  const n      = (item?.yield_count || 0) + 1;
  const newAvg = parseFloat((((item?.avg_yield || 0) * (n - 1) + yield_pct) / n).toFixed(2));

  const { data, error } = await supabase
    .from('seafood_inventory')
    .update({ avg_yield: newAvg, yield_count: n, updated_at: new Date().toISOString() })
    .eq('item_number', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  res.json({ ...data, yield_pct, sample_count: n });
});

// GET /api/inventory/:id/yield — yield history for a product
router.get('/:id/yield', authenticateToken, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const { data, error } = await supabase
    .from('inventory_yield_log')
    .select('*')
    .eq('item_number', req.params.id)
    .order('logged_at', { ascending: false })
    .limit(limit);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/inventory/:id/reorder-alert — AI-generated reorder alert, optionally emailed
router.post('/:id/reorder-alert', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { email } = req.body;

  const { data: product, error: pErr } = await supabase
    .from('seafood_inventory')
    .select('item_number,description,unit,on_hand_qty,cost')
    .eq('item_number', req.params.id)
    .single();
  if (pErr || !product) return res.status(404).json({ error: 'Product not found' });

  // Compute daily usage from last 30 days
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data: history } = await supabase
    .from('inventory_stock_history')
    .select('change_qty,created_at')
    .eq('item_number', req.params.id)
    .lt('change_qty', 0)
    .gte('created_at', since);

  const totalUsed  = (history || []).reduce((s, h) => s + Math.abs(parseFloat(h.change_qty)), 0);
  const dailyUsage = parseFloat((totalUsed / 30).toFixed(4));
  const reorderQty = req.body.reorder_qty || Math.round(dailyUsage * 14); // 2-week supply default

  // Find soonest active expiry
  const { data: lots } = await supabase
    .from('inventory_lots')
    .select('expiry_date')
    .eq('item_number', req.params.id)
    .eq('status', 'active')
    .not('expiry_date', 'is', null)
    .order('expiry_date', { ascending: true })
    .limit(1);
  const expiryDate = lots?.[0]?.expiry_date || null;

  try {
    const alert = await generateReorderAlert(product, dailyUsage, reorderQty, expiryDate);

    if (email) {
      const mailer = createMailer();
      if (mailer) {
        await mailer.sendMail({
          from: process.env.EMAIL_FROM,
          to:   email,
          subject: alert.subject,
          text:    alert.body,
          html:    `<div style="font-family:sans-serif;font-size:14px;color:#111;padding:16px">${alert.body.replace(/\n/g, '<br>')}</div>`,
        });
        return res.json({ ...alert, emailed: true, to: email });
      }
    }

    res.json({ ...alert, emailed: false });
  } catch (err) {
    if (err.message.includes('OPENAI_API_KEY')) return res.status(503).json({ error: err.message });
    res.status(500).json({ error: 'Alert generation failed: ' + err.message });
  }
});

// ── EXISTING CRUD (must come after named sub-routes) ─────────────────────────

router.patch('/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const existing = await dbQuery(supabase.from('seafood_inventory').select('*').eq('item_number', req.params.id).single(), res);
  if (!existing) return res.status(404).json({ error: 'Product not found' });
  if (!rowMatchesContext(existing, req.context)) return res.status(403).json({ error: 'Forbidden' });
  const allowed = ['description','category','item_number','unit','cost','on_hand_qty','on_hand_weight','lot_item','notes'];
  const fields = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) fields[k] = req.body[k]; });
  // Auto-enforce lot requirement when description is updated
  if (fields.description && needsLot(fields.description)) fields.lot_item = 'Y';
  const data = await dbQuery(supabase.from('seafood_inventory').update(fields).eq('item_number', req.params.id).select().single(), res);
  if (!data) return;
  res.json(data);
});

router.delete('/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const existing = await dbQuery(supabase.from('seafood_inventory').select('*').eq('item_number', req.params.id).single(), res);
  if (!existing) return res.status(404).json({ error: 'Product not found' });
  if (!rowMatchesContext(existing, req.context)) return res.status(403).json({ error: 'Forbidden' });
  const data = await dbQuery(supabase.from('seafood_inventory').delete().eq('item_number', req.params.id), res);
  if (data === null) return;
  res.json({ message: 'Deleted' });
});

module.exports = router;
