const express = require('express');
const multer = require('multer');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { supabase } = require('../services/supabase');
const {
  generateWalkthrough,
  generateOrderIntakeDraft,
  generateChatReply,
  checkChatRateLimit,
  analyzeInventory,
  parsePurchaseOrderImage,
} = require('../services/ai');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── WALKTHROUGH ────────────────────────────────────────────────────────────────
router.post('/walkthrough', authenticateToken, async (req, res) => {
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
router.post('/order-intake', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
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
    const reply = await generateChatReply(userName, userRole, message, history);
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
// POST /api/ai/inventory-analysis
// Admin/manager only. Fetches live inventory + expiring lots, runs AI analysis.
router.post('/inventory-analysis', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { data: products, error: pErr } = await supabase
      .from('seafood_inventory')
      .select('item_number,description,category,unit,cost,on_hand_qty')
      .order('category');
    if (pErr) return res.status(500).json({ error: pErr.message });

    const since = new Date(Date.now() - 28 * 86400000).toISOString(); // 4 weeks
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

    // Fetch lots expiring within 14 days
    const expiryWindow = new Date(Date.now() + 14 * 86400000).toISOString();
    const { data: expiringLots } = await supabase
      .from('lot_codes')
      .select('item_number,lot_number,expiry_date')
      .lte('expiry_date', expiryWindow)
      .gte('expiry_date', new Date().toISOString().split('T')[0]);

    const analysis = await analyzeInventory(
      products || [],
      historyByItem,
      expiringLots || []
    );

    res.json(analysis);
  } catch (err) {
    if (String(err.message || '').includes('OPENAI_API_KEY')) {
      return res.status(503).json({ error: 'AI service is not configured.' });
    }
    res.status(500).json({ error: 'Inventory analysis failed: ' + err.message });
  }
});

// ── PO IMAGE SCAN ──────────────────────────────────────────────────────────────
// POST /api/ai/scan-po  (multipart: field name = "file")
// Admin/manager only. Accepts a JPEG/PNG/PDF image of a PO and returns parsed line items.
router.post(
  '/scan-po',
  authenticateToken,
  requireRole('admin', 'manager'),
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

module.exports = router;
