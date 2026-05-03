'use strict';

const express = require('express');
const multer = require('multer');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { supabase } = require('../services/supabase');
const {
  generateWalkthrough,
  generateOrderIntakeDraft,
  generateChatReply,
  generateChatReplyWithContext,
  checkChatRateLimit,
  analyzeInventory,
  parsePurchaseOrderImage,
  optimizeRoute,
  scoreCustomerRisk,
  detectAnomalies,
  scoreVendorPerformance,
  optimizeDriverAssignments,
  generateMarkdownRecommendations,
  generateInvoiceFollowUp,
} = require('../services/ai');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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
setInterval(() => {
  const cutoff = Date.now() - HEAVY_WINDOW_MS;
  for (const [key, timestamps] of AI_RATE_WINDOWS) {
    const filtered = timestamps.filter((t) => t > cutoff);
    if (filtered.length === 0) AI_RATE_WINDOWS.delete(key);
    else AI_RATE_WINDOWS.set(key, filtered);
  }
}, 15 * 60 * 1000); // prune every 15 min

// ── WALKTHROUGH ────────────────────────────────────────────────────────────────
router.post('/walkthrough', authenticateToken, aiRateLimit('walkthrough'), async (req, res) => {
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
router.post('/chat', authenticateToken, async (req, res) => {
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
    const msg = message.toLowerCase();
    const dbContext = {};

    if (msg.includes('order') || msg.includes('delivery') || msg.includes('status')) {
      const since = new Date(Date.now() - 7 * 86400000).toISOString();
      const { data: recentOrders } = await supabase
        .from('orders').select('customer_name,status,date,created_at').gte('created_at', since).order('created_at', { ascending: false }).limit(10);
      dbContext.recentOrders = recentOrders || [];
    }

    if (msg.includes('inventory') || msg.includes('stock') || msg.includes('low')) {
      const { data: allInv } = await supabase.from('seafood_inventory').select('description,on_hand_qty,unit,category');
      dbContext.lowInventory = (allInv || []).filter((i) => (i.on_hand_qty || 0) <= 5);
    }

    if (msg.includes('invoice') || msg.includes('overdue') || msg.includes('payment')) {
      const { data: overdueInv } = await supabase.from('invoices').select('customer_name,total,due_date,status').eq('status', 'overdue').limit(20);
      dbContext.overdueInvoices = overdueInv || [];
    }

    if (msg.includes('credit hold') || msg.includes('hold') || msg.includes('customer')) {
      const { data: holdCustomers } = await supabase.from('customers').select('company_name,credit_hold_reason').not('credit_hold_reason', 'is', null).neq('credit_hold_reason', '');
      dbContext.creditHoldCustomers = holdCustomers || [];
    }

    if (msg.includes('route') || msg.includes('driver') || msg.includes('today')) {
      const { data: activeRoutes } = await supabase.from('routes').select('name,driver').order('created_at', { ascending: false }).limit(10);
      dbContext.activeRoutes = activeRoutes || [];
    }

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
    const { data: products, error: pErr } = await supabase
      .from('seafood_inventory')
      .select('item_number,description,category,unit,cost,on_hand_qty')
      .order('category');
    if (pErr) return res.status(500).json({ error: pErr.message });

    const since = new Date(Date.now() - 28 * 86400000).toISOString();
    const { data: allHistory, error: hErr } = await supabase
      .from('inventory_stock_history')
      .select('item_number,change_qty,change_type,created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false });
    if (hErr) return res.status(500).json({ error: hErr.message });

    const historyByItem = {};
    (allHistory || []).forEach((h) => {
      if (!historyByItem[h.item_number]) historyByItem[h.item_number] = [];
      historyByItem[h.item_number].push(h);
    });

    const expiryWindow = new Date(Date.now() + 14 * 86400000).toISOString();
    const { data: expiringLots } = await supabase
      .from('lot_codes')
      .select('item_number,lot_number,expiry_date')
      .lte('expiry_date', expiryWindow)
      .gte('expiry_date', new Date().toISOString().split('T')[0]);

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
  upload.single('file'),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded. Send the image as multipart field "file".' });
    }

    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowed.includes(req.file.mimetype)) {
      return res.status(400).json({ error: 'Unsupported file type. Upload a JPEG, PNG, WEBP, or PDF.' });
    }

    try {
      const base64 = req.file.buffer.toString('base64');
      const mimeType = req.file.mimetype === 'application/pdf' ? 'image/png' : req.file.mimetype;
      const result = await parsePurchaseOrderImage(base64, mimeType);
      res.json(result);
    } catch (err) {
      if (String(err.message || '').includes('OPENAI_API_KEY')) {
        return res.status(503).json({ error: 'AI service is not configured.' });
      }
      res.status(500).json({ error: 'PO scan failed: ' + err.message });
    }
  }
);

// ── ROUTE OPTIMIZATION ─────────────────────────────────────────────────────────
router.post('/optimize-route', authenticateToken, requireRole('admin', 'manager'), aiRateLimit('optimize-route'), async (req, res) => {
  const routeId = String(req.body.route_id || '').trim();
  if (!routeId) return res.status(400).json({ error: 'route_id is required' });

  try {
    const { data: route, error: rErr } = await supabase.from('routes').select('*').eq('id', routeId).single();
    if (rErr || !route) return res.status(404).json({ error: 'Route not found' });

    const stopIds = (route.active_stop_ids || route.stop_ids || []);
    if (!stopIds.length) return res.json({ optimized_stop_ids: [], key_changes: [], estimated_efficiency_gain: 'N/A', reasoning: 'No stops on this route.' });

    const { data: stops } = await supabase
      .from('stops')
      .select('id,address,customer_id,status')
      .in('id', stopIds);

    const customerIds = (stops || []).map((s) => s.customer_id).filter(Boolean);
    let customerMap = {};
    if (customerIds.length) {
      const { data: customers } = await supabase.from('customers').select('customer_number,company_name').in('customer_number', customerIds);
      (customers || []).forEach((c) => { customerMap[c.customer_number] = c.company_name; });
    }

    const enrichedStops = (stops || []).map((s) => ({ ...s, customer_name: customerMap[s.customer_id] || null }));
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
    const { data: customer, error: cErr } = await supabase.from('customers').select('*').eq('customer_number', customerId).single();
    if (cErr || !customer) return res.status(404).json({ error: 'Customer not found' });

    const since = new Date(Date.now() - 90 * 86400000).toISOString();
    const [{ data: invoices }, { data: orders }] = await Promise.all([
      supabase.from('invoices').select('total,status,due_date,created_at').eq('customer_name', customer.company_name).gte('created_at', since),
      supabase.from('orders').select('status,created_at,date').eq('customer', customerId).gte('created_at', since).order('created_at', { ascending: false }),
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
      supabase.from('deliveries').select('id,status,created_at,driver_id').gte('created_at', since),
      supabase.from('orders').select('id,status,customer_name,created_at').gte('created_at', since),
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
    const { data: vendor, error: vErr } = await supabase.from('vendors').select('*').eq('id', vendorId).single();
    if (vErr || !vendor) return res.status(404).json({ error: 'Vendor not found' });

    const since = new Date(Date.now() - 90 * 86400000).toISOString();
    const { data: pos } = await supabase
      .from('purchase_orders')
      .select('id,status,created_at,total_cost')
      .eq('vendor_id', vendorId)
      .gte('created_at', since);

    const result = await scoreVendorPerformance(vendor, pos || []);
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
      supabase.from('users').select('id,name,email').eq('role', 'driver'),
      supabase.from('routes').select('id,name,stop_ids,active_stop_ids,driver,driver_id').order('created_at', { ascending: false }).limit(20),
    ]);

    const enrichedDrivers = await Promise.all((drivers || []).map(async (d) => {
      const { count: completedCount } = await supabase.from('deliveries').select('id', { count: 'exact', head: true }).eq('driver_id', d.id).eq('status', 'delivered');
      const { count: activeCount } = await supabase.from('routes').select('id', { count: 'exact', head: true }).eq('driver_id', d.id);
      return { ...d, completed_count: completedCount || 0, active_count: activeCount || 0 };
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

    const { data: expiringLots, error: lErr } = await supabase
      .from('lot_codes')
      .select('item_number,lot_number,expiry_date')
      .lte('expiry_date', expiryWindow)
      .gte('expiry_date', today);
    if (lErr) return res.status(500).json({ error: lErr.message });

    if (!expiringLots || !expiringLots.length) {
      return res.json({ recommendations: [], summary: 'No lots expiring within the window.' });
    }

    const itemNumbers = [...new Set(expiringLots.map((l) => l.item_number))];
    const { data: products } = await supabase
      .from('seafood_inventory')
      .select('item_number,description,on_hand_qty,unit,cost')
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
    const { data: invoice, error: iErr } = await supabase.from('invoices').select('*').eq('id', invoiceId).single();
    if (iErr || !invoice) return res.status(404).json({ error: 'Invoice not found' });

    const dueDate = invoice.due_date ? new Date(invoice.due_date) : null;
    const daysOverdue = dueDate ? Math.max(0, Math.round((Date.now() - dueDate) / 86400000)) : 0;

    let customer = {};
    if (invoice.customer_name) {
      const { data: cust } = await supabase.from('customers').select('company_name,email,payment_terms,credit_hold_reason').ilike('company_name', invoice.customer_name).limit(1).single();
      customer = cust || {};
    }

    const { count: priorCount } = await supabase.from('invoices').select('id', { count: 'exact', head: true }).ilike('customer_name', invoice.customer_name || '');
    const result = await generateInvoiceFollowUp({ ...invoice, prior_invoice_count: priorCount || 0 }, customer, daysOverdue);
    res.json({ invoice_id: invoiceId, days_overdue: daysOverdue, ...result });
  } catch (err) {
    if (String(err.message || '').includes('OPENAI_API_KEY')) return res.status(503).json({ error: 'AI service is not configured.' });
    res.status(500).json({ error: 'Invoice follow-up generation failed: ' + err.message });
  }
});

module.exports = router;
