const express = require('express');
const { supabase } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { filterRowsByContext, scopeQueryByContext } = require('../services/operating-context');
const { summarizeVendorPo } = require('./ops-utils');
const { loadVendorPurchaseOrdersFromDb } = require('../services/purchase-order-workflows');

const router = express.Router();

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function toNumber(value, fallback = 0) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

function toDateOrNull(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    const [year, month, day] = value.trim().split('-').map((part) => parseInt(part, 10));
    const localDate = new Date(year, (month || 1) - 1, day || 1);
    return Number.isFinite(localDate.getTime()) ? localDate : null;
  }
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

function inDateRange(isoValue, start, end) {
  if (!start && !end) return true;
  const d = toDateOrNull(isoValue);
  if (!d) return false;
  if (start && d < start) return false;
  if (end && d > end) return false;
  return true;
}

function round2(value) {
  return parseFloat(toNumber(value, 0).toFixed(2));
}

function parseInvoiceItems(invoice) {
  return Array.isArray(invoice?.items) ? invoice.items : [];
}

function buildInventoryCostMap(inventory) {
  const map = new Map();
  for (const item of inventory || []) {
    const cost = toNumber(item.cost, 0);
    const keyByNumber = normalize(item.item_number);
    const keyByName = normalize(item.description || item.name);
    if (keyByNumber && !map.has(`num:${keyByNumber}`)) map.set(`num:${keyByNumber}`, cost);
    if (keyByName && !map.has(`name:${keyByName}`)) map.set(`name:${keyByName}`, cost);
  }
  return map;
}

function estimateLineCost(line, costMap) {
  const qty = toNumber(line.quantity ?? line.qty, 0);
  const itemNumberKey = normalize(line.item_number);
  const nameKey = normalize(line.description || line.name);
  const mappedCost =
    (itemNumberKey ? costMap.get(`num:${itemNumberKey}`) : undefined) ??
    (nameKey ? costMap.get(`name:${nameKey}`) : undefined) ??
    0;
  return round2(qty * toNumber(mappedCost, 0));
}

function lineRevenue(line) {
  const explicit = toNumber(line.total, NaN);
  if (Number.isFinite(explicit)) return round2(explicit);
  const qty = toNumber(line.quantity ?? line.qty, 0);
  const unit = toNumber(line.unit_price ?? line.unitPrice ?? line.price, 0);
  return round2(qty * unit);
}

function createAccumulator(label) {
  return {
    label,
    order_count: 0,
    invoice_count: 0,
    sku_line_count: 0,
    qty: 0,
    revenue: 0,
    estimated_cost: 0,
    margin: 0,
    margin_pct: 0,
  };
}

function finalizeAccumulator(row) {
  row.revenue = round2(row.revenue);
  row.estimated_cost = round2(row.estimated_cost);
  row.margin = round2(row.revenue - row.estimated_cost);
  row.qty = round2(row.qty);
  row.margin_pct = row.revenue > 0 ? round2((row.margin / row.revenue) * 100) : 0;
  return row;
}

function sortRows(rows, limit = 100) {
  return rows
    .map(finalizeAccumulator)
    .sort((a, b) => b.revenue - a.revenue || b.margin - a.margin || b.order_count - a.order_count)
    .slice(0, limit);
}

function isMissingTableError(error) {
  const msg = String(error?.message || '');
  return /public\.orders|relation ["']?orders["']? does not exist|schema cache/i.test(msg);
}

function computeRollups({ orders, invoices, routes, inventory, startDate, endDate, limit = 100 }) {
  const filteredOrders = (orders || []).filter((o) => inDateRange(o.created_at, startDate, endDate));
  const filteredInvoices = (invoices || []).filter((i) => inDateRange(i.created_at, startDate, endDate));
  const routeMap = new Map((routes || []).map((r) => [String(r.id), r]));
  const orderMap = new Map(filteredOrders.map((o) => [String(o.id), o]));
  const costMap = buildInventoryCostMap(inventory || []);

  const byCustomer = new Map();
  const byRoute = new Map();
  const byDriver = new Map();
  const bySku = new Map();

  for (const order of filteredOrders) {
    const customerKey = normalize(order.customer_email) || normalize(order.customer_name) || `cust:${order.id}`;
    if (!byCustomer.has(customerKey)) byCustomer.set(customerKey, createAccumulator(order.customer_name || order.customer_email || 'Unknown Customer'));
    byCustomer.get(customerKey).order_count += 1;

    const routeId = String(order.route_id || '');
    const route = routeMap.get(routeId);
    const routeKey = routeId || 'unassigned';
    if (!byRoute.has(routeKey)) byRoute.set(routeKey, createAccumulator(route?.name || order.route_id || 'Unassigned Route'));
    byRoute.get(routeKey).order_count += 1;

    const driverKey = normalize(order.driver_name) || 'unassigned';
    if (!byDriver.has(driverKey)) byDriver.set(driverKey, createAccumulator(order.driver_name || 'Unassigned Driver'));
    byDriver.get(driverKey).order_count += 1;
  }

  for (const invoice of filteredInvoices) {
    const customerKey = normalize(invoice.customer_email) || normalize(invoice.customer_name) || `cust:${invoice.id}`;
    if (!byCustomer.has(customerKey)) byCustomer.set(customerKey, createAccumulator(invoice.customer_name || invoice.customer_email || 'Unknown Customer'));

    const order = invoice.order_id ? orderMap.get(String(invoice.order_id)) : null;
    const routeId = String(order?.route_id || '');
    const route = routeMap.get(routeId);
    const routeKey = routeId || 'unassigned';
    if (!byRoute.has(routeKey)) byRoute.set(routeKey, createAccumulator(route?.name || 'Unassigned Route'));

    const driverLabel = invoice.driver_name || order?.driver_name || 'Unassigned Driver';
    const driverKey = normalize(driverLabel) || 'unassigned';
    if (!byDriver.has(driverKey)) byDriver.set(driverKey, createAccumulator(driverLabel));

    const customerRow = byCustomer.get(customerKey);
    const routeRow = byRoute.get(routeKey);
    const driverRow = byDriver.get(driverKey);

    const invoiceRevenue = toNumber(invoice.total, 0);
    customerRow.invoice_count += 1;
    routeRow.invoice_count += 1;
    driverRow.invoice_count += 1;
    customerRow.revenue += invoiceRevenue;
    routeRow.revenue += invoiceRevenue;
    driverRow.revenue += invoiceRevenue;

    for (const line of parseInvoiceItems(invoice)) {
      // Prefer human-readable description/name over SKU for label; keep SKU as stable grouping key
      const skuLabel = line.description || line.name || line.item_number || 'Unknown SKU';
      const skuKey = normalize(line.item_number) || normalize(skuLabel) || `sku:${invoice.id}:${customerRow.sku_line_count}`;
      if (!bySku.has(skuKey)) bySku.set(skuKey, createAccumulator(skuLabel));
      const skuRow = bySku.get(skuKey);

      const revenue = lineRevenue(line);
      const cost = estimateLineCost(line, costMap);
      const qty = toNumber(line.quantity ?? line.qty, 0);

      [customerRow, routeRow, driverRow, skuRow].forEach((row) => {
        row.sku_line_count += 1;
        row.qty += qty;
        row.estimated_cost += cost;
      });
      skuRow.revenue += revenue;
    }
  }

  const overallRevenue = filteredInvoices.reduce((sum, inv) => sum + toNumber(inv.total, 0), 0);
  const overallEstimatedCost = Array.from(bySku.values()).reduce((sum, row) => sum + toNumber(row.estimated_cost, 0), 0);
  const overallMargin = overallRevenue - overallEstimatedCost;
  const overview = {
    order_count: filteredOrders.length,
    invoice_count: filteredInvoices.length,
    revenue: round2(overallRevenue),
    estimated_cost: round2(overallEstimatedCost),
    margin: round2(overallMargin),
    margin_pct: overallRevenue > 0 ? round2((overallMargin / overallRevenue) * 100) : 0,
  };

  return {
    overview,
    customer: sortRows(Array.from(byCustomer.values()), limit),
    route: sortRows(Array.from(byRoute.values()), limit),
    driver: sortRows(Array.from(byDriver.values()), limit),
    sku: sortRows(Array.from(bySku.values()), limit),
  };
}

function startOfDay(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function startOfWeek(date) {
  const next = startOfDay(date);
  const day = next.getDay();
  const diff = (day + 6) % 7;
  next.setDate(next.getDate() - diff);
  return next;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function startOfYear(date) {
  return new Date(date.getFullYear(), 0, 1);
}

function dateRangeForPreset(preset, now = new Date()) {
  const end = endOfDay(now);
  if (preset === 'daily') return { start: startOfDay(now), end };
  if (preset === 'weekly') return { start: startOfWeek(now), end };
  if (preset === 'monthly') return { start: startOfMonth(now), end };
  if (preset === 'yearly') return { start: startOfYear(now), end };
  return { start: null, end: null };
}

const REPORTING_MAX_WINDOW_DAYS = 365;
const REPORTING_DEFAULT_WINDOW_DAYS = 90;

/**
 * Resolve and validate a reporting date range.
 * - If neither bound is provided, defaults to the last 90 days.
 * - If only one bound is provided, the other is anchored to "today" or
 *   "the default window before the given end".
 * - Rejects ranges where start > end or that exceed REPORTING_MAX_WINDOW_DAYS.
 *
 * @returns {{ startDate: Date, endDate: Date }} on success
 *          or { error: string } on validation failure
 */
function resolveReportingDateRange(rawStart, rawEnd, maxDays = REPORTING_MAX_WINDOW_DAYS) {
  const parsedStart = toDateOrNull(rawStart);
  const parsedEnd = toDateOrNull(rawEnd);
  const now = new Date();

  let endDate = parsedEnd ? endOfDay(parsedEnd) : endOfDay(now);
  let startDate = parsedStart
    ? startOfDay(parsedStart)
    : startOfDay(new Date(endDate.getTime() - (REPORTING_DEFAULT_WINDOW_DAYS - 1) * 86_400_000));

  if (startDate.getTime() > endDate.getTime()) {
    return { error: 'start date must be on or before end date' };
  }
  const windowDays = Math.floor((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1;
  if (windowDays > maxDays) {
    return { error: `date window exceeds the maximum of ${maxDays} days (got ${windowDays})` };
  }

  return { startDate, endDate };
}

/**
 * Returns the human-readable label for an invoice line item.
 * Prefers description/name over item_number so reports show product names, not SKU codes.
 */
function itemLabelFromLine(line) {
  return String(line.description || line.name || line.item_number || 'Unknown Item').trim() || 'Unknown Item';
}

function normalizeFulfillment(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'pickup' ? 'pickup' : normalized === 'delivery' ? 'delivery' : 'unknown';
}

function computeSalesSummary({ orders, invoices, startDate, endDate, itemQuery = '' }) {
  const filteredOrders = (orders || []).filter((order) => inDateRange(order.created_at, startDate, endDate));
  const filteredInvoices = (invoices || []).filter((invoice) => inDateRange(invoice.created_at, startDate, endDate));
  const orderMap = new Map((orders || []).map((order) => [String(order.id), order]));
  const query = normalize(itemQuery);
  const itemRows = new Map();

  let totalSales = 0;
  let deliverySales = 0;
  let pickupSales = 0;
  let unknownSales = 0;

  for (const invoice of filteredInvoices) {
    const order = invoice.order_id ? orderMap.get(String(invoice.order_id)) : null;
    const channel = normalizeFulfillment(order?.fulfillment_type);
    const total = round2(toNumber(invoice.total, 0));
    totalSales += total;
    if (channel === 'delivery') deliverySales += total;
    else if (channel === 'pickup') pickupSales += total;
    else unknownSales += total;

    for (const line of parseInvoiceItems(invoice)) {
      const label = itemLabelFromLine(line);
      const itemNumber = String(line.item_number || '').trim();
      const key = normalize(itemNumber || label) || `item:${invoice.id}:${label}`;
      const qty = round2(toNumber(line.quantity ?? line.qty, 0));
      const revenue = lineRevenue(line);
      const haystack = `${normalize(itemNumber)} ${normalize(label)}`;
      if (query && !haystack.includes(query)) continue;

      const row = itemRows.get(key) || {
        key,
        label,
        item_number: itemNumber || null,
        qty: 0,
        revenue: 0,
        invoice_count: 0,
        delivery_revenue: 0,
        pickup_revenue: 0,
      };
      row.qty += qty;
      row.revenue += revenue;
      row.invoice_count += 1;
      if (channel === 'delivery') row.delivery_revenue += revenue;
      if (channel === 'pickup') row.pickup_revenue += revenue;
      itemRows.set(key, row);
    }
  }

  const items = [...itemRows.values()]
    .map((row) => ({
      ...row,
      qty: round2(row.qty),
      revenue: round2(row.revenue),
      delivery_revenue: round2(row.delivery_revenue),
      pickup_revenue: round2(row.pickup_revenue),
    }))
    .sort((a, b) => b.revenue - a.revenue || b.qty - a.qty || a.label.localeCompare(b.label));

  const availableItems = [...new Map(
    filteredInvoices.flatMap((invoice) => parseInvoiceItems(invoice).map((line) => {
      const label = itemLabelFromLine(line);
      const itemNumber = String(line.item_number || '').trim();
      const key = normalize(itemNumber || label);
      return [key, { key, label, item_number: itemNumber || null }];
    }))
  ).values()].sort((a, b) => a.label.localeCompare(b.label));

  return {
    overview: {
      total_sales: round2(totalSales),
      delivery_sales: round2(deliverySales),
      pickup_sales: round2(pickupSales),
      unknown_sales: round2(unknownSales),
      invoice_count: filteredInvoices.length,
      order_count: filteredOrders.length,
      average_invoice: filteredInvoices.length ? round2(totalSales / filteredInvoices.length) : 0,
      item_count: items.length,
    },
    items,
    available_items: availableItems,
  };
}

function computeRecentSoldItems({ invoices, startDate, endDate }) {
  const filteredInvoices = (invoices || []).filter((invoice) => inDateRange(invoice.created_at, startDate, endDate));
  const soldByKey = new Map();

  for (const invoice of filteredInvoices) {
    for (const line of parseInvoiceItems(invoice)) {
      const label = itemLabelFromLine(line);
      const itemNumber = String(line.item_number || '').trim();
      const key = normalize(itemNumber || label);
      if (!key) continue;
      if (!soldByKey.has(key)) {
        soldByKey.set(key, {
          key,
          item_number: itemNumber || null,
          label,
          invoice_count: 0,
          qty: 0,
        });
      }
      const row = soldByKey.get(key);
      row.invoice_count += 1;
      row.qty += toNumber(line.quantity ?? line.qty, 0);
    }
  }

  return [...soldByKey.values()]
    .map((row) => ({
      ...row,
      qty: round2(row.qty),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function computeDailyOps({ date, inventory, vendorPurchaseOrders, rollups, lowStockThreshold = 5, topCustomerLimit = 10 }) {
  const targetDate = toDateOrNull(date) || new Date();
  const startDate = startOfDay(targetDate);
  const endDate = endOfDay(targetDate);

  const byCategory = new Map();
  let inventorySkuCount = 0;
  let lowStockSkuCount = 0;

  for (const item of inventory || []) {
    const category = String(item.category || 'Uncategorized').trim() || 'Uncategorized';
    const onHandQty = Math.max(0, toNumber(item.on_hand_qty, 0));
    const unitCost = Math.max(0, toNumber(item.cost, 0));
    const estimatedStockValue = onHandQty * unitCost;
    inventorySkuCount += 1;
    if (onHandQty <= lowStockThreshold) lowStockSkuCount += 1;

    if (!byCategory.has(category)) {
      byCategory.set(category, {
        category,
        sku_count: 0,
        total_on_hand_qty: 0,
        estimated_stock_value: 0,
        low_stock_sku_count: 0,
      });
    }

    const row = byCategory.get(category);
    row.sku_count += 1;
    row.total_on_hand_qty += onHandQty;
    row.estimated_stock_value += estimatedStockValue;
    if (onHandQty <= lowStockThreshold) row.low_stock_sku_count += 1;
  }

  const onHandByCategory = Array.from(byCategory.values())
    .map((row) => ({
      ...row,
      total_on_hand_qty: round2(row.total_on_hand_qty),
      estimated_stock_value: round2(row.estimated_stock_value),
    }))
    .sort((a, b) => b.estimated_stock_value - a.estimated_stock_value || b.sku_count - a.sku_count || a.category.localeCompare(b.category));

  const vendorFillMap = new Map();
  const shortShipLines = [];
  let totalRequestedQty = 0;
  let totalAcceptedQty = 0;
  let totalShortQty = 0;
  let totalOverReceiptQty = 0;
  let receiptCount = 0;
  let shortReceiptLineCount = 0;
  let shortReceiptPoCount = 0;

  for (const sourcePo of vendorPurchaseOrders || []) {
    const po = summarizeVendorPo(sourcePo);
    const vendorName = String(po.vendor || po.vendor_name || 'Unassigned Vendor').trim() || 'Unassigned Vendor';
    const vendorKey = normalize(vendorName) || po.id;
    let poHadReceiptToday = false;
    let poHadShortReceiptToday = false;

    for (const receipt of po.receipts || []) {
      if (!inDateRange(receipt.received_at, startDate, endDate)) continue;
      poHadReceiptToday = true;
      receiptCount += 1;

      if (!vendorFillMap.has(vendorKey)) {
        vendorFillMap.set(vendorKey, {
          vendor: vendorName,
          po_count: 0,
          receipt_count: 0,
          line_count: 0,
          requested_qty: 0,
          accepted_qty: 0,
          short_qty: 0,
          over_receipt_qty: 0,
          short_receipt_line_count: 0,
          fill_rate_pct: 0,
        });
      }

      const vendorRow = vendorFillMap.get(vendorKey);
      vendorRow.receipt_count += 1;

      for (const line of receipt.lines || []) {
        const requestedQty = Math.max(0, toNumber(line.requested_receive_qty ?? line.qty_received, 0));
        const acceptedQty = Math.max(0, toNumber(line.accepted_receive_qty ?? line.qty_received, 0));
        const shortQty = Math.max(0, -toNumber(line.quantity_variance_qty, 0));
        const overReceiptQty = Math.max(0, toNumber(line.over_receipt_qty, 0));

        vendorRow.line_count += 1;
        vendorRow.requested_qty += requestedQty;
        vendorRow.accepted_qty += acceptedQty;
        vendorRow.short_qty += shortQty;
        vendorRow.over_receipt_qty += overReceiptQty;

        totalRequestedQty += requestedQty;
        totalAcceptedQty += acceptedQty;
        totalShortQty += shortQty;
        totalOverReceiptQty += overReceiptQty;

        if (shortQty > 0 || normalize(line.variance_type) === 'short_receipt') {
          vendorRow.short_receipt_line_count += 1;
          shortReceiptLineCount += 1;
          poHadShortReceiptToday = true;
          shortShipLines.push({
            po_number: po.po_number || po.id,
            vendor: vendorName,
            product_name: line.product_name || line.item_number || `Line ${line.line_no || '?'}`,
            short_qty: round2(shortQty),
            requested_qty: round2(requestedQty),
            accepted_qty: round2(acceptedQty),
            received_at: receipt.received_at || null,
          });
        }
      }
    }

    if (poHadReceiptToday) {
      vendorFillMap.get(vendorKey).po_count += 1;
    }
    if (poHadShortReceiptToday) {
      shortReceiptPoCount += 1;
    }
  }

  const vendorFill = Array.from(vendorFillMap.values())
    .map((row) => ({
      ...row,
      requested_qty: round2(row.requested_qty),
      accepted_qty: round2(row.accepted_qty),
      short_qty: round2(row.short_qty),
      over_receipt_qty: round2(row.over_receipt_qty),
      fill_rate_pct: row.requested_qty > 0 ? round2((row.accepted_qty / row.requested_qty) * 100) : 0,
    }))
    .sort((a, b) => b.short_qty - a.short_qty || a.fill_rate_pct - b.fill_rate_pct || b.requested_qty - a.requested_qty || a.vendor.localeCompare(b.vendor));

  const topCustomers = (rollups?.customer || []).slice(0, topCustomerLimit);

  return {
    overview: {
      fill_rate_pct: totalRequestedQty > 0 ? round2((totalAcceptedQty / totalRequestedQty) * 100) : 0,
      requested_qty: round2(totalRequestedQty),
      accepted_qty: round2(totalAcceptedQty),
      short_qty: round2(totalShortQty),
      over_receipt_qty: round2(totalOverReceiptQty),
      receipt_count: receiptCount,
      vendor_count: vendorFill.length,
      short_receipt_line_count: shortReceiptLineCount,
      short_receipt_po_count: shortReceiptPoCount,
      category_count: onHandByCategory.length,
      inventory_sku_count: inventorySkuCount,
      low_stock_sku_count: lowStockSkuCount,
      top_customer_count: topCustomers.length,
    },
    top_customers: topCustomers,
    on_hand_by_category: onHandByCategory,
    vendor_fill: vendorFill,
    short_ship_lines: shortShipLines
      .sort((a, b) => b.short_qty - a.short_qty || String(b.received_at || '').localeCompare(String(a.received_at || '')))
      .slice(0, 20),
  };
}

router.get('/rollups', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const range = resolveReportingDateRange(req.query.start, req.query.end);
  if (range.error) return res.status(400).json({ error: range.error });
  const { startDate, endDate } = range;
  const limit = Math.max(1, Math.min(parseInt(req.query.limit || '100', 10), 500));

  try {
    const [ordersResult, invoicesResult, routesResult, inventoryResult] = await Promise.all([
      scopeQueryByContext(supabase.from('orders').select('*'), req.context)
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString())
        .limit(5000),
      scopeQueryByContext(supabase.from('invoices').select('*'), req.context)
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString())
        .limit(5000),
      scopeQueryByContext(supabase.from('routes').select('*'), req.context).limit(2000),
      scopeQueryByContext(supabase.from('products').select('item_number,description,cost'), req.context).limit(5000),
    ]);

    const ordersMissing = isMissingTableError(ordersResult.error);
    if (ordersMissing) {
      console.warn('[reporting] orders table not found; generating rollups without order-level joins');
    }
    const error = (!ordersMissing && ordersResult.error) || invoicesResult.error || routesResult.error || inventoryResult.error;
    if (error) return res.status(500).json({ error: error.message });

    const payload = computeRollups({
      orders: filterRowsByContext((ordersMissing ? [] : (ordersResult.data || [])), req.context),
      invoices: filterRowsByContext(invoicesResult.data || [], req.context),
      routes: filterRowsByContext(routesResult.data || [], req.context),
      inventory: filterRowsByContext(inventoryResult.data || [], req.context),
      startDate,
      endDate,
      limit,
    });

    res.json({
      generated_at: new Date().toISOString(),
      filters: {
        start: startDate ? startDate.toISOString() : null,
        end: endDate ? endDate.toISOString() : null,
        limit,
      },
      ...payload,
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not build reporting rollups' });
  }
});

router.get('/sales-summary', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const preset = String(req.query.preset || 'range').trim().toLowerCase();
  const presetRange = dateRangeForPreset(preset);
  let startDate;
  let endDate;
  if (preset === 'range') {
    const range = resolveReportingDateRange(req.query.start, req.query.end);
    if (range.error) return res.status(400).json({ error: range.error });
    ({ startDate, endDate } = range);
  } else {
    startDate = presetRange.start;
    endDate = presetRange.end;
    if (!startDate || !endDate) {
      return res.status(400).json({ error: `Unknown preset "${preset}"` });
    }
  }
  const itemQuery = String(req.query.item || '').trim();

  try {
    const [ordersResult, invoicesResult] = await Promise.all([
      scopeQueryByContext(supabase.from('orders').select('*'), req.context)
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString())
        .limit(5000),
      scopeQueryByContext(supabase.from('invoices').select('*'), req.context)
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString())
        .limit(5000),
    ]);

    const ordersMissing = isMissingTableError(ordersResult.error);
    const error = (!ordersMissing && ordersResult.error) || invoicesResult.error;
    if (error) return res.status(500).json({ error: error.message });

    const payload = computeSalesSummary({
      orders: filterRowsByContext((ordersMissing ? [] : (ordersResult.data || [])), req.context),
      invoices: filterRowsByContext(invoicesResult.data || [], req.context),
      startDate,
      endDate,
      itemQuery,
    });

    res.json({
      generated_at: new Date().toISOString(),
      filters: {
        preset,
        start: startDate ? startDate.toISOString() : null,
        end: endDate ? endDate.toISOString() : null,
        item: itemQuery || null,
      },
      ...payload,
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not build sales summary' });
  }
});

router.get('/recent-sold-items', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const days = Math.max(1, Math.min(parseInt(req.query.days || '30', 10), 365));
  const endDate = endOfDay(new Date());
  const startDate = startOfDay(new Date(endDate.getTime() - (days - 1) * 86400000));

  try {
    const invoicesResult = await scopeQueryByContext(supabase
      .from('invoices')
      .select('*'), req.context)
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString())
      .limit(5000);
    if (invoicesResult.error) return res.status(500).json({ error: invoicesResult.error.message });

    const items = computeRecentSoldItems({
      invoices: filterRowsByContext(invoicesResult.data || [], req.context),
      startDate,
      endDate,
    });

    res.json({
      generated_at: new Date().toISOString(),
      filters: {
        days,
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
      item_count: items.length,
      items,
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not build recent sold items report' });
  }
});

router.get('/daily-ops', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const targetDate = toDateOrNull(req.query.date) || new Date();
  const startDate = startOfDay(targetDate);
  const endDate = endOfDay(targetDate);

  try {
    const [ordersResult, invoicesResult, routesResult, inventoryResult] = await Promise.all([
      scopeQueryByContext(supabase.from('orders').select('*'), req.context)
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString())
        .limit(5000),
      scopeQueryByContext(supabase.from('invoices').select('*'), req.context)
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString())
        .limit(5000),
      scopeQueryByContext(supabase.from('routes').select('*'), req.context).limit(2000),
      scopeQueryByContext(supabase.from('products').select('item_number,description,category,cost,on_hand_qty'), req.context).limit(5000),
    ]);

    const ordersMissing = isMissingTableError(ordersResult.error);
    if (ordersMissing) {
      console.warn('[reporting] orders table not found; generating daily ops without order-level joins');
    }
    const error = (!ordersMissing && ordersResult.error) || invoicesResult.error || routesResult.error || inventoryResult.error;
    if (error) return res.status(500).json({ error: error.message });

    const scopedInventory = filterRowsByContext(inventoryResult.data || [], req.context);
    const rollups = computeRollups({
      orders: filterRowsByContext((ordersMissing ? [] : (ordersResult.data || [])), req.context),
      invoices: filterRowsByContext(invoicesResult.data || [], req.context),
      routes: filterRowsByContext(routesResult.data || [], req.context),
      inventory: scopedInventory,
      startDate,
      endDate,
      limit: 10,
    });
    let vendorPurchaseOrders = [];
    try {
      const dbOrders = await loadVendorPurchaseOrdersFromDb(req.context || {});
      if (Array.isArray(dbOrders)) vendorPurchaseOrders = dbOrders;
    } catch (vendorErr) {
      console.warn('[reporting] failed to load vendor POs for daily-ops:', vendorErr.message);
    }
    const payload = computeDailyOps({
      date: targetDate,
      inventory: scopedInventory,
      vendorPurchaseOrders,
      rollups,
    });

    res.json({
      generated_at: new Date().toISOString(),
      filters: {
        date: startDate.toISOString(),
      },
      ...payload,
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not build daily operations report' });
  }
});

// ──────────────────────────────────────────────────────────────────────────
// CREDIT & AR REPORTING
// ──────────────────────────────────────────────────────────────────────────
const creditEngine = require('../services/creditEngine');

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function toCsv(headers, rows) {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(','));
  }
  return lines.join('\n');
}

// 9A. GET /api/reporting/ar-aging
router.get('/ar-aging', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const format = String(req.query.format || 'json').toLowerCase();
    const { data: invoices, error } = await scopeQueryByContext(supabase
      .from('invoices')
      .select('id, invoice_number, customer_id, customer_name, customer_email, total, due_date, created_at, status, company_id, location_id'), req.context)
      .in('status', creditEngine.OPEN_INVOICE_STATUSES);
    if (error) return res.status(500).json({ error: error.message });

    const scoped = filterRowsByContext(invoices || [], req.context);
    const now = Date.now();
    const buckets = { Current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    const rows = [];

    for (const inv of scoped) {
      const due = inv.due_date || inv.created_at;
      const days = due ? Math.floor((now - new Date(due).getTime()) / 86_400_000) : 0;
      const bucket = days <= 0 ? 'Current' : days <= 30 ? '1-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+';
      const amount = toNumber(inv.total, 0);
      buckets[bucket] += amount;
      rows.push({
        invoice_number: inv.invoice_number,
        customer_id: inv.customer_id,
        customer_name: inv.customer_name,
        customer_email: inv.customer_email,
        due_date: inv.due_date,
        days_past_due: Math.max(0, days),
        bucket,
        amount: round2(amount),
        status: inv.status,
      });
    }

    if (format === 'csv') {
      const csv = toCsv(
        ['invoice_number', 'customer_name', 'customer_email', 'due_date', 'days_past_due', 'bucket', 'amount', 'status'],
        rows,
      );
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="ar-aging-${new Date().toISOString().slice(0, 10)}.csv"`);
      return res.send(csv);
    }

    res.json({
      generated_at: new Date().toISOString(),
      buckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, round2(v)])),
      rows: rows.sort((a, b) => b.days_past_due - a.days_past_due),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9B. GET /api/reporting/credit-hold-history
router.get('/credit-hold-history', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const from = toDateOrNull(req.query.from);
    const to = toDateOrNull(req.query.to);
    const customerId = req.query.customer_id ? parseInt(req.query.customer_id, 10) : null;
    const reason = req.query.reason ? String(req.query.reason).trim() : null;

    let query = scopeQueryByContext(supabase.from('credit_hold_log').select('*'), req.context).order('created_at', { ascending: false }).limit(2000);
    if (customerId) query = query.eq('customer_id', customerId);
    if (from) query = query.gte('created_at', from.toISOString());
    if (to) query = query.lte('created_at', to.toISOString());

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    let rows = filterRowsByContext(data || [], req.context);
    if (reason) rows = rows.filter((r) => r.event_type === reason || r.previous_status === reason || r.new_status === reason);

    // Average time on hold: pair hold_placed with hold_released (or auto_released) per customer.
    const byCustomer = new Map();
    for (const r of rows) {
      if (!byCustomer.has(r.customer_id)) byCustomer.set(r.customer_id, []);
      byCustomer.get(r.customer_id).push(r);
    }
    const durations = [];
    for (const events of byCustomer.values()) {
      const sorted = events.slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      let openHoldAt = null;
      for (const ev of sorted) {
        if (ev.event_type === 'hold_placed') openHoldAt = new Date(ev.created_at);
        else if (['hold_released', 'auto_released'].includes(ev.event_type) && openHoldAt) {
          durations.push((new Date(ev.created_at) - openHoldAt) / 86_400_000);
          openHoldAt = null;
        }
      }
    }
    const avgDays = durations.length ? round2(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

    res.json({
      generated_at: new Date().toISOString(),
      filters: { from, to, customer_id: customerId, reason },
      total_events: rows.length,
      avg_days_on_hold: avgDays,
      events: rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9C. GET /api/reporting/credit-override-audit
// Financial controls report — every override ever granted. Append-only by
// virtue of the underlying table; never deleted.
router.get('/credit-override-audit', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const from = toDateOrNull(req.query.from);
    const to = toDateOrNull(req.query.to);
    let query = scopeQueryByContext(supabase.from('credit_hold_overrides').select('*'), req.context).order('created_at', { ascending: false }).limit(5000);
    if (from) query = query.gte('created_at', from.toISOString());
    if (to) query = query.lte('created_at', to.toISOString());
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    const scoped = filterRowsByContext(data || [], req.context);
    const customerIds = [...new Set(scoped.map((o) => o.customer_id))];
    const userIds = [...new Set(scoped.map((o) => o.overridden_by))];
    const [custRes, userRes] = await Promise.all([
      customerIds.length ? scopeQueryByContext(supabase.from('Customers').select('id,company_name,company_id,location_id'), req.context).in('id', customerIds) : { data: [] },
      userIds.length ? scopeQueryByContext(supabase.from('users').select('id,email,name,company_id,location_id'), req.context).in('id', userIds) : { data: [] },
    ]);
    const customers = {};
    (custRes.data || []).forEach((c) => { customers[c.id] = c; });
    const users = {};
    (userRes.data || []).forEach((u) => { users[u.id] = u; });

    const rows = scoped.map((o) => ({
      override_id: o.id,
      created_at: o.created_at,
      customer_id: o.customer_id,
      company_name: customers[o.customer_id]?.company_name || null,
      order_id: o.order_id,
      overridden_by_email: users[o.overridden_by]?.email || null,
      overridden_by_name: users[o.overridden_by]?.name || null,
      override_reason: o.override_reason,
      customer_balance_at_override: o.customer_balance_at_override,
      credit_limit_at_override: o.credit_limit_at_override,
      expires_at: o.expires_at,
      consumed_at: o.consumed_at,
      is_one_time: o.is_one_time,
    }));

    if (String(req.query.format || '').toLowerCase() === 'csv') {
      const csv = toCsv(
        ['override_id', 'created_at', 'company_name', 'order_id', 'overridden_by_email', 'override_reason',
          'customer_balance_at_override', 'credit_limit_at_override', 'expires_at', 'consumed_at'],
        rows,
      );
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="credit-overrides-${new Date().toISOString().slice(0, 10)}.csv"`);
      return res.send(csv);
    }

    res.json({
      generated_at: new Date().toISOString(),
      filters: { from, to },
      total: rows.length,
      overrides: rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9D. GET /api/reporting/bad-debt-risk
router.get('/bad-debt-risk', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { data: invoices, error } = await scopeQueryByContext(supabase
      .from('invoices')
      .select('id, customer_id, customer_name, total, due_date, created_at, status, company_id, location_id'), req.context)
      .in('status', creditEngine.OPEN_INVOICE_STATUSES);
    if (error) return res.status(500).json({ error: error.message });

    const scoped = filterRowsByContext(invoices || [], req.context);
    const now = Date.now();
    const byCustomer = new Map();

    for (const inv of scoped) {
      const due = inv.due_date || inv.created_at;
      const days = due ? Math.floor((now - new Date(due).getTime()) / 86_400_000) : 0;
      if (days <= 90) continue;
      const key = inv.customer_id || inv.customer_name || inv.id;
      if (!byCustomer.has(key)) byCustomer.set(key, { customer_id: inv.customer_id, customer_name: inv.customer_name, total_at_risk: 0, oldest_days: 0, invoice_count: 0 });
      const entry = byCustomer.get(key);
      entry.total_at_risk += toNumber(inv.total, 0);
      entry.invoice_count += 1;
      if (days > entry.oldest_days) entry.oldest_days = days;
    }

    const rows = [...byCustomer.values()].map((entry) => {
      // Risk multiplier ramps from ~1.0 at 90 days to ~1.0 (we cap) — purely
      // a sorting heuristic; the field is labeled "estimated".
      const writeOffMultiplier = entry.oldest_days >= 180 ? 0.75 : entry.oldest_days >= 120 ? 0.5 : 0.25;
      return {
        ...entry,
        total_at_risk: round2(entry.total_at_risk),
        estimated_uncollectable: round2(entry.total_at_risk * writeOffMultiplier),
        risk_level: entry.oldest_days >= 180 ? 'high' : entry.oldest_days >= 120 ? 'medium' : 'low',
      };
    }).sort((a, b) => b.estimated_uncollectable - a.estimated_uncollectable);

    res.json({
      generated_at: new Date().toISOString(),
      total_customers_at_risk: rows.length,
      total_at_risk: round2(rows.reduce((s, r) => s + r.total_at_risk, 0)),
      total_estimated_uncollectable: round2(rows.reduce((s, r) => s + r.estimated_uncollectable, 0)),
      rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/reorder-performance', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const range = resolveReportingDateRange(req.query.start, req.query.end);
  if (range.error) return res.status(400).json({ error: range.error });
  const { startDate, endDate } = range;

  try {
    const { data, error } = await scopeQueryByContext(supabase
      .from('reorder_suggestions')
      .select('*'), req.context)
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString())
      .limit(5000);
    if (error) return res.status(500).json({ error: error.message });
    const rows = filterRowsByContext(data || [], req.context);
    const byStatus = rows.reduce((acc, row) => {
      const status = row.status || 'unknown';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});
    const converted = rows.filter((row) => row.status === 'converted_to_po' && row.approved_at);
    const avgHoursToPo = converted.length
      ? round2(converted.reduce((sum, row) => sum + Math.max(0, new Date(row.approved_at).getTime() - new Date(row.created_at).getTime()) / 3_600_000, 0) / converted.length)
      : 0;
    const lowConfidence = rows.filter((row) => toNumber(row.ai_confidence_score, 1) < 0.6).length;
    const stockoutSignals = rows.filter((row) => toNumber(row.days_of_stock_remaining, 999) <= 0).length;
    const overstockSignals = rows.filter((row) => {
      const breakdown = row.calculation_breakdown || {};
      return toNumber(breakdown.max_stock_level, 0) > 0
        && toNumber(row.current_stock, 0) + toNumber(row.suggested_quantity, 0) >= toNumber(breakdown.max_stock_level, 0);
    }).length;

    res.json({
      generated_at: new Date().toISOString(),
      filters: { start: startDate.toISOString(), end: endDate.toISOString() },
      total_suggestions: rows.length,
      approved_count: byStatus.approved || 0,
      converted_to_po_count: byStatus.converted_to_po || 0,
      dismissed_count: byStatus.dismissed || 0,
      ignored_pending_count: byStatus.pending || 0,
      snoozed_count: byStatus.snoozed || 0,
      average_hours_suggestion_to_po: avgHoursToPo,
      low_confidence_count: lowConfidence,
      stockout_signal_count: stockoutSignals,
      overstock_signal_count: overstockSignals,
      status_breakdown: byStatus,
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not build reorder performance report' });
  }
});

router.get('/stockout-risk', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const horizon = Math.max(1, Math.min(parseInt(req.query.days || '14', 10), 30));
  try {
    const { data, error } = await scopeQueryByContext(supabase
      .from('products')
      .select('id,item_number,name,description,category,unit,on_hand_qty,avg_daily_usage,reorder_point,safety_stock,lead_time_days,company_id,location_id'), req.context)
      .eq('reorder_enabled', true);
    if (error) return res.status(500).json({ error: error.message });
    const rows = filterRowsByContext(data || [], req.context)
      .map((product) => {
        const dailyUsage = toNumber(product.avg_daily_usage, 0);
        const currentStock = toNumber(product.on_hand_qty, 0);
        const daysRemaining = dailyUsage > 0 ? round2(currentStock / dailyUsage) : null;
        return {
          product_id: product.id,
          item_number: product.item_number,
          product_name: product.name || product.description,
          category: product.category,
          current_stock: currentStock,
          unit: product.unit,
          avg_daily_usage: dailyUsage,
          days_remaining: daysRemaining,
          projected_stock_at_horizon: dailyUsage > 0 ? round2(currentStock - dailyUsage * horizon) : currentStock,
          reorder_point: toNumber(product.reorder_point, 0),
          lead_time_days: product.lead_time_days,
          risk_level: daysRemaining === null ? 'unknown' : daysRemaining <= 2 ? 'critical' : daysRemaining <= horizon ? 'at_risk' : 'watch',
        };
      })
      .filter((row) => row.days_remaining === null || row.days_remaining <= horizon)
      .sort((a, b) => toNumber(a.days_remaining, 9999) - toNumber(b.days_remaining, 9999));
    res.json({
      generated_at: new Date().toISOString(),
      horizon_days: horizon,
      product_count: rows.length,
      products: rows,
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not build stockout risk report' });
  }
});

router.get('/inventory-turnover', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const days = Math.max(7, Math.min(parseInt(req.query.days || '30', 10), 365));
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  try {
    const { data: products, error: pErr } = await scopeQueryByContext(supabase
      .from('products')
      .select('id,item_number,name,description,category,unit,on_hand_qty,cost,avg_daily_usage,company_id,location_id'), req.context)
      .eq('reorder_enabled', true)
      .limit(5000);
    if (pErr) return res.status(500).json({ error: pErr.message });
    const scopedProducts = filterRowsByContext(products || [], req.context);
    const productIds = scopedProducts.map((product) => product.id).filter(Boolean);
    const { data: usage, error: uErr } = productIds.length
      ? await supabase
        .from('product_usage_history')
        .select('product_id,units_used,recorded_date')
        .in('product_id', productIds)
        .gte('recorded_date', since)
        .limit(10000)
      : { data: [], error: null };
    if (uErr) return res.status(500).json({ error: uErr.message });
    const usageByProduct = new Map();
    (usage || []).forEach((row) => {
      usageByProduct.set(row.product_id, toNumber(usageByProduct.get(row.product_id), 0) + toNumber(row.units_used, 0));
    });
    const rows = scopedProducts.map((product) => {
      const used = round2(usageByProduct.get(product.id) || 0);
      const onHand = toNumber(product.on_hand_qty, 0);
      const averageInventory = Math.max(1, (onHand + Math.max(0, onHand + used)) / 2);
      const turnover = round2(used / averageInventory);
      return {
        product_id: product.id,
        item_number: product.item_number,
        product_name: product.name || product.description,
        category: product.category,
        unit: product.unit,
        current_stock: onHand,
        units_used: used,
        turnover_ratio: turnover,
        days_of_stock: toNumber(product.avg_daily_usage, 0) > 0 ? round2(onHand / toNumber(product.avg_daily_usage, 0)) : null,
        movement_class: turnover >= 2 ? 'fast_mover' : turnover <= 0.25 ? 'slow_mover' : 'normal',
      };
    }).sort((a, b) => b.turnover_ratio - a.turnover_ratio);
    res.json({
      generated_at: new Date().toISOString(),
      window_days: days,
      fastest_movers: rows.filter((row) => row.movement_class === 'fast_mover').slice(0, 25),
      slow_movers: rows.filter((row) => row.movement_class === 'slow_mover').slice(0, 25),
      products: rows,
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not build inventory turnover report' });
  }
});

module.exports = { router, computeRollups, computeSalesSummary, computeRecentSoldItems, computeDailyOps };
