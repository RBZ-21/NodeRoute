const express  = require('express');
const multer   = require('multer');
const { z } = require('zod');
const { supabase }                  = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { parsePurchaseOrderImage }   = require('../services/ai');
const { getAiScanErrorResponse } = require('../services/ai-errors');
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
  scopeQueryByContext,
} = require('../services/operating-context');

function isMissingLotSourcePoColumnError(error) {
  return !!error?.message && String(error.message).includes('lot_codes.source_po_number does not exist');
}

function isDuplicatePoNumberError(error) {
  const message = String(error?.message || '');
  return error?.code === '23505'
    && (message.includes('idx_purchase_orders_po_number_unique') || message.includes('purchase_orders_po_number'));
}

async function generateUniquePurchaseOrderNumber(maxAttempts = 5) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = generatePurchaseOrderNumber();
    const { data, error } = await supabase
      .from('purchase_orders')
      .select('id')
      .eq('po_number', candidate)
      .limit(1);
    if (error) return candidate;
    if (!Array.isArray(data) || data.length === 0) return candidate;
  }
  return generatePurchaseOrderNumber();
}

const router = express.Router();
const MAX_SCAN_PAGES = 5;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
  fileFilter: (req, file, cb) => {
    const isAcceptedScanFile = file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/');
    if (!isAcceptedScanFile) return cb(new Error('Only image or PDF files are accepted'));
    cb(null, true);
  },
});

function scanUpload(req, res, next) {
  const middleware = upload.fields([
    { name: 'image', maxCount: MAX_SCAN_PAGES },
    { name: 'file', maxCount: MAX_SCAN_PAGES },
  ]);
  middleware(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: `Too many pages. Upload at most ${MAX_SCAN_PAGES} images per scan.` });
    }
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Each image must be 15MB or smaller.' });
    }
    if (err.message === 'Only image or PDF files are accepted') {
      return res.status(400).json({ error: 'Unsupported file type. Upload an image or PDF.' });
    }
    return next(err);
  });
}

function scanFilesFromRequest(req) {
  return [...(req.files?.image || []), ...(req.files?.file || [])];
}

const LOT_REQUIRED = /\b(mussel|clam|oyster)s?\b/i;
const purchaseOrderConfirmSchema = z.object({
  draft_id: z.any().optional(),
  vendor: z.preprocess(
    (value) => (value === null || value === undefined ? '' : value),
    z.string().trim().min(1, 'Vendor Name Required')
  ),
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

const purchaseOrderDraftSchema = z.object({
  id: z.any().optional(),
  vendor: z.any().optional(),
  po_number: z.any().optional(),
  scan_id: z.any().optional(),
  total_cost: z.any().optional(),
  notes: z.any().optional(),
  items: z.array(z.any(), { error: 'items must be an array' }).min(1, 'items is required'),
}).passthrough();

const purchaseOrderStatusPatchSchema = z.object({
  status: z.enum(['draft', 'abandoned']),
}).strict();

function currentUserName(req) {
  return req.user?.name || req.user?.email || 'system';
}

function normalizeDraftItem(item) {
  const description = String(item?.description || item?.product_name || '').trim();
  const itemNumber = String(item?.item_number || '').trim();
  const quantity = parseFloat(item?.quantity ?? item?.ordered_qty ?? 0) || 0;
  const unitPrice = parseFloat(item?.unit_price ?? item?.unit_cost ?? item?.estimated_unit_cost ?? 0) || 0;
  return {
    ...item,
    description,
    item_number: itemNumber || undefined,
    quantity,
    unit_price: unitPrice,
    unit: String(item?.unit || '').trim() || 'lb',
    category: String(item?.category || '').trim() || 'Other',
    lot_number: String(item?.lot_number || '').trim() || undefined,
    expiration_date: String(item?.expiration_date || '').trim() || undefined,
    total: parseFloat((quantity * unitPrice).toFixed(2)),
  };
}

function normalizeDraftItems(items) {
  return (Array.isArray(items) ? items : [])
    .map(normalizeDraftItem)
    .filter((item) => (item.description || item.item_number) && item.quantity > 0);
}

function computeDraftTotal(items, fallbackTotal) {
  const provided = parseFloat(fallbackTotal);
  if (Number.isFinite(provided) && provided >= 0) return provided;
  return parseFloat((items || []).reduce((sum, item) => sum + (parseFloat(item.total) || 0), 0).toFixed(2));
}

function buildDraftWorkflowId() {
  return `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function loadEditablePurchaseOrder(id, context) {
  const normalizedId = String(id || '').trim();
  if (!normalizedId) return { row: null };

  const { data, error } = await scopeQueryByContext(
    supabase.from('purchase_orders').select('*'),
    context
  ).eq('id', normalizedId).single();
  if (error || !data) {
    return { status: 404, error: 'Purchase order draft not found' };
  }
  if (!rowMatchesContext(data, context)) {
    return { status: 403, error: 'Forbidden' };
  }

  const status = String(data.status || '').trim().toLowerCase();
  if (status === 'received' || status === 'abandoned' || status === 'cancelled') {
    return { status: 409, error: `Cannot edit a ${status} purchase order` };
  }
  return { row: data };
}

// ── POST /api/purchase-orders/scan ─────────────────────────────────────────
router.post('/scan', authenticateToken, requireRole('admin', 'manager'),
  scanUpload,
  async (req, res) => {
    const uploadedFiles = scanFilesFromRequest(req);
    if (!uploadedFiles.length) return res.status(400).json({ error: 'No file uploaded' });
    if (uploadedFiles.length > MAX_SCAN_PAGES) {
      return res.status(400).json({ error: `Too many pages. Upload at most ${MAX_SCAN_PAGES} images per scan.` });
    }

    try {
      const pages = uploadedFiles.map((file) => ({
        base64: file.buffer.toString('base64'),
        mimeType: file.mimetype || 'image/jpeg',
      }));
      const parsed = pages.length === 1
        ? await parsePurchaseOrderImage(pages[0].base64, pages[0].mimeType)
        : await parsePurchaseOrderImage(pages);
      if (!Array.isArray(parsed.items)) parsed.items = [];
      parsed.items = parsed.items.map(item => {
        const desc = String(item.description || '').toLowerCase();
        const isChargeLine = item.item_type === 'unknown' && (
          /fuel|surcharge|freight|delivery fee|brokerage|handling|service fee|misc charge/i.test(desc)
          || (parseFloat(item.quantity) === 1 && !item.unit)
        );
        return {
          ...item,
          quantity:   parseFloat(item.quantity)   || 0,
          unit_price: parseFloat(item.unit_price) || 0,
          total:      parseFloat(item.total)      || parseFloat((parseFloat(item.quantity || 0) * parseFloat(item.unit_price || 0)).toFixed(2)),
          unit:       item.unit || 'lb',
          category:   item.category || 'Other',
          item_type:  isChargeLine ? 'charge' : (item.item_type || 'unknown'),
          lot_number: item.lot_number || null,
          lot_number_confidence: item.lot_number_confidence || 'none',
        };
      });
      if (!parsed.total_cost) {
        parsed.total_cost = parseFloat(parsed.items.reduce((s, i) => s + i.total, 0).toFixed(2));
      }
      const scanRecord = await recordPoInvoiceScan({
        context: req.context || {},
        createdBy: req.user?.name || req.user?.email || 'system',
        fileName: uploadedFiles.map((file) => file.originalname).filter(Boolean).join(', ') || null,
        mimeType: uploadedFiles[0]?.mimetype || null,
        parsed,
        source: 'purchase-orders-scan',
      });
      res.json({
        ...parsed,
        scan_id: scanRecord?.id || null,
      });
    } catch (err) {
      const { status, body } = getAiScanErrorResponse(
        err,
        'Image scan failed. Please try again with a clearer image or enter the details manually.'
      );
      res.status(status).json(body);
    }
  }
);

// ── POST /api/purchase-orders/draft ────────────────────────────────────────
router.post('/draft', authenticateToken, requireRole('admin', 'manager'), validateBody(purchaseOrderDraftSchema), async (req, res) => {
  try {
    const { id, vendor, po_number, items, total_cost, notes, scan_id } = req.validated.body;
    const existing = await loadEditablePurchaseOrder(id, req.context || {});
    if (existing.error) return res.status(existing.status || 400).json({ error: existing.error });

    const normalizedItems = normalizeDraftItems(items);
    if (!normalizedItems.length) {
      return res.status(400).json({ error: 'Add at least one line with item number or description and quantity.' });
    }

    const vendorName = String(vendor || '').trim();
    const vendorRecord = vendorName ? await findVendorByName(vendorName, req.context || {}) : null;
    const resolvedPoNumber = String(po_number || existing.row?.po_number || '').trim()
      || await generateUniquePurchaseOrderNumber();
    const nowIso = new Date().toISOString();
    const userName = currentUserName(req);
    const draftPayload = {
      po_number: resolvedPoNumber,
      vendor: vendorName || null,
      vendor_id: vendorRecord?.id || null,
      items: normalizedItems,
      total_cost: computeDraftTotal(normalizedItems, total_cost),
      notes: String(notes || '').trim() || null,
      status: 'draft',
      workflow_kind: 'inventory_receipt',
      workflow_id: existing.row?.workflow_id || buildDraftWorkflowId(),
      source_scan_id: String(scan_id || '').trim() || null,
      updated_by: userName,
      updated_at: nowIso,
      created_by: existing.row?.created_by || userName,
      ...buildScopeFields(req.context),
    };

    let result;
    if (existing.row?.id) {
      result = await executeWithOptionalScope(
        (candidate) => supabase.from('purchase_orders').update(candidate).eq('id', existing.row.id).select().single(),
        draftPayload
      );
    } else {
      result = await insertRecordWithOptionalScope(supabase, 'purchase_orders', draftPayload, req.context);
    }

    if (result.error && isDuplicatePoNumberError(result.error)) {
      return res.status(409).json({ error: 'PO number already exists. Enter a unique PO number.' });
    }
    if (result.error) return res.status(500).json({ error: result.error.message });
    res.json(result.data);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not save purchase order draft' });
  }
});

// ── POST /api/purchase-orders/confirm ──────────────────────────────────────
router.post('/confirm', authenticateToken, requireRole('admin', 'manager'), validateBody(purchaseOrderConfirmSchema), async (req, res) => {
  const { vendor, po_number, date, items, total_cost, notes, scan_id, draft_id } = req.validated.body;
  const existing = await loadEditablePurchaseOrder(draft_id, req.context || {});
  if (existing.error) return res.status(existing.status || 400).json({ error: existing.error });
  const providedPoNumber = String(po_number || existing.row?.po_number || '').trim();
  const resolvedPoNumber = providedPoNumber || await generateUniquePurchaseOrderNumber();
  const vendorRecord = await findVendorByName(vendor, req.context || {});

  const { data: inventory, error: invErr } = await supabase
    .from('products')
    .select('item_number, description, on_hand_qty, cost, unit, is_ftl_regulated, company_id, location_id');
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

  for (const item of items) {
    // Skip non-product charge lines (fuel surcharges, fees, etc.)
    if (String(item.item_type || '').toLowerCase() === 'charge') {
      savedItems.push({ ...item, skipped: true });
      continue;
    }

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
          context: req.context,
        });
      } catch (ledgerErr) {
        errors.push(`${desc}: ${ledgerErr.message}`);
        continue;
      }
      itemsUpdated++;
    } else {
      const itemNumber = 'PO-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();
      resolvedItemNumber = itemNumber;

      const inventoryInsert = await insertRecordWithOptionalScope(supabase, 'products', {
        item_number:      itemNumber,
        name:             desc,
        category:         item.category || 'Other',
        unit:             item.unit || 'lb',
        cost:             unitPrice > 0 ? unitPrice : 0,
        on_hand_qty:      0,
        on_hand_weight:   0,
        lot_item:         LOT_REQUIRED.test(desc) ? 'Y' : 'N',
        is_ftl_regulated: false,
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
          context: req.context,
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
        const { data: fallbackLots, error: fallbackErr } = await scopeQueryByContext(supabase
          .from('lot_codes').select('id'), req.context).eq('lot_number', lotNumber).limit(1);
        if (fallbackErr) throw new Error(fallbackErr.message);
        const existingLot = fallbackLots?.[0] || null;
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

      if (lotId || (item.lot_number && item.lot_number.trim())) {
        const lotNumber = String(item.lot_number || '').trim();
        if (lotNumber) {
          const inventoryLotPayload = {
            item_number:       resolvedItemNumber,
            lot_number:        lotNumber,
            supplier_name:     vendor || null,
            received_date:     date || new Date().toISOString().slice(0, 10),
            qty_received:      qty,
            qty_on_hand:       qty,
            cost_per_unit:     unitPrice > 0 ? unitPrice : 0,
            status:            'active',
            notes:             `Auto-created from PO confirm · ${resolvedPoNumber}`,
            created_by:        req.user.name || req.user.email,
            ...buildScopeFields(req.context),
          };
          const { error: invLotErr } = await insertRecordWithOptionalScope(
            supabase,
            'inventory_lots',
            inventoryLotPayload,
            req.context
          );
          if (invLotErr && invLotErr.code !== '23505') {
            errors.push(`inventory_lots for Lot ${lotNumber}: ${invLotErr.message}`);
          }
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

  const poPayload = {
    po_number:    resolvedPoNumber,
    vendor:       vendor    || null,
    vendor_id:    vendorRecord?.id || null,
    items:        savedItems.length ? savedItems : items,
    total_cost:   computedTotal,
    notes:        notes || null,
    status:       'received',
    workflow_kind:'inventory_receipt',
    workflow_id:  null,
    created_by:   req.user.name || req.user.email,
    updated_by:   req.user.name || req.user.email,
    updated_at:   new Date().toISOString(),
    received_at:  new Date().toISOString(),
    closed_at:    new Date().toISOString(),
    source_scan_id: String(scan_id || '').trim() || null,
    confirmed_by: req.user.name || req.user.email,
    ...buildScopeFields(req.context),
  };
  let poInsert;
  if (existing.row?.id) {
    poInsert = await executeWithOptionalScope(
      (candidate) => supabase.from('purchase_orders').update(candidate).eq('id', existing.row.id).select().single(),
      poPayload
    );
  } else {
    poInsert = await insertRecordWithOptionalScope(supabase, 'purchase_orders', poPayload, req.context);
  }
  if (poInsert.error && isDuplicatePoNumberError(poInsert.error)) {
    return res.status(409).json({ error: 'PO number already exists. Enter a unique PO number.' });
  }
  if (poInsert.error) return res.status(500).json({ error: poInsert.error.message });
  const po = poInsert.data;

  if (po?.id) {
    // Build a single synthetic receipt from the confirmed items so the formal
    // receiving pipeline (po_receipts -> po_receiving_lines -> po_discrepancy_log)
    // is populated for every scan-confirmed PO.
    const syntheticReceipt = {
      received_by: req.user.name || req.user.email,
      received_at: poPayload.received_at,
      notes: notes || null,
      scan_id: String(scan_id || '').trim() || null,
      receipt_rules_applied: {},
      variance_audit: {},
      lines: savedItems
        .filter((item) => String(item.item_type || '').toLowerCase() !== 'charge')
        .map((item, index) => {
          const qty = parseFloat(item.quantity) || 0;
          return {
            line_no: index + 1,
            item_number: item.item_number || null,
            product_name: (item.description || '').trim() || null,
            lot_number: item.lot_number ? String(item.lot_number).trim() : null,
            qty_received: qty,
            requested_receive_qty: qty,
            accepted_receive_qty: qty,
            rejected_receive_qty: 0,
            over_receipt_qty: 0,
            remaining_before_qty: qty,
            remaining_after_qty: 0,
            quantity_variance_qty: 0,
            variance_type: 'exact_receipt',
            backordered_qty_after_receipt: 0,
            waived_backorder_qty_applied: 0,
            unit: item.unit || 'lb',
            unit_cost: parseFloat(item.unit_price) || 0,
            item_type: item.item_type || 'unknown',
            approval_status: null,
          };
        }),
    };

    const syntheticPo = {
      receipts: [syntheticReceipt],
      receipt_rules: {},
    };

    try {
      const { replaceReceiptAuditRows } = require('../services/purchase-order-workflows');
      await replaceReceiptAuditRows(po.id, syntheticPo, req.context || {});
    } catch (receiptErr) {
      console.warn('[po-confirm] failed to write receiving pipeline rows:', receiptErr.message);
    }
  }

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

// ── PATCH /api/purchase-orders/:id/status ─────────────────────────────────
router.patch('/:id/status', authenticateToken, requireRole('admin', 'manager'), validateBody(purchaseOrderStatusPatchSchema), async (req, res) => {
  const nextStatus = req.validated.body.status;
  const existing = await loadEditablePurchaseOrder(req.params.id, req.context || {});
  if (existing.error) return res.status(existing.status || 400).json({ error: existing.error });

  const { data, error } = await executeWithOptionalScope(
    (candidate) => supabase.from('purchase_orders').update(candidate).eq('id', existing.row.id).select().single(),
    {
      status: nextStatus,
      updated_by: currentUserName(req),
      updated_at: new Date().toISOString(),
    }
  );
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── GET /api/purchase-orders ──────────────────────────────────────────────
router.get('/', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  // Tenant-scope marker: 'id, po_number, vendor, total_cost, items, confirmed_by, created_at, company_id, location_id'
  let result = await executeWithOptionalScope(
    (candidate) => scopeQueryByContext(supabase
      .from('purchase_orders')
      .select(candidate.select), req.context)
      .order('created_at', { ascending: false })
      .limit(100),
    { select: 'id, po_number, vendor, total_cost, notes, items, confirmed_by, status, updated_at, created_at, company_id, location_id, workflow_kind' }
  );
  if (result.error && String(result.error.message || '').includes('purchase_orders.company_id')) {
    result = await executeWithOptionalScope(
      (candidate) => scopeQueryByContext(supabase
        .from('purchase_orders')
        .select(candidate.select), req.context)
        .order('created_at', { ascending: false })
        .limit(100),
      { select: 'id, po_number, vendor, total_cost, notes, items, confirmed_by, status, updated_at, created_at, location_id, workflow_kind' }
    );
  }
  if (result.error) return res.status(500).json({ error: result.error.message });
  const scopedRows = filterRowsByContext(result.data || [], req.context)
    .filter((row) => String(row.workflow_kind || '').trim().toLowerCase() !== 'vendor_order');
  res.json(scopedRows);
});

router.get('/:id/pdf', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  let result = await executeWithOptionalScope(
    (candidate) => scopeQueryByContext(supabase
      .from('purchase_orders')
      .select(candidate.select), req.context)
      .eq('id', req.params.id)
      .single(),
    { select: 'id, po_number, vendor, total_cost, notes, items, confirmed_by, created_at, company_id, location_id' }
  );
  if (result.error && String(result.error.message || '').includes('purchase_orders.company_id')) {
    result = await executeWithOptionalScope(
      (candidate) => scopeQueryByContext(supabase
        .from('purchase_orders')
        .select(candidate.select), req.context)
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
