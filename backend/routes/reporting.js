const express = require('express');
const { supabase } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { filterRowsByContext } = require('../services/operating-context');

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

function itemLabelFromLine(line) {
  return String(line.item_number || line.description || line.name || 'Unknown Item').trim() || 'Unknown Item';
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

router.get('/rollups', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const startDate = toDateOrNull(req.query.start);
  const endDate = toDateOrNull(req.query.end);
  const limit = Math.max(1, Math.min(parseInt(req.query.limit || '100', 10), 500));

  try {
    const [ordersResult, invoicesResult, routesResult, inventoryResult] = await Promise.all([
      supabase.from('orders').select('*'),
      supabase.from('invoices').select('*'),
      supabase.from('routes').select('*'),
      supabase.from('seafood_inventory').select('item_number,description,cost'),
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
  const startDate = preset === 'range' ? toDateOrNull(req.query.start) : presetRange.start;
  const endDate = preset === 'range' ? toDateOrNull(req.query.end) : presetRange.end;
  const itemQuery = String(req.query.item || '').trim();

  try {
    const [ordersResult, invoicesResult] = await Promise.all([
      supabase.from('orders').select('*'),
      supabase.from('invoices').select('*'),
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
    const invoicesResult = await supabase.from('invoices').select('*');
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

module.exports = { router, computeRollups, computeSalesSummary, computeRecentSoldItems };
