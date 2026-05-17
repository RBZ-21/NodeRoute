const express  = require('express');
const multer   = require('multer');
const { z } = require('zod');
const { supabase }                  = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { parsePurchaseOrderImage }   = require('../services/ai');
const { applyInventoryLedgerEntry } = require('../services/inventory-ledger');
const { generatePurchaseOrderNumber } = require('../services/purchase-order-numbers');
const { buildPurchaseOrderPDF } = require('../services/purchase-order-pdf');
const {
  attachLotsToPurchaseOrder,
  findVendorByName,
  linkScanToPurchaseOrder,
  recordPoInvoiceScan,
} = require('../services/purchase-order-workflows');
const { validateBody } = require('../lib/zod-validate');
const {
  buildScopeFields,
  executeWithOptionalScope,
  filterRowsByContext,
  insertRecordWithOptionalScope,
  rowMatchesContext,
} = require('../services/operating-context');

function isMissingFtlColumnError(error) {
  return !!error?.message && error.message.includes('seafood_inventory.is_ftl_product does not exist');
}

function isMissingLotSourcePoColumnError(error) {
  return !!error?.message && String(error.message).includes('lot_codes.source_po_number does not exist');
}

function isMissingSourceRequestIdColumnError(error) {
  return !!error?.message && String(error.message).includes('purchase_orders.source_request_id does not exist');
}

function normalizeInventoryReceiptRequestId(requestId, scanId) {
  const explicit = String(requestId || '').trim();
  if (explicit) return explicit;
  const normalizedScanId = String(scanId || '').trim();
  return normalizedScanId ? `scan:${normalizedScanId}` : null;
}

async function reverseLedgerApplications(applications, userName) {
  for (const entry of [...applications].reverse()) {
    try {
      await applyInventoryLedgerEntry({
        itemNumber: entry.itemNumber,
        deltaQty: -Math.abs(entry.qty),
        changeType: 'receipt_reversal',
        notes: entry.notes,
        createdBy: userName || 'system',
        preventNegative: false,
      });
    } catch (_error) {
      // Best-effort reversal only. The primary failure will still surface to the caller.
    }
  }
}

async function findExistingInventoryReceiptByRequest({ requestId, scanId, context }) {
  if (!requestId && !scanId) return null;

  const selectClause = `${PURCHASE_ORDER_SELECT}, notes, workflow_kind, source_scan_id, source_request_id`;
  if (requestId) {
    let requestLookup = await executeWithOptionalScope(
      (candidate) => supabase
        .from('purchase_orders')
        .select(candidate.select)
        .eq('workflow_kind', 'inventory_receipt')
        .eq('source_request_id', requestId)
        .order('created_at', { ascending: false })
        .limit(5),
      { select: selectClause }
    );
    if (requestLookup.error && !isMissingSourceRequestIdColumnError(requestLookup.error)) {
      throw new Error(requestLookup.error.message);
    }
    if (!requestLookup.error) {
      const existingByRequest = filterRowsByContext(requestLookup.data || [], context)[0] || null;
      if (existingByRequest) return existingByRequest;
    }
  }

  if (!scanId) return null;
  const scanLookup = await executeWithOptionalScope(
    (candidate) => supabase
      .from('purchase_orders')
      .select(candidate.select)
      .eq('workflow_kind', 'inventory_receipt')
      .eq('source_scan_id', scanId)
      .order('created_at', { ascending: false })
      .limit(5),
    { select: `${PURCHASE_ORDER_SELECT}, notes, workflow_kind, source_scan_id` }
  );
  if (scanLookup.error) throw new Error(scanLookup.error.message);
  return filterRowsByContext(scanLookup.data || [], context)[0] || null;
}

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
const PURCHASE_ORDER_SELECT = 'id, po_number, vendor, total_cost, items, confirmed_by, created_at, company_id, location_id';
const purchaseOrderConfirmSchema = z.object({
  request_id: z.any().optional(),
  vendor: z.string().trim().min(1, 'vendor is required'),
  po_number: z.any().optional(),
  date: z.any().optional(),
  scan_id: z.any().optional(),
  total_cost: z.any().optional(),
  notes: z.any().optional(),
  items: z.array(z.any(), { error: 'items must be an array' }).min(1, 'items is required'),
}).passthrough().superRefine((body, ctx) => {
  (body.items || []).forEach((item, index) => {
    const description = String(item?.description || '').trim();
    const category = String(item?.category || '').trim();
    const quantity = Number(item?.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'quantity must be a positive number',
        path: ['items', index, 'quantity'],
      });
    }
    if (LOT_REQUIRED.test(`${description} ${category}`) && !String(item?.lot_number || '').trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'lot_number is required for mollusk traceability items',
        path: ['items', index, 'lot_number'],
      });
    }
  });
});

// ── POST /api/purchase-orders/scan ─────────────────────────────────────────
router.post('/scan', authenticateToken, requireRole('admin', 'manager'),
  upload.single('image'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

    const base64   = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype || 'image/jpeg';

    try {
      const parsed = await parsePurchaseOrderImage(base64, mimeType);
      if (!Array.isArray(parsed.items)) parsed.items = [];
      parsed.items = parsed.items.map(item => ({
        ...item,
        quantity:   parseFloat(item.quantity)   || 0,
        unit_price: parseFloat(item.unit_price) || 0,
        total:      parseFloat(item.total)      || parseFloat((parseFloat(item.quantity || 0) * parseFloat(item.unit_price || 0)).toFixed(2)),
        unit:       item.unit || 'lb',
        category:   item.category || 'Other',
        item_type:  item.item_type || 'unknown',
        lot_number: item.lot_number || null,
        lot_number_confidence: item.lot_number_confidence || 'none',
      }));
      if (!parsed.total_cost) {
        parsed.total_cost = parseFloat(parsed.items.reduce((s, i) => s + i.total, 0).toFixed(2));
      }
      const scanRecord = await recordPoInvoiceScan({
        context: req.context || {},
        createdBy: req.user?.name || req.user?.email || 'system',
        fileName: req.file.originalname || null,
        mimeType: req.file.mimetype || null,
        parsed,
        source: 'purchase-orders-scan',
      });
      res.json({
        ...parsed,
        scan_id: scanRecord?.id || null,
      });
    } catch (err) {
      if (err.message.includes('OPENAI_API_KEY')) return res.status(503).json({ error: err.message });
      res.status(500).json({ error: 'Image scan failed: ' + err.message });
    }
  }
);

// ── POST /api/purchase-orders/confirm ──────────────────────────────────────
router.post('/confirm', authenticateToken, requireRole('admin', 'manager'), validateBody(purchaseOrderConfirmSchema), async (req, res) => {
  const { request_id, vendor, po_number, date, items, total_cost, notes, scan_id } = req.validated.body;
  const resolvedPoNumber = String(po_number || '').trim() || generatePurchaseOrderNumber();
  const vendorRecord = await findVendorByName(vendor, req.context || {});
  const normalizedRequestId = normalizeInventoryReceiptRequestId(request_id, scan_id);

  try {
    const existingReceipt = await findExistingInventoryReceiptByRequest({
      requestId: normalizedRequestId,
      scanId: String(scan_id || '').trim() || null,
      context: req.context || {},
    });
    if (existingReceipt) {
      return res.json({
        success: true,
        replay: true,
        items_created: 0,
        items_updated: 0,
        lots_created: 0,
        errors: [],
        purchase_order: existingReceipt,
      });
    }
  } catch (lookupError) {
    return res.status(500).json({ error: lookupError.message });
  }

  let { data: inventory, error: invErr } = await supabase
    .from('seafood_inventory')
    .select('item_number, description, on_hand_qty, cost, unit, is_ftl_product, company_id, location_id');
  if (isMissingFtlColumnError(invErr)) {
    ({ data: inventory, error: invErr } = await supabase
      .from('seafood_inventory')
      .select('item_number, description, on_hand_qty, cost, unit, company_id, location_id'));
  }
  if (invErr) return res.status(500).json({ error: invErr.message });

  const invMap = {};
  filterRowsByContext(inventory || [], req.context).forEach(row => {
    invMap[row.description.toLowerCase().trim()] = row;
  });

  let itemsCreated  = 0;
  let itemsUpdated  = 0;
  let lotsCreated   = 0;
  const errors      = [];
  const savedItems  = [];
  const ledgerApplications = [];

  for (const item of items) {
    const desc = (item.description || '').trim();
    if (!desc) continue;

    const qty       = parseFloat(item.quantity)   || 0;
    const unitPrice = parseFloat(item.unit_price) || 0;
    if (qty <= 0) continue;

    const key      = desc.toLowerCase();
    const existing = invMap[key];
    const poRef    = `PO scan${resolvedPoNumber ? ' · ' + resolvedPoNumber : ''}${vendor ? ' from ' + vendor : ''}`;

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
        ledgerApplications.push({
          itemNumber: existing.item_number,
          qty,
          notes: `Auto-reversal for inventory receipt retry protection · ${poRef}${item.lot_number ? ' · Lot ' + item.lot_number : ''}`,
        });
      } catch (ledgerErr) {
        errors.push(`${desc}: ${ledgerErr.message}`);
        continue;
      }
      itemsUpdated++;
    } else {
      const itemNumber = 'PO-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();
      resolvedItemNumber = itemNumber;

      const inventoryInsert = await insertRecordWithOptionalScope(supabase, 'seafood_inventory', {
        item_number:    itemNumber,
        description:    desc,
        category:       item.category || 'Other',
        unit:           item.unit || 'lb',
        cost:           unitPrice > 0 ? unitPrice : 0,
        on_hand_qty:    0,
        on_hand_weight: 0,
        lot_item:       LOT_REQUIRED.test(desc) ? 'Y' : 'N',
        is_ftl_product: false,
      }, req.context);
      const inserted = inventoryInsert.data;
      const insErr = inventoryInsert.error;

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
        ledgerApplications.push({
          itemNumber,
          qty,
          notes: `Auto-reversal for inventory receipt retry protection · ${poRef}${item.lot_number ? ' · Lot ' + item.lot_number : ''}`,
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
      const lotNumber = item.lot_number.trim();

      // Scope lot lookup to current tenant context where possible
      const scopeFields = buildScopeFields(req.context);
      let lotQuery = supabase.from('lot_codes').select('id').eq('lot_number', lotNumber);
      if (scopeFields.company_id) lotQuery = lotQuery.eq('company_id', scopeFields.company_id);
      if (scopeFields.location_id) lotQuery = lotQuery.eq('location_id', scopeFields.location_id);
      const { data: existingLots, error: existingLotErr } = await lotQuery.limit(1);

      if (existingLotErr) {
        // Fallback: query without scope if column missing
        const { data: fallbackLots, error: fallbackErr } = await supabase
          .from('lot_codes').select('id, company_id, location_id').eq('lot_number', lotNumber).limit(5);
        if (fallbackErr) throw new Error(fallbackErr.message);
        const scopedFallbackLots = filterRowsByContext(fallbackLots || [], req.context);
        const existingLot = scopedFallbackLots[0]
          || ((!scopeFields.company_id && !scopeFields.location_id) ? (fallbackLots?.[0] || null) : null);
        if (existingLot) {
          lotId = existingLot.id;
        }
      } else {
        const existingLot = existingLots?.[0] || null;
        if (existingLot) {
          lotId = existingLot.id;
        }
      }

      if (!lotId) {
        // Insert with tenant scope
        const lotPayload = {
          lot_number:        lotNumber,
          product_id:        resolvedItemNumber,
          vendor_id:         vendor || null,
          quantity_received: qty,
          unit_of_measure:   item.unit || 'lb',
          received_date:     date || new Date().toISOString().slice(0, 10),
          received_by:       req.user.name || req.user.email,
          expiration_date:   item.expiration_date || null,
          source_po_number:  resolvedPoNumber,
          notes:             `Auto-created from PO confirm${resolvedPoNumber ? ' · ' + resolvedPoNumber : ''}`,
          ...buildScopeFields(req.context),
        };
        let lotInsert = await executeWithOptionalScope(
          (candidate) => supabase.from('lot_codes').insert([candidate]).select('id').single(),
          lotPayload
        );
        if (isMissingLotSourcePoColumnError(lotInsert.error)) {
          const { source_po_number, ...legacyLotPayload } = lotPayload;
          lotInsert = await executeWithOptionalScope(
            (candidate) => supabase.from('lot_codes').insert([candidate]).select('id').single(),
            legacyLotPayload
          );
        }
        if (lotInsert.error && lotInsert.error.code !== '23505') {
          errors.push(`Lot ${lotNumber}: ${lotInsert.error.message}`);
        } else if (lotInsert.data) {
          lotId = lotInsert.data.id;
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

  const computedTotal = parseFloat(total_cost) ||
    parseFloat(items.reduce((s, i) => s + (parseFloat(i.total) || 0), 0).toFixed(2));

  const poInsert = await insertRecordWithOptionalScope(supabase, 'purchase_orders', {
    po_number:    resolvedPoNumber,
    vendor:       vendor    || null,
    vendor_id:    vendorRecord?.id || null,
    items:        savedItems.length ? savedItems : items,
    total_cost:   computedTotal,
    notes:        notes || null,
    status:       'received',
    workflow_kind:'inventory_receipt',
    workflow_id:  null,
    source_request_id: String(normalizedRequestId || '').trim() || null,
    created_by:   req.user.name || req.user.email,
    updated_by:   req.user.name || req.user.email,
    updated_at:   new Date().toISOString(),
    received_at:  new Date().toISOString(),
    source_scan_id: String(scan_id || '').trim() || null,
    confirmed_by: req.user.name || req.user.email,
    ...buildScopeFields(req.context),
  }, req.context);
  if (poInsert.error) {
    await reverseLedgerApplications(ledgerApplications, req.user.name || req.user.email);
    return res.status(500).json({ error: poInsert.error.message });
  }
  const po = poInsert.data;

  try {
    const lotNumbers = savedItems
      .map((item) => String(item.lot_number || '').trim())
      .filter(Boolean);
    if (po?.id && lotNumbers.length) {
      await attachLotsToPurchaseOrder(po.id, lotNumbers, req.context || {});
    }
    if (po?.id && String(scan_id || '').trim()) {
      await linkScanToPurchaseOrder(
        String(scan_id).trim(),
        po.id,
        vendorRecord?.id || po.vendor_id || null,
        req.user.name || req.user.email
      );
    }
  } catch (linkError) {
    return res.status(500).json({ error: linkError.message });
  }

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
  let result = await executeWithOptionalScope(
    (candidate) => supabase
      .from('purchase_orders')
      .select(candidate.select)
      .order('created_at', { ascending: false })
      .limit(100),
    { select: `${PURCHASE_ORDER_SELECT}, notes, workflow_kind` }
  );
  if (result.error && String(result.error.message || '').includes('purchase_orders.company_id')) {
    result = await executeWithOptionalScope(
      (candidate) => supabase
        .from('purchase_orders')
        .select(candidate.select)
        .order('created_at', { ascending: false })
        .limit(100),
      { select: 'id, po_number, vendor, total_cost, notes, items, confirmed_by, created_at, location_id, workflow_kind' }
    );
  }
  if (result.error) return res.status(500).json({ error: result.error.message });
  const scopedRows = filterRowsByContext(result.data || [], req.context)
    .filter((row) => String(row.workflow_kind || '').trim().toLowerCase() !== 'vendor_order');
  res.json(scopedRows);
});

router.get('/:id/pdf', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  let result = await executeWithOptionalScope(
    (candidate) => supabase
      .from('purchase_orders')
      .select(candidate.select)
      .eq('id', req.params.id)
      .single(),
    { select: `${PURCHASE_ORDER_SELECT}, notes` }
  );
  if (result.error && String(result.error.message || '').includes('purchase_orders.company_id')) {
    result = await executeWithOptionalScope(
      (candidate) => supabase
        .from('purchase_orders')
        .select(candidate.select)
        .eq('id', req.params.id)
        .single(),
      { select: 'id, po_number, vendor, total_cost, notes, items, confirmed_by, created_at, location_id' }
    );
  }
  if (result.error) return res.status(500).json({ error: result.error.message });

  const order = result.data;
  if (!order) return res.status(404).json({ error: 'Purchase order not found' });
  if (!rowMatchesContext(order, req.context)) return res.status(403).json({ error: 'Forbidden' });

  try {
    const pdf = await buildPurchaseOrderPDF(order);
    const poNumber = String(order.po_number || order.id || 'purchase-order').replace(/[^\w.-]+/g, '-');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${poNumber}.pdf"`);
    res.send(pdf);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not build purchase order PDF' });
  }
});

module.exports = router;
