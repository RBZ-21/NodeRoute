// /api/vendors route
// Vendor roster used by VendorsPage.tsx
const express = require('express');
const { z } = require('zod');
const { supabase, dbQuery } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { validateBody } = require('../lib/zod-validate');
const {
  buildScopeFields,
  filterRowsByContext,
  insertRecordWithOptionalScope,
  rowMatchesContext,
} = require('../services/operating-context');

const router = express.Router();

const VENDOR_FIELDS = [
  'name',
  'contact',
  'email',
  'phone',
  'category',
  'catalog_item_numbers',
  'status',
  'address',
  'notes',
  'payment_terms',
];

function normalizeCatalogItemNumbers(value) {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  return Array.from(
    new Set(
      rawValues
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
    )
  );
}

const vendorBillBodySchema = z.object({
  purchase_order_id: z.string().uuid().optional().nullable(),
  purchaseOrderId: z.string().uuid().optional().nullable(),
  bill_number: z.string().trim().max(100).optional().nullable(),
  billNumber: z.string().trim().max(100).optional().nullable(),
  bill_date: z.string().optional().nullable(),
  billDate: z.string().optional().nullable(),
  due_date: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  subtotal: z.coerce.number().nonnegative().optional(),
  tax: z.coerce.number().nonnegative().optional(),
  total: z.coerce.number().nonnegative().optional(),
  status: z.enum(['pending', 'approved', 'disputed', 'paid', 'void']).optional(),
  items: z.array(z.any()).optional(),
  notes: z.string().max(2000).optional().nullable(),
}).passthrough();

function vendorPayload(source) {
  const payload = {};
  VENDOR_FIELDS.forEach(field => {
    if (source[field] === undefined) return;
    if (field === 'catalog_item_numbers') {
      payload[field] = normalizeCatalogItemNumbers(source[field]);
      return;
    }
    payload[field] = source[field] ?? null;
  });
  return payload;
}

function firstValue(source, ...keys) {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== '') return source[key];
  }
  return null;
}

function money(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parseFloat(parsed.toFixed(2)) : 0;
}

function lineTotal(item) {
  if (!item || typeof item !== 'object') return 0;
  if (item.total !== undefined && item.total !== null && item.total !== '') return Number(item.total) || 0;
  const qty = Number(item.quantity ?? item.qty ?? 0) || 0;
  const unitCost = Number(item.unit_cost ?? item.unitCost ?? item.unit_price ?? item.unitPrice ?? item.price ?? 0) || 0;
  return qty * unitCost;
}

// GET /api/vendors
router.get('/', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const data = await dbQuery(
    supabase.from('vendors').select('*').order('name', { ascending: true }),
    res
  );
  if (!data) return;

  const scoped = filterRowsByContext(data, req.context);

  // Enrich with active PO count
  const { data: pos } = await supabase
    .from('purchase_orders')
    .select('vendor_id, status, workflow_kind');
  const scopedPos = filterRowsByContext(pos || [], req.context);
  const poCountMap = {};
  scopedPos.forEach(po => {
    const workflowKind = String(po.workflow_kind || '').trim().toLowerCase();
    const status = String(po.status || '').trim().toLowerCase();
    if (workflowKind && workflowKind !== 'vendor_order') return;
    if (!['open', 'partial_received', 'backordered', 'pending', 'approved', 'ordered', 'partial'].includes(status)) return;
    const vid = String(po.vendor_id || '');
    if (vid) poCountMap[vid] = (poCountMap[vid] || 0) + 1;
  });

  const enriched = scoped.map(vendor => ({
    ...vendor,
    vendorId: vendor.id,
    activePOs: poCountMap[String(vendor.id)] || 0,
  }));

  res.json(enriched);
});

// POST /api/vendors
router.post('/', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Vendor name is required' });
  const insertResult = await insertRecordWithOptionalScope(supabase, 'vendors', vendorPayload(req.body), req.context);
  if (insertResult.error) return res.status(500).json({ error: insertResult.error.message });
  if (!insertResult.data) return;
  res.json(insertResult.data);
});

// POST /api/vendors/:id/bills — record a vendor bill against a vendor/optional PO.
router.post('/:id/bills', authenticateToken, requireRole('admin', 'manager'), validateBody(vendorBillBodySchema), async (req, res) => {
  const vendor = await dbQuery(
    supabase.from('vendors').select('*').eq('id', req.params.id).single(),
    res
  );
  if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
  if (!rowMatchesContext(vendor, req.context)) return res.status(403).json({ error: 'Forbidden' });

  const body = req.validated.body;
  const items = Array.isArray(body.items) ? body.items : [];
  const subtotal = body.subtotal !== undefined
    ? money(body.subtotal)
    : money(items.reduce((sum, item) => sum + lineTotal(item), 0));
  const tax = money(body.tax || 0);
  const total = body.total !== undefined ? money(body.total) : money(subtotal + tax);
  const purchaseOrderId = firstValue(body, 'purchase_order_id', 'purchaseOrderId');

  if (purchaseOrderId) {
    const po = await dbQuery(
      supabase.from('purchase_orders').select('*').eq('id', purchaseOrderId).single(),
      res
    );
    if (!po) return res.status(404).json({ error: 'Purchase order not found' });
    if (!rowMatchesContext(po, req.context)) return res.status(403).json({ error: 'Forbidden' });
  }

  const insertResult = await insertRecordWithOptionalScope(supabase, 'vendor_bills', {
    vendor_id: vendor.id,
    vendor_name: vendor.name || null,
    purchase_order_id: purchaseOrderId || null,
    bill_number: firstValue(body, 'bill_number', 'billNumber'),
    bill_date: firstValue(body, 'bill_date', 'billDate'),
    due_date: firstValue(body, 'due_date', 'dueDate'),
    subtotal,
    tax,
    total,
    status: body.status || 'pending',
    items,
    notes: body.notes || null,
    created_by: req.user?.name || req.user?.email || 'system',
    ...buildScopeFields(req.context),
  }, req.context);

  if (insertResult.error) return res.status(500).json({ error: insertResult.error.message });
  res.status(201).json(insertResult.data);
});

// PATCH /api/vendors/:id
router.patch('/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const existing = await dbQuery(
    supabase.from('vendors').select('*').eq('id', req.params.id).single(),
    res
  );
  if (!existing) return res.status(404).json({ error: 'Vendor not found' });
  if (!rowMatchesContext(existing, req.context)) return res.status(403).json({ error: 'Forbidden' });

  const payload = vendorPayload(req.body);
  if (!Object.keys(payload).length) return res.status(400).json({ error: 'No valid fields provided' });

  const data = await dbQuery(
    supabase.from('vendors').update(payload).eq('id', req.params.id).select().single(),
    res
  );
  if (!data) return;
  res.json(data);
});

// DELETE /api/vendors/:id
router.delete('/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const existing = await dbQuery(
    supabase.from('vendors').select('*').eq('id', req.params.id).single(),
    res
  );
  if (!existing) return res.status(404).json({ error: 'Vendor not found' });
  if (!rowMatchesContext(existing, req.context)) return res.status(403).json({ error: 'Forbidden' });

  const data = await dbQuery(
    supabase.from('vendors').delete().eq('id', req.params.id),
    res
  );
  if (data === null) return;
  res.json({ message: 'Deleted' });
});

module.exports = router;
