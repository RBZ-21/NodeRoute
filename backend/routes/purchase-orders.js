const express  = require('express');
const multer   = require('multer');
const { supabase }                  = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { parsePurchaseOrderImage }   = require('../services/ai');
const { applyInventoryLedgerEntry } = require('../services/inventory-ledger');

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
// Upsert inventory, log stock history, create lot_codes records, save the PO.
router.post('/confirm', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { vendor, po_number, date, items, total_cost, notes } = req.body;
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'No items to save' });
  }

  // Fetch all current inventory for matching by description
  const { data: inventory, error: invErr } = await supabase
    .from('seafood_inventory')
    .select('item_number, description, on_hand_qty, cost, unit, is_ftl_product');
  if (invErr) return res.status(500).json({ error: invErr.message });

  const invMap = {};
  (inventory || []).forEach(row => {
    invMap[row.description.toLowerCase().trim()] = row;
  });

  let itemsCreated  = 0;
  let itemsUpdated  = 0;
  let lotsCreated   = 0;
  const errors      = [];
  const savedItems  = []; // items array to store in PO record (with lot data)

  for (const item of items) {
    const desc = (item.description || '').trim();
    if (!desc) continue;

    const qty       = parseFloat(item.quantity)   || 0;
    const unitPrice = parseFloat(item.unit_price) || 0;
    if (qty <= 0) continue;

    const key      = desc.toLowerCase();
    const existing = invMap[key];
    const poRef    = `PO scan${po_number ? ' · ' + po_number : ''}${vendor ? ' from ' + vendor : ''}`;

    // Determine item_number for lot association
    let resolvedItemNumber = existing?.item_number || null;

    if (existing) {
      try {
        await applyInventoryLedgerEntry({
          itemNumber: existing.item_number,
          deltaQty: qty,
          changeType: 'restock',
          notes: `${poRef}${item.lot_number ? ' · Lot ' + item.lot_number : ''}`,
          createdBy: req.user.name || req.user.email,
          unitCost: unitPrice,
        });
      } catch (ledgerErr) {
        errors.push(`${desc}: ${ledgerErr.message}`);
        continue;
      }
      itemsUpdated++;
    } else {
      // Generate a unique item_number
      const itemNumber = 'PO-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();
      resolvedItemNumber = itemNumber;

      const { data: inserted, error: insErr } = await supabase.from('seafood_inventory').insert([{
        item_number:    itemNumber,
        description:    desc,
        category:       item.category || 'Other',
        unit:           item.unit || 'lb',
        cost:           unitPrice > 0 ? unitPrice : 0,
        on_hand_qty:    0,
        on_hand_weight: 0,
        lot_item:       LOT_REQUIRED.test(desc) ? 'Y' : 'N',
        is_ftl_product: false,
      }]).select().single();

      if (insErr) {
        errors.push(`${desc}: ${insErr.message}`);
        continue;
      }
      invMap[key] = inserted || { item_number: itemNumber, description: desc };
      try {
        await applyInventoryLedgerEntry({
          itemNumber,
          deltaQty: qty,
          changeType: 'restock',
          notes: `New item · ${poRef}${item.lot_number ? ' · Lot ' + item.lot_number : ''}`,
          createdBy: req.user.name || req.user.email,
          unitCost: unitPrice,
        });
      } catch (ledgerErr) {
        errors.push(`${desc}: ${ledgerErr.message}`);
        continue;
      }
      itemsCreated++;
    }

    // Auto-create a lot_codes record when lot_number is provided
    let lotId = null;
    if (item.lot_number && item.lot_number.trim()) {
      const lotNumber = item.lot_number.trim(); // stored verbatim — never normalised
      const { data: existingLot } = await supabase
        .from('lot_codes')
        .select('id')
        .eq('lot_number', lotNumber)
        .maybeSingle();

      if (existingLot) {
        lotId = existingLot.id;
      } else {
        const { data: newLot, error: lotErr } = await supabase.from('lot_codes').insert([{
          lot_number:        lotNumber,
          product_id:        resolvedItemNumber,
          vendor_id:         vendor || null,
          quantity_received: qty,
          unit_of_measure:   item.unit || 'lb',
          received_date:     date || new Date().toISOString().slice(0, 10),
          received_by:       req.user.name || req.user.email,
          expiration_date:   item.expiration_date || null,
          notes:             `Auto-created from PO confirm${po_number ? ' · ' + po_number : ''}`,
        }]).select('id').single();

        if (lotErr && lotErr.code !== '23505') {
          errors.push(`Lot ${lotNumber}: ${lotErr.message}`);
        } else if (newLot) {
          lotId = newLot.id;
          lotsCreated++;
        }
      }
    }

    savedItems.push({
      ...item,
      lot_number:      item.lot_number ? item.lot_number.trim() : undefined,
      lot_id:          lotId,
      expiration_date: item.expiration_date || undefined,
    });
  }

  // Persist the purchase order record
  const computedTotal = parseFloat(total_cost) ||
    parseFloat(items.reduce((s, i) => s + (parseFloat(i.total) || 0), 0).toFixed(2));

  const { data: po } = await supabase.from('purchase_orders').insert([{
    po_number:    po_number || null,
    vendor:       vendor    || null,
    items:        savedItems.length ? savedItems : items,
    total_cost:   computedTotal,
    notes:        notes || null,
    confirmed_by: req.user.name || req.user.email,
  }]).select().single();

  res.json({
    success: true,
    items_created: itemsCreated,
    items_updated: itemsUpdated,
    lots_created:  lotsCreated,
    errors,
    purchase_order: po || null,
  });
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
