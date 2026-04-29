const express = require('express');
const { supabase } = require('../../services/supabase');
const { authenticateToken, requireRole } = require('../../middleware/auth');
const { applyInventoryLedgerEntry } = require('../../services/inventory-ledger');
const { genId, readOpsData, toNumber, writeOpsData } = require('./store');

module.exports = function buildOpsAdminRouter() {
  const router = express.Router();

  router.get('/uom-rules', authenticateToken, (req, res) => {
    const ops = readOpsData();
    res.json(ops.uomRules || []);
  });

  router.post('/uom-rules', authenticateToken, requireRole('admin', 'manager'), (req, res) => {
    const { productName, fromUnit, toUnit, factor, notes } = req.body;
    if (!productName || !fromUnit || !toUnit) return res.status(400).json({ error: 'productName, fromUnit, and toUnit are required' });
    const parsedFactor = toNumber(factor, NaN);
    if (!Number.isFinite(parsedFactor) || parsedFactor <= 0) return res.status(400).json({ error: 'factor must be a positive number' });

    const ops = readOpsData();
    const rule = {
      id: genId('uom'),
      product_name: productName.trim(),
      from_unit: fromUnit.trim().toLowerCase(),
      to_unit: toUnit.trim().toLowerCase(),
      factor: parsedFactor,
      notes: (notes || '').trim(),
      created_at: new Date().toISOString(),
    };
    ops.uomRules.unshift(rule);
    writeOpsData(ops);
    res.json(rule);
  });

  router.delete('/uom-rules/:id', authenticateToken, requireRole('admin', 'manager'), (req, res) => {
    const ops = readOpsData();
    ops.uomRules = (ops.uomRules || []).filter((rule) => rule.id !== req.params.id);
    writeOpsData(ops);
    res.json({ message: 'Rule deleted' });
  });

  router.get('/warehouses', authenticateToken, (req, res) => {
    const ops = readOpsData();
    res.json(ops.warehouses || []);
  });

  router.post('/warehouses', authenticateToken, requireRole('admin', 'manager'), (req, res) => {
    const { name, code } = req.body;
    if (!name) return res.status(400).json({ error: 'Warehouse name required' });

    const ops = readOpsData();
    const warehouse = {
      id: genId('wh'),
      name: name.trim(),
      code: (code || name).toString().trim().toUpperCase().slice(0, 10),
      isDefault: false,
      created_at: new Date().toISOString(),
    };
    ops.warehouses.push(warehouse);
    writeOpsData(ops);
    res.json(warehouse);
  });

  router.get('/vendors', authenticateToken, (req, res) => {
    const ops = readOpsData();
    res.json(ops.vendors || []);
  });

  router.post('/vendors', authenticateToken, requireRole('admin', 'manager'), (req, res) => {
    const vendorName = String(req.body.vendorName || req.body.name || '').trim();
    if (!vendorName) return res.status(400).json({ error: 'Vendor name required' });

    const leadTimeDays = Math.max(0, Math.min(365, parseInt(req.body.leadTimeDays || '0', 10) || 0));
    const ops = readOpsData();
    ops.vendors = ops.vendors || [];
    const vendor = {
      id: genId('ven'),
      name: vendorName,
      contact_name: String(req.body.contactName || '').trim() || null,
      email: String(req.body.email || '').trim() || null,
      phone: String(req.body.phone || '').trim() || null,
      payment_terms: String(req.body.paymentTerms || '').trim() || null,
      lead_time_days: leadTimeDays || null,
      notes: String(req.body.notes || '').trim() || null,
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    ops.vendors.unshift(vendor);
    writeOpsData(ops);
    res.json(vendor);
  });

  router.get('/cycle-counts', authenticateToken, (req, res) => {
    const ops = readOpsData();
    res.json(ops.cycleCounts || []);
  });

  router.post('/cycle-counts', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
    const { warehouseId, countedItems, replaceStock } = req.body;
    if (!Array.isArray(countedItems) || countedItems.length === 0) return res.status(400).json({ error: 'countedItems is required' });

    const { data: inventory, error: invErr } = await supabase.from('seafood_inventory').select('*');
    if (invErr) return res.status(500).json({ error: invErr.message });

    const inventoryById = new Map((inventory || []).map((item) => [String(item.id), item]));
    const inventoryByName = new Map((inventory || []).map((item) => [String(item.name || item.description || '').toLowerCase(), item]));

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

    const countRecord = {
      id: genId('cc'),
      warehouse_id: warehouseId || 'wh-main',
      replace_stock: !!replaceStock,
      counted_at: new Date().toISOString(),
      lines: normalized,
    };

    if (replaceStock) {
      for (const line of normalized) {
        if (!line.item_number) continue;
        await applyInventoryLedgerEntry({
          itemNumber: line.item_number,
          changeType: 'count',
          notes: `Cycle count ${countRecord.id}`,
          createdBy: req.user?.name || req.user?.email || 'system',
          setAbsoluteQty: line.counted_qty,
          preventNegative: false,
        });
      }
    }

    const ops = readOpsData();
    ops.cycleCounts.unshift(countRecord);
    writeOpsData(ops);
    res.json(countRecord);
  });

  router.get('/returns', authenticateToken, (req, res) => {
    const ops = readOpsData();
    res.json(ops.returns || []);
  });

  router.post('/returns', authenticateToken, requireRole('admin', 'manager'), (req, res) => {
    const { customerName, productName, quantity, reason, status } = req.body;
    if (!customerName || !productName) return res.status(400).json({ error: 'customerName and productName are required' });

    const ops = readOpsData();
    const record = {
      id: genId('ret'),
      customer_name: customerName.trim(),
      product_name: productName.trim(),
      quantity: toNumber(quantity, 0),
      reason: (reason || '').trim(),
      status: status || 'open',
      created_at: new Date().toISOString(),
    };
    ops.returns.unshift(record);
    writeOpsData(ops);
    res.json(record);
  });

  router.get('/barcode-events', authenticateToken, (req, res) => {
    const ops = readOpsData();
    res.json((ops.barcodeEvents || []).slice(0, 200));
  });

  router.post('/barcode-events', authenticateToken, requireRole('admin', 'manager'), (req, res) => {
    const { code, action, quantity, itemName, warehouseId } = req.body;
    if (!code) return res.status(400).json({ error: 'code is required' });

    const ops = readOpsData();
    const event = {
      id: genId('scan'),
      code: String(code),
      action: action || 'scan',
      quantity: toNumber(quantity, 0),
      item_name: (itemName || '').trim(),
      warehouse_id: warehouseId || 'wh-main',
      created_at: new Date().toISOString(),
      user: req.user.name,
    };
    ops.barcodeEvents.unshift(event);
    writeOpsData(ops);
    res.json(event);
  });

  router.get('/edi-jobs', authenticateToken, (req, res) => {
    const ops = readOpsData();
    res.json(ops.ediJobs || []);
  });

  router.post('/edi-jobs', authenticateToken, requireRole('admin', 'manager'), (req, res) => {
    const { direction, partner, docType } = req.body;
    if (!direction || !partner || !docType) return res.status(400).json({ error: 'direction, partner, and docType are required' });

    const ops = readOpsData();
    const job = {
      id: genId('edi'),
      direction,
      partner,
      doc_type: docType,
      status: 'queued',
      created_at: new Date().toISOString(),
    };
    ops.ediJobs.unshift(job);
    writeOpsData(ops);
    res.json(job);
  });

  router.get('/capabilities', authenticateToken, (req, res) => {
    res.json({
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
    });
  });

  return router;
};
