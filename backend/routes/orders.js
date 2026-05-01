const express = require('express');
const crypto = require('crypto');
const { supabase, dbQuery } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { required, maxLen, isArray, maxItems, compose } = require('../lib/validate');
const { applyInventoryLedgerEntry } = require('../services/inventory-ledger');
const {
  executeWithOptionalScope,
  filterRowsByContext,
  insertRecordWithOptionalScope,
  rowMatchesContext,
} = require('../services/operating-context');

function isMissingFtlColumnError(error) {
  return !!error?.message && error.message.includes('seafood_inventory.is_ftl_product does not exist');
}

// ── FSMA 204 lot validation ────────────────────────────────────────────────────
// For each item that references an FTL-flagged product, lot_id is required.
// Returns null on success, or an error string on validation failure.
async function validateFtlLots(items) {
  if (!Array.isArray(items) || !items.length) return null;

  // Collect item_numbers that appear in this order
  const itemNumbers = items
    .map((it) => String(it.item_number || '').trim())
    .filter(Boolean);

  if (!itemNumbers.length) return null;

  // Fetch FTL flags for all referenced products in one query
  const { data: products, error: prodErr } = await supabase
    .from('seafood_inventory')
    .select('item_number, description, is_ftl_product')
    .in('item_number', itemNumbers);

  if (isMissingFtlColumnError(prodErr)) return null;
  if (prodErr) return `Could not verify FTL product status: ${prodErr.message}`;

  const ftlSet = new Set(
    (products || []).filter((p) => p.is_ftl_product).map((p) => p.item_number)
  );

  if (!ftlSet.size) return null; // no FTL products in this order — nothing to check

  // Collect lot_ids that need to be validated
  const lotIds = items
    .filter((it) => ftlSet.has(String(it.item_number || '').trim()) && it.lot_id)
    .map((it) => parseInt(it.lot_id, 10))
    .filter((id) => Number.isFinite(id));

  // Check each FTL item has a lot_id
  for (const item of items) {
    const itemNum = String(item.item_number || '').trim();
    if (!ftlSet.has(itemNum)) continue;
    if (!item.lot_id) {
      const prodName = (products || []).find((p) => p.item_number === itemNum)?.description || itemNum;
      return `Lot assignment is required for FTL product "${prodName}" (item ${itemNum}). Assign a lot before confirming this order.`;
    }
  }

  if (!lotIds.length) return null;

  // Validate each lot_id belongs to the correct product
  const { data: lots, error: lotErr } = await supabase
    .from('lot_codes')
    .select('id, lot_number, product_id')
    .in('id', lotIds);

  if (lotErr) return `Could not verify lot assignments: ${lotErr.message}`;

  const lotMap = {};
  (lots || []).forEach((l) => { lotMap[l.id] = l; });

  for (const item of items) {
    const itemNum = String(item.item_number || '').trim();
    if (!ftlSet.has(itemNum) || !item.lot_id) continue;
    const lotId = parseInt(item.lot_id, 10);
    const lot = lotMap[lotId];
    if (!lot) return `Lot ID ${item.lot_id} not found.`;
    if (lot.product_id && lot.product_id !== itemNum) {
      return `Lot "${lot.lot_number}" belongs to product "${lot.product_id}", not "${itemNum}". Use a lot for the correct product.`;
    }
  }

  return null; // all checks passed
}

// Fetch lot metadata and embed lot_number + quantity_from_lot into each item that has a lot_id.
async function enrichItemsWithLotData(items) {
  if (!Array.isArray(items) || !items.length) return items || [];

  const lotIds = [...new Set(
    items.map((it) => parseInt(it.lot_id, 10)).filter((id) => Number.isFinite(id))
  )];
  if (!lotIds.length) return items;

  const { data: lots } = await supabase
    .from('lot_codes')
    .select('id, lot_number, expiration_date')
    .in('id', lotIds);

  const lotMap = {};
  (lots || []).forEach((l) => { lotMap[l.id] = l; });

  return items.map((item) => {
    const lotId = parseInt(item.lot_id, 10);
    if (!Number.isFinite(lotId) || !lotMap[lotId]) return item;
    const lot = lotMap[lotId];
    const qtyFromLot = parseFloat(item.quantity_from_lot ?? item.requested_weight ?? item.quantity ?? 0) || 0;
    return {
      ...item,
      lot_id:            lotId,
      lot_number:        lot.lot_number,
      quantity_from_lot: qtyFromLot,
      lot_expiration:    lot.expiration_date || null,
    };
  });
}

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

function normalizeFulfillmentType(value) {
  return String(value || '').trim().toLowerCase() === 'pickup' ? 'pickup' : 'delivery';
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

function isWeightManagedItem(item) {
  return !!item?.is_catch_weight || String(item?.unit || '').toLowerCase() === 'lb' || item?.requested_weight !== undefined;
}

function itemNeedsActualWeight(item) {
  return isWeightManagedItem(item) && !(parseFloat(item?.actual_weight) > 0);
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

// Compute catch weight display fields — appended to items in GET responses.
function enrichCatchWeightItem(item) {
  if (!item.is_catch_weight) return item;
  const est = parseFloat(item.estimated_weight) || null;
  const act = parseFloat(item.actual_weight) > 0 ? parseFloat(item.actual_weight) : null;
  const ppl = parseFloat(item.price_per_lb) || null;
  return {
    ...item,
    estimated_total:  est !== null && ppl !== null ? asMoney(est * ppl) : null,
    actual_total:     act !== null && ppl !== null ? asMoney(act * ppl) : null,
    weight_variance:  act !== null && est !== null ? parseFloat((act - est).toFixed(3)) : null,
    weight_confirmed: act !== null,
  };
}

function enrichOrderResponse(order) {
  return { ...order, items: (order.items || []).map(enrichCatchWeightItem) };
}

function invoiceItemsFromOrder(order, fulfilledItems) {
  const sourceItems = Array.isArray(fulfilledItems) ? fulfilledItems : (order.items || []);
  const invoiceItems = sourceItems.map((it) => {
    if (it.is_catch_weight) {
      const act = parseFloat(it.actual_weight);
      const est = parseFloat(it.estimated_weight) || 0;
      const hasActual = Number.isFinite(act) && act > 0;
      const weight = hasActual ? act : est;
      const pricePerLb = parseFloat(it.price_per_lb) || 0;
      return {
        description: it.name || it.description || '',
        notes: hasActual
          ? `Actual Weight: ${weight.toFixed(3)} lbs`
          : `Estimated Weight: ${est.toFixed(3)} lbs (pending confirmation)`,
        quantity: weight,
        requested_weight: est || null,
        actual_weight: hasActual ? act : null,
        unit: 'lb',
        unit_price: pricePerLb,
        total: asMoney(weight * pricePerLb),
        is_catch_weight: true,
        weight_confirmed: hasActual,
      };
    }
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
  const sourceItems = Array.isArray(fulfilledItems) ? fulfilledItems : (order.items || []);
  const estimatedWeightPending = sourceItems.some((it) => itemNeedsActualWeight(it));
  const items = invoiceItemsFromOrder(order, fulfilledItems);
  const totals = totalsForItems(items, taxEnabled, taxRate);
  return {
    invoice_number: overrides.invoice_number || `INV-${Date.now().toString().slice(-6)}`,
    customer_name: order.customer_name,
    customer_email: order.customer_email,
    customer_address: order.customer_address,
    billing_name: overrides.billing_name || null,
    billing_contact: overrides.billing_contact || null,
    billing_email: overrides.billing_email || order.customer_email || null,
    billing_phone: overrides.billing_phone || null,
    billing_address: overrides.billing_address || order.customer_address || null,
    items,
    ...totals,
    tax_enabled: taxEnabled,
    tax_rate: taxRate,
    order_id: order.id,
    driver_name: overrides.driverName || order.driver_name || null,
    status: 'pending',
    notes: overrides.notes !== undefined ? overrides.notes : order.notes || 'Awaiting final weights',
    estimated_weight_pending: estimatedWeightPending,
  };
}

function isMissingEstimatedWeightPendingError(error) {
  return !!error?.message && error.message.includes("estimated_weight_pending");
}

function withoutEstimatedWeightPending(payload) {
  const next = { ...payload };
  delete next.estimated_weight_pending;
  return next;
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

async function findOrderStop(order) {
  const orderNumber = String(order?.order_number || '').trim();
  if (!orderNumber) return null;
  const { data, error } = await supabase
    .from('stops')
    .select('*')
    .ilike('notes', `Order ${orderNumber}`)
    .limit(1);
  if (error || !Array.isArray(data) || !data.length) return null;
  return data[0];
}

async function syncOrderStop(order, req, removeOnly = false) {
  const fulfillmentType = normalizeFulfillmentType(order?.fulfillment_type);
  const name = String(order?.customer_name || '').trim();
  const address = String(order?.customer_address || '').trim();
  const stopNotes = `Order ${order.order_number || order.id}`;
  const existingStop = await findOrderStop(order);

  if (removeOnly || fulfillmentType === 'pickup' || !name || !address) {
    if (existingStop?.id) {
      await supabase.from('stops').delete().eq('id', existingStop.id);
    }
    return null;
  }

  const payload = {
    name,
    address,
    lat: parseFloat(order?.customer_lat) || 0,
    lng: parseFloat(order?.customer_lng) || 0,
    notes: stopNotes,
  };

  if (existingStop?.id) {
    await executeWithOptionalScope(
      (candidate) => supabase.from('stops').update(candidate).eq('id', existingStop.id).select().single(),
      payload
    );
    return existingStop.id;
  }

  const insertResult = await insertRecordWithOptionalScope(supabase, 'stops', payload, req.context);
  if (insertResult.error) throw insertResult.error;
  return insertResult.data?.id || null;
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
    let updateResult = await executeWithOptionalScope(
      (candidate) => supabase.from('invoices').update(candidate).eq('id', existingInvoice.id).select().single(),
      payload
    );
    if (isMissingEstimatedWeightPendingError(updateResult.error)) {
      updateResult = await executeWithOptionalScope(
        (candidate) => supabase.from('invoices').update(candidate).eq('id', existingInvoice.id).select().single(),
        withoutEstimatedWeightPending(payload)
      );
    }
    if (updateResult.error) {
      if (res) res.status(500).json({ error: updateResult.error.message });
      return null;
    }
    return updateResult.data;
  }

  let invoiceInsert = await insertRecordWithOptionalScope(supabase, 'invoices', payload, req.context);
  if (isMissingEstimatedWeightPendingError(invoiceInsert.error)) {
    invoiceInsert = await insertRecordWithOptionalScope(supabase, 'invoices', withoutEstimatedWeightPending(payload), req.context);
  }
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
  const fulfillmentType = normalizeFulfillmentType(req.body.fulfillmentType ?? req.body.fulfillment_type);

  const valErr = compose(
    required(customerName, 'customerName'),
    maxLen(customerName, 'customerName', 200),
    maxLen(customerEmail, 'customerEmail', 200),
    maxLen(customerAddress, 'customerAddress', 500),
    maxLen(notes, 'notes', 2000),
    items !== undefined ? isArray(items, 'items') : null,
    items !== undefined ? maxItems(items, 'items', 200) : null,
    charges !== undefined ? isArray(charges, 'charges') : null,
    charges !== undefined ? maxItems(charges, 'charges', 20) : null,
  );
  if (valErr) return res.status(400).json({ error: valErr });

  // Block orders for customers on credit hold
  if (customerName) {
    const { data: heldCustomers, error: heldCustomerErr } = await supabase
      .from('Customers')
      .select('id, company_name, credit_hold, credit_hold_reason')
      .ilike('company_name', customerName.trim())
      .eq('credit_hold', true)
      .limit(1);
    if (heldCustomerErr) return res.status(500).json({ error: heldCustomerErr.message });
    const heldCustomer = heldCustomers?.[0] || null;
    if (heldCustomer) {
      const reason = heldCustomer.credit_hold_reason ? ` Reason: ${heldCustomer.credit_hold_reason}` : '';
      return res.status(422).json({
        error: `Order blocked: ${heldCustomer.company_name} is on credit hold.${reason}`,
        code: 'CUSTOMER_CREDIT_HOLD',
      });
    }
  }

  // FSMA 204: validate FTL product lot assignments before creating the order
  const ftlError = await validateFtlLots(items);
  if (ftlError) return res.status(422).json({ error: ftlError, code: 'FTL_LOT_REQUIRED' });

  // Enrich items with lot metadata (lot_number, quantity_from_lot) from lot_codes
  const enrichedItems = await enrichItemsWithLotData(items);

  const orderNumber = 'ORD-' + Date.now().toString().slice(-6);
  const trackingToken = generateTrackingToken();
  const taxEnabled = parseBoolean(req.body.taxEnabled ?? req.body.tax_enabled);
  const taxRate = normalizeTaxRate(req.body.taxRate ?? req.body.tax_rate);
  const insertResult = await insertRecordWithOptionalScope(supabase, 'orders', {
    order_number: orderNumber,
    customer_name: customerName,
    customer_email: customerEmail || null,
    customer_address: fulfillmentType === 'delivery' ? customerAddress || null : null,
    items: enrichedItems || [],
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
  try {
    await syncOrderStop({ ...data, fulfillment_type: fulfillmentType }, req);
  } catch (stopErr) {
    return res.status(500).json({ error: stopErr.message || 'Could not create delivery stop' });
  }
  res.json({
    ...data,
    tracking_url: data.tracking_token ? buildTrackingUrl(req, data.tracking_token) : null,
  });
});

router.get('/:id', authenticateToken, async (req, res) => {
  const order = await dbQuery(supabase.from('orders').select('*').eq('id', req.params.id).single(), res);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (!rowMatchesContext(order, req.context)) return res.status(403).json({ error: 'Forbidden' });
  res.json(enrichOrderResponse(order));
});

// Capture actual weight for a single catch-weight line item.
// Recalculates line total and returns the updated order.
router.patch('/:id/items/:itemIndex/actual-weight', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const order = await dbQuery(supabase.from('orders').select('*').eq('id', req.params.id).single(), res);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (!rowMatchesContext(order, req.context)) return res.status(403).json({ error: 'Forbidden' });

  const idx = parseInt(req.params.itemIndex, 10);
  const items = Array.isArray(order.items) ? order.items : [];
  if (!Number.isFinite(idx) || idx < 0 || idx >= items.length) {
    return res.status(400).json({ error: `Item index ${req.params.itemIndex} is out of range` });
  }

  const item = items[idx];
  if (!isWeightManagedItem(item)) {
    return res.status(400).json({ error: 'Item at this index does not require weight capture' });
  }

  const actualWeight = parseFloat(req.body.actual_weight);
  if (!Number.isFinite(actualWeight) || actualWeight <= 0) {
    return res.status(400).json({ error: 'actual_weight must be a positive number greater than 0' });
  }
  const rounded = parseFloat(actualWeight.toFixed(3));
  const pricePerLb = item.is_catch_weight ? (parseFloat(item.price_per_lb) || 0) : (parseFloat(item.unit_price) || 0);

  const updatedItems = items.map((it, i) => {
    if (i !== idx) return it;
    const updatedItem = { ...it, actual_weight: rounded, total: asMoney(rounded * pricePerLb) };
    if (!it.is_catch_weight) {
      updatedItem.quantity = rounded;
    }
    return updatedItem;
  });

  // eslint-disable-next-line no-console
  console.log(`[weight-capture] order=${order.id} item=${idx} actual_weight=${rounded} user=${req.user?.id || req.user?.email} ts=${new Date().toISOString()}`);

  const updated = await updateRecord('orders', req.params.id, { items: updatedItems }, res);
  if (!updated) return;
  res.json(enrichOrderResponse(updated));
});

router.patch('/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const valErr = compose(
    maxLen(req.body.customerName, 'customerName', 200),
    maxLen(req.body.customerEmail, 'customerEmail', 200),
    maxLen(req.body.customerAddress, 'customerAddress', 500),
    maxLen(req.body.notes, 'notes', 2000),
    req.body.items !== undefined ? isArray(req.body.items, 'items') : null,
    req.body.items !== undefined ? maxItems(req.body.items, 'items', 200) : null,
    req.body.charges !== undefined ? isArray(req.body.charges, 'charges') : null,
    req.body.charges !== undefined ? maxItems(req.body.charges, 'charges', 20) : null,
  );
  if (valErr) return res.status(400).json({ error: valErr });

  const existing = await dbQuery(supabase.from('orders').select('*').eq('id', req.params.id).single(), res);
  if (!existing) return res.status(404).json({ error: 'Order not found' });
  if (!rowMatchesContext(existing, req.context)) return res.status(403).json({ error: 'Forbidden' });
  const fulfillmentType = normalizeFulfillmentType(req.body.fulfillmentType ?? req.body.fulfillment_type ?? existing.fulfillment_type);
  const updates = {};
  if (req.body.customerName !== undefined) updates.customer_name = req.body.customerName;
  if (req.body.customerEmail !== undefined) updates.customer_email = req.body.customerEmail || null;
  if (req.body.customerAddress !== undefined) updates.customer_address = fulfillmentType === 'delivery' ? (req.body.customerAddress || null) : null;
  if (req.body.items !== undefined) {
    const ftlError = await validateFtlLots(req.body.items);
    if (ftlError) return res.status(422).json({ error: ftlError, code: 'FTL_LOT_REQUIRED' });
    updates.items = await enrichItemsWithLotData(req.body.items);
  }
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
  try {
    await syncOrderStop({ ...existing, ...data, ...updates, fulfillment_type: fulfillmentType }, req);
  } catch (stopErr) {
    return res.status(500).json({ error: stopErr.message || 'Could not sync delivery stop' });
  }
  res.json(data);
});

router.delete('/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const existing = await dbQuery(supabase.from('orders').select('*').eq('id', req.params.id).single(), res);
  if (!existing) return res.status(404).json({ error: 'Order not found' });
  if (!rowMatchesContext(existing, req.context)) return res.status(403).json({ error: 'Forbidden' });
  await syncOrderStop(existing, req, true);
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

  // Enrich invoice with billing data from Customers table
  const billingOverrides = {};
  if (order.customer_name) {
    const { data: customer } = await supabase
      .from('Customers')
      .select('billing_name,billing_contact,billing_email,billing_phone,billing_address,phone_number,contact_name,address')
      .eq('company_name', order.customer_name)
      .limit(1)
      .single();
    if (customer) {
      if (customer.billing_name) billingOverrides.billing_name = customer.billing_name;
      if (customer.billing_contact || customer.contact_name) billingOverrides.billing_contact = customer.billing_contact || customer.contact_name;
      if (customer.billing_email) billingOverrides.billing_email = customer.billing_email;
      if (customer.billing_phone || customer.phone_number) billingOverrides.billing_phone = customer.billing_phone || customer.phone_number;
      if (customer.billing_address || customer.address) billingOverrides.billing_address = customer.billing_address || customer.address;
    }
  }

  const invoice = await createOrUpdateProcessingInvoice(
    order,
    fulfilledItems,
    { driverName: driverName || null, notes: order.notes || null, ...billingOverrides },
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
