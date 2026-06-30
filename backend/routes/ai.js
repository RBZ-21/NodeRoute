'use strict';

const express = require('express');
const multer = require('multer');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { supabase } = require('../services/supabase');
const {
  generateWalkthrough,
  generateOrderIntakeDraft,
  generateChatReplyWithContext,
  checkChatRateLimit,
  analyzeInventory,
  parsePurchaseOrderImage,
  optimizeRoute,
  scoreCustomerRisk,
  detectAnomalies,
  scoreVendorPerformance,
  scoreVendorList,
  optimizeDriverAssignments,
  generateMarkdownRecommendations,
  generateInvoiceFollowUp,
  generateBulkReorderAlerts,
  scoreLatePaymentRisk,
  detectPricingAnomalies,
} = require('../services/ai');
const { recordPoInvoiceScan } = require('../services/purchase-order-workflows');
const { getAiScanErrorResponse } = require('../services/ai-errors');
const { filterRowsByContext, scopeQueryByContext } = require('../services/operating-context');

const router = express.Router();
const MAX_SCAN_PAGES = 5;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Multer rejects extra files past maxCount / oversized files with terse codes;
// translate those into the same friendly 400s the handler uses for its own checks.
function scanUpload(req, res, next) {
  const middleware = upload.fields([
    { name: 'file', maxCount: MAX_SCAN_PAGES },
    { name: 'image', maxCount: MAX_SCAN_PAGES },
  ]);
  middleware(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: `Too many pages. Upload at most ${MAX_SCAN_PAGES} images per scan.` });
    }
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Each image must be 10MB or smaller.' });
    }
    return next(err);
  });
}
const CHAT_STOPWORDS = new Set([
  'a', 'about', 'all', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'by', 'can',
  'customer', 'customers', 'delivery', 'deliveries', 'do', 'for', 'from', 'get',
  'give', 'has', 'have', 'help', 'how', 'i', 'in', 'invoice', 'invoices', 'is',
  'it', 'list', 'me', 'my', 'need', 'of', 'on', 'or', 'our', 'payment', 'po',
  'purchase', 'route', 'routes', 'show', 'status', 'stock', 'supplier', 'tell',
  'the', 'there', 'these', 'today', 'to', 'vendor', 'vendors', 'what', 'which',
  'with', 'you',
]);

function uniqBy(items, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of items || []) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function includesText(value, term) {
  const haystack = String(value || '').trim().toLowerCase();
  const needle = String(term || '').trim().toLowerCase();
  return !!haystack && !!needle && haystack.includes(needle);
}

function detectChatTopics(message) {
  const msg = String(message || '').toLowerCase();
  return {
    overview: /today|overview|summary|what(?:'s| is) going on|dashboard|anything urgent/.test(msg),
    orders: /order|orders|delivery|deliveries|shipment|shipments|status/.test(msg),
    inventory: /inventory|stock|sku|item|items|product|products|reorder|low stock|out of stock|spoilage/.test(msg),
    invoices: /invoice|invoices|payment|payments|overdue|ar|accounts receivable|collections/.test(msg),
    customers: /customer|customers|account|accounts|credit hold|hold/.test(msg),
    routes: /route|routes|driver|drivers|stop|stops|dispatch/.test(msg),
    vendors: /vendor|vendors|supplier|suppliers|purchase order|purchase orders|receiving|po\b/.test(msg),
    warehouse: /warehouse|cooler|freezer|lot|traceability|barcode|scan/.test(msg),
  };
}

function extractChatSearchTerms(message) {
  const text = String(message || '');
  const quotedTerms = Array.from(text.matchAll(/"([^"]+)"/g))
    .map((match) => String(match[1] || '').trim())
    .filter((term) => term.length >= 3);
  const wordTerms = text
    .replace(/[^A-Za-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length >= 3 && !CHAT_STOPWORDS.has(token));

  return Array.from(new Set([...quotedTerms, ...wordTerms])).slice(0, 5);
}

async function runScopedQuery(query, context) {
  const { data, error } = await scopeQueryByContext(query, context);
  if (error) throw error;
  return filterRowsByContext(data || [], context);
}

async function runOptionalScopedQuery(query, context) {
  try {
    const { data, error } = await scopeQueryByContext(query, context);
    if (error) return [];
    return filterRowsByContext(data || [], context);
  } catch {
    return [];
  }
}

async function searchTableByTerms({ table, field, select, terms, context, limit = 5, orderField = null }) {
  const matches = [];
  for (const term of terms || []) {
    let query = supabase.from(table).select(select).ilike(field, `%${term}%`).limit(limit);
    if (orderField) query = query.order(orderField, { ascending: false });
    const rows = await runScopedQuery(query, context);
    matches.push(...rows);
    if (matches.length >= limit) break;
  }
  return uniqBy(matches, (row) => row.id || row.item_number || row.customer_number || row.po_number || row.name).slice(0, limit);
}

const CHAT_INVENTORY_SELECT = 'id,item_number,description,on_hand_qty,unit,category,company_id,location_id';

function normalizeChatInventoryItem(item) {
  return {
    ...item,
    description: item.description || item.name || item.item_number || 'Unknown item',
  };
}

async function loadChatInventory(context) {
  const [products, legacyInventory] = await Promise.all([
    runOptionalScopedQuery(
      supabase.from('products')
        .select(CHAT_INVENTORY_SELECT)
        .order('description', { ascending: true }),
      context
    ),
    runOptionalScopedQuery(
      supabase.from('seafood_inventory')
        .select(CHAT_INVENTORY_SELECT)
        .order('description', { ascending: true }),
      context
    ),
  ]);

  return uniqBy([...products, ...legacyInventory].map(normalizeChatInventoryItem), (row) => row.id || row.item_number);
}

async function searchInventoryByTerms({ terms, context, limit = 5 }) {
  const matches = [];
  for (const term of terms || []) {
    const [products, legacyInventory] = await Promise.all([
      runOptionalScopedQuery(
        supabase.from('products')
          .select(CHAT_INVENTORY_SELECT)
          .ilike('description', `%${term}%`)
          .limit(limit),
        context
      ),
      runOptionalScopedQuery(
        supabase.from('seafood_inventory')
          .select(CHAT_INVENTORY_SELECT)
          .ilike('description', `%${term}%`)
          .limit(limit),
        context
      ),
    ]);
    matches.push(...products, ...legacyInventory);
    if (matches.length >= limit) break;
  }
  return uniqBy(matches.map(normalizeChatInventoryItem), (row) => row.id || row.item_number).slice(0, limit);
}

function buildChatOverview({ recentOrders, overdueInvoices, lowInventory, activeRoutes, creditHoldCustomers, vendorPurchaseOrders }) {
  return {
    recent_order_count: (recentOrders || []).length,
    overdue_invoice_count: (overdueInvoices || []).length,
    low_inventory_count: (lowInventory || []).length,
    active_route_count: (activeRoutes || []).length,
    credit_hold_count: (creditHoldCustomers || []).length,
    open_vendor_po_count: (vendorPurchaseOrders || []).length,
  };
}

async function loadChatContext(message, context = {}) {
  const topics = detectChatTopics(message);
  const searchTerms = extractChatSearchTerms(message);
  const shouldLoadOverview = topics.overview || !Object.values(topics).some(Boolean);
  const shouldLoadOrders = shouldLoadOverview || topics.orders || topics.customers || topics.routes;
  const shouldLoadInventory = shouldLoadOverview || topics.inventory || topics.warehouse;
  const shouldLoadInvoices = shouldLoadOverview || topics.invoices || topics.customers;
  const shouldLoadCustomers = shouldLoadOverview || topics.customers;
  const shouldLoadRoutes = shouldLoadOverview || topics.routes || topics.orders;
  const shouldLoadVendors = shouldLoadOverview || topics.vendors || topics.inventory;

  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  const [
    recentOrders,
    allInventory,
    overdueInvoices,
    creditHoldCustomers,
    activeRoutes,
    vendorPurchaseOrders,
    matchingCustomers,
    matchingProducts,
    matchingVendors,
    matchingRoutes,
  ] = await Promise.all([
    shouldLoadOrders
      ? runScopedQuery(
        supabase.from('orders')
          .select('id,order_number,customer_name,status,created_at')
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(15),
        context
      )
      : Promise.resolve([]),
    shouldLoadInventory
      ? loadChatInventory(context)
      : Promise.resolve([]),
    shouldLoadInvoices
      ? runScopedQuery(
        supabase.from('invoices')
          .select('id,invoice_number,customer_name,total,due_date,status,created_at')
          .in('status', ['overdue', 'sent', 'draft'])
          .order('due_date', { ascending: true })
          .limit(15),
        context
      )
      : Promise.resolve([]),
    shouldLoadCustomers
      ? runScopedQuery(
        supabase.from('customers')
          .select('id,customer_number,company_name,credit_hold_reason')
          .order('company_name', { ascending: true })
          .limit(25),
        context
      )
      : Promise.resolve([]),
    shouldLoadRoutes
      ? runScopedQuery(
        supabase.from('routes')
          .select('id,name,driver,driver_id,active_stop_ids,stop_ids,created_at')
          .gte('created_at', thirtyDaysAgo)
          .order('created_at', { ascending: false })
          .limit(12),
        context
      )
      : Promise.resolve([]),
    shouldLoadVendors
      ? runScopedQuery(
        supabase.from('purchase_orders')
          .select('id,po_number,vendor,status,total_cost,workflow_kind,created_at')
          .gte('created_at', thirtyDaysAgo)
          .order('created_at', { ascending: false })
          .limit(12),
        context
      )
      : Promise.resolve([]),
    searchTerms.length
      ? searchTableByTerms({
        table: 'customers',
        field: 'company_name',
        select: 'id,customer_number,company_name,credit_hold_reason',
        terms: searchTerms,
        context,
      })
      : Promise.resolve([]),
    searchTerms.length
      ? searchInventoryByTerms({ terms: searchTerms, context })
      : Promise.resolve([]),
    searchTerms.length
      ? searchTableByTerms({
        table: 'vendors',
        field: 'name',
        select: 'id,name',
        terms: searchTerms,
        context,
      })
      : Promise.resolve([]),
    searchTerms.length
      ? searchTableByTerms({
        table: 'routes',
        field: 'name',
        select: 'id,name,driver,driver_id,active_stop_ids,stop_ids,created_at',
        terms: searchTerms,
        context,
        orderField: 'created_at',
      })
      : Promise.resolve([]),
  ]);

  const lowInventory = (allInventory || [])
    .filter((item) => Number(item.on_hand_qty || 0) <= 5)
    .slice(0, 10);
  const overdueOnly = (overdueInvoices || []).filter((invoice) => String(invoice.status || '').toLowerCase() === 'overdue');
  const holdOnly = (creditHoldCustomers || []).filter((customer) => String(customer.credit_hold_reason || '').trim());
  const openVendorPos = (vendorPurchaseOrders || [])
    .filter((po) => {
      const workflowKind = String(po.workflow_kind || '').trim().toLowerCase();
      const status = String(po.status || '').trim().toLowerCase();
      return (!workflowKind || workflowKind === 'vendor_order') && !['received', 'closed', 'cancelled'].includes(status);
    })
    .slice(0, 10);

  const matchingOrders = (recentOrders || []).filter((order) =>
    searchTerms.some((term) => includesText(order.customer_name, term) || includesText(order.order_number, term))
  ).slice(0, 5);
  const matchingInvoices = (overdueInvoices || []).filter((invoice) =>
    searchTerms.some((term) => includesText(invoice.customer_name, term) || includesText(invoice.invoice_number, term))
  ).slice(0, 5);

  return {
    topics,
    search_terms: searchTerms,
    overview: buildChatOverview({
      recentOrders,
      overdueInvoices: overdueOnly,
      lowInventory,
      activeRoutes,
      creditHoldCustomers: holdOnly,
      vendorPurchaseOrders: openVendorPos,
    }),
    recentOrders: recentOrders || [],
    lowInventory,
    overdueInvoices: overdueOnly,
    creditHoldCustomers: holdOnly,
    activeRoutes: activeRoutes || [],
    vendorPurchaseOrders: openVendorPos,
    matchingCustomers,
    matchingProducts,
    matchingVendors,
    matchingRoutes,
    matchingOrders,
    matchingInvoices,
  };
}

// ── PER-USER AI RATE LIMITER ───────────────────────────────────────────────────
// Sliding window — tracks timestamps of calls per user per endpoint group.
// "heavy" endpoints (OpenAI calls with DB fetches): 20 per hour per user.
// "chat" endpoint keeps its own existing checkChatRateLimit (60/hr).
const AI_RATE_WINDOWS = new Map(); // key: `${userId}:${group}` → [timestamp, ...]
const HEAVY_LIMIT = 20;            // max calls
const HEAVY_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function checkAiRateLimit(userId, group) {
  const key = `${userId}:${group}`;
  const now = Date.now();
  const cutoff = now - HEAVY_WINDOW_MS;

  const timestamps = (AI_RATE_WINDOWS.get(key) || []).filter((t) => t > cutoff);
  if (timestamps.length >= HEAVY_LIMIT) {
    return false;
  }
  timestamps.push(now);
  AI_RATE_WINDOWS.set(key, timestamps);
  return true;
}

// Middleware factory — call with a group name so limits are per-endpoint-group.
function aiRateLimit(group) {
  return (req, res, next) => {
    const userId = req.user?.id || req.user?.email || 'unknown';
    if (!checkAiRateLimit(userId, group)) {
      return res.status(429).json({
        error: `AI rate limit reached. You can make up to ${HEAVY_LIMIT} ${group} requests per hour.`,
      });
    }
    next();
  };
}

// Periodically prune stale entries so the Map doesn't grow forever.
const aiRateWindowPruner = setInterval(() => {
  const cutoff = Date.now() - HEAVY_WINDOW_MS;
  for (const [key, timestamps] of AI_RATE_WINDOWS) {
    const filtered = timestamps.filter((t) => t > cutoff);
    if (filtered.length === 0) AI_RATE_WINDOWS.delete(key);
    else AI_RATE_WINDOWS.set(key, filtered);
  }
}, 15 * 60 * 1000); // prune every 15 min
if (typeof aiRateWindowPruner.unref === 'function') aiRateWindowPruner.unref();

// ── WALKTHROUGH ────────────────────────────────────────────────────────────────
router.post('/walkthrough', authenticateToken, requireRole('admin', 'manager'), aiRateLimit('walkthrough'), async (req, res) => {
  const feature = String(req.body.feature || '').trim();
  const question = String(req.body.question || '').trim();

  if (!feature) {
    return res.status(400).json({ error: 'Feature is required' });
  }

  try {
    const walkthrough = await generateWalkthrough(feature, question);
    res.json(walkthrough);
  } catch (err) {
    if (String(err.message || '').includes('OPENAI_API_KEY')) {
      return res.status(503).json({ error: err.message });
    }
    res.status(500).json({ error: 'AI walkthrough failed: ' + err.message });
  }
});

// ── ORDER INTAKE ───────────────────────────────────────────────────────────────
router.post('/order-intake', authenticateToken, requireRole('admin', 'manager'), aiRateLimit('order-intake'), async (req, res) => {
  const message = String(req.body.message || '').trim();

  if (!message) {
    return res.status(400).json({ error: 'Order intake message is required' });
  }

  try {
    const draft = await generateOrderIntakeDraft(message);
    res.json(draft);
  } catch (err) {
    res.status(500).json({ error: 'Order intake parsing failed: ' + err.message });
  }
});

// ── CHAT ───────────────────────────────────────────────────────────────────────
router.post('/chat', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const message = String(req.body.message || '').trim();
  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  const userId = req.user?.id || req.user?.email || 'unknown';
  if (!checkChatRateLimit(userId)) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment before sending another message.' });
  }

  const userName = req.user?.name || req.user?.email || 'User';
  const userRole = req.user?.role || 'user';
  const history = Array.isArray(req.body.history) ? req.body.history : [];

  try {
    const dbContext = await loadChatContext(message, req.context || {});
    const reply = await generateChatReplyWithContext(userName, userRole, message, history, dbContext);
    const conversation_id = req.body.conversation_id || null;
    res.json({ reply, ...(conversation_id ? { conversation_id } : {}) });
  } catch (err) {
    if (String(err.message || '').includes('OPENAI_API_KEY')) {
      return res.status(503).json({ error: 'AI service is not configured.' });
    }
    res.status(502).json({ error: 'AI chat failed. Please try again.' });
  }
});

// ── INVENTORY HEALTH ANALYSIS ──────────────────────────────────────────────────
router.post('/inventory-analysis', authenticateToken, requireRole('admin', 'manager'), aiRateLimit('inventory-analysis'), async (req, res) => {
  try {
    // Tenant scope: AI inventory analysis must only see the caller's company/location data.
    const { data: products, error: pErr } = await scopeQueryByContext(
      supabase
        .from('products')
        .select('item_number,description,category,unit,cost,on_hand_qty,company_id,location_id')
        .order('category'),
      req.context
    );
    if (pErr) return res.status(500).json({ error: pErr.message });

    const since = new Date(Date.now() - 28 * 86400000).toISOString();
    // Tenant scope: stock history is tenant-sensitive; never aggregate across companies.
    const { data: allHistory, error: hErr } = await scopeQueryByContext(
      supabase
        .from('inventory_stock_history')
        .select('item_number,change_qty,change_type,created_at,company_id,location_id')
        .gte('created_at', since)
        .order('created_at', { ascending: false }),
      req.context
    );
    if (hErr) return res.status(500).json({ error: hErr.message });

    const historyByItem = {};
    (allHistory || []).forEach((h) => {
      if (!historyByItem[h.item_number]) historyByItem[h.item_number] = [];
      historyByItem[h.item_number].push(h);
    });

    const expiryWindow = new Date(Date.now() + 14 * 86400000).toISOString();
    // Tenant scope: lot codes belong to a specific company/location.
    const { data: expiringLots } = await scopeQueryByContext(
      supabase
        .from('lot_codes')
        .select('item_number,lot_number,expiry_date,company_id,location_id')
        .lte('expiry_date', expiryWindow)
        .gte('expiry_date', new Date().toISOString().split('T')[0]),
      req.context
    );

    const analysis = await analyzeInventory(products || [], historyByItem, expiringLots || []);
    res.json(analysis);
  } catch (err) {
    if (String(err.message || '').includes('OPENAI_API_KEY')) {
      return res.status(503).json({ error: 'AI service is not configured.' });
    }
    res.status(500).json({ error: 'Inventory analysis failed: ' + err.message });
  }
});

// ── PO IMAGE SCAN ──────────────────────────────────────────────────────────────
router.post(
  '/scan-po',
  authenticateToken,
  requireRole('admin', 'manager'),
  aiRateLimit('scan-po'),
  scanUpload,
  async (req, res) => {
    const uploadedFiles = [...(req.files?.file || []), ...(req.files?.image || [])];
    if (uploadedFiles.length === 0) {
      return res.status(400).json({ error: 'No file uploaded. Send the image(s) as multipart field "file" or "image".' });
    }
    if (uploadedFiles.length > MAX_SCAN_PAGES) {
      return res.status(400).json({ error: `Too many pages. Upload at most ${MAX_SCAN_PAGES} images per scan.` });
    }

    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    const badFile = uploadedFiles.find((f) => !allowed.includes(f.mimetype));
    if (badFile) {
      return res.status(400).json({ error: 'Unsupported file type. Upload a JPEG, PNG, WEBP, or PDF.' });
    }

    try {
      const pages = uploadedFiles.map((f) => ({ base64: f.buffer.toString('base64'), mimeType: f.mimetype }));
      const result = await parsePurchaseOrderImage(pages);
      const scanRecord = await recordPoInvoiceScan({
        context: req.context || {},
        createdBy: req.user?.name || req.user?.email || 'system',
        fileName: uploadedFiles.map((f) => f.originalname).filter(Boolean).join(', ') || null,
        mimeType: uploadedFiles[0]?.mimetype || null,
        parsed: result,
        source: 'ai-scan-po',
      });
      res.json({
        ...result,
        scan_id: scanRecord?.id || null,
      });
    } catch (err) {
      const { status, body } = getAiScanErrorResponse(
        err,
        'PO scan failed. Please try again with a clearer image or enter the details manually.'
      );
      res.status(status).json(body);
    }
  }
);

// ── ROUTE OPTIMIZATION ─────────────────────────────────────────────────────────
router.post('/optimize-route', authenticateToken, requireRole('admin', 'manager'), aiRateLimit('optimize-route'), async (req, res) => {
  const routeId = String(req.body.route_id || '').trim();
  if (!routeId) return res.status(400).json({ error: 'route_id is required' });

  try {
    const { data: route, error: rErr } = await scopeQueryByContext(supabase.from('routes').select('*'), req.context).eq('id', routeId).single();
    if (rErr || !route) return res.status(404).json({ error: 'Route not found' });

    const stopIds = (route.active_stop_ids || route.stop_ids || []);
    if (!stopIds.length) return res.json({ optimized_stop_ids: [], key_changes: [], estimated_efficiency_gain: 'N/A', reasoning: 'No stops on this route.' });

    const { data: stops } = await scopeQueryByContext(supabase
      .from('stops')
      .select('id,address,customer_id,status,lat,lng,company_id,location_id'), req.context)
      .in('id', stopIds);

    const customerIds = (stops || []).map((s) => s.customer_id).filter(Boolean);
    let customerMap = {};
    if (customerIds.length) {
      const { data: customers } = await scopeQueryByContext(supabase
        .from('customers')
        .select('customer_number,company_name,preferred_delivery_window,company_id,location_id'), req.context)
        .in('customer_number', customerIds);
      (customers || []).forEach((customer) => {
        customerMap[customer.customer_number] = customer;
      });
    }

    const enrichedStops = (stops || []).map((stop) => ({
      ...stop,
      customer_name: customerMap[stop.customer_id]?.company_name || null,
      preferred_delivery_window: customerMap[stop.customer_id]?.preferred_delivery_window || null,
    }));
    const result = await optimizeRoute(enrichedStops);
    res.json(result);
  } catch (err) {
    if (String(err.message || '').includes('OPENAI_API_KEY')) return res.status(503).json({ error: 'AI service is not configured.' });
    res.status(500).json({ error: 'Route optimization failed: ' + err.message });
  }
});

// ── CUSTOMER RISK SCORING ──────────────────────────────────────────────────────
router.post('/customer-risk', authenticateToken, requireRole('admin', 'manager'), aiRateLimit('customer-risk'), async (req, res) => {
  const customerId = String(req.body.customer_id || '').trim();
  if (!customerId) return res.status(400).json({ error: 'customer_id is required' });

  try {
    const { data: customer, error: cErr } = await scopeQueryByContext(supabase.from('customers').select('*'), req.context).eq('customer_number', customerId).single();
    if (cErr || !customer) return res.status(404).json({ error: 'Customer not found' });

    const since = new Date(Date.now() - 90 * 86400000).toISOString();
    const [{ data: invoices }, { data: orders }] = await Promise.all([
      scopeQueryByContext(supabase.from('invoices').select('total,status,due_date,created_at,company_id,location_id'), req.context).eq('customer_name', customer.company_name).gte('created_at', since),
      scopeQueryByContext(supabase.from('orders').select('status,created_at,company_id,location_id'), req.context).eq('customer_name', customer.company_name).gte('created_at', since).order('created_at', { ascending: false }),
    ]);

    const result = await scoreCustomerRisk(customer, invoices || [], orders || []);
    res.json({ customer_id: customerId, customer_name: customer.company_name, ...result });
  } catch (err) {
    if (String(err.message || '').includes('OPENAI_API_KEY')) return res.status(503).json({ error: 'AI service is not configured.' });
    res.status(500).json({ error: 'Customer risk scoring failed: ' + err.message });
  }
});

// ── ANOMALY DETECTION ──────────────────────────────────────────────────────────
router.post('/anomalies', authenticateToken, requireRole('admin', 'manager'), aiRateLimit('anomalies'), async (req, res) => {
  try {
    const since = new Date(Date.now() - 7 * 86400000).toISOString();
    const [{ data: deliveries }, { data: orders }] = await Promise.all([
      scopeQueryByContext(supabase.from('stops').select('id,status,created_at,driver_id,company_id,location_id'), req.context).gte('created_at', since),
      scopeQueryByContext(supabase.from('orders').select('id,status,customer_name,created_at,company_id,location_id'), req.context).gte('created_at', since),
    ]);

    const result = await detectAnomalies(deliveries || [], orders || []);
    res.json(result);
  } catch (err) {
    if (String(err.message || '').includes('OPENAI_API_KEY')) return res.status(503).json({ error: 'AI service is not configured.' });
    res.status(500).json({ error: 'Anomaly detection failed: ' + err.message });
  }
});

// ── VENDOR PERFORMANCE SCORE ───────────────────────────────────────────────────
router.post('/vendor-score', authenticateToken, requireRole('admin', 'manager'), aiRateLimit('vendor-score'), async (req, res) => {
  const vendorId = String(req.body.vendor_id || '').trim();
  if (!vendorId) return res.status(400).json({ error: 'vendor_id is required' });

  try {
    const { data: vendor, error: vErr } = await scopeQueryByContext(supabase.from('vendors').select('*'), req.context).eq('id', vendorId).single();
    if (vErr || !vendor) return res.status(404).json({ error: 'Vendor not found' });

    const since = new Date(Date.now() - 90 * 86400000).toISOString();
    const { data: pos } = await scopeQueryByContext(supabase
      .from('purchase_orders')
      .select('id,status,created_at,total_cost,workflow_kind,company_id,location_id'), req.context)
      .eq('vendor_id', vendorId)
      .gte('created_at', since);

    const vendorOrders = (pos || []).filter((po) => {
      const workflowKind = String(po.workflow_kind || '').trim().toLowerCase();
      return !workflowKind || workflowKind === 'vendor_order';
    });

    const result = await scoreVendorPerformance(vendor, vendorOrders);
    res.json({ vendor_id: vendorId, vendor_name: vendor.name, ...result });
  } catch (err) {
    if (String(err.message || '').includes('OPENAI_API_KEY')) return res.status(503).json({ error: 'AI service is not configured.' });
    res.status(500).json({ error: 'Vendor scoring failed: ' + err.message });
  }
});

// ── DRIVER ASSIGNMENT OPTIMIZATION ────────────────────────────────────────────
router.post('/driver-assignments', authenticateToken, requireRole('admin', 'manager'), aiRateLimit('driver-assignments'), async (req, res) => {
  try {
    const [{ data: drivers }, { data: routes }] = await Promise.all([
      scopeQueryByContext(supabase.from('users').select('id,name,email,company_id,location_id'), req.context).eq('role', 'driver'),
      scopeQueryByContext(supabase.from('routes').select('id,name,stop_ids,active_stop_ids,driver,driver_id,company_id,location_id'), req.context).order('created_at', { ascending: false }).limit(20),
    ]);

    const driverIds = (drivers || []).map((driver) => driver.id).filter(Boolean);
    let completedByDriver = new Map();
    let activeByDriver = new Map();

    if (driverIds.length) {
      const [{ data: completedDeliveries }, { data: activeRoutes }] = await Promise.all([
        scopeQueryByContext(
          supabase.from('deliveries').select('driver_id,status,company_id,location_id'),
          req.context
        ).in('driver_id', driverIds).eq('status', 'delivered'),
        scopeQueryByContext(
          supabase.from('routes').select('driver_id,company_id,location_id'),
          req.context
        ).in('driver_id', driverIds),
      ]);

      completedByDriver = (completedDeliveries || []).reduce((counts, row) => {
        counts.set(row.driver_id, (counts.get(row.driver_id) || 0) + 1);
        return counts;
      }, new Map());

      activeByDriver = (activeRoutes || []).reduce((counts, row) => {
        counts.set(row.driver_id, (counts.get(row.driver_id) || 0) + 1);
        return counts;
      }, new Map());
    }

    const enrichedDrivers = (drivers || []).map((d) => ({
      ...d,
      completed_count: completedByDriver.get(d.id) || 0,
      active_count: activeByDriver.get(d.id) || 0,
    }));

    const enrichedRoutes = (routes || []).map((r) => ({
      ...r,
      stop_count: (r.active_stop_ids || r.stop_ids || []).length,
    }));

    const result = await optimizeDriverAssignments(enrichedDrivers, enrichedRoutes);
    res.json(result);
  } catch (err) {
    if (String(err.message || '').includes('OPENAI_API_KEY')) return res.status(503).json({ error: 'AI service is not configured.' });
    res.status(500).json({ error: 'Driver assignment failed: ' + err.message });
  }
});

// ── MARKDOWN RECOMMENDATIONS ───────────────────────────────────────────────────
router.post('/markdown-recommendations', authenticateToken, requireRole('admin', 'manager'), aiRateLimit('markdown-recommendations'), async (req, res) => {
  try {
    const windowDays = Math.min(30, Math.max(1, parseInt(req.body.window_days || '10', 10)));
    const expiryWindow = new Date(Date.now() + windowDays * 86400000).toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];

    const { data: expiringLots, error: lErr } = await scopeQueryByContext(supabase
      .from('lot_codes')
      .select('item_number,lot_number,expiry_date,company_id,location_id'), req.context)
      .lte('expiry_date', expiryWindow)
      .gte('expiry_date', today);
    if (lErr) return res.status(500).json({ error: lErr.message });

    if (!expiringLots || !expiringLots.length) {
      return res.json({ recommendations: [], summary: 'No lots expiring within the window.' });
    }

    const itemNumbers = [...new Set(expiringLots.map((l) => l.item_number))];
    const { data: products } = await scopeQueryByContext(supabase
      .from('products')
      .select('item_number,description,on_hand_qty,unit,cost,company_id,location_id'), req.context)
      .in('item_number', itemNumbers);

    const productMap = {};
    (products || []).forEach((p) => { productMap[p.item_number] = p; });

    const enrichedItems = expiringLots.map((lot) => {
      const product = productMap[lot.item_number] || {};
      const daysLeft = Math.round((new Date(lot.expiry_date) - Date.now()) / 86400000);
      return {
        item_number: lot.item_number,
        lot_number: lot.lot_number,
        expiry_date: lot.expiry_date,
        days_until_expiry: Math.max(0, daysLeft),
        description: product.description || lot.item_number,
        on_hand_qty: product.on_hand_qty || 0,
        unit: product.unit || 'unit',
        cost: product.cost || 0,
      };
    }).sort((a, b) => a.days_until_expiry - b.days_until_expiry);

    const result = await generateMarkdownRecommendations(enrichedItems);
    res.json(result);
  } catch (err) {
    if (String(err.message || '').includes('OPENAI_API_KEY')) return res.status(503).json({ error: 'AI service is not configured.' });
    res.status(500).json({ error: 'Markdown recommendations failed: ' + err.message });
  }
});

// ── INVOICE FOLLOW-UP DRAFT ────────────────────────────────────────────────────
router.post('/invoice-followup', authenticateToken, requireRole('admin', 'manager'), aiRateLimit('invoice-followup'), async (req, res) => {
  const invoiceId = String(req.body.invoice_id || '').trim();
  if (!invoiceId) return res.status(400).json({ error: 'invoice_id is required' });

  try {
    const { data: invoice, error: iErr } = await scopeQueryByContext(supabase.from('invoices').select('*'), req.context).eq('id', invoiceId).single();
    if (iErr || !invoice) return res.status(404).json({ error: 'Invoice not found' });

    const dueDate = invoice.due_date ? new Date(invoice.due_date) : null;
    const daysOverdue = dueDate ? Math.max(0, Math.round((Date.now() - dueDate) / 86400000)) : 0;

    let customer = {};
    if (invoice.customer_name) {
      const { data: cust } = await scopeQueryByContext(supabase.from('customers').select('company_name,email,payment_terms,credit_hold_reason,company_id,location_id'), req.context).ilike('company_name', invoice.customer_name).limit(1).single();
      customer = cust || {};
    }

    const { count: priorCount } = await scopeQueryByContext(supabase.from('invoices').select('id', { count: 'exact', head: true }), req.context).ilike('customer_name', invoice.customer_name || '');
    const result = await generateInvoiceFollowUp({ ...invoice, prior_invoice_count: priorCount || 0 }, customer, daysOverdue);
    res.json({ invoice_id: invoiceId, days_overdue: daysOverdue, ...result });
  } catch (err) {
    if (String(err.message || '').includes('OPENAI_API_KEY')) return res.status(503).json({ error: 'AI service is not configured.' });
    res.status(500).json({ error: 'Invoice follow-up generation failed: ' + err.message });
  }
});

// ── SMART REORDER ALERTS ───────────────────────────────────────────────────────
router.get('/reorder-alerts', authenticateToken, requireRole('admin', 'manager'), aiRateLimit('reorder-alerts'), async (req, res) => {
  try {
    const { data: products, error: pErr } = await scopeQueryByContext(supabase
      .from('products')
      .select('item_number,description,on_hand_qty,unit,cost,company_id,location_id'), req.context)
      .order('description');
    if (pErr) return res.status(500).json({ error: pErr.message });

    const since = new Date(Date.now() - 28 * 86400000).toISOString();
    const { data: history } = await scopeQueryByContext(supabase
      .from('inventory_stock_history')
      .select('item_number,change_qty,change_type,created_at,company_id,location_id'), req.context)
      .gte('created_at', since)
      .in('change_type', ['pick', 'sale', 'depletion', 'adjustment']);

    const usageByItem = {};
    for (const row of (history || [])) {
      if (!usageByItem[row.item_number]) usageByItem[row.item_number] = 0;
      usageByItem[row.item_number] += Math.abs(Number(row.change_qty) || 0);
    }

    const enriched = (products || []).map((p) => {
      const totalUsed = usageByItem[p.item_number] || 0;
      const daily_usage = totalUsed / 28;
      const on_hand = Math.max(0, Number(p.on_hand_qty) || 0);
      const days_until_stockout = daily_usage > 0 ? Math.round(on_hand / daily_usage) : null;
      const reorder_qty = Math.max(1, Math.round(daily_usage * 14));
      return { ...p, daily_usage, days_until_stockout, reorder_qty };
    });

    const result = await generateBulkReorderAlerts(enriched);
    res.json(result);
  } catch (err) {
    if (String(err.message || '').includes('OPENAI_API_KEY')) return res.status(503).json({ error: 'AI service is not configured.' });
    res.status(500).json({ error: 'Reorder alerts failed: ' + err.message });
  }
});

// ── LATE PAYMENT RISK ──────────────────────────────────────────────────────────
router.get('/late-payment-risk', authenticateToken, requireRole('admin', 'manager'), aiRateLimit('late-payment-risk'), async (req, res) => {
  try {
    const { data: invoices, error: iErr } = await scopeQueryByContext(supabase
      .from('invoices')
      .select('id,customer_name,total,status,due_date,created_at,company_id,location_id'), req.context)
      .in('status', ['sent', 'overdue', 'draft'])
      .order('due_date', { ascending: true });
    if (iErr) return res.status(500).json({ error: iErr.message });

    const today = Date.now();
    const byCustomer = {};
    for (const inv of (invoices || [])) {
      const name = inv.customer_name || 'Unknown';
      if (!byCustomer[name]) byCustomer[name] = { customer_name: name, total_open: 0, invoice_count: 0, oldest_invoice_days: 0, days_overdue_max: 0 };
      const total = Number(inv.total) || 0;
      const dueMs = inv.due_date ? new Date(inv.due_date).getTime() : null;
      const daysOverdue = dueMs ? Math.max(0, Math.round((today - dueMs) / 86400000)) : 0;
      const ageDays = inv.created_at ? Math.round((today - new Date(inv.created_at).getTime()) / 86400000) : 0;
      byCustomer[name].total_open += total;
      byCustomer[name].invoice_count += 1;
      byCustomer[name].oldest_invoice_days = Math.max(byCustomer[name].oldest_invoice_days, ageDays);
      byCustomer[name].days_overdue_max = Math.max(byCustomer[name].days_overdue_max, daysOverdue);
    }

    const customerData = Object.values(byCustomer).filter((c) => c.total_open > 0);
    const result = await scoreLatePaymentRisk(customerData);
    res.json(result);
  } catch (err) {
    if (String(err.message || '').includes('OPENAI_API_KEY')) return res.status(503).json({ error: 'AI service is not configured.' });
    res.status(500).json({ error: 'Late payment risk scoring failed: ' + err.message });
  }
});

// ── PRICING ANOMALY DETECTION ──────────────────────────────────────────────────
router.post('/pricing-anomalies', authenticateToken, requireRole('admin', 'manager'), aiRateLimit('pricing-anomalies'), async (req, res) => {
  try {
    const days = Math.min(90, Math.max(7, parseInt(req.body.days || '30', 10)));
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const { data: orders, error: oErr } = await scopeQueryByContext(supabase
      .from('orders')
      .select('id,order_number,customer_name,items,created_at,company_id,location_id'), req.context)
      .gte('created_at', since)
      .not('items', 'is', null);
    if (oErr) return res.status(500).json({ error: oErr.message });

    const result = detectPricingAnomalies(orders || []);
    res.json({ ...result, lookback_days: days });
  } catch (err) {
    if (String(err.message || '').includes('OPENAI_API_KEY')) return res.status(503).json({ error: 'AI service is not configured.' });
    res.status(500).json({ error: 'Pricing anomaly detection failed: ' + err.message });
  }
});

// ── VENDOR PERFORMANCE (BULK) ──────────────────────────────────────────────────
router.get('/vendor-performance', authenticateToken, requireRole('admin', 'manager'), aiRateLimit('vendor-performance'), async (req, res) => {
  try {
    const { data: pos, error: pErr } = await scopeQueryByContext(supabase
      .from('purchase_orders')
      .select('id,vendor,status,total_cost,items,created_at,company_id,location_id'), req.context)
      .order('created_at', { ascending: false })
      .limit(200);
    if (pErr) return res.status(500).json({ error: pErr.message });

    const byVendor = {};
    for (const po of (pos || [])) {
      const v = String(po.vendor || '').trim() || 'Unknown';
      if (!byVendor[v]) byVendor[v] = { vendor: v, po_count: 0, total_value: 0, short_ship_count: 0, avg_lead_days: 0, _lead_total: 0, _lead_count: 0 };
      byVendor[v].po_count += 1;
      byVendor[v].total_value += Number(po.total_cost) || 0;
      if (po.status === 'exception' || po.status === 'short') byVendor[v].short_ship_count += 1;
      if (po.created_at) {
        const lead = Math.round((Date.now() - new Date(po.created_at).getTime()) / 86400000);
        byVendor[v]._lead_total += lead;
        byVendor[v]._lead_count += 1;
      }
    }

    const vendorSummaries = Object.values(byVendor).map((v) => ({
      ...v,
      avg_lead_days: v._lead_count > 0 ? Math.round(v._lead_total / v._lead_count) : 0,
    })).sort((a, b) => b.total_value - a.total_value);

    const result = await scoreVendorList(vendorSummaries);
    res.json(result);
  } catch (err) {
    if (String(err.message || '').includes('OPENAI_API_KEY')) return res.status(503).json({ error: 'AI service is not configured.' });
    res.status(500).json({ error: 'Vendor performance scoring failed: ' + err.message });
  }
});

router.detectChatTopics = detectChatTopics;
router.extractChatSearchTerms = extractChatSearchTerms;
router.loadChatContext = loadChatContext;

module.exports = router;
