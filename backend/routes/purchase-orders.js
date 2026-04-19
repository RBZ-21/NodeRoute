const express  = require('express');
const multer   = require('multer');
const { supabase }                  = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { parsePurchaseOrderImage }   = require('../services/ai');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image files are accepted'));
    cb(null, true);
  },
});

const LOT_REQUIRED = /\b(mussel|clam|oyster)s?\b/i;

// ── POST /api/purchase-orders/scan ─────────────────────────────────────────
// Accept an image upload, run GPT-4o vision, return parsed PO items for review.
router.post('/scan', authenticateToken, requireRole('admin', 'manager'),
  upload.single('image'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

    const base64   = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype || 'image/jpeg';

    try {
      const parsed = await parsePurchaseOrderImage(base64, mimeType);
      // Ensure items is always an array
      if (!Array.isArray(parsed.items)) parsed.items = [];
      // Compute totals for any items missing them
      parsed.items = parsed.items.map(item => ({
        ...item,
        quantity:   parseFloat(item.quantity)   || 0,
        unit_price: parseFloat(item.unit_price) || 0,
        total:      parseFloat(item.total)      || parseFloat((parseFloat(item.quantity || 0) * parseFloat(item.unit_price || 0)).toFixed(2)),
        unit:       item.unit || 'lb',
        category:   item.category || 'Other',
      }));
      if (!parsed.total_cost) {
        parsed.total_cost = parseFloat(parsed.items.reduce((s, i) => s + i.total, 0).toFixed(2));
      }
      res.json(parsed);
    } catch (err) {
      if (err.message.includes('OPENAI_API_KEY')) return res.status(503).json({ error: err.message });
      res.status(500).json({ error: 'Image scan failed: ' + err.message });
    }
  }
);

// ── POST /api/purchase-orders/confirm ──────────────────────────────────────
// User has reviewed and confirmed the AI-extracted items.
// Upsert inventory, log stock history, save the PO record.
router.post('/confirm', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { vendor, po_number, date, items, total_cost, notes } = req.body;
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'No items to save' });
  }

  // Fetch all current inventory for matching by description
  const { data: inventory, error: invErr } = await supabase
    .from('seafood_inventory')
    .select('item_number, description, on_hand_qty, cost, unit');
  if (invErr) return res.status(500).json({ error: invErr.message });

  const invMap = {};
  (inventory || []).forEach(row => {
    invMap[row.description.toLowerCase().trim()] = row;
  });

  const historyEntries = [];
  let itemsCreated = 0;
  let itemsUpdated = 0;
  const errors = [];

  for (const item of items) {
    const desc = (item.description || '').trim();
    if (!desc) continue;

    const qty       = parseFloat(item.quantity)   || 0;
    const unitPrice = parseFloat(item.unit_price) || 0;
    if (qty <= 0) continue;

    const key      = desc.toLowerCase();
    const existing = invMap[key];
    const poRef    = `PO scan${po_number ? ' · ' + po_number : ''}${vendor ? ' from ' + vendor : ''}`;

    if (existing) {
      const newQty = parseFloat(parseFloat(existing.on_hand_qty || 0) + qty).toFixed(4);
      const updates = {
        on_hand_qty:    parseFloat(newQty),
        on_hand_weight: parseFloat(newQty),
        updated_at:     new Date().toISOString(),
      };
      if (unitPrice > 0) updates.cost = unitPrice;

      const { error: updErr } = await supabase
        .from('seafood_inventory')
        .update(updates)
        .eq('item_number', existing.item_number);

      if (updErr) {
        errors.push(`${desc}: ${updErr.message}`);
        continue;
      }
      historyEntries.push({
        item_number:  existing.item_number,
        change_qty:   qty,
        new_qty:      parseFloat(newQty),
        change_type:  'restock',
        notes:        poRef,
        created_by:   req.user.name || req.user.email,
      });
      itemsUpdated++;
    } else {
      // Generate a unique item_number
      const itemNumber = 'PO-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();

      const { error: insErr } = await supabase.from('seafood_inventory').insert([{
        item_number:    itemNumber,
        description:    desc,
        category:       item.category || 'Other',
        unit:           item.unit || 'lb',
        cost:           unitPrice,
        on_hand_qty:    qty,
        on_hand_weight: qty,
        lot_item:       LOT_REQUIRED.test(desc) ? 'Y' : 'N',
      }]);

      if (insErr) {
        errors.push(`${desc}: ${insErr.message}`);
        continue;
      }
      historyEntries.push({
        item_number:  itemNumber,
        change_qty:   qty,
        new_qty:      qty,
        change_type:  'restock',
        notes:        `New item · ${poRef}`,
        created_by:   req.user.name || req.user.email,
      });
      itemsCreated++;
    }
  }

  // Batch-insert stock history
  if (historyEntries.length) {
    await supabase.from('inventory_stock_history').insert(historyEntries);
  }

  // Persist the purchase order record
  const computedTotal = parseFloat(total_cost) ||
    parseFloat(items.reduce((s, i) => s + (parseFloat(i.total) || 0), 0).toFixed(2));

  const { data: po } = await supabase.from('purchase_orders').insert([{
    po_number:    po_number || null,
    vendor:       vendor    || null,
    items,
    total_cost:   computedTotal,
    notes:        notes || null,
    confirmed_by: req.user.name || req.user.email,
  }]).select().single();

  res.json({ success: true, items_created: itemsCreated, items_updated: itemsUpdated, errors, purchase_order: po || null });
});

// ── GET /api/purchase-orders ──────────────────────────────────────────────
router.get('/', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { data, error } = await supabase
    .from('purchase_orders')
    .select('id, po_number, vendor, total_cost, items, confirmed_by, created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

module.exports = router;
