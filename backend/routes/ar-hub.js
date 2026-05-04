'use strict';

const express = require('express');
const { supabase, dbQuery } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { filterRowsByContext, rowMatchesContext } = require('../services/operating-context');
const { sendInvoiceEmail } = require('../services/invoice-email');

const router = express.Router();
const OPEN_STATUSES = ['pending', 'signed', 'sent', 'overdue'];

function daysSince(dateString) {
  if (!dateString) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(dateString).getTime()) / 86_400_000));
}

function ageBucket(days) {
  if (days === 0) return 'Current';
  if (days <= 30) return '1-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

// GET /api/ar/aging
router.get('/aging', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('invoices')
      .select('id,invoice_number,customer_name,customer_email,total,status,due_date,created_at')
      .in('status', OPEN_STATUSES)
      .order('due_date', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });

    const invoices = filterRowsByContext(data || [], req.context);
    const byCustomer = new Map();

    for (const inv of invoices) {
      const key = (inv.customer_email || inv.customer_name || inv.id).toLowerCase();
      const age = daysSince(inv.due_date || inv.created_at);
      const bucket = ageBucket(age);
      const amount = parseFloat(inv.total || 0) || 0;

      if (!byCustomer.has(key)) {
        byCustomer.set(key, {
          customer_name: inv.customer_name || 'Unknown',
          customer_email: inv.customer_email || null,
          buckets: { Current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 },
          total_open: 0,
          invoice_count: 0,
          oldest_due_date: inv.due_date || inv.created_at,
        });
      }
      const entry = byCustomer.get(key);
      entry.buckets[bucket] = parseFloat((entry.buckets[bucket] + amount).toFixed(2));
      entry.total_open = parseFloat((entry.total_open + amount).toFixed(2));
      entry.invoice_count += 1;
      if ((inv.due_date || inv.created_at) < entry.oldest_due_date) {
        entry.oldest_due_date = inv.due_date || inv.created_at;
      }
    }

    const rows = [...byCustomer.values()].sort((a, b) => b.total_open - a.total_open);
    res.json({ aging: rows, bucketLabels: ['Current', '1-30', '31-60', '61-90', '90+'] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ar/remind/:customerId
// Send payment reminder emails for all open invoices belonging to a customer.
router.post('/remind/:customerId', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const id = req.params.customerId;
    let { data: invoices, error } = await supabase
      .from('invoices')
      .select('*')
      .eq('customer_email', id)
      .in('status', OPEN_STATUSES);
    if (error) return res.status(500).json({ error: error.message });
    if (!invoices?.length) {
      const { data: byName } = await supabase
        .from('invoices')
        .select('*')
        .ilike('customer_name', `%${id}%`)
        .in('status', OPEN_STATUSES);
      invoices = byName || [];
    }
    if (!invoices.length) return res.status(404).json({ error: 'No open invoices found for this customer' });
    const scoped = invoices.filter((inv) => rowMatchesContext(inv, req.context));
    if (!scoped.length) return res.status(403).json({ error: 'Forbidden' });
    const recipient = scoped[0].customer_email || scoped[0].billing_email;
    if (!recipient) return res.status(400).json({ error: 'No email address on file for this customer' });

    const results = [];
    for (const inv of scoped) {
      const result = await sendInvoiceEmail(inv, `Payment Reminder — ${inv.invoice_number || inv.id}`);
      results.push({ invoice_id: inv.id, sent: result.sent, error: result.error });
    }
    const totalOwed = scoped.reduce((s, inv) => s + (parseFloat(inv.total) || 0), 0);
    res.json({
      sent: results.filter((r) => r.sent).length,
      failed: results.filter((r) => !r.sent).length,
      total_owed: parseFloat(totalOwed.toFixed(2)),
      results,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ar/collections
router.get('/collections', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const { data, error } = await supabase
      .from('invoices')
      .select('id,invoice_number,customer_name,customer_email,total,status,due_date,created_at,collections_note,collections_status')
      .in('status', ['pending', 'sent', 'overdue'])
      .lt('due_date', cutoff)
      .order('due_date', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    const rows = filterRowsByContext(data || [], req.context).map((inv) => ({
      ...inv,
      days_overdue: daysSince(inv.due_date || inv.created_at),
      total: parseFloat(inv.total || 0),
    }));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/ar/collections/:invoiceId/note
router.patch('/collections/:invoiceId/note', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const existing = await dbQuery(
      supabase.from('invoices').select('*').eq('id', req.params.invoiceId).single(),
      res
    );
    if (!existing) return;
    if (!rowMatchesContext(existing, req.context)) return res.status(403).json({ error: 'Forbidden' });
    const updates = {};
    const { note, collections_status } = req.body || {};
    if (note !== undefined) updates.collections_note = String(note || '').trim() || null;
    if (collections_status !== undefined) {
      const allowed = ['open', 'contacted', 'promise_to_pay', 'escalated', 'resolved'];
      const val = String(collections_status).trim().toLowerCase();
      if (!allowed.includes(val)) return res.status(400).json({ error: `collections_status must be one of: ${allowed.join(', ')}` });
      updates.collections_status = val;
      if (val === 'resolved') updates.status = 'paid';
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'No valid fields provided' });
    const { data, error } = await supabase.from('invoices').update(updates).eq('id', req.params.invoiceId).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
