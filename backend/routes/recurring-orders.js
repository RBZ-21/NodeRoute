'use strict';

/**
 * Recurring (standing) orders CRUD.
 * Tenant-scoped via req.context. The scheduled generator lives in
 * services/recurring-orders.js.
 */

const express = require('express');
const { supabase } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const {
  buildScopeFields,
  filterRowsByContext,
  insertRecordWithOptionalScope,
  scopeQueryByContext,
} = require('../services/operating-context');
const { computeNextRunDate } = require('../services/recurring-orders');

const router = express.Router();

function sanitizeDays(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
}

function sanitizeItems(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      item_number: String(item.item_number || '').trim() || null,
      name: String(item.name || item.description || '').trim() || null,
      unit: String(item.unit || 'each').trim(),
      quantity: Number(item.quantity ?? item.qty) || 0,
      unit_price: Number(item.unit_price ?? item.price) || 0,
    }))
    .filter((item) => item.quantity > 0 && (item.item_number || item.name));
}

// GET /api/recurring-orders
router.get('/', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { data, error } = await scopeQueryByContext(
    supabase.from('recurring_orders').select('*'),
    req.context,
  ).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(filterRowsByContext(data || [], req.context));
});

// POST /api/recurring-orders
router.post('/', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const days = sanitizeDays(req.body?.schedule_days);
  const items = sanitizeItems(req.body?.items);
  if (!req.body?.customer_name) return res.status(400).json({ error: 'customer_name is required.' });
  if (!days.length) return res.status(400).json({ error: 'Select at least one delivery day.' });
  if (!items.length) return res.status(400).json({ error: 'Add at least one item with quantity greater than 0.' });

  const insert = await insertRecordWithOptionalScope(supabase, 'recurring_orders', {
    customer_id: req.body.customer_id ? String(req.body.customer_id) : null,
    customer_name: req.body.customer_name,
    customer_email: req.body.customer_email || null,
    customer_address: req.body.customer_address || null,
    schedule_days: days,
    items,
    route_template_id: req.body.route_template_id ? String(req.body.route_template_id) : null,
    notes: req.body.notes || null,
    active: req.body.active !== false,
    next_run_date: computeNextRunDate(days, new Date()),
  }, req.context);
  if (insert.error) return res.status(500).json({ error: insert.error.message });
  res.json(insert.data);
});

// PATCH /api/recurring-orders/:id
router.patch('/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const patch = { updated_at: new Date().toISOString() };
  if (req.body.customer_name !== undefined) patch.customer_name = req.body.customer_name;
  if (req.body.customer_email !== undefined) patch.customer_email = req.body.customer_email || null;
  if (req.body.customer_address !== undefined) patch.customer_address = req.body.customer_address || null;
  if (req.body.route_template_id !== undefined) patch.route_template_id = req.body.route_template_id ? String(req.body.route_template_id) : null;
  if (req.body.notes !== undefined) patch.notes = req.body.notes || null;
  if (req.body.active !== undefined) patch.active = req.body.active === true;
  if (req.body.schedule_days !== undefined) {
    patch.schedule_days = sanitizeDays(req.body.schedule_days);
    patch.next_run_date = computeNextRunDate(patch.schedule_days, new Date());
  }
  if (req.body.items !== undefined) patch.items = sanitizeItems(req.body.items);

  const { data, error } = await scopeQueryByContext(
    supabase.from('recurring_orders').update(patch).eq('id', req.params.id),
    req.context,
  ).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE /api/recurring-orders/:id
router.delete('/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { error } = await scopeQueryByContext(
    supabase.from('recurring_orders').delete().eq('id', req.params.id),
    req.context,
  );
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

module.exports = router;
