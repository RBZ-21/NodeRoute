'use strict';

const express = require('express');
const { z } = require('zod');
const { supabase } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { validateBody, validateParams, validateQuery } = require('../lib/zod-validate');
const apLedger = require('../services/ap-ledger');
const {
  buildScopeFields,
  filterRowsByContext,
  insertRecordWithOptionalScope,
  rowMatchesContext,
  scopeQueryByContext,
} = require('../services/operating-context');

const router = express.Router();
const apReaders = requireRole('admin', 'manager', 'approve_ap_payment');
const apWriters = requireRole('admin', 'manager');
const apApprovers = requireRole('approve_ap_payment', 'admin');

const idParamsSchema = z.object({ id: z.string().trim().min(1) });
const agingQuerySchema = z.object({
  asOfDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
const cashRequirementsQuerySchema = z.object({
  horizonDays: z.coerce.number().int().min(0).max(365).optional(),
  asOfDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
const journalQuerySchema = z.object({
  from: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
const paymentBatchItemSchema = z.object({
  vendor_bill_id: z.string().trim().min(1),
  amount: z.coerce.number().positive(),
});
const paymentBatchSchema = z.object({
  payment_date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  payment_method: z.enum(['check', 'ach', 'wire', 'card', 'cash', 'other']).optional(),
  bank_account_id: z.string().trim().min(1).optional().nullable(),
  items: z.array(paymentBatchItemSchema).min(1),
});
const bankAccountSchema = z.object({
  account_name: z.string().trim().min(1).max(160),
  account_type: z.enum(['checking', 'savings', 'credit', 'cash', 'other']).optional(),
  institution_name: z.string().trim().max(160).optional().nullable(),
  last_four: z.string().trim().max(8).optional().nullable(),
  routing_last_four: z.string().trim().max(8).optional().nullable(),
  opening_balance: z.coerce.number().optional(),
  current_balance: z.coerce.number().optional(),
  status: z.enum(['active', 'inactive']).optional(),
});
const reconciliationItemSchema = z.object({
  id: z.string().trim().min(1).optional(),
  ap_ledger_entry_id: z.string().trim().min(1).optional().nullable(),
  external_reference: z.string().trim().max(160).optional().nullable(),
  description: z.string().trim().max(500).optional().nullable(),
  amount: z.coerce.number(),
  cleared: z.boolean().optional(),
});
const reconciliationSchema = z.object({
  bank_account_id: z.string().trim().min(1),
  statement_start_date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  statement_end_date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  statement_balance: z.coerce.number(),
  items: z.array(reconciliationItemSchema).optional().default([]),
});
const reconciliationItemsSchema = z.object({
  items: z.array(reconciliationItemSchema).min(1),
});

function scopeCompanyId(context = {}) {
  return context.activeCompanyId || context.companyId || null;
}

async function loadScoped(table, id, context, notFoundMessage) {
  const { data, error } = await scopeQueryByContext(
    supabase.from(table).select('*'),
    context,
    { includeLocation: true }
  ).eq('id', id).single();
  if (error) throw error;
  if (!data) {
    const err = new Error(notFoundMessage || `${table} not found`);
    err.status = 404;
    throw err;
  }
  if (!rowMatchesContext(data, context)) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }
  return data;
}

function sendError(res, error, fallback) {
  res.status(error.status || 500).json({ error: error.message || fallback });
}

router.get('/aging', authenticateToken, apReaders, validateQuery(agingQuerySchema), async (req, res) => {
  try {
    const rows = await apLedger.getAPAging(scopeCompanyId(req.context), req.validated.query.asOfDate, {
      db: supabase,
      context: req.context,
    });
    res.json({ as_of_date: req.validated.query.asOfDate || new Date().toISOString().slice(0, 10), rows });
  } catch (error) {
    sendError(res, error, 'Failed to load AP aging');
  }
});

router.get('/cash-requirements', authenticateToken, apReaders, validateQuery(cashRequirementsQuerySchema), async (req, res) => {
  try {
    const result = await apLedger.getCashRequirements(scopeCompanyId(req.context), req.validated.query.horizonDays || 30, {
      db: supabase,
      context: req.context,
      asOfDate: req.validated.query.asOfDate,
    });
    const snapshot = await insertRecordWithOptionalScope(supabase, 'cash_requirements_snapshots', {
      as_of_date: result.as_of_date,
      horizon_days: result.horizon_days,
      total_due: result.total_due,
      snapshot: result,
      created_by: req.user?.id || null,
    }, req.context);
    res.json({ ...result, snapshot_id: snapshot.data?.id || null });
  } catch (error) {
    sendError(res, error, 'Failed to load cash requirements');
  }
});

router.post('/payment-batches', authenticateToken, apWriters, validateBody(paymentBatchSchema), async (req, res) => {
  try {
    const body = req.validated.body;
    const bills = [];
    for (const item of body.items) {
      bills.push(await loadScoped('vendor_bills', item.vendor_bill_id, req.context, 'Vendor bill not found'));
    }
    const totalAmount = body.items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const batchResult = await insertRecordWithOptionalScope(supabase, 'ap_payment_batches', {
      payment_date: body.payment_date || new Date().toISOString().slice(0, 10),
      payment_method: body.payment_method || 'check',
      bank_account_id: body.bank_account_id || null,
      status: 'draft',
      total_amount: Number(totalAmount.toFixed(2)),
      created_by: req.user?.id || null,
    }, req.context);
    if (batchResult.error) throw batchResult.error;

    const scopedItems = body.items.map((item, index) => buildScopeFields(req.context, {
      ap_payment_batch_id: batchResult.data.id,
      vendor_bill_id: item.vendor_bill_id,
      vendor_id: bills[index]?.vendor_id || null,
      amount: Number(item.amount),
      status: 'pending',
    }));
    const { data: items, error: itemError } = await supabase.from('ap_payment_batch_items').insert(scopedItems).select();
    if (itemError) throw itemError;
    res.status(201).json({ ...batchResult.data, items: filterRowsByContext(items || [], req.context) });
  } catch (error) {
    sendError(res, error, 'Failed to create AP payment batch');
  }
});

router.patch('/payment-batches/:id/approve', authenticateToken, apApprovers, validateParams(idParamsSchema), async (req, res) => {
  try {
    await loadScoped('ap_payment_batches', req.validated.params.id, req.context, 'AP payment batch not found');
    const approvedAt = new Date().toISOString();
    const { data, error } = await scopeQueryByContext(
      supabase.from('ap_payment_batches').update({
        status: 'approved',
        approved_by: req.user?.id || null,
        approved_at: approvedAt,
        updated_at: approvedAt,
      }),
      req.context,
      { includeLocation: true }
    ).eq('id', req.validated.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (error) {
    sendError(res, error, 'Failed to approve AP payment batch');
  }
});

router.post('/payment-batches/:id/pay', authenticateToken, apWriters, validateParams(idParamsSchema), async (req, res) => {
  try {
    const result = await apLedger.processPaymentBatch(req.validated.params.id, {
      db: supabase,
      context: req.context,
      paidBy: req.user?.id || null,
    });
    res.json(result);
  } catch (error) {
    sendError(res, error, 'Failed to pay AP payment batch');
  }
});

router.get('/journal', authenticateToken, apReaders, validateQuery(journalQuerySchema), async (req, res) => {
  try {
    let query = scopeQueryByContext(
      supabase.from('ap_ledger_entries').select('*'),
      req.context,
      { includeLocation: true }
    ).order('entry_date', { ascending: false }).limit(500);
    if (req.validated.query.from) query = query.gte('entry_date', req.validated.query.from);
    if (req.validated.query.to) query = query.lte('entry_date', req.validated.query.to);
    const { data, error } = await query;
    if (error) throw error;
    res.json({ entries: filterRowsByContext(data || [], req.context) });
  } catch (error) {
    sendError(res, error, 'Failed to load AP journal');
  }
});

router.get('/bank-accounts', authenticateToken, apReaders, async (req, res) => {
  try {
    const { data, error } = await scopeQueryByContext(
      supabase.from('bank_accounts').select('*'),
      req.context,
      { includeLocation: true }
    ).order('account_name', { ascending: true });
    if (error) throw error;
    res.json(filterRowsByContext(data || [], req.context));
  } catch (error) {
    sendError(res, error, 'Failed to load bank accounts');
  }
});

router.post('/bank-accounts', authenticateToken, apWriters, validateBody(bankAccountSchema), async (req, res) => {
  try {
    const result = await insertRecordWithOptionalScope(supabase, 'bank_accounts', {
      account_name: req.validated.body.account_name,
      account_type: req.validated.body.account_type || 'checking',
      institution_name: req.validated.body.institution_name || null,
      last_four: req.validated.body.last_four || null,
      routing_last_four: req.validated.body.routing_last_four || null,
      opening_balance: req.validated.body.opening_balance || 0,
      current_balance: req.validated.body.current_balance || req.validated.body.opening_balance || 0,
      status: req.validated.body.status || 'active',
    }, req.context);
    if (result.error) throw result.error;
    res.status(201).json(result.data);
  } catch (error) {
    sendError(res, error, 'Failed to create bank account');
  }
});

router.patch('/bank-accounts/:id', authenticateToken, apWriters, validateParams(idParamsSchema), validateBody(bankAccountSchema.partial()), async (req, res) => {
  try {
    await loadScoped('bank_accounts', req.validated.params.id, req.context, 'Bank account not found');
    const fields = { ...req.validated.body, updated_at: new Date().toISOString() };
    const { data, error } = await scopeQueryByContext(
      supabase.from('bank_accounts').update(fields),
      req.context,
      { includeLocation: true }
    ).eq('id', req.validated.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (error) {
    sendError(res, error, 'Failed to update bank account');
  }
});

router.delete('/bank-accounts/:id', authenticateToken, apWriters, validateParams(idParamsSchema), async (req, res) => {
  try {
    await loadScoped('bank_accounts', req.validated.params.id, req.context, 'Bank account not found');
    const { data, error } = await scopeQueryByContext(
      supabase.from('bank_accounts').update({ status: 'inactive', updated_at: new Date().toISOString() }),
      req.context,
      { includeLocation: true }
    ).eq('id', req.validated.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (error) {
    sendError(res, error, 'Failed to archive bank account');
  }
});

async function insertReconciliationItems(session, items, context) {
  if (!items.length) return [];
  const records = items.map((item) => buildScopeFields(context, {
    bank_reconciliation_session_id: session.id,
    ap_ledger_entry_id: item.ap_ledger_entry_id || null,
    external_reference: item.external_reference || null,
    description: item.description || null,
    amount: item.amount,
    cleared: item.cleared === true,
    cleared_at: item.cleared === true ? new Date().toISOString() : null,
  }));
  const { data, error } = await supabase.from('bank_reconciliation_items').insert(records).select();
  if (error) throw error;
  return filterRowsByContext(data || [], context);
}

router.post('/bank-reconciliation', authenticateToken, apWriters, validateBody(reconciliationSchema), async (req, res) => {
  try {
    await loadScoped('bank_accounts', req.validated.body.bank_account_id, req.context, 'Bank account not found');
    const result = await insertRecordWithOptionalScope(supabase, 'bank_reconciliation_sessions', {
      bank_account_id: req.validated.body.bank_account_id,
      statement_start_date: req.validated.body.statement_start_date || null,
      statement_end_date: req.validated.body.statement_end_date,
      statement_balance: req.validated.body.statement_balance,
      status: 'open',
      created_by: req.user?.id || null,
    }, req.context);
    if (result.error) throw result.error;
    const items = await insertReconciliationItems(result.data, req.validated.body.items || [], req.context);
    res.status(201).json({ ...result.data, items });
  } catch (error) {
    sendError(res, error, 'Failed to create bank reconciliation');
  }
});

router.patch('/bank-reconciliation/:id/items', authenticateToken, apWriters, validateParams(idParamsSchema), validateBody(reconciliationItemsSchema), async (req, res) => {
  try {
    const session = await loadScoped('bank_reconciliation_sessions', req.validated.params.id, req.context, 'Bank reconciliation not found');
    if (String(session.status || '').toLowerCase() === 'completed') {
      return res.status(400).json({ error: 'Completed bank reconciliations cannot be edited' });
    }

    const inserted = [];
    for (const item of req.validated.body.items) {
      if (item.id) {
        const update = {
          ap_ledger_entry_id: item.ap_ledger_entry_id || null,
          external_reference: item.external_reference || null,
          description: item.description || null,
          amount: item.amount,
          cleared: item.cleared === true,
          cleared_at: item.cleared === true ? new Date().toISOString() : null,
        };
        const { data, error } = await scopeQueryByContext(
          supabase.from('bank_reconciliation_items').update(update),
          req.context,
          { includeLocation: true }
        ).eq('id', item.id).eq('bank_reconciliation_session_id', session.id).select().single();
        if (error) throw error;
        inserted.push(data);
      } else {
        inserted.push(...await insertReconciliationItems(session, [item], req.context));
      }
    }
    res.json({ items: filterRowsByContext(inserted, req.context) });
  } catch (error) {
    sendError(res, error, 'Failed to update bank reconciliation items');
  }
});

router.post('/bank-reconciliation/:id/complete', authenticateToken, apWriters, validateParams(idParamsSchema), async (req, res) => {
  try {
    const session = await loadScoped('bank_reconciliation_sessions', req.validated.params.id, req.context, 'Bank reconciliation not found');
    if (String(session.status || '').toLowerCase() === 'completed') return res.json({ ...session, idempotent: true });
    const completedAt = new Date().toISOString();
    const { data, error } = await scopeQueryByContext(
      supabase.from('bank_reconciliation_sessions').update({
        status: 'completed',
        completed_by: req.user?.id || null,
        completed_at: completedAt,
        updated_at: completedAt,
      }),
      req.context,
      { includeLocation: true }
    ).eq('id', session.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (error) {
    sendError(res, error, 'Failed to complete bank reconciliation');
  }
});

module.exports = router;
