const express = require('express');
const { supabase } = require('../../services/supabase');
const { authenticateToken, requireRole } = require('../../middleware/auth');
const { applyInventoryLedgerEntry } = require('../../services/inventory-ledger');
const {
  buildScopeFields,
  filterRowsByContext,
  insertRecordWithOptionalScope,
  rowMatchesContext,
} = require('../../services/operating-context');
const { toNumber } = require('./store');

const STATIC_CAPABILITIES = {
  catch_weight_management: true,
  lot_control_traceability: true,
  case_breaks_uom: true,
  inventory_projection_30_day: true,
  automated_purchasing: true,
  vendor_purchase_orders: true,
  purchasing_receiving_workflow: true,
  weighted_inventory_cost_updates: true,
  warehouse_barcode_android: true,
  realtime_inventory_mobile: true,
  multi_warehouse_cycle_count_returns: true,
  online_order_entry_edi_customer_portal: true,
};

module.exports = function buildOpsAdminRouter() {
  const router = express.Router();

  // ── UOM rules ────────────────────────────────────────────────────────────────
  router.get('/uom-rules', authenticateToken, async (req, res) => {
    const { data, error } = await supabase
      .from('op_uom_rules')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(filterRowsByContext(data || [], req.context));
  });

  router.post('/uom-rules', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
    const { productName, fromUnit, toUnit, factor, notes } = req.body;
    if (!productName || !fromUnit || !toUnit) {
      return res.status(400).json({ error: 'productName, fromUnit, and toUnit are required' });
    }
    const parsedFactor = toNumber(factor, NaN);
    if (!Number.isFinite(parsedFactor) || parsedFactor <= 0) {
      return res.status(400).json({ error: 'factor must be a positive number' });
    }

    const result = await insertRecordWithOptionalScope(supabase, 'op_uom_rules', {
      product_name: productName.trim(),
      from_unit: fromUnit.trim().toLowerCase(),
      to_unit: toUnit.trim().toLowerCase(),
      factor: parsedFactor,
      notes: (notes || '').trim() || null,
    }, req.context);
    if (result.error) return res.status(500).json({ error: result.error.message });
    res.json(result.data);
  });

  router.delete('/uom-rules/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
    const { data: existing, error: fetchErr } = await supabase
      .from('op_uom_rules').select('*').eq('id', req.params.id).single();
    if (fetchErr) return res.status(404).json({ error: 'Rule not found' });
    if (!rowMatchesContext(existing, req.context)) return res.status(403).json({ error: 'Forbidden' });

    const { error } = await supabase.from('op_uom_rules').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: 'Rule deleted' });
  });

  // ── Warehouses (ops admin view) ─────────────────────────────────────────────
  router.get('/warehouses', authenticateToken, async (req, res) => {
    const { data, error } = await supabase
      .from('op_warehouses')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json(filterRowsByContext(data || [], req.context));
  });

  router.post('/warehouses', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
    const { name, code } = req.body;
    if (!name) return res.status(400).json({ error: 'Warehouse name required' });

    const result = await insertRecordWithOptionalScope(supabase, 'op_warehouses', {
      name: name.trim(),
      code: (code || name).toString().trim().toUpperCase().slice(0, 10),
      is_default: false,
    }, req.context);
    if (result.error) return res.status(500).json({ error: result.error.message });
    res.json(result.data);
  });

  // ── Vendors (delegates to canonical vendors table) ──────────────────────────
  // Returns the same vendors used by purchase orders, with optional lead-time.
  router.get('/vendors', authenticateToken, async (req, res) => {
    const { data, error } = await supabase
      .from('vendors')
      .select('id, name, contact, email, phone, category, payment_terms, lead_time_days, status, notes, company_id, location_id, created_at, updated_at')
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(filterRowsByContext(data || [], req.context));
  });

  router.post('/vendors', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
    const vendorName = String(req.body.vendorName || req.body.name || '').trim();
    if (!vendorName) return res.status(400).json({ error: 'Vendor name required' });

    const leadTimeDays = Math.max(0, Math.min(365, parseInt(req.body.leadTimeDays || '0', 10) || 0));
    const result = await insertRecordWithOptionalScope(supabase, 'vendors', {
      name: vendorName,
      contact: String(req.body.contactName || '').trim() || null,
      email: String(req.body.email || '').trim() || null,
      phone: String(req.body.phone || '').trim() || null,
      payment_terms: String(req.body.paymentTerms || '').trim() || null,
      lead_time_days: leadTimeDays || null,
      notes: String(req.body.notes || '').trim() || null,
      status: 'active',
    }, req.context);
    if (result.error) return res.status(500).json({ error: result.error.message });
    res.json(result.data);
  });

  // ── Cycle counts ────────────────────────────────────────────────────────────
  router.get('/cycle-counts', authenticateToken, async (req, res) => {
    const { data, error } = await supabase
      .from('op_cycle_counts')
      .select('*')
      .order('counted_at', { ascending: false })
      .limit(200);
    if (error) return res.status(500).json({ error: error.message });
    res.json(filterRowsByContext(data || [], req.context));
  });

  router.post('/cycle-counts', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
    const { warehouseId, countedItems, replaceStock } = req.body;
    if (!Array.isArray(countedItems) || countedItems.length === 0) {
      return res.status(400).json({ error: 'countedItems is required' });
    }

    const { data: inventory, error: invErr } = await supabase.from('products').select('*');
    if (invErr) return res.status(500).json({ error: invErr.message });

    const scopedInventory = filterRowsByContext(inventory || [], req.context);
    const inventoryById = new Map(scopedInventory.map((item) => [String(item.id), item]));
    const inventoryByName = new Map(scopedInventory.map((item) => [String(item.name || item.description || '').toLowerCase(), item]));

    const normalized = countedItems.map((raw) => {
      const countedQty = toNumber(raw.counted_qty ?? raw.countedQty, NaN);
      if (!Number.isFinite(countedQty)) return null;
      const product = raw.product_id ? inventoryById.get(String(raw.product_id)) : inventoryByName.get(String(raw.product_name || '').toLowerCase());
      const systemQty = toNumber(product?.stock_qty ?? product?.on_hand_qty, 0);
      return {
        product_id: product?.id || raw.product_id || null,
        item_number: product?.item_number || null,
        product_name: product?.name || product?.description || raw.product_name || 'Unknown',
        system_qty: systemQty,
        counted_qty: countedQty,
        variance_qty: parseFloat((countedQty - systemQty).toFixed(3)),
      };
    }).filter(Boolean);

    if (replaceStock) {
      for (const line of normalized) {
        if (!line.item_number) continue;
        await applyInventoryLedgerEntry({
          itemNumber: line.item_number,
          changeType: 'count',
          notes: `Cycle count (warehouse ${warehouseId || 'wh-main'})`,
          createdBy: req.user?.name || req.user?.email || 'system',
          setAbsoluteQty: line.counted_qty,
          preventNegative: false,
          context: req.context,
        });
      }
    }

    const result = await insertRecordWithOptionalScope(supabase, 'op_cycle_counts', {
      warehouse_id: warehouseId || 'wh-main',
      replace_stock: !!replaceStock,
      lines: normalized,
      counted_by: req.user?.name || req.user?.email || 'system',
      counted_at: new Date().toISOString(),
    }, req.context);
    if (result.error) return res.status(500).json({ error: result.error.message });
    res.json(result.data);
  });

  // ── Returns (ops admin simplified log) ──────────────────────────────────────
  router.get('/returns', authenticateToken, async (req, res) => {
    const { data, error } = await supabase
      .from('op_returns')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) return res.status(500).json({ error: error.message });
    res.json(filterRowsByContext(data || [], req.context));
  });

  router.post('/returns', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
    const { customerName, productName, quantity, reason, status } = req.body;
    if (!customerName || !productName) return res.status(400).json({ error: 'customerName and productName are required' });

    const result = await insertRecordWithOptionalScope(supabase, 'op_returns', {
      customer_name: customerName.trim(),
      product_name: productName.trim(),
      quantity: toNumber(quantity, 0),
      reason: (reason || '').trim() || null,
      status: status || 'open',
    }, req.context);
    if (result.error) return res.status(500).json({ error: result.error.message });
    res.json(result.data);
  });

  // ── Barcode events ──────────────────────────────────────────────────────────
  router.get('/barcode-events', authenticateToken, async (req, res) => {
    const { data, error } = await supabase
      .from('op_barcode_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) return res.status(500).json({ error: error.message });
    res.json(filterRowsByContext(data || [], req.context));
  });

  router.post('/barcode-events', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
    const { code, action, quantity, itemName, warehouseId } = req.body;
    if (!code) return res.status(400).json({ error: 'code is required' });

    const result = await insertRecordWithOptionalScope(supabase, 'op_barcode_events', {
      code: String(code),
      action: action || 'scan',
      quantity: toNumber(quantity, 0),
      item_name: (itemName || '').trim() || null,
      warehouse_id: warehouseId || 'wh-main',
      created_by: req.user?.name || req.user?.email || 'system',
    }, req.context);
    if (result.error) return res.status(500).json({ error: result.error.message });
    res.json(result.data);
  });

  // ── EDI jobs ────────────────────────────────────────────────────────────────
  router.get('/edi-jobs', authenticateToken, async (req, res) => {
    const { data, error } = await supabase
      .from('op_edi_jobs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) return res.status(500).json({ error: error.message });
    res.json(filterRowsByContext(data || [], req.context));
  });

  router.post('/edi-jobs', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
    const { direction, partner, docType } = req.body;
    if (!direction || !partner || !docType) {
      return res.status(400).json({ error: 'direction, partner, and docType are required' });
    }

    const result = await insertRecordWithOptionalScope(supabase, 'op_edi_jobs', {
      direction,
      partner,
      doc_type: docType,
      status: 'queued',
    }, req.context);
    if (result.error) return res.status(500).json({ error: result.error.message });
    res.json(result.data);
  });

  // ── Capabilities (static) ───────────────────────────────────────────────────
  router.get('/capabilities', authenticateToken, (req, res) => {
    res.json(STATIC_CAPABILITIES);
  });

  return router;
};
