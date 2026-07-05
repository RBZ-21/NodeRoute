const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const { supabase, dbQuery } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { required, maxLen, isArray, maxItems, compose } = require('../lib/validate');
const { validateBody, validateParams } = require('../lib/zod-validate');
const { buildTrackingUrl } = require('../lib/tracking-url');
const {
  orderCreateSchema, orderUpdateSchema, orderActualWeightSchema,
  orderSendSchema, orderFulfillSchema,
} = require('../lib/schemas');
// Driver-invoices endpoint (Step 14) - best placed here to avoid extra mounting.
// This endpoint serves both drivers (restricted to their route) and admins/managers.
async function fetchInvoicesForRoute(routeId, user, context) {
  if (!routeId) return { invoices: [], orders: [] };
  const role = String(user?.role || '').toLowerCase();
  if (role === 'driver') {
    // Enforce route ownership when possible
    try {
      const { data: route, error: routeErr } = await scopeQueryByContext(supabase.from('routes').select('id, driver_id, company_id, location_id'), context).eq('id', routeId).single();
      if (routeErr) throw routeErr;
      if (route?.driver_id && String(route.driver_id) !== String(user?.id)) {
        return { invoices: [], orders: [], error: 'Not authorized for this route' };
      }
    } catch (e) {
      return { invoices: [], orders: [], error: (e && e.message) || 'Authorization failed' };
    }
  }
  const { data: orders, error: oErr } = await scopeQueryByContext(supabase.from('orders').select('id, order_number, invoice_id, route_id, company_id, location_id'), context).eq('route_id', routeId);
  if (oErr) throw oErr;
  const invoiceIds = (orders || []).map((o) => o.invoice_id).filter((id) => id);
  let invoices = [];
  if (invoiceIds.length) {
    const { data: invs, error: iErr } = await scopeQueryByContext(supabase.from('invoices').select('*'), context).in('id', invoiceIds);
    if (iErr) throw iErr;
    invoices = invs;
  }
  return { invoices, orders };
}
const { triggerPrintJob } = require('../services/printer');
const printRouter = require('./print');
const { applyInventoryLedgerEntry } = require('../services/inventory-ledger');
const reorderEngine = require('../services/reorderEngine');
const { sendInvoiceEmail } = require('../services/invoice-email');
const deliveryNotifications = require('../services/delivery-notifications');
const { invoiceLotEntriesFromItems } = require('../services/invoice-lots');
const orderEntryEngine = require('../services/order-entry-engine');
const orderValidation = require('../services/order-validation');
const {
  buildScopeFields,
  executeWithOptionalScope,
  filterRowsByContext,
  insertRecordWithOptionalScope,
  isMissingColumnError,
  rowMatchesContext,
  scopeQueryByContext,
} = require('../services/operating-context');
const { statusAfterDeliveryCompletion } = require('../services/invoice-delivery');
const creditEngine = require('../services/creditEngine');
const { enforceDeliveryLimit, sendPlanLimitError } = require('../services/plan-limits');

// Estimate the dollar value of a draft order for the credit check. Mirrors
// totalsForItems but tolerates partially-priced items (returns 0 contributions
// for missing prices rather than NaN). This is intentionally an estimate —
// final invoice totals are computed from actual weights after fulfillment.
function estimateOrderTotal({ items, charges, taxEnabled, taxRate }) {
  const itemsSum = (Array.isArray(items) ? items : []).reduce((sum, it) => {
    const qty = parseFloat(it?.actual_weight || it?.requested_weight || it?.requested_qty || it?.quantity || 0) || 0;
    const price = parseFloat(it?.unit_price ?? it?.price_per_lb ?? 0) || 0;
    return sum + qty * price;
  }, 0);
  const chargesSum = (Array.isArray(charges) ? charges : []).reduce((sum, c) => sum + (parseFloat(c?.amount) || 0), 0);
  const subtotal = itemsSum + chargesSum;
  const tax = taxEnabled ? subtotal * (parseFloat(taxRate) || 0) : 0;
  return parseFloat((subtotal + tax).toFixed(2));
}

function hasMinimumSellOverride(user) {
  const role = String(user?.role || '').toLowerCase();
  return role === 'admin' || role === 'superadmin';
}

function sendMinimumSellViolation(res, violation) {
  return res.status(422).json({
    error: 'minimum_sell_violation',
    min_price: violation.min_price,
    source_id: violation.source_id || null,
    item_number: violation.item?.item_number || violation.item?.itemNumber || null,
    product_id: violation.item?.product_id || violation.item?.productId || null,
  });
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

async function findCustomerForOrderRoute(customerName, context) {
  const normalizedName = normalizeText(customerName);
  if (!normalizedName) return null;
  const { data, error } = await scopeQueryByContext(
    supabase.from('Customers').select('*'),
    context
  ).eq('company_name', normalizedName).limit(1);
  if (error || !Array.isArray(data) || !data.length) return null;
  return filterRowsByContext(data, context)[0] || null;
}

async function persistCustomerDefaultRoute(customerName, routeId, context) {
  const normalizedRouteId = normalizeText(routeId);
  if (!normalizedRouteId) return;
  const customer = await findCustomerForOrderRoute(customerName, context);
  if (!customer?.id) return;

  const updateResult = await executeWithOptionalScope(
    (candidate) => scopeQueryByContext(supabase.from('Customers').update(candidate), context).eq('id', customer.id).select().single(),
    { default_route_id: normalizedRouteId }
  );
  if (updateResult.error && !isMissingColumnError(updateResult.error)) {
    console.warn('[orders] customer default route sync skipped:', updateResult.error.message);
  }
}

function lotMapKey(value) {
  return normalizeText(value);
}

async function triggerReorderForOrderItems(items, context) {
  const productIds = new Set();
  const itemNumbers = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    if (item?.product_id) productIds.add(String(item.product_id));
    if (item?.item_number) itemNumbers.add(String(item.item_number));
    if (item?.product_item_number) itemNumbers.add(String(item.product_item_number));
  }
  try {
    if (itemNumbers.size) {
      // Tenant scope: only resolve products within the caller's company.
      const { data } = await scopeQueryByContext(
        supabase.from('products').select('id'),
        context
      ).in('item_number', [...itemNumbers]);
      (data || []).forEach((product) => productIds.add(product.id));
    }
    if (productIds.size) {
      await reorderEngine.runReorderCheck({ productIds: [...productIds], context });
    }
  } catch (err) {
    console.warn('[reorder] order-triggered check skipped:', err.message);
  }
}

// ── Lot tracing validation ────────────────────────────────────────────────────
// Lot tracing is required only for Fresh Clams and Mussels.
// Returns null on success, or an error string on validation failure.
const LOT_REQUIRED = /\b(mussel|clam|oyster)s?\b/i;

async function validateFtlLots(items, context) {
  if (!Array.isArray(items) || !items.length) return null;

  // Collect item_numbers that appear in this order
  const itemNumbers = items
    .map((it) => normalizeText(it.item_number))
    .filter(Boolean);

  if (!itemNumbers.length) return null;

  // Fetch product descriptions to determine which items require lot tracing.
  // Tenant-scoped so another company's product (shared item_number) cannot
  // alter this order's FTL determination.
  const { data: products, error: prodErr } = await scopeQueryByContext(
    supabase.from('products').select('item_number, description'),
    context
  ).in('item_number', itemNumbers);

  if (prodErr) return `Could not verify product lot requirements: ${prodErr.message}`;

  const ftlSet = new Set(
    (products || []).filter((p) => LOT_REQUIRED.test(p.description || '')).map((p) => p.item_number)
  );

  if (!ftlSet.size) return null; // no FTL products in this order — nothing to check

  // Collect lot_ids that need to be validated
  const lotIds = items
    .filter((it) => ftlSet.has(normalizeText(it.item_number)) && normalizeText(it.lot_id))
    .map((it) => normalizeText(it.lot_id))
    .filter(Boolean);

  // Check each FTL item has a lot_id
  for (const item of items) {
    const itemNum = normalizeText(item.item_number);
    if (!ftlSet.has(itemNum)) continue;
    if (!item.lot_id) {
      const prodName = (products || []).find((p) => p.item_number === itemNum)?.description || itemNum;
      return `Lot assignment is required for "${prodName}" (item ${itemNum}). Assign a lot before confirming this order.`;
    }
  }

  if (!lotIds.length) return null;

  // Validate each lot_id belongs to the correct product. Tenant-scoped so a
  // caller cannot assign another company's lot to their order.
  const { data: lots, error: lotErr } = await scopeQueryByContext(
    supabase.from('lot_codes').select('id, lot_number, product_id'),
    context
  ).in('id', lotIds);

  if (lotErr) return `Could not verify lot assignments: ${lotErr.message}`;

  const lotMap = Object.create(null);
  (lots || []).forEach((l) => {
    const key = lotMapKey(l?.id);
    if (key) lotMap[key] = l;
  });

  for (const item of items) {
    const itemNum = normalizeText(item.item_number);
    if (!ftlSet.has(itemNum) || !item.lot_id) continue;
    const lotId = lotMapKey(item.lot_id);
    const lot = lotMap[lotId];
    if (!lot) return `Lot ID ${item.lot_id} not found.`;
    if (lot.product_id && lot.product_id !== itemNum) {
      return `Lot "${lot.lot_number}" belongs to product "${lot.product_id}", not "${itemNum}". Use a lot for the correct product.`;
    }
  }

  return null; // all checks passed
}

// Fetch lot metadata and embed lot_number + quantity_from_lot into each item that has a lot_id.
async function enrichItemsWithLotData(items, context) {
  if (!Array.isArray(items) || !items.length) return items || [];

  const lotIds = [...new Set(
    items.map((it) => normalizeText(it.lot_id)).filter(Boolean)
  )];
  if (!lotIds.length) return items;

  // Tenant-scoped: only embed lot metadata for the caller's own lots.
  const { data: lots } = await scopeQueryByContext(
    supabase.from('lot_codes').select('id, lot_number, expiration_date'),
    context
  ).in('id', lotIds);

  const lotMap = Object.create(null);
  (lots || []).forEach((l) => {
    const key = lotMapKey(l?.id);
    if (key) lotMap[key] = l;
  });

  return items.map((item) => {
    const lotId = lotMapKey(item.lot_id);
    if (!lotId || !lotMap[lotId]) return item;
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

async function enrichItemsWithCatchWeightData(items, context) {
  if (!Array.isArray(items) || !items.length) return items || [];

  const productIds = [...new Set(items.map((item) => normalizeText(item.product_id)).filter(Boolean))];
  const itemNumbers = [...new Set(items.map((item) => normalizeText(item.item_number)).filter(Boolean))];
  const products = [];

  // Tenant-scoped: catch-weight pricing must come from the caller's own products.
  if (productIds.length) {
    const { data, error } = await scopeQueryByContext(
      supabase
        .from('products')
        .select('id,item_number,name,description,is_catch_weight,catch_weight_unit,estimated_unit_weight,weight_tolerance_pct,pricing_method,price_per_unit'),
      context
    ).in('id', productIds);
    if (!error && Array.isArray(data)) products.push(...data);
  }

  if (itemNumbers.length) {
    const { data, error } = await scopeQueryByContext(
      supabase
        .from('products')
        .select('id,item_number,name,description,is_catch_weight,catch_weight_unit,estimated_unit_weight,weight_tolerance_pct,pricing_method,price_per_unit'),
      context
    ).in('item_number', itemNumbers);
    if (!error && Array.isArray(data)) products.push(...data);
  }

  const byId = Object.create(null);
  const byItemNumber = Object.create(null);
  products.forEach((product) => {
    if (product.id) byId[normalizeText(product.id)] = product;
    if (product.item_number) byItemNumber[normalizeText(product.item_number)] = product;
  });

  return items.map((item) => {
    const product = byId[normalizeText(item.product_id)] || byItemNumber[normalizeText(item.item_number)] || null;
    if (!product?.is_catch_weight && !item.is_catch_weight) return item;

    const orderedQty = itemCount(item) || 1;
    const estimatedUnitWeight = parseFloat(product?.estimated_unit_weight ?? item.estimated_unit_weight ?? 0) || 0;
    const estimatedWeight = parseFloat(item.estimated_weight || 0) > 0
      ? parseFloat(item.estimated_weight)
      : parseFloat((orderedQty * estimatedUnitWeight).toFixed(4));
    const pricePerLb = parseFloat(item.price_per_lb ?? product?.price_per_unit ?? item.unit_price ?? 0) || 0;

    return {
      ...item,
      product_id: item.product_id || product?.id || undefined,
      item_number: item.item_number || product?.item_number || undefined,
      name: item.name || product?.name || product?.description || undefined,
      is_catch_weight: true,
      catch_weight_unit: product?.catch_weight_unit || item.catch_weight_unit || 'lb',
      estimated_unit_weight: estimatedUnitWeight || item.estimated_unit_weight || undefined,
      estimated_weight: estimatedWeight || item.estimated_weight || undefined,
      weight_tolerance_pct: product?.weight_tolerance_pct ?? item.weight_tolerance_pct ?? 10,
      pricing_method: 'per_weight',
      price_per_lb: pricePerLb,
      ordered_unit: item.ordered_unit || item.unit || 'case',
      weight_status: item.weight_status || 'pending',
    };
  });
}

const router = express.Router();
const idParamsSchema = z.object({ id: z.string().trim().min(1, 'id is required').max(120) });
const resolveLineSchema = z.object({
  customerId: z.string().trim().min(1, 'customerId is required').max(120),
  productId: z.string().trim().max(120).optional().nullable(),
  itemNumber: z.string().trim().max(120).optional().nullable(),
  barcode: z.string().trim().max(120).optional().nullable(),
  qty: z.coerce.number().min(0).optional().default(1),
  uom: z.string().trim().max(50).optional().default('each'),
}).refine((body) => body.productId || body.itemNumber || body.barcode, {
  message: 'productId, itemNumber, or barcode is required',
});
const barcodeScanSchema = z.object({
  barcode: z.string().trim().min(1, 'barcode is required').max(120),
});

function generateTrackingToken() {
  return crypto.randomBytes(18).toString('hex');
}

function trackingExpiry(days = 7) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

const DEFAULT_TAX_RATE = 0.09;

function parseBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1' || value === 'on';
}

function normalizeFulfillmentType(value) {
  return String(value || '').trim().toLowerCase() === 'pickup' ? 'pickup' : 'delivery';
}

function normalizeOrderStatus(value) {
  return String(value || '').trim().toLowerCase();
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

function itemCount(item) {
  return parseFloat(item?.requested_qty || item?.quantity || 0) || 0;
}

async function resolveCustomerIdFromOrderInput(body, fallbackOrder, context) {
  const explicit = normalizeText(body?.customer_id || body?.customerId || fallbackOrder?.customer_id || fallbackOrder?.customerId);
  if (explicit) return explicit;
  const customerName = normalizeText(body?.customerName || body?.customer_name || fallbackOrder?.customer_name);
  if (!customerName) return '';
  const customer = await findCustomerForOrderRoute(customerName, context);
  return normalizeText(customer?.id);
}

function workflowLineQuantity(item) {
  if (item?.is_catch_weight) return parseFloat(item.estimated_weight || item.requested_weight || item.quantity || 1) || 1;
  if (String(item?.unit || '').toLowerCase() === 'lb') return parseFloat(item.requested_weight || item.quantity || 1) || 1;
  return parseFloat(item?.requested_qty || item?.quantity || 1) || 1;
}

async function resolveOrderWorkflowItems(items, { customerId, context }) {
  if (!Array.isArray(items) || !items.length || !customerId) return items || [];

  const resolvedItems = [];
  for (const item of items) {
    const productId = normalizeText(item?.product_id || item?.productId);
    const itemNumber = normalizeText(item?.item_number || item?.itemNumber);
    if (!productId && !itemNumber) {
      resolvedItems.push(item);
      continue;
    }

    try {
      const resolved = await orderEntryEngine.resolveOrderLine({
        db: supabase,
        customerId,
        productId: productId || undefined,
        barcode: productId ? undefined : itemNumber,
        qty: workflowLineQuantity(item),
        uom: item?.unit || item?.uom || 'each',
        context,
      });
      resolvedItems.push({
        ...resolved,
        ...item,
        product_id: item.product_id || resolved.product_id,
        item_number: item.item_number || resolved.item_number,
        name: item.name || item.description || resolved.name,
        resolved_price: resolved.price,
        substitution: item.substitution || resolved.substitution || undefined,
        deposit_lines: item.deposit_lines || resolved.deposit_lines || [],
        hot_messages: item.hot_messages || resolved.hot_messages || [],
        instructions: item.instructions || resolved.instructions || [],
      });
    } catch (error) {
      console.warn('[order-entry] line workflow resolution skipped:', error.message);
      resolvedItems.push(item);
    }
  }
  return resolvedItems;
}

function isWeightManagedItem(item) {
  return !!item?.is_catch_weight || String(item?.unit || '').toLowerCase() === 'lb' || item?.requested_weight !== undefined;
}

function itemNeedsActualWeight(item) {
  return isWeightManagedItem(item) && !(parseFloat(item?.actual_weight) > 0);
}

function allWeightsCaptured(items) {
  return Array.isArray(items) && items.length > 0 && items.every((item) => !itemNeedsActualWeight(item));
}

function normalizeInventoryMatch(row) {
  if (!row) return null;
  return {
    ...row,
    product_id: row.product_id || row.id || null,
    description: row.description || row.name || '',
  };
}

async function findInventoryMatchByField(table, field, value) {
  const result = await supabase
    .from(table)
    .select('id,item_number,description,on_hand_qty,cost')
    .eq(field, value)
    .single();
  if (result.error || !result.data) return null;
  return normalizeInventoryMatch(result.data);
}

async function findInventoryMatchByName(table, name) {
  const result = await supabase
    .from(table)
    .select('id,item_number,description,on_hand_qty,cost')
    .ilike('description', name)
    .limit(1);
  if (result.error || !Array.isArray(result.data) || !result.data.length) return null;
  return normalizeInventoryMatch(result.data[0]);
}

async function findInventoryMatchForFulfillment(item) {
  const explicitProductId = normalizeText(item?.product_id);
  if (explicitProductId) {
    const byId =
      await findInventoryMatchByField('products', 'id', explicitProductId)
      || await findInventoryMatchByField('seafood_inventory', 'id', explicitProductId);
    if (byId) return byId;
  }

  const explicitItemNumber = normalizeText(item?.item_number);
  if (explicitItemNumber) {
    const byNumber =
      await findInventoryMatchByField('products', 'item_number', explicitItemNumber)
      || await findInventoryMatchByField('seafood_inventory', 'item_number', explicitItemNumber);
    if (byNumber) return byNumber;
  }

  const name = normalizeText(item?.name || item?.description);
  if (!name) return null;
  return (
    await findInventoryMatchByName('products', name)
    || await findInventoryMatchByName('seafood_inventory', name)
  );
}

async function billingOverridesForOrderCustomer(customerName) {
  if (!customerName) return {};
  const { data: customer } = await supabase
    .from('Customers')
    .select('billing_name,billing_contact,billing_email,billing_phone,billing_address,phone_number,contact_name,address')
    .eq('company_name', customerName)
    .limit(1)
    .single();
  if (!customer) return {};

  const billingOverrides = {};
  if (customer.billing_name) billingOverrides.billing_name = customer.billing_name;
  if (customer.billing_contact || customer.contact_name) billingOverrides.billing_contact = customer.billing_contact || customer.contact_name;
  if (customer.billing_email) billingOverrides.billing_email = customer.billing_email;
  if (customer.billing_phone || customer.phone_number) billingOverrides.billing_phone = customer.billing_phone || customer.phone_number;
  if (customer.billing_address || customer.address) billingOverrides.billing_address = customer.billing_address || customer.address;
  return billingOverrides;
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
      const orderedQty = itemCount(it);
      const orderedUnit = it.ordered_unit || it.order_unit || it.unit || 'case';
      const productName = it.name || it.description || '';
      return {
        description: hasActual
          ? `${productName} — ${orderedQty || 1} ${orderedUnit}${(orderedQty || 1) === 1 ? '' : 's'} @ ${weight.toFixed(3)} lbs — $${pricePerLb.toFixed(4)}/lb = $${asMoney(weight * pricePerLb).toFixed(2)}`
          : productName,
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
        item_number: it.item_number || null,
        product_id: it.product_id || null,
        lot_id: it.lot_id || null,
        lot_number: it.lot_number || null,
        quantity_from_lot: it.quantity_from_lot || null,
        lot_expiration: it.lot_expiration || null,
      };
    }
    const qty = itemQuantity(it);
    const unitPrice = parseFloat(it.unit_price || it.unitPrice || 0) || 0;
    return {
      description: it.name || it.description || '',
      notes:
        it.notes
        || (String(it.unit || '').toLowerCase() === 'lb' && itemCount(it) > 0 ? `Ordered Qty: ${itemCount(it)}` : null),
      quantity: qty,
      requested_qty: it.requested_qty || null,
      requested_weight: it.requested_weight || null,
      actual_weight: it.actual_weight || null,
      unit: it.unit || (it.requested_weight ? 'lb' : 'each'),
      unit_price: unitPrice,
      total: asMoney(qty * unitPrice),
      item_number: it.item_number || null,
      product_id: it.product_id || null,
      lot_id: it.lot_id || null,
      lot_number: it.lot_number || null,
      quantity_from_lot: it.quantity_from_lot || null,
      lot_expiration: it.lot_expiration || null,
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

function catchWeightInvoiceSummary(items = []) {
  const catchItems = (Array.isArray(items) ? items : []).filter((item) => item?.is_catch_weight);
  if (!catchItems.length) return null;
  const summary = catchItems.reduce((acc, item) => {
    acc.total_estimated_weight += parseFloat(item.estimated_weight || 0) || 0;
    acc.total_actual_weight += parseFloat(item.actual_weight || 0) || 0;
    return acc;
  }, { total_estimated_weight: 0, total_actual_weight: 0 });
  summary.total_variance_lbs = parseFloat((summary.total_actual_weight - summary.total_estimated_weight).toFixed(4));
  summary.total_variance_pct = summary.total_estimated_weight > 0
    ? parseFloat(((summary.total_variance_lbs / summary.total_estimated_weight) * 100).toFixed(3))
    : 0;
  return summary;
}

function catchWeightInvoiceBlock(items = []) {
  for (const item of Array.isArray(items) ? items : []) {
    if (!item?.is_catch_weight) continue;
    const name = item.name || item.description || item.item_number || 'catch weight item';
    const status = String(item.weight_status || '').toLowerCase();
    const hasActual = parseFloat(item.actual_weight || 0) > 0;
    if (!hasActual || status === 'pending') {
      return `Cannot invoice order — catch weight not recorded for: ${name}`;
    }
    if (status === 'variance_flagged' && !item.approved_at && !item.catch_weight_approved_at) {
      return `Weight variance requires supervisor approval before invoicing: ${name}`;
    }
  }
  return null;
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
  const lotNumbers = invoiceLotEntriesFromItems(sourceItems);
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
    lot_numbers: lotNumbers,
    ...totals,
    tax_enabled: taxEnabled,
    tax_rate: taxRate,
    order_id: order.id,
    driver_name: overrides.driverName || order.driver_name || null,
    status: 'pending',
    notes: overrides.notes !== undefined ? overrides.notes : order.notes || 'Awaiting final weights',
    estimated_weight_pending: estimatedWeightPending,
    catch_weight_summary: catchWeightInvoiceSummary(sourceItems),
  };
}

function isMissingEstimatedWeightPendingError(error) {
  return !!error?.message && error.message.includes("estimated_weight_pending");
}

function isMissingLotNumbersError(error) {
  return !!error?.message && error.message.includes('lot_numbers');
}

function withoutEstimatedWeightPending(payload) {
  const next = { ...payload };
  delete next.estimated_weight_pending;
  return next;
}

function withoutOptionalInvoiceFields(payload, { stripEstimatedWeightPending = false, stripLotNumbers = false } = {}) {
  let next = { ...payload };
  if (stripEstimatedWeightPending) next = withoutEstimatedWeightPending(next);
  if (stripLotNumbers) {
    next = { ...next };
    delete next.lot_numbers;
  }
  return next;
}

async function updateRecord(table, id, payload, res, context) {
  const updateResult = await executeWithOptionalScope(
    (candidate) => scopeQueryByContext(supabase.from(table).update(candidate), context).eq('id', id).select().single(),
    payload
  );
  if (updateResult.error) {
    if (res) res.status(500).json({ error: updateResult.error.message });
    return null;
  }
  return updateResult.data;
}

async function findOrderStop(order, context) {
  if (order?.stop_id) {
    const { data, error } = await scopeQueryByContext(
      supabase.from('stops').select('*'),
      context
    ).eq('id', order.stop_id)
      .limit(1);
    if (!error && Array.isArray(data) && data[0]) return data[0];
  }

  const orderNumber = String(order?.order_number || '').trim();
  if (!orderNumber) return null;
  const { data, error } = await scopeQueryByContext(
    supabase.from('stops').select('*'),
    context
  ).ilike('notes', `Order ${orderNumber}`).limit(1);
  if (error || !Array.isArray(data) || !data.length) return null;
  return data[0];
}

async function syncOrderStop(order, req, removeOnly = false) {
  const fulfillmentType = normalizeFulfillmentType(order?.fulfillment_type);
  const name = String(order?.customer_name || '').trim();
  const address = String(order?.customer_address || '').trim();
  const stopNotes = `Order ${order.order_number || order.id}`;
  const existingStop = await findOrderStop(order, req.context);

  if (removeOnly || fulfillmentType === 'pickup' || !name || !address) {
    if (existingStop?.id) {
      await scopeQueryByContext(supabase.from('stops').delete(), req.context).eq('id', existingStop.id);
    }
    return null;
  }

  const payload = {
    name,
    address,
    lat: parseFloat(order?.customer_lat) || 0,
    lng: parseFloat(order?.customer_lng) || 0,
    notes: stopNotes,
    route_id: order?.route_id || null,
  };

  if (existingStop?.id) {
    await executeWithOptionalScope(
      (candidate) => scopeQueryByContext(supabase.from('stops').update(candidate), req.context).eq('id', existingStop.id).select().single(),
      payload
    );
    if (order?.id && !order.stop_id) {
      await executeWithOptionalScope(
        (candidate) => scopeQueryByContext(supabase.from('orders').update(candidate), req.context).eq('id', order.id),
        { stop_id: existingStop.id }
      );
    }
    return existingStop.id;
  }

  const insertResult = await insertRecordWithOptionalScope(supabase, 'stops', payload, req.context);
  if (insertResult.error) throw insertResult.error;
  if (order?.id && insertResult.data?.id) {
    await executeWithOptionalScope(
      (candidate) => scopeQueryByContext(supabase.from('orders').update(candidate), req.context).eq('id', order.id),
      { stop_id: insertResult.data.id }
    );
  }
  return insertResult.data?.id || null;
}

async function findInvoiceForOrder(order, req) {
  if (order.invoice_id) {
    const byId = await scopeQueryByContext(supabase.from('invoices').select('*'), req.context).eq('id', order.invoice_id).single();
    if (!byId.error && byId.data) return byId.data;
  }

  const byOrderId = await scopeQueryByContext(supabase.from('invoices').select('*'), req.context).eq('order_id', order.id).limit(1);
  if (!byOrderId.error && Array.isArray(byOrderId.data) && byOrderId.data.length) {
    return byOrderId.data[0];
  }
  return null;
}

async function markOrderDelivered(order, req, res) {
  const deliveredAt = new Date().toISOString();
  const stop = await findOrderStop(order, req.context);
  let invoiceId = null;
  let emailSent = false;
  let emailError = '';

  if (stop?.id) {
    const stopUpdate = {
      status: 'completed',
      departed_at: stop.departed_at || deliveredAt,
    };
    const stopResult = await executeWithOptionalScope(
      (candidate) => scopeQueryByContext(supabase.from('stops').update(candidate), req.context).eq('id', stop.id).select().single(),
      stopUpdate
    );
    if (stopResult.error) {
      if (res) res.status(500).json({ error: stopResult.error.message });
      return null;
    }
  }

  const invoice = await findInvoiceForOrder(order, req);
  if (invoice?.id) {
    invoiceId = invoice.id;
    const invoiceResult = await executeWithOptionalScope(
      (candidate) => scopeQueryByContext(supabase.from('invoices').update(candidate), req.context).eq('id', invoice.id).select().single(),
      { status: statusAfterDeliveryCompletion(invoice.status) }
    );
    if (invoiceResult.error) {
      if (res) res.status(500).json({ error: invoiceResult.error.message });
      return null;
    }

    try {
      const emailResult = await sendInvoiceEmail(
        { ...invoice, ...(invoiceResult.data || {}) },
        'Invoice'
      );
      emailSent = !!emailResult?.sent;
      emailError = emailResult?.sent ? '' : String(emailResult?.error || '');
    } catch (error) {
      emailError = error?.message || 'Failed to send invoice email';
    }
  }

  deliveryNotifications.notifyDeliveryCompleted(supabase, order.stop_id || null, order.id).catch(() => {});

  return { deliveredAt, invoiceId, emailSent, emailError };
}

async function createOrUpdateProcessingInvoice(order, fulfilledItems, overrides, req, res) {
  const existingInvoice = await findInvoiceForOrder(order, req);
  const invoiceOrder = { ...order };
  if (existingInvoice?.id && invoiceOrder.tax_enabled === undefined) {
    invoiceOrder.tax_enabled = existingInvoice.tax_enabled ?? (parseFloat(existingInvoice.tax || 0) > 0);
  }
  if (existingInvoice?.id && invoiceOrder.tax_rate === undefined) {
    invoiceOrder.tax_rate = existingInvoice.tax_rate ?? DEFAULT_TAX_RATE;
  }
  const sourceItems = Array.isArray(fulfilledItems) ? fulfilledItems : (invoiceOrder.items || []);
  if (!overrides?.allowPendingCatchWeight) {
    const catchWeightBlock = catchWeightInvoiceBlock(sourceItems);
    if (catchWeightBlock) {
      if (res) res.status(409).json({ error: catchWeightBlock, code: 'CATCH_WEIGHT_REQUIRED' });
      return null;
    }
  }
  const payload = invoicePayloadForOrder(
    invoiceOrder,
    fulfilledItems,
    existingInvoice ? { ...overrides, invoice_number: existingInvoice.invoice_number } : overrides
  );
  const minimumSellViolation = await orderValidation.validateOrderItemPricing(payload.items, req.context);
  if (minimumSellViolation && !hasMinimumSellOverride(req.user)) {
    if (res) sendMinimumSellViolation(res, minimumSellViolation);
    return null;
  }

  if (existingInvoice?.id) {
    let updateResult = await executeWithOptionalScope(
      (candidate) => scopeQueryByContext(supabase.from('invoices').update(candidate), req.context).eq('id', existingInvoice.id).select().single(),
      payload
    );
    if (isMissingEstimatedWeightPendingError(updateResult.error)) {
      updateResult = await executeWithOptionalScope(
        (candidate) => scopeQueryByContext(supabase.from('invoices').update(candidate), req.context).eq('id', existingInvoice.id).select().single(),
        withoutOptionalInvoiceFields(payload, { stripEstimatedWeightPending: true })
      );
    }
    if (isMissingLotNumbersError(updateResult.error)) {
      updateResult = await executeWithOptionalScope(
        (candidate) => scopeQueryByContext(supabase.from('invoices').update(candidate), req.context).eq('id', existingInvoice.id).select().single(),
        withoutOptionalInvoiceFields(payload, {
          stripEstimatedWeightPending: isMissingEstimatedWeightPendingError(updateResult.error),
          stripLotNumbers: true,
        })
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
    invoiceInsert = await insertRecordWithOptionalScope(
      supabase,
      'invoices',
      withoutOptionalInvoiceFields(payload, { stripEstimatedWeightPending: true }),
      req.context
    );
  }
  if (isMissingLotNumbersError(invoiceInsert.error)) {
    invoiceInsert = await insertRecordWithOptionalScope(
      supabase,
      'invoices',
      withoutOptionalInvoiceFields(payload, {
        stripEstimatedWeightPending: isMissingEstimatedWeightPendingError(invoiceInsert.error),
        stripLotNumbers: true,
      }),
      req.context
    );
  }
  if (invoiceInsert.error) {
    if (res) res.status(500).json({ error: invoiceInsert.error.message });
    return null;
  }
  return invoiceInsert.data;
}

async function sendFulfillmentInvoiceIfPossible(invoice) {
  if (!invoice?.id) {
    return { sent: false, skipped: true, reason: 'Invoice missing' };
  }
  if (!(invoice.billing_email || invoice.customer_email)) {
    return { sent: false, skipped: true, reason: 'No email on file for this customer' };
  }

  try {
    return await sendInvoiceEmail(invoice, 'Invoice');
  } catch (error) {
    console.error('Fulfillment invoice email error:', error.message);
    return { sent: false, error: error.message };
  }
}

// ── ORDERS ────────────────────────────────────────────────────────────────────
const ORDERS_LIST_MAX_ROWS = Number.parseInt(process.env.ORDERS_LIST_MAX_ROWS, 10) > 0
  ? Number.parseInt(process.env.ORDERS_LIST_MAX_ROWS, 10)
  : 1000;

router.get('/', authenticateToken, async (req, res) => {
  const data = await dbQuery(
    scopeQueryByContext(supabase.from('orders').select('*'), req.context)
      .order('created_at', { ascending: false })
      .limit(ORDERS_LIST_MAX_ROWS),
    res
  );
  if (!data) return;
  res.json(filterRowsByContext(data || [], req.context));
});

// Driver-visible invoices for a specific route (consolidated path for Step 14)
router.get('/driver-invoices', authenticateToken, async (req, res) => {
  const routeId = req.query.routeId;
  if (!routeId) return res.status(400).json({ error: 'routeId is required' });
  const user = req.user || {};
  const { invoices, orders, error } = await fetchInvoicesForRoute(routeId, user, req.context)
    .catch((err) => ({ invoices: [], orders: [], error: err?.message || 'Failed to fetch invoices' }));
  if (error) return res.status(403).json({ error });
  res.json({ invoices, orders });
});

// Mount basic print endpoint under /print
router.use('/print', printRouter);

router.post('/line-resolution', validateBody(resolveLineSchema), authenticateToken, requireRole('admin', 'manager', 'rep'), async (req, res) => {
  try {
    const body = req.validated.body;
    const resolved = await orderEntryEngine.resolveOrderLine({
      db: supabase,
      customerId: body.customerId,
      productId: body.productId || undefined,
      barcode: body.barcode || body.itemNumber || undefined,
      qty: body.qty,
      uom: body.uom,
      context: req.context,
    });
    res.json(resolved);
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not resolve order line' });
  }
});

router.post('/', validateBody(orderCreateSchema), authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { customerName, customerEmail, customerAddress, items, charges, notes } = req.body;
  try {
    await enforceDeliveryLimit(supabase, req.context);
  } catch (error) {
    if (sendPlanLimitError(res, error)) return;
    return res.status(500).json({ error: error.message || 'Could not verify subscription limits' });
  }
  const customerPhone = req.body.customerPhone ?? req.body.customer_phone ?? null;
  const fulfillmentType = normalizeFulfillmentType(req.body.fulfillmentType ?? req.body.fulfillment_type);
  const routeId = normalizeText(req.body.routeId ?? req.body.route_id);

  // ── Credit check (runs BEFORE any other order logic) ─────────────────────
  // Blocks the order if the customer is on credit hold OR if the order would
  // push them past their limit. Authorized managers can pre-issue an override
  // via POST /api/credit/customer/:id/override which is consumed here.
  const creditTaxEnabled = parseBoolean(req.body.taxEnabled ?? req.body.tax_enabled);
  const creditTaxRate = normalizeTaxRate(req.body.taxRate ?? req.body.tax_rate);
  const estimatedTotal = estimateOrderTotal({
    items,
    charges,
    taxEnabled: creditTaxEnabled,
    taxRate: creditTaxRate,
  });
  const creditDecision = await creditEngine.checkOrderAllowed({
    customer_name: customerName,
    order_total: estimatedTotal,
  });
  if (!creditDecision.allowed) {
    if (creditDecision.customer_id) {
      await creditEngine.logOrderBlocked(
        creditDecision.customer_id,
        estimatedTotal,
        creditDecision,
        req.context
      );
    }
    return res.status(402).json({
      success: false,
      error: 'credit_hold',
      code: 'CUSTOMER_CREDIT_HOLD',
      message: creditDecision.reason === 'would_exceed_limit'
        ? `Order would exceed ${creditDecision.customer_name}'s credit limit`
        : `${creditDecision.customer_name || 'This customer'} is on credit hold`,
      details: {
        customer_id: creditDecision.customer_id,
        customer_name: creditDecision.customer_name,
        reason: creditDecision.reason,
        hold_reason: creditDecision.hold_reason,
        current_balance: creditDecision.current_balance,
        order_total: estimatedTotal,
        projected_balance: creditDecision.projected_balance,
        credit_limit: creditDecision.credit_limit,
        over_by: creditDecision.over_by,
        oldest_past_due_days: creditDecision.oldest_past_due_days,
        contact: 'Contact your AR manager to resolve',
      },
    });
  }

  // FSMA 204: validate FTL product lot assignments before creating the order
  const ftlError = await validateFtlLots(items, req.context);
  if (ftlError) return res.status(422).json({ error: ftlError, code: 'FTL_LOT_REQUIRED' });

  const resolvedCustomerId = await resolveCustomerIdFromOrderInput(req.body, null, req.context);

  // Enrich items with lot metadata (lot_number, quantity_from_lot) from lot_codes
  const lotEnrichedItems = await enrichItemsWithLotData(items, req.context);
  const catchWeightItems = await enrichItemsWithCatchWeightData(lotEnrichedItems, req.context);
  const enrichedItems = await resolveOrderWorkflowItems(catchWeightItems, {
    customerId: resolvedCustomerId,
    context: req.context,
  });
  const minimumSellViolation = await orderValidation.validateOrderItemPricing(enrichedItems, req.context);
  if (minimumSellViolation && !hasMinimumSellOverride(req.user)) {
    return sendMinimumSellViolation(res, minimumSellViolation);
  }

  const orderNumber = 'ORD-' + Date.now().toString().slice(-6);
  const trackingToken = generateTrackingToken();
  const taxEnabled = parseBoolean(req.body.taxEnabled ?? req.body.tax_enabled);
  const taxRate = normalizeTaxRate(req.body.taxRate ?? req.body.tax_rate);
  const insertResult = await insertRecordWithOptionalScope(supabase, 'orders', {
    order_number: orderNumber,
    customer_id: resolvedCustomerId || null,
    customer_name: customerName,
    customer_email: customerEmail || null,
    customer_phone: customerPhone || null,
    customer_address: fulfillmentType === 'delivery' ? customerAddress || null : null,
    items: enrichedItems || [],
    charges: Array.isArray(charges) ? charges : [],
    status: 'pending',
    notes: notes || null,
    tax_enabled: taxEnabled,
    tax_rate: taxRate,
    driver_name: null,
    route_id: routeId || null,
    stop_id: req.body.stop_id || req.body.stopId || null,
    tracking_token: trackingToken,
    tracking_expires_at: trackingExpiry(),
  }, req.context);
  if (insertResult.error) return res.status(500).json({ error: insertResult.error.message });
  const data = insertResult.data;
  if (!data) return res.status(500).json({ error: 'Failed to create order record' });
  await persistCustomerDefaultRoute(customerName, data.route_id, req.context);
  // Trigger print job for the newly created order (best-effort, non-fatal if printing fails)
  try {
    await triggerPrintJob(data, enrichedItems, req.context);
  } catch (printErr) {
    // Do not fail the request due to print errors; log for investigation
    // eslint-disable-next-line no-console
    console.error('[print-trigger] failed', printErr?.message || printErr);
  }
  try {
    await syncOrderStop({ ...data, fulfillment_type: fulfillmentType }, req);
  } catch (stopErr) {
    return res.status(500).json({ error: stopErr.message || 'Could not create delivery stop' });
  }
  // Consume the override (if one was used) now that the order is on the books.
  if (creditDecision.override_id) {
    await creditEngine.consumeOverride(creditDecision.override_id);
  }

  await triggerReorderForOrderItems(enrichedItems, req.context);

  res.json({
    ...data,
    tracking_url: data.tracking_token ? buildTrackingUrl(req, data.tracking_token) : null,
    credit_warning: creditDecision.warning === true,
    credit_message: creditDecision.warning ? creditDecision.message : undefined,
    available_credit: creditDecision.warning ? creditDecision.available_credit : undefined,
    credit_override_used: creditDecision.override_id || undefined,
  });
});

router.get('/:id', authenticateToken, async (req, res) => {
  const order = await dbQuery(scopeQueryByContext(supabase.from('orders').select('*'), req.context).eq('id', req.params.id).single(), res);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (!rowMatchesContext(order, req.context)) return res.status(403).json({ error: 'Forbidden' });
  res.json(enrichOrderResponse(order));
});

router.post('/:id/backorder', validateParams(idParamsSchema), authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const result = await orderEntryEngine.processBackorder({
      db: supabase,
      orderId: req.validated.params.id,
      context: req.context,
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not process backorder' });
  }
});

router.post('/:id/scan', validateParams(idParamsSchema), validateBody(barcodeScanSchema), authenticateToken, requireRole('admin', 'manager', 'rep'), async (req, res) => {
  try {
    const result = await orderEntryEngine.applyBarcodeScan({
      db: supabase,
      orderId: req.validated.params.id,
      barcode: req.validated.body.barcode,
      userId: req.user?.id || null,
      context: req.context,
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not apply barcode scan' });
  }
});

// Capture actual weight for a single catch-weight line item.
// Recalculates line total and returns the updated order.
router.patch('/:id/items/:itemIndex/actual-weight', validateBody(orderActualWeightSchema), authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const order = await dbQuery(scopeQueryByContext(supabase.from('orders').select('*'), req.context).eq('id', req.params.id).single(), res);
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
    const updatedItem = {
      ...it,
      actual_weight: rounded,
      total: asMoney(rounded * pricePerLb),
      weight_status: it.weight_status === 'approved' ? 'approved' : 'weighed',
      weighed_at: new Date().toISOString(),
    };
    return updatedItem;
  });

  // eslint-disable-next-line no-console
  console.log(`[weight-capture] order=${order.id} item=${idx} actual_weight=${rounded} user=${req.user?.id || req.user?.email} ts=${new Date().toISOString()}`);

  const updated = await updateRecord('orders', req.params.id, { items: updatedItems }, res, req.context);
  if (!updated) return;
  const invoice = await createOrUpdateProcessingInvoice(
    { ...order, ...updated, items: updatedItems },
    updatedItems,
    { notes: order.notes || 'Awaiting final weights', allowPendingCatchWeight: true },
    req,
    res
  );
  if (!invoice) return;

  const orderStatus = allWeightsCaptured(updatedItems) ? 'processed' : 'in_process';
  const orderWithInvoice = await updateRecord('orders', req.params.id, {
    invoice_id: invoice.id,
    status: orderStatus,
  }, res, req.context);
  if (!orderWithInvoice) return;

  res.json(enrichOrderResponse({ ...orderWithInvoice, items: updatedItems, invoice_id: invoice.id }));
});

router.patch('/:id', validateBody(orderUpdateSchema), authenticateToken, requireRole('admin', 'manager'), async (req, res) => {

  const existing = await dbQuery(scopeQueryByContext(supabase.from('orders').select('*'), req.context).eq('id', req.params.id).single(), res);
  if (!existing) return res.status(404).json({ error: 'Order not found' });
  if (!rowMatchesContext(existing, req.context)) return res.status(403).json({ error: 'Forbidden' });
  const fulfillmentType = normalizeFulfillmentType(req.body.fulfillmentType ?? req.body.fulfillment_type ?? existing.fulfillment_type);
  const updates = {};
  if (req.body.customerName !== undefined) updates.customer_name = req.body.customerName;
  if (req.body.customerEmail !== undefined) updates.customer_email = req.body.customerEmail || null;
  if (req.body.customerPhone !== undefined || req.body.customer_phone !== undefined) {
    updates.customer_phone = req.body.customerPhone ?? req.body.customer_phone ?? null;
  }
  const resolvedCustomerId = await resolveCustomerIdFromOrderInput(req.body, existing, req.context);
  if (resolvedCustomerId) updates.customer_id = resolvedCustomerId;
  if (req.body.customerAddress !== undefined) updates.customer_address = fulfillmentType === 'delivery' ? (req.body.customerAddress || null) : null;
  if (req.body.items !== undefined) {
    const ftlError = await validateFtlLots(req.body.items, req.context);
    if (ftlError) return res.status(422).json({ error: ftlError, code: 'FTL_LOT_REQUIRED' });
    const lotEnrichedItems = await enrichItemsWithLotData(req.body.items, req.context);
    const catchWeightItems = await enrichItemsWithCatchWeightData(lotEnrichedItems, req.context);
    updates.items = await resolveOrderWorkflowItems(catchWeightItems, {
      customerId: resolvedCustomerId,
      context: req.context,
    });
    const minimumSellViolation = await orderValidation.validateOrderItemPricing(updates.items, req.context);
    if (minimumSellViolation && !hasMinimumSellOverride(req.user)) {
      return sendMinimumSellViolation(res, minimumSellViolation);
    }

    // Credit recheck on order edits — only blocks when the new estimate is
    // higher than the previous one. A reduction in scope should never be
    // blocked by credit even if the customer is now near the limit.
    const newTotal = estimateOrderTotal({
      items: updates.items,
      charges: req.body.charges !== undefined ? req.body.charges : existing.charges,
      taxEnabled: req.body.taxEnabled !== undefined || req.body.tax_enabled !== undefined
        ? parseBoolean(req.body.taxEnabled ?? req.body.tax_enabled)
        : !!existing.tax_enabled,
      taxRate: req.body.taxRate !== undefined || req.body.tax_rate !== undefined
        ? normalizeTaxRate(req.body.taxRate ?? req.body.tax_rate)
        : normalizeTaxRate(existing.tax_rate),
    });
    const previousTotal = estimateOrderTotal({
      items: existing.items,
      charges: existing.charges,
      taxEnabled: !!existing.tax_enabled,
      taxRate: normalizeTaxRate(existing.tax_rate),
    });
    if (newTotal > previousTotal) {
      const decision = await creditEngine.checkOrderAllowed({
        customer_name: updates.customer_name || existing.customer_name,
        order_id: existing.id,
        order_total: newTotal,
      });
      if (!decision.allowed) {
        if (decision.customer_id) {
          await creditEngine.logOrderBlocked(decision.customer_id, newTotal, decision, req.context);
        }
        return res.status(402).json({
          success: false,
          error: 'credit_hold',
          code: 'CUSTOMER_CREDIT_HOLD',
          message: 'Increased order total exceeds available credit',
          details: { ...decision, order_total: newTotal },
        });
      }
    }
  }
  if (req.body.charges !== undefined) updates.charges = Array.isArray(req.body.charges) ? req.body.charges : [];
  if (req.body.status !== undefined) updates.status = req.body.status;
  if (req.body.driverName !== undefined) updates.driver_name = req.body.driverName;
  if (req.body.routeId !== undefined || req.body.route_id !== undefined) {
    updates.route_id = req.body.routeId ?? req.body.route_id ?? null;
  }
  if (req.body.stop_id !== undefined || req.body.stopId !== undefined) {
    updates.stop_id = req.body.stop_id ?? req.body.stopId ?? null;
  }
  if (req.body.notes !== undefined) updates.notes = req.body.notes;
  if (req.body.taxEnabled !== undefined || req.body.tax_enabled !== undefined) {
    updates.tax_enabled = parseBoolean(req.body.taxEnabled ?? req.body.tax_enabled);
  }
  if (req.body.taxRate !== undefined || req.body.tax_rate !== undefined) {
    updates.tax_rate = normalizeTaxRate(req.body.taxRate ?? req.body.tax_rate);
  }
  const data = await updateRecord('orders', req.params.id, updates, res, req.context);
  if (!data) return;
  const mergedOrder = { ...existing, ...data, ...updates, fulfillment_type: fulfillmentType };
  await persistCustomerDefaultRoute(mergedOrder.customer_name, mergedOrder.route_id, req.context);
  try {
    await syncOrderStop(mergedOrder, req);
  } catch (stopErr) {
    return res.status(500).json({ error: stopErr.message || 'Could not sync delivery stop' });
  }

  const shouldSyncInvoice =
    !!mergedOrder.invoice_id
    || normalizeOrderStatus(mergedOrder.status) === 'in_process'
    || normalizeOrderStatus(existing.status) === 'in_process';

  if (shouldSyncInvoice) {
    const billingOverrides = await billingOverridesForOrderCustomer(mergedOrder.customer_name);
    const invoice = await createOrUpdateProcessingInvoice(
      mergedOrder,
      mergedOrder.items || [],
      { notes: mergedOrder.notes || 'Awaiting final weights', allowPendingCatchWeight: true, ...billingOverrides },
      req,
      res
    );
    if (!invoice) return;

    const refreshed = await updateRecord('orders', req.params.id, {
      invoice_id: invoice.id,
      status: 'in_process',
    }, res, req.context);
    if (!refreshed) return;
    return res.json(enrichOrderResponse({ ...mergedOrder, ...refreshed, items: mergedOrder.items || [], invoice_id: invoice.id }));
  }

  if (normalizeOrderStatus(mergedOrder.status) === 'delivered') {
    const deliverySync = await markOrderDelivered(mergedOrder, req, res);
    if (!deliverySync) return;
    return res.json({
      ...data,
      delivered_at: deliverySync.deliveredAt,
      invoice_id: deliverySync.invoiceId || mergedOrder.invoice_id || null,
      emailSent: deliverySync.emailSent,
      emailError: deliverySync.emailError || null,
    });
  }

  res.json(data);
});

router.delete('/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const existing = await dbQuery(scopeQueryByContext(supabase.from('orders').select('*'), req.context).eq('id', req.params.id).single(), res);
  if (!existing) return res.status(404).json({ error: 'Order not found' });
  if (!rowMatchesContext(existing, req.context)) return res.status(403).json({ error: 'Forbidden' });
  await syncOrderStop(existing, req, true);
  const data = await dbQuery(scopeQueryByContext(supabase.from('orders').delete(), req.context).eq('id', req.params.id), res);
  if (data === null) return;
  res.json({ message: 'Order deleted' });
});

// Send order to processing: creates/updates the pending invoice draft and marks the order ready for weights.
router.post('/:id/send', validateBody(orderSendSchema), authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const existing = await dbQuery(scopeQueryByContext(supabase.from('orders').select('*'), req.context).eq('id', req.params.id).single(), res);
  if (!existing) return res.status(404).json({ error: 'Order not found' });
  if (!rowMatchesContext(existing, req.context)) return res.status(403).json({ error: 'Forbidden' });

  const effectiveOrder = { ...existing };
  if (req.body.taxEnabled !== undefined || req.body.tax_enabled !== undefined) {
    effectiveOrder.tax_enabled = parseBoolean(req.body.taxEnabled ?? req.body.tax_enabled);
  }
  if (req.body.taxRate !== undefined || req.body.tax_rate !== undefined) {
    effectiveOrder.tax_rate = normalizeTaxRate(req.body.taxRate ?? req.body.tax_rate);
  }
  const invoice = await createOrUpdateProcessingInvoice(effectiveOrder, null, { notes: existing.notes || 'Awaiting final weights', allowPendingCatchWeight: true }, req, res);
  if (!invoice) return;
  const trackingToken = existing.tracking_token || generateTrackingToken();
  const trackingExpiresAt = existing.tracking_expires_at || trackingExpiry();
  const data = await updateRecord('orders', req.params.id, {
    status: 'in_process',
    invoice_id: invoice.id,
    tracking_token: trackingToken,
    tracking_expires_at: trackingExpiresAt,
  }, res, req.context);
  if (!data) return;
  res.json({
    ...data,
    invoice,
    tracking_url: buildTrackingUrl(req, trackingToken),
  });
});

// Fulfill order: enter actual weights → generate invoice
router.post('/:id/fulfill', validateBody(orderFulfillSchema), authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { items, driverName, routeId } = req.body;
  const order = await dbQuery(scopeQueryByContext(supabase.from('orders').select('*'), req.context).eq('id', req.params.id).single(), res);
  if (!order) return;
  if (!rowMatchesContext(order, req.context)) return res.status(403).json({ error: 'Forbidden' });
  const fulfilledItems = Array.isArray(items) ? items : (order.items || []);

  // Enrich invoice with billing data from Customers table
  const billingOverrides = await billingOverridesForOrderCustomer(order.customer_name);

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
        context: req.context,
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
  await triggerReorderForOrderItems(fulfilledItems, req.context);

  const orderUpdate = await executeWithOptionalScope((candidate) => scopeQueryByContext(supabase.from('orders').update(candidate), req.context).eq('id', req.params.id), {
    status: 'invoiced',
    items: fulfilledItems,
    driver_name: driverName || null,
    route_id: routeId || null,
    invoice_id: invoice.id,
    tracking_token: trackingToken,
    tracking_expires_at: trackingExpiresAt,
  });
  if (orderUpdate.error) return res.status(500).json({ error: orderUpdate.error.message });

  const emailResult = await sendFulfillmentInvoiceIfPossible(invoice);
  res.json({
    invoice,
    message: 'Invoice created',
    emailSent: !!emailResult.sent,
    emailError: emailResult.sent ? null : (emailResult.error || emailResult.reason || null),
    tracking_token: trackingToken,
    tracking_expires_at: trackingExpiresAt,
    tracking_url: buildTrackingUrl(req, trackingToken),
  });
});

router.post('/:id/tracking-link', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const order = await dbQuery(
    scopeQueryByContext(supabase.from('orders').select('*'), req.context)
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
      scopeQueryByContext(
        supabase.from('orders').update({
          tracking_token: trackingToken,
          tracking_expires_at: trackingExpiresAt,
        }),
        req.context
      )
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

// POST /api/orders/bulk-import — CSV bulk order creation.
// Validates every row first; if any row fails, nothing is committed (the rows
// are inserted in a single atomic multi-row insert). Returns per-row errors.
router.post('/bulk-import', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: 'No rows to import.' });
  if (rows.length > 1000) return res.status(400).json({ error: 'Import is limited to 1000 rows per file.' });

  const errors = [];
  const prepared = [];
  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const customerName = String(row.customer_name || '').trim();
    const items = Array.isArray(row.items) ? row.items : [];
    const normalizedItems = items
      .map((it) => ({
        item_number: String(it.item_number || '').trim() || null,
        name: String(it.name || it.description || '').trim() || null,
        unit: String(it.unit || 'each').trim(),
        quantity: Number(it.quantity ?? it.qty) || 0,
        unit_price: Number(it.unit_price ?? it.price) || 0,
      }))
      .filter((it) => it.quantity > 0 && (it.item_number || it.name));
    if (!customerName) { errors.push({ row: rowNumber, error: 'Missing customer name.' }); return; }
    if (!normalizedItems.length) { errors.push({ row: rowNumber, error: 'No valid items with quantity > 0.' }); return; }
    prepared.push({
      order_number: 'ORD-' + Date.now().toString().slice(-6) + '-' + rowNumber,
      customer_name: customerName,
      customer_email: String(row.customer_email || '').trim() || null,
      customer_address: String(row.customer_address || '').trim() || null,
      items: normalizedItems,
      charges: [],
      status: 'pending',
      source: 'csv_import',
      ...buildScopeFields(req.context),
    });
  });

  if (errors.length) {
    // Reject the whole import — no partial commits.
    return res.status(422).json({ error: 'Import rejected: fix the row errors and retry.', errors, committed: 0 });
  }

  const { data, error } = await supabase.from('orders').insert(prepared).select('id, order_number');
  if (error) return res.status(500).json({ error: error.message, committed: 0 });
  res.json({ committed: data.length, orders: data });
});

module.exports = router;
module.exports.validateFtlLots = validateFtlLots;
module.exports.enrichItemsWithLotData = enrichItemsWithLotData;
module.exports.enrichItemsWithCatchWeightData = enrichItemsWithCatchWeightData;
module.exports.findInventoryMatchForFulfillment = findInventoryMatchForFulfillment;
