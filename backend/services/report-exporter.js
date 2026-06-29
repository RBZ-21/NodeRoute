'use strict';

const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const { supabase: defaultDb } = require('./supabase');

const REPORT_CATALOG = [
  {
    query_key: 'chain_store',
    name: 'Chain Store Report',
    category: 'Sales',
    title: 'Chain Store Report',
    description: 'Customer sales grouped for chain-store review.',
    columns: [
      { key: 'chain_name', header: 'Chain' },
      { key: 'customer_count', header: 'Customers' },
      { key: 'invoice_count', header: 'Invoices' },
      { key: 'total_sales', header: 'Total Sales' },
      { key: 'open_balance', header: 'Open Balance' },
    ],
  },
  {
    query_key: 'commodity',
    name: 'Commodity Report',
    category: 'Inventory',
    title: 'Commodity Report',
    description: 'Sales and quantities by commodity or category.',
    columns: [
      { key: 'commodity', header: 'Commodity' },
      { key: 'qty', header: 'Qty' },
      { key: 'revenue', header: 'Revenue' },
      { key: 'invoice_count', header: 'Invoices' },
    ],
  },
  {
    query_key: 'gross_profit',
    name: 'Gross Profit Report',
    category: 'Analytics',
    title: 'Gross Profit',
    description: 'Revenue, estimated cost, and gross profit by item.',
    columns: [
      { key: 'item_number', header: 'Item #' },
      { key: 'description', header: 'Description' },
      { key: 'qty', header: 'Qty' },
      { key: 'revenue', header: 'Revenue' },
      { key: 'estimated_cost', header: 'Estimated Cost' },
      { key: 'gross_profit', header: 'Gross Profit' },
      { key: 'margin_pct', header: 'Margin %' },
    ],
  },
  {
    query_key: 'invoice_register',
    name: 'Invoice Register',
    category: 'Financials',
    title: 'Invoice Register',
    description: 'Invoice totals, balances, dates, and status.',
    columns: [
      { key: 'invoice_number', header: 'Invoice' },
      { key: 'customer_name', header: 'Customer' },
      { key: 'invoice_date', header: 'Invoice Date' },
      { key: 'due_date', header: 'Due Date' },
      { key: 'status', header: 'Status' },
      { key: 'total', header: 'Total' },
      { key: 'open_balance', header: 'Open Balance' },
    ],
  },
  {
    query_key: 'tonnage',
    name: 'Tonnage Report',
    category: 'Operations',
    title: 'Tonnage Report',
    description: 'Pounds and tons shipped by product.',
    columns: [
      { key: 'item_number', header: 'Item #' },
      { key: 'description', header: 'Description' },
      { key: 'pounds', header: 'Pounds' },
      { key: 'tons', header: 'Tons' },
      { key: 'revenue', header: 'Revenue' },
    ],
  },
  {
    query_key: 'comparative_sales',
    name: 'Comparative Sales Report',
    category: 'Analytics',
    title: 'Comparative Sales',
    description: 'Current period sales compared with the prior period.',
    columns: [
      { key: 'customer_name', header: 'Customer' },
      { key: 'current_sales', header: 'Current Sales' },
      { key: 'prior_sales', header: 'Prior Sales' },
      { key: 'change_amount', header: 'Change' },
      { key: 'change_pct', header: 'Change %' },
    ],
  },
  {
    query_key: 'price_exceptions',
    name: 'Price Exceptions Report',
    category: 'Pricing',
    title: 'Price Exceptions',
    description: 'Invoices and order lines with pricing exceptions.',
    columns: [
      { key: 'invoice_number', header: 'Invoice' },
      { key: 'customer_name', header: 'Customer' },
      { key: 'item_number', header: 'Item #' },
      { key: 'description', header: 'Description' },
      { key: 'unit_price', header: 'Unit Price' },
      { key: 'expected_price', header: 'Expected Price' },
      { key: 'reason', header: 'Reason' },
    ],
  },
  {
    query_key: 'weekly_projections',
    name: 'Weekly Projections Report',
    category: 'Planning',
    title: 'Weekly Projections',
    description: 'Projected weekly demand and low-stock exposure.',
    columns: [
      { key: 'item_number', header: 'Item #' },
      { key: 'description', header: 'Description' },
      { key: 'on_hand_qty', header: 'On Hand' },
      { key: 'avg_daily_usage', header: 'Avg Daily Usage' },
      { key: 'projected_weekly_usage', header: 'Projected Weekly Usage' },
      { key: 'projected_ending_stock', header: 'Projected Ending Stock' },
      { key: 'risk_level', header: 'Risk' },
    ],
  },
];

const REPORTS_BY_KEY = new Map(REPORT_CATALOG.map((definition) => [definition.query_key, definition]));

function normalizeQueryKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round2(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

function dateOnly(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function parseItems(invoice) {
  const raw = invoice?.items ?? invoice?.line_items ?? [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function itemNumber(line) {
  return String(line?.item_number || line?.sku || line?.product_id || '').trim();
}

function itemDescription(line, product) {
  return String(line?.description || line?.name || product?.description || product?.name || itemNumber(line) || 'Unknown Item').trim();
}

function lineQty(line) {
  return toNumber(line?.quantity ?? line?.qty ?? line?.cases ?? line?.units, 0);
}

function lineUnitPrice(line) {
  return toNumber(line?.unit_price ?? line?.price ?? line?.sell_price, 0);
}

function lineRevenue(line) {
  const explicit = line?.total ?? line?.line_total ?? line?.extended_price;
  if (explicit !== undefined && explicit !== null && explicit !== '') return toNumber(explicit, 0);
  return lineQty(line) * lineUnitPrice(line);
}

function normalizeColumns(columns) {
  return (columns || []).map((column) => (
    typeof column === 'string' ? { key: column, header: column } : column
  ));
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function safeWorksheetName(title) {
  const cleaned = String(title || 'Report').replace(/[\][*?:/\\]/g, ' ').trim() || 'Report';
  return cleaned.slice(0, 31);
}

function filterByDate(rows, params = {}) {
  const start = params.startDate || params.start || null;
  const end = params.endDate || params.end || null;
  const startTime = start ? new Date(`${dateOnly(start)}T00:00:00.000Z`).getTime() : null;
  const endTime = end ? new Date(`${dateOnly(end)}T23:59:59.999Z`).getTime() : null;
  return rows.filter((row) => {
    const raw = row.invoice_date || row.due_date || row.created_at || row.entry_date;
    if (!raw) return true;
    const time = new Date(raw).getTime();
    if (Number.isNaN(time)) return true;
    if (startTime !== null && time < startTime) return false;
    if (endTime !== null && time > endTime) return false;
    return true;
  });
}

async function selectCompanyRows(db, table, companyId, select = '*', limit = 5000) {
  let query = db.from(table).select(select).limit(limit);
  if (companyId) query = query.eq('company_id', companyId);
  const { data, error } = await query;
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function invoiceRows(db, companyId, params = {}) {
  const rows = await selectCompanyRows(db, 'invoices', companyId, '*', 10000);
  return filterByDate(rows, params);
}

async function productMap(db, companyId) {
  const products = await selectCompanyRows(db, 'products', companyId, '*', 10000);
  const byItem = new Map();
  const byId = new Map();
  for (const product of products) {
    if (product.item_number) byItem.set(String(product.item_number), product);
    if (product.id) byId.set(String(product.id), product);
  }
  return { products, byItem, byId };
}

async function chainStoreReport(companyId, params = {}, options = {}) {
  const db = options.db || defaultDb;
  const [customers, invoices] = await Promise.all([
    selectCompanyRows(db, 'Customers', companyId, '*', 10000),
    invoiceRows(db, companyId, params),
  ]);
  const customersById = new Map(customers.map((customer) => [String(customer.id), customer]));
  const groups = new Map();

  for (const invoice of invoices) {
    const customer = customersById.get(String(invoice.customer_id || ''));
    const chainName = customer?.chain_name || customer?.parent_company_name || customer?.company_name || invoice.customer_name || 'Unassigned';
    const key = String(chainName).trim() || 'Unassigned';
    if (!groups.has(key)) {
      groups.set(key, {
        chain_name: key,
        customers: new Set(),
        customer_count: 0,
        invoice_count: 0,
        total_sales: 0,
        open_balance: 0,
      });
    }
    const row = groups.get(key);
    if (invoice.customer_id) row.customers.add(String(invoice.customer_id));
    row.invoice_count += 1;
    row.total_sales += toNumber(invoice.total, 0);
    row.open_balance += toNumber(invoice.open_balance ?? invoice.balance_due, 0);
  }

  return [...groups.values()].map((row) => ({
    chain_name: row.chain_name,
    customer_count: row.customers.size || row.customer_count,
    invoice_count: row.invoice_count,
    total_sales: round2(row.total_sales),
    open_balance: round2(row.open_balance),
  })).sort((a, b) => b.total_sales - a.total_sales || a.chain_name.localeCompare(b.chain_name));
}

async function commodityReport(companyId, params = {}, options = {}) {
  const db = options.db || defaultDb;
  const [invoices, products] = await Promise.all([
    invoiceRows(db, companyId, params),
    productMap(db, companyId),
  ]);
  const groups = new Map();

  for (const invoice of invoices) {
    for (const line of parseItems(invoice)) {
      const product = products.byItem.get(itemNumber(line)) || products.byId.get(String(line.product_id || ''));
      const commodity = String(line.commodity || product?.commodity || product?.category || line.category || 'Uncategorized').trim() || 'Uncategorized';
      const row = groups.get(commodity) || { commodity, qty: 0, revenue: 0, invoice_ids: new Set() };
      row.qty += lineQty(line);
      row.revenue += lineRevenue(line);
      row.invoice_ids.add(String(invoice.id));
      groups.set(commodity, row);
    }
  }

  return [...groups.values()].map((row) => ({
    commodity: row.commodity,
    qty: round2(row.qty),
    revenue: round2(row.revenue),
    invoice_count: row.invoice_ids.size,
  })).sort((a, b) => b.revenue - a.revenue || a.commodity.localeCompare(b.commodity));
}

async function grossProfitReport(companyId, params = {}, options = {}) {
  const db = options.db || defaultDb;
  const [invoices, products] = await Promise.all([
    invoiceRows(db, companyId, params),
    productMap(db, companyId),
  ]);
  const groups = new Map();

  for (const invoice of invoices) {
    for (const line of parseItems(invoice)) {
      const product = products.byItem.get(itemNumber(line)) || products.byId.get(String(line.product_id || ''));
      const key = itemNumber(line) || String(line.description || line.name || line.product_id || 'unknown');
      const row = groups.get(key) || {
        item_number: itemNumber(line) || product?.item_number || '',
        description: itemDescription(line, product),
        qty: 0,
        revenue: 0,
        estimated_cost: 0,
      };
      const qty = lineQty(line);
      const revenue = lineRevenue(line);
      const unitCost = toNumber(line.cost ?? line.unit_cost ?? product?.cost, 0);
      row.qty += qty;
      row.revenue += revenue;
      row.estimated_cost += unitCost * qty;
      groups.set(key, row);
    }
  }

  return [...groups.values()].map((row) => {
    const grossProfit = row.revenue - row.estimated_cost;
    return {
      ...row,
      qty: round2(row.qty),
      revenue: round2(row.revenue),
      estimated_cost: round2(row.estimated_cost),
      gross_profit: round2(grossProfit),
      margin_pct: row.revenue ? round2((grossProfit / row.revenue) * 100) : 0,
    };
  }).sort((a, b) => b.gross_profit - a.gross_profit || a.description.localeCompare(b.description));
}

async function invoiceRegisterReport(companyId, params = {}, options = {}) {
  const db = options.db || defaultDb;
  const invoices = await invoiceRows(db, companyId, params);
  return invoices.map((invoice) => ({
    invoice_number: invoice.invoice_number || invoice.id,
    customer_name: invoice.customer_name || invoice.customer_id || '',
    invoice_date: dateOnly(invoice.invoice_date || invoice.created_at),
    due_date: dateOnly(invoice.due_date),
    status: invoice.status || '',
    total: round2(invoice.total),
    open_balance: round2(invoice.open_balance ?? invoice.balance_due ?? 0),
  })).sort((a, b) => String(b.invoice_date || '').localeCompare(String(a.invoice_date || '')));
}

async function tonnageReport(companyId, params = {}, options = {}) {
  const db = options.db || defaultDb;
  const [invoices, products] = await Promise.all([
    invoiceRows(db, companyId, params),
    productMap(db, companyId),
  ]);
  const groups = new Map();

  for (const invoice of invoices) {
    for (const line of parseItems(invoice)) {
      const product = products.byItem.get(itemNumber(line)) || products.byId.get(String(line.product_id || ''));
      const key = itemNumber(line) || String(line.description || line.name || line.product_id || 'unknown');
      const row = groups.get(key) || {
        item_number: itemNumber(line) || product?.item_number || '',
        description: itemDescription(line, product),
        pounds: 0,
        revenue: 0,
      };
      const explicitPounds = toNumber(line.weight_lbs ?? line.pounds ?? line.catch_weight_lbs, NaN);
      const qty = lineQty(line);
      const unit = String(line.unit || product?.unit || '').toLowerCase();
      const pounds = Number.isFinite(explicitPounds)
        ? explicitPounds
        : unit.includes('ton') ? qty * 2000 : qty;
      row.pounds += pounds;
      row.revenue += lineRevenue(line);
      groups.set(key, row);
    }
  }

  return [...groups.values()].map((row) => ({
    ...row,
    pounds: round2(row.pounds),
    tons: round2(row.pounds / 2000),
    revenue: round2(row.revenue),
  })).sort((a, b) => b.pounds - a.pounds || a.description.localeCompare(b.description));
}

async function comparativeSalesReport(companyId, params = {}, options = {}) {
  const db = options.db || defaultDb;
  const allInvoices = await selectCompanyRows(db, 'invoices', companyId, '*', 10000);
  const end = new Date(params.end || params.endDate || Date.now());
  const start = new Date(params.start || params.startDate || end.getTime() - 29 * 86_400_000);
  const days = Math.max(1, Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1);
  const priorEnd = new Date(start.getTime() - 1);
  const priorStart = new Date(priorEnd.getTime() - (days - 1) * 86_400_000);
  const groups = new Map();

  function add(invoice, field) {
    const key = String(invoice.customer_id || invoice.customer_name || 'Unassigned');
    const row = groups.get(key) || {
      customer_name: invoice.customer_name || invoice.customer_id || 'Unassigned',
      current_sales: 0,
      prior_sales: 0,
    };
    row[field] += toNumber(invoice.total, 0);
    groups.set(key, row);
  }

  for (const invoice of allInvoices) {
    const time = new Date(invoice.invoice_date || invoice.created_at || 0).getTime();
    if (time >= start.getTime() && time <= end.getTime()) add(invoice, 'current_sales');
    if (time >= priorStart.getTime() && time <= priorEnd.getTime()) add(invoice, 'prior_sales');
  }

  return [...groups.values()].map((row) => {
    const change = row.current_sales - row.prior_sales;
    return {
      customer_name: row.customer_name,
      current_sales: round2(row.current_sales),
      prior_sales: round2(row.prior_sales),
      change_amount: round2(change),
      change_pct: row.prior_sales ? round2((change / row.prior_sales) * 100) : (row.current_sales ? 100 : 0),
    };
  }).sort((a, b) => Math.abs(b.change_amount) - Math.abs(a.change_amount));
}

async function priceExceptionsReport(companyId, params = {}, options = {}) {
  const db = options.db || defaultDb;
  const invoices = await invoiceRows(db, companyId, params);
  const rows = [];

  for (const invoice of invoices) {
    for (const line of parseItems(invoice)) {
      const expected = toNumber(line.expected_price ?? line.list_price ?? line.min_sell_price, NaN);
      const actual = lineUnitPrice(line);
      const reason = line.override_reason || line.price_exception_reason || line.exception_reason
        || (Number.isFinite(expected) && actual < expected ? 'Below expected price' : null);
      if (!reason) continue;
      rows.push({
        invoice_number: invoice.invoice_number || invoice.id,
        customer_name: invoice.customer_name || invoice.customer_id || '',
        item_number: itemNumber(line),
        description: itemDescription(line),
        unit_price: round2(actual),
        expected_price: Number.isFinite(expected) ? round2(expected) : null,
        reason,
      });
    }
  }

  return rows.sort((a, b) => String(a.customer_name).localeCompare(String(b.customer_name)));
}

async function weeklyProjectionsReport(companyId, params = {}, options = {}) {
  const db = options.db || defaultDb;
  const products = await selectCompanyRows(db, 'products', companyId, '*', 10000);
  return products.map((product) => {
    const onHand = toNumber(product.on_hand_qty ?? product.quantity ?? product.stock_qty, 0);
    const daily = toNumber(product.avg_daily_usage, 0);
    const weekly = daily * toNumber(params.days || 7, 7);
    const ending = onHand - weekly;
    return {
      item_number: product.item_number || '',
      description: product.description || product.name || product.item_number || '',
      on_hand_qty: round2(onHand),
      avg_daily_usage: round2(daily),
      projected_weekly_usage: round2(weekly),
      projected_ending_stock: round2(ending),
      risk_level: ending <= 0 ? 'stockout' : ending <= toNumber(product.reorder_point, 0) ? 'reorder' : 'ok',
    };
  }).sort((a, b) => a.projected_ending_stock - b.projected_ending_stock || a.description.localeCompare(b.description));
}

const QUERY_HANDLERS = {
  chain_store: chainStoreReport,
  chainStoreReport,
  commodity: commodityReport,
  commodity_report: commodityReport,
  commodityReport,
  gross_profit: grossProfitReport,
  grossProfitReport,
  invoice_register: invoiceRegisterReport,
  invoiceRegisterReport,
  tonnage: tonnageReport,
  tonnage_report: tonnageReport,
  tonnageReport,
  comparative_sales: comparativeSalesReport,
  comparativeSalesReport,
  price_exceptions: priceExceptionsReport,
  priceExceptionsReport,
  weekly_projections: weeklyProjectionsReport,
  weeklyProjectionsReport,
};

function getReportDefinitionCatalog() {
  return REPORT_CATALOG.map((definition) => ({ ...definition, columns: [...definition.columns] }));
}

function resolveReport(queryKey) {
  const normalized = normalizeQueryKey(queryKey);
  const handler = QUERY_HANDLERS[normalized] || QUERY_HANDLERS[queryKey];
  if (!handler) {
    const error = new Error(`Unknown report query key: ${queryKey}`);
    error.status = 400;
    throw error;
  }
  const metadata = REPORTS_BY_KEY.get(normalized) || REPORT_CATALOG.find((definition) => definition.query_key === normalized) || {
    query_key: normalized,
    name: normalized,
    title: normalized,
    columns: [],
  };
  return { handler, metadata };
}

async function runNamedReport(queryKey, companyId, params = {}, options = {}) {
  const { handler, metadata } = resolveReport(queryKey);
  const rows = await handler(companyId, params, options);
  return {
    query_key: metadata.query_key,
    title: metadata.title || metadata.name,
    columns: metadata.columns || [],
    rows,
  };
}

function toCSV(rows, columns) {
  const cols = normalizeColumns(columns);
  const lines = [cols.map((column) => csvEscape(column.header || column.key)).join(',')];
  for (const row of rows || []) {
    lines.push(cols.map((column) => csvEscape(row?.[column.key])).join(','));
  }
  return Buffer.from(`${lines.join('\n')}\n`, 'utf8');
}

function toText(rows, columns, widths = {}) {
  const cols = normalizeColumns(columns);
  const widthFor = (column) => Math.max(4, Number(widths[column.key] || column.width || 16));
  const format = (value, width) => String(value ?? '').slice(0, width).padEnd(width, ' ');
  const lines = [
    cols.map((column) => format(column.header || column.key, widthFor(column))).join(' '),
    cols.map((column) => '-'.repeat(widthFor(column))).join(' '),
  ];
  for (const row of rows || []) {
    lines.push(cols.map((column) => format(row?.[column.key], widthFor(column))).join(' '));
  }
  return Buffer.from(`${lines.join('\n')}\n`, 'utf8');
}

async function toPDF(rows, columns, title = 'Report') {
  const cols = normalizeColumns(columns);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'LETTER' });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(16).text(title, { align: 'left' });
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(9).fillColor('#555').text(`Generated ${new Date().toISOString()}`);
    doc.moveDown();

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const colWidth = Math.max(70, pageWidth / Math.max(cols.length, 1));
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#111');
    cols.forEach((column, index) => {
      doc.text(column.header || column.key, doc.page.margins.left + index * colWidth, doc.y, { width: colWidth - 4, continued: index < cols.length - 1 });
    });
    doc.text('');
    doc.moveDown(0.25);
    doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor('#cccccc').stroke();
    doc.moveDown(0.5);

    doc.font('Helvetica').fontSize(8).fillColor('#222');
    for (const row of rows || []) {
      if (doc.y > doc.page.height - doc.page.margins.bottom - 24) doc.addPage();
      const y = doc.y;
      cols.forEach((column, index) => {
        doc.text(String(row?.[column.key] ?? ''), doc.page.margins.left + index * colWidth, y, { width: colWidth - 4, height: 24 });
      });
      doc.y = y + 26;
    }
    doc.end();
  });
}

async function toExcel(rows, columns, title = 'Report') {
  // ExcelJS is used only in the backend so scheduled/exported workbooks are
  // generated server-side without shipping spreadsheet dependencies to clients.
  const cols = normalizeColumns(columns);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'NodeRoute';
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet(safeWorksheetName(title));
  worksheet.columns = cols.map((column) => ({
    header: column.header || column.key,
    key: column.key,
    width: Math.max(12, Math.min(40, Number(column.width || String(column.header || column.key).length + 6))),
  }));
  for (const row of rows || []) worksheet.addRow(row);
  worksheet.getRow(1).font = { bold: true };
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
}

async function exportReport(queryKey, companyId, params = {}, format = 'csv', options = {}) {
  const report = await runNamedReport(queryKey, companyId, params, options);
  const normalizedFormat = String(format || 'csv').toLowerCase();
  if (normalizedFormat === 'csv') {
    return { ...report, buffer: toCSV(report.rows, report.columns), contentType: 'text/csv', extension: 'csv' };
  }
  if (normalizedFormat === 'text' || normalizedFormat === 'txt') {
    return { ...report, buffer: toText(report.rows, report.columns), contentType: 'text/plain', extension: 'txt' };
  }
  if (normalizedFormat === 'pdf') {
    return { ...report, buffer: await toPDF(report.rows, report.columns, report.title), contentType: 'application/pdf', extension: 'pdf' };
  }
  if (normalizedFormat === 'excel' || normalizedFormat === 'xlsx') {
    return {
      ...report,
      buffer: await toExcel(report.rows, report.columns, report.title),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      extension: 'xlsx',
    };
  }
  const error = new Error(`Unsupported report format: ${format}`);
  error.status = 400;
  throw error;
}

module.exports = {
  REPORT_CATALOG,
  chainStoreReport,
  commodityReport,
  comparativeSalesReport,
  exportReport,
  getReportDefinitionCatalog,
  grossProfitReport,
  invoiceRegisterReport,
  priceExceptionsReport,
  runNamedReport,
  toCSV,
  toExcel,
  toPDF,
  toText,
  tonnageReport,
  weeklyProjectionsReport,
};
