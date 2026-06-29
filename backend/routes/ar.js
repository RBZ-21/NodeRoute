'use strict';

const express = require('express');
const { z } = require('zod');
const { supabase } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { validateBody, validateParams, validateQuery } = require('../lib/zod-validate');
const arLedger = require('../services/ar-ledger');
const financeCharges = require('../services/finance-charges');
const {
  filterRowsByContext,
  insertRecordWithOptionalScope,
  scopeQueryByContext,
} = require('../services/operating-context');

const router = express.Router();
const arReaders = requireRole('admin', 'manager', 'rep');
const arWriters = requireRole('admin', 'manager');

const customerParamsSchema = z.object({
  customerId: z.string().trim().min(1),
});

const idParamsSchema = z.object({
  id: z.string().trim().min(1),
});

const agingQuerySchema = z.object({
  asOfDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const journalQuerySchema = z.object({
  from: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const receiptApplicationSchema = z.object({
  invoice_id: z.string().trim().min(1),
  applied_amount: z.coerce.number().positive(),
});

const cashReceiptSchema = z.object({
  customer_id: z.string().trim().min(1),
  receipt_date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  total_amount: z.coerce.number().nonnegative(),
  payment_method: z.enum(['cash', 'check', 'card', 'credit_memo', 'unapplied']),
  check_number: z.string().trim().max(80).optional().nullable(),
  stripe_payment_intent_id: z.string().trim().max(255).optional().nullable(),
  idempotency_key: z.string().trim().max(255).optional().nullable(),
  applications: z.array(receiptApplicationSchema).default([]),
});

const financeChargeSchema = z.object({
  runDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  run_date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).optional().default({});

function arStripeCardPaymentsEnabled() {
  return ['AR_STRIPE_CARD_PAYMENTS_ENABLED', 'NODEROUTE_AR_CARD_PAYMENTS_ENABLED', 'CUSTOMER_AR_CARD_PAYMENTS_ENABLED']
    .some((key) => String(process.env[key] || '').toLowerCase() === 'true');
}

function scopeCompanyId(context = {}) {
  return context.activeCompanyId || context.companyId || null;
}

async function findExistingReceipt(body, context) {
  if (!body.idempotency_key && !body.stripe_payment_intent_id) return null;
  let query = scopeQueryByContext(supabase.from('cash_receipts').select('*'), context, { includeLocation: true })
    .eq('customer_id', body.customer_id);
  if (body.idempotency_key) query = query.eq('idempotency_key', body.idempotency_key);
  else query = query.eq('stripe_payment_intent_id', body.stripe_payment_intent_id);
  const { data, error } = await query.limit(1);
  if (error) throw error;
  return Array.isArray(data) && data.length ? data[0] : null;
}

async function receiptWithApplications(receiptId, context) {
  const { data: receipt, error } = await scopeQueryByContext(
    supabase.from('cash_receipts').select('*'),
    context,
    { includeLocation: true }
  )
    .eq('id', receiptId)
    .single();
  if (error) throw error;
  if (!receipt) return null;

  const { data: applications, error: appError } = await scopeQueryByContext(
    supabase.from('cash_receipt_applications').select('*'),
    context,
    { includeLocation: true }
  )
    .eq('cash_receipt_id', receiptId)
    .order('applied_at', { ascending: true });
  if (appError) throw appError;
  return { ...receipt, applications: filterRowsByContext(applications || [], context) };
}

router.get('/account-inquiry/:customerId', authenticateToken, arReaders, validateParams(customerParamsSchema), async (req, res) => {
  try {
    const inquiry = await arLedger.getAccountInquiry(req.validated.params.customerId, scopeCompanyId(req.context), {
      db: supabase,
      context: req.context,
      asOfDate: req.query.asOfDate,
    });
    res.json(inquiry);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to load account inquiry' });
  }
});

router.post('/cash-receipts', authenticateToken, arWriters, validateBody(cashReceiptSchema), async (req, res) => {
  try {
    const body = req.validated.body;
    if (body.payment_method === 'card' && body.stripe_payment_intent_id && !arStripeCardPaymentsEnabled()) {
      return res.status(400).json({
        error: 'NodeRoute AR card processing is disabled for this deployment',
        code: 'AR_CARD_PROCESSING_DISABLED',
      });
    }

    let receipt = await findExistingReceipt(body, req.context);
    if (!receipt) {
      const result = await insertRecordWithOptionalScope(supabase, 'cash_receipts', {
        customer_id: body.customer_id,
        receipt_date: body.receipt_date || new Date().toISOString().slice(0, 10),
        total_amount: body.total_amount,
        unapplied_amount: body.total_amount,
        payment_method: body.payment_method,
        check_number: body.check_number || null,
        stripe_payment_intent_id: body.stripe_payment_intent_id || null,
        idempotency_key: body.idempotency_key || null,
        status: 'new',
        created_by: req.user?.id || null,
      }, req.context);
      if (result.error) throw result.error;
      receipt = result.data;
    }

    const applied = await arLedger.applyReceipt(receipt.id, body.applications, {
      db: supabase,
      context: req.context,
    });
    res.status(receipt.idempotent ? 200 : 201).json(applied);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to create cash receipt' });
  }
});

router.get('/cash-receipts/:id', authenticateToken, arReaders, validateParams(idParamsSchema), async (req, res) => {
  try {
    const receipt = await receiptWithApplications(req.validated.params.id, req.context);
    if (!receipt) return res.status(404).json({ error: 'Cash receipt not found' });
    res.json(receipt);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to load cash receipt' });
  }
});

router.get('/aging-report', authenticateToken, arReaders, validateQuery(agingQuerySchema), async (req, res) => {
  try {
    const rows = await arLedger.getAgingReport(scopeCompanyId(req.context), req.validated.query.asOfDate, {
      db: supabase,
      context: req.context,
    });
    res.json({ as_of_date: req.validated.query.asOfDate || new Date().toISOString().slice(0, 10), rows });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to load aging report' });
  }
});

router.get('/cash-receipts-journal', authenticateToken, arReaders, validateQuery(journalQuerySchema), async (req, res) => {
  try {
    let query = scopeQueryByContext(
      supabase.from('cash_receipts').select('*'),
      req.context,
      { includeLocation: true }
    ).order('receipt_date', { ascending: false });
    if (req.validated.query.from) query = query.gte('receipt_date', req.validated.query.from);
    if (req.validated.query.to) query = query.lte('receipt_date', req.validated.query.to);
    const { data, error } = await query.limit(500);
    if (error) throw error;
    res.json({ receipts: filterRowsByContext(data || [], req.context) });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to load cash receipts journal' });
  }
});

router.post('/finance-charges/preview', authenticateToken, arWriters, validateBody(financeChargeSchema), async (req, res) => {
  try {
    const runDate = req.validated.body.runDate || req.validated.body.run_date || new Date().toISOString().slice(0, 10);
    const result = await financeCharges.calculateFinanceCharges(scopeCompanyId(req.context), runDate, 'preview', {
      db: supabase,
      context: req.context,
      createdBy: req.user?.id || null,
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to preview finance charges' });
  }
});

router.post('/finance-charges/commit', authenticateToken, arWriters, validateBody(financeChargeSchema), async (req, res) => {
  try {
    const runDate = req.validated.body.runDate || req.validated.body.run_date || new Date().toISOString().slice(0, 10);
    const result = await financeCharges.calculateFinanceCharges(scopeCompanyId(req.context), runDate, 'commit', {
      db: supabase,
      context: req.context,
      createdBy: req.user?.id || null,
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to commit finance charges' });
  }
});

module.exports = router;
module.exports.arStripeCardPaymentsEnabled = arStripeCardPaymentsEnabled;
