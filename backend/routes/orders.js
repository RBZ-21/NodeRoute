const express = require('express');
const crypto = require('crypto');
const { supabase, dbQuery } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { applyInventoryLedgerEntry } = require('../services/inventory-ledger');
const {
  executeWithOptionalScope,
  filterRowsByContext,
  insertRecordWithOptionalScope,
  rowMatchesContext,
} = require('../services/operating-context');

const router = express.Router();

function generateTrackingToken() {
  return crypto.randomBytes(18).toString('hex');
}

function trackingExpiry(days = 7) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function buildTrackingUrl(req, token) {
  const fallbackBase = `${req.protocol}://${req.get('host')}`;
  const baseUrl = (process.env.BASE_URL || fallbackBase).replace(/\/$/, '');
  return `${baseUrl}/track?t=${encodeURIComponent(token)}`;
}

const DEFAULT_TAX_RATE = 0.09;

function parseBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1' || value === 'on';
}

function asMoney(value) {
  return parseFloat((parseFloat(value || 0) || 0).toFixed(2));
}

function normalizeTaxRate(value) {
  const rate = parseFloat(value);
  return Number.isFinite(rate) && rate >= 0 ? rate : DEFAULT_TAX_RATE;
}

function itemQuantity(item) {
  if (item?.unit === 'lb') return parseFloat(item.actual_weight || item.requested_weight || 0) || 0;
  return parseFloat(item?.requested_qty || item?.quantity || 0) || 0;
}

async function findInventoryMatchForFulfillment(item) {
  const explicitItemNumber = String(item?.item_number || '').trim();
  if (explicitItemNumber) {
    const byNumber = await supabase
      .from('seafood_inventory')
      .select('item_number,description,on_hand_qty,cost')
      .eq('item_number', explicitItemNumber)
      .single();
    if (!byNumber.error && byNumber.data) return byNumber.data;
  }

  const name = String(item?.name || item?.description || '').trim();
  if (!name) return null;
  const byName = await supabase
    .from('seafood_inventory')
    .select('item_number,description,on_hand_qty,cost')
    .ilike('description', name)
    .limit(1);
  if (byName.error || !Array.isArray(byName.data) || !byName.data.length) return null;
  return byName.data[0];
}

function invoiceItemsFromOrder(order, fulfilledItems) {
  const sourceItems = Array.isArray(fulfilledItems) ? fulfilledItems : (order.items || []);
  const invoiceItems = sourceItems.map((it) => {
    const qty = itemQuantity(it);
    const unitPrice = parseFloat(it.unit_price || it.unitPrice || 0) || 0;
    return {
      description: it.name || it.description || '',
      notes: it.notes || null,
      quantity: qty,
      requested_weight: it.requested_weight || null,
      actual_weight: it.actual_weight || null,
      unit: it.unit || (it.requested_weight ? 'lb' : 'each'),
      unit_price: unitPrice,
      total: asMoney(qty * unitPrice),
    };
  });

  (Array.isArray(order.charges) ? order.charges : []).forEach((charge) => {
    const amount = asMoney(charge.amount);
    if (amount > 0) {
      invoiceItems.push({
        description: charge.label || 'Additional Charge',
        notes: charge.type === 'percent' ? `${charge.value}%` : null,
        quantity: 1,
        unit: 'charge',
        unit_price: amount,
        total: amount,
      });
    }
  });

  return invoiceItems;
}

function totalsForItems(items, taxEnabled, taxRate) {
  const subtotal = asMoney((items || []).reduce((sum, item) => sum + (parseFloat(item.total || 0) || 0), 0));
  const tax = taxEnabled ? asMoney(subtotal * taxRate) : 0;
  return { subtotal, tax, total: asMoney(subtotal + tax) };
}

function invoicePayloadForOrder(order, fulfilledItems = null, overrides = {}) {
  const taxEnabled = parseBoolean(order.tax_enabled);
  const taxRate = normalizeTaxRate(order.tax_rate);
  const items = invoiceItemsFromOrder(order, fulfilledItems);
  const totals = totalsForItems(items, taxEnabled, taxRate);
  return {
    invoice_number: overrides.invoice_number || `INV-${Date.now().toString().slice(-6)}`,
    customer_name: order.customer_name,
    customer_email: order.customer_email,
    customer_address: order.customer_address,
    items,
    ...totals,
    tax_enabled: taxEnabled,
    tax_rate: taxRate,
    order_id: order.id,
    driver_name: overrides.driverName || order.driver_name || null,
    status: 'pending',
    notes: overrides.notes !== undefined ? overrides.notes : order.notes || 'Awaiting final weights',
  };
}

async function updateRecord(table, id, payload, res) {
  const updateResult = await executeWithOptionalScope(
    (candidate) => supabase.from(table).update(candidate).eq('id', id).select().single(),
    payload
  );
  if (updateResult.error) {
    if (res) res.status(500).json({ error: updateResult.error.message });
    return null;
  }
  return updateResult.data;
}

async function findInvoiceForOrder(order) {
  if (order.invoice_id) {
    const byId = await supabase.from('invoices').select('*').eq('id', order.invoice_id).single();
    if (!byId.error && byId.data) return byId.data;
  }

  const byOrderId = await supabase.from('invoices').select('*').eq('order_id', order.id).limit(1);
  if (!byOrderId.error && Array.isArray(byOrderId.data) && byOrderId.data.length) {
    return byOrderId.data[0];
  }
  return null;
}

async function createOrUpdateProcessingInvoice(order, fulfilledItems, overrides, req, res) {
  const existingInvoice = await findInvoiceForOrder(order);
  const invoiceOrder = { ...order };
  if (existingInvoice?.id && invoiceOrder.tax_enabled === undefined) {
    invoiceOrder.tax_enabled = existingInvoice.tax_enabled ?? (parseFloat(existingInvoice.tax || 0) > 0);
  }
  if (existingInvoice?.id && invoiceOrder.tax_rate === undefined) {
    invoiceOrder.tax_rate = existingInvoice.tax_rate ?? DEFAULT_TAX_RATE;
  }
  const payload = invoicePayloadForOrder(
    invoiceOrder,
    fulfilledItems,
    existingInvoice ? { ...overrides, invoice_number: existingInvoice.invoice_number } : overrides
  );

  if (existingInvoice?.id) {
    return updateRecord('invoices', existingInvoice.id, payload, res);
  }

  const invoiceInsert = await insertRecordWithOptionalScope(supabase, 'invoices', payload, req.context);
  if (invoiceInsert.error) {
    if (res) res.status(500).json({ error: invoiceInsert.error.message });
    return null;
  }
  return invoiceInsert.data;
}

// ── ORDERS ────────────────────────────────────────────────────────────────────
router.get('/', authenticateToken, async (req, res) => {
  const data = await dbQuery(supabase.from('orders').select('*').order('created_at', { ascending: false }), res);
  if (!data) return;
  res.json(filterRowsByContext(data || [], req.context));
});

router.post('/', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { customerName, customerEmail, customerAddress, items, charges, notes } = req.body;

  // Block orders for customers on credit hold
  if (customerName) {
    const { data: heldCustomer } = await supabase
      .from('Customers')
      .select('id, company_name, credit_hold, credit_hold_reason')
      .ilike('company_name', customerName.trim())
      .eq('credit_hold', true)
      .limit(1)
      .maybeSingle();
    if (heldCustomer) {
      const reason = heldCustomer.credit_hold_reason ? ` Reason: ${heldCustomer.credit_hold_reason}` : '';
      return res.status(422).json({
        error: `Order blocked: ${heldCustomer.company_name} is on credit hold.${reason}`,
        code: 'CUSTOMER_CREDIT_HOLD',
      });
    }
  }

  const orderNumber = 'ORD-' + Date.now().toString().slice(-6);
  const trackingToken = generateTrackingToken();
  const taxEnabled = parseBoolean(req.body.taxEnabled ?? req.body.tax_enabled);
  const taxRate = normalizeTaxRate(req.body.taxRate ?? req.body.tax_rate);
  const insertResult = await insertRecordWithOptionalScope(supabase, 'orders', {
    order_number: orderNumber,
    customer_name: customerName,
    customer_email: customerEmail || null,
    customer_address: customerAddress || null,
    items: items || [],
    charges: Array.isArray(charges) ? charges : [],
    status: 'pending',
    notes: notes || null,
    tax_enabled: taxEnabled,
    tax_rate: taxRate,
    driver_name: null,
    route_id: null,
    tracking_token: trackingToken,
    tracking_expires_at: trackingExpiry(),
  }, req.context);
  if (insertResult.error) return res.status(500).json({ error: insertResult.error.message });
  const data = insertResult.data;
  if (!data) return;
  res.json({
    ...data,
    tracking_url: data.tracking_token ? buildTrackingUrl(req, data.tracking_token) : null,
  });
});

router.patch('/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const existing = await dbQuery(supabase.from('orders').select('*').eq('id', req.params.id).single(), res);
  if (!existing) return res.status(404).json({ error: 'Order not found' });
  if (!rowMatchesContext(existing, req.context)) return res.status(403).json({ error: 'Forbidden' });
  const updates = {};
  if (req.body.customerName !== undefined) updates.customer_name = req.body.customerName;
  if (req.body.customerEmail !== undefined) updates.customer_email = req.body.customerEmail || null;
  if (req.body.customerAddress !== undefined) updates.customer_address = req.body.customerAddress || null;
  if (req.body.items !== undefined) updates.items = req.body.items;
  if (req.body.charges !== undefined) updates.charges = Array.isArray(req.body.charges) ? req.body.charges : [];
  if (req.body.status !== undefined) updates.status = req.body.status;
  if (req.body.driverName !== undefined) updates.driver_name = req.body.driverName;
  if (req.body.routeId !== undefined) updates.route_id = req.body.routeId;
  if (req.body.notes !== undefined) updates.notes = req.body.notes;
  if (req.body.taxEnabled !== undefined || req.body.tax_enabled !== undefined) {
    updates.tax_enabled = parseBoolean(req.body.taxEnabled ?? req.body.tax_enabled);
  }
  if (req.body.taxRate !== undefined || req.body.tax_rate !== undefined) {
    updates.tax_rate = normalizeTaxRate(req.body.taxRate ?? req.body.tax_rate);
  }
  const data = await updateRecord('orders', req.params.id, updates, res);
  if (!data) return;
  res.json(data);
});

router.delete('/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const existing = await dbQuery(supabase.from('orders').select('*').eq('id', req.params.id).single(), res);
  if (!existing) return res.status(404).json({ error: 'Order not found' });
  if (!rowMatchesContext(existing, req.context)) return res.status(403).json({ error: 'Forbidden' });
  const data = await dbQuery(supabase.from('orders').delete().eq('id', req.params.id), res);
  if (data === null) return;
  res.json({ message: 'Order deleted' });
});

// Send order to processing: creates/updates the pending invoice draft and marks the order ready for weights.
router.post('/:id/send', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const existing = await dbQuery(supabase.from('orders').select('*').eq('id', req.params.id).single(), res);
  if (!existing) return res.status(404).json({ error: 'Order not found' });
  if (!rowMatchesContext(existing, req.context)) return res.status(403).json({ error: 'Forbidden' });

  const effectiveOrder = { ...existing };
  if (req.body.taxEnabled !== undefined || req.body.tax_enabled !== undefined) {
    effectiveOrder.tax_enabled = parseBoolean(req.body.taxEnabled ?? req.body.tax_enabled);
  }
  if (req.body.taxRate !== undefined || req.body.tax_rate !== undefined) {
    effectiveOrder.tax_rate = normalizeTaxRate(req.body.taxRate ?? req.body.tax_rate);
  }
  const invoice = await createOrUpdateProcessingInvoice(effectiveOrder, null, { notes: existing.notes || 'Awaiting final weights' }, req, res);
  if (!invoice) return;
  const trackingToken = existing.tracking_token || generateTrackingToken();
  const trackingExpiresAt = existing.tracking_expires_at || trackingExpiry();
  const data = await updateRecord('orders', req.params.id, {
    status: 'in_process',
    invoice_id: invoice.id,
    tracking_token: trackingToken,
    tracking_expires_at: trackingExpiresAt,
  }, res);
  if (!data) return;
  res.json({
    ...data,
    invoice,
    tracking_url: buildTrackingUrl(req, trackingToken),
  });
});

// Fulfill order: enter actual weights → generate invoice
router.post('/:id/fulfill', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { items, driverName, routeId } = req.body;
  const order = await dbQuery(supabase.from('orders').select('*').eq('id', req.params.id).single(), res);
  if (!order) return;
  if (!rowMatchesContext(order, req.context)) return res.status(403).json({ error: 'Forbidden' });
  const fulfilledItems = Array.isArray(items) ? items : (order.items || []);
  const invoice = await createOrUpdateProcessingInvoice(
    order,
    fulfilledItems,
    { driverName: driverName || null, notes: order.notes || null },
    req,
    res
  );
  if (!invoice) return;
  const trackingToken = order.tracking_token || generateTrackingToken();
  const trackingExpiresAt = order.tracking_expires_at || trackingExpiry();

  const pickFailures = [];
  for (const item of fulfilledItems) {
    const qty = itemQuantity(item);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const inventoryMatch = await findInventoryMatchForFulfillment(item);
    if (!inventoryMatch?.item_number) continue;
    try {
      await applyInventoryLedgerEntry({
        itemNumber: inventoryMatch.item_number,
        deltaQty: -qty,
        changeType: 'pick',
        notes: `Order ${order.order_number || order.id} fulfill pick`,
        createdBy: req.user?.name || req.user?.email || 'system',
      });
    } catch (ledgerErr) {
      pickFailures.push({
        item_number: inventoryMatch.item_number,
        item_name: item.name || item.description || null,
        error: ledgerErr.message,
      });
    }
  }

  if (pickFailures.length) {
    return res.status(409).json({
      error: 'One or more picks could not be posted to inventory',
      code: 'PICK_LEDGER_FAILED',
      failures: pickFailures,
    });
  }

  const orderUpdate = await executeWithOptionalScope((candidate) => supabase.from('orders').update(candidate).eq('id', req.params.id), {
    status: 'invoiced',
    items: fulfilledItems,
    driver_name: driverName || null,
    route_id: routeId || null,
    invoice_id: invoice.id,
    tracking_token: trackingToken,
    tracking_expires_at: trackingExpiresAt,
  });
  if (orderUpdate.error) return res.status(500).json({ error: orderUpdate.error.message });
  res.json({
    invoice,
    message: 'Invoice created',
    tracking_token: trackingToken,
    tracking_expires_at: trackingExpiresAt,
    tracking_url: buildTrackingUrl(req, trackingToken),
  });
});

router.post('/:id/tracking-link', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const order = await dbQuery(
    supabase
      .from('orders')
      .select('*')
      .eq('id', req.params.id)
      .single(),
    res
  );
  if (!order) return;
  if (!rowMatchesContext(order, req.context)) return res.status(403).json({ error: 'Forbidden' });

  const shouldRegenerate =
    !!req.body?.regenerate ||
    !order.tracking_token ||
    !order.tracking_expires_at ||
    new Date(order.tracking_expires_at).getTime() <= Date.now();

  let trackingToken = order.tracking_token;
  let trackingExpiresAt = order.tracking_expires_at;

  if (shouldRegenerate) {
    trackingToken = generateTrackingToken();
    trackingExpiresAt = trackingExpiry();
    const updated = await dbQuery(
      supabase
        .from('orders')
        .update({
          tracking_token: trackingToken,
          tracking_expires_at: trackingExpiresAt,
        })
        .eq('id', req.params.id)
        .select('id, order_number, tracking_token, tracking_expires_at')
        .single(),
      res
    );
    if (!updated) return;
    trackingToken = updated.tracking_token;
    trackingExpiresAt = updated.tracking_expires_at;
  }

  res.json({
    orderId: order.id,
    orderNumber: order.order_number,
    tracking_token: trackingToken,
    tracking_expires_at: trackingExpiresAt,
    tracking_url: buildTrackingUrl(req, trackingToken),
  });
});

module.exports = router;
