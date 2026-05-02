// /api/vendors route
// Vendor roster used by VendorsPage.tsx
const express = require('express');
const { supabase, dbQuery } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const {
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
  'status',
  'address',
  'notes',
  'payment_terms',
];

function vendorPayload(source) {
  const payload = {};
  VENDOR_FIELDS.forEach(field => {
    if (source[field] !== undefined) payload[field] = source[field] ?? null;
  });
  return payload;
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
    .select('vendor_id, status')
    .in('status', ['pending', 'approved', 'ordered', 'partial']);
  const scopedPos = filterRowsByContext(pos || [], req.context);
  const poCountMap = {};
  scopedPos.forEach(po => {
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
