'use strict';
const express = require('express');
const { supabase, dbQuery } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const apLedger = require('../services/ap-ledger');
const {
  filterRowsByContext,
  rowMatchesContext,
  buildScopeFields,
  scopeQueryByContext,
} = require('../services/operating-context');

const router = express.Router();

// GET /api/vendor-bills — list all vendor bills, newest first
router.get('/', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { data, error } = await scopeQueryByContext(supabase
    .from('vendor_bills')
    .select('id, bill_number, purchase_order_id, vendor, vendor_id, amount, status, due_date, paid_at, paid_by, notes, auto_generated, created_by, company_id, location_id, created_at, updated_at'), req.context)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return res.status(500).json({ error: error.message });
  res.json(filterRowsByContext(data || [], req.context));
});

// GET /api/vendor-bills/:id — single bill
router.get('/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const bill = await dbQuery(
    scopeQueryByContext(supabase.from('vendor_bills').select('*'), req.context).eq('id', req.params.id).single(),
    res
  );
  if (!bill) return;
  if (!rowMatchesContext(bill, req.context)) return res.status(403).json({ error: 'Forbidden' });
  res.json(bill);
});

// PATCH /api/vendor-bills/:id — update status, due_date, notes, paid_by
router.patch('/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const existing = await dbQuery(
    scopeQueryByContext(supabase.from('vendor_bills').select('*'), req.context).eq('id', req.params.id).single(),
    res
  );
  if (!existing) return;
  if (!rowMatchesContext(existing, req.context)) return res.status(403).json({ error: 'Forbidden' });

  const allowed = ['status', 'due_date', 'notes', 'paid_by', 'amount'];
  const fields = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) fields[key] = req.body[key];
  }
  if (!Object.keys(fields).length) return res.status(400).json({ error: 'No updatable fields provided' });

  const VALID_STATUSES = new Set(['pending', 'approved', 'paid', 'void']);
  if (fields.status && !VALID_STATUSES.has(fields.status)) {
    return res.status(400).json({ error: `Invalid status "${fields.status}"` });
  }

  if (fields.status === 'paid' && !existing.paid_at) {
    fields.paid_at = new Date().toISOString();
    if (!fields.paid_by) fields.paid_by = req.user?.name || req.user?.email || null;
  }

  fields.updated_at = new Date().toISOString();
  const data = await dbQuery(
    scopeQueryByContext(supabase.from('vendor_bills').update(fields), req.context).eq('id', req.params.id).select().single(),
    res
  );
  if (!data) return;
  if (fields.status === 'approved' && String(existing.status || '').toLowerCase() !== 'approved') {
    data.ap_ledger_entry = await apLedger.postBill(data.id, { db: supabase, context: req.context });
  }
  res.json(data);
});

module.exports = router;
