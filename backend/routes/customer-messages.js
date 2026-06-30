'use strict';

const express = require('express');
const { z } = require('zod');
const { supabase } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { validateBody, validateParams, validateQuery } = require('../lib/zod-validate');
const {
  filterRowsByContext,
  insertRecordWithOptionalScope,
  scopeQueryByContext,
} = require('../services/operating-context');

const router = express.Router();
const messageReaders = requireRole('admin', 'manager', 'rep');
const messageManagers = requireRole('admin', 'manager');
const MESSAGE_TYPES = ['order_entry', 'delivery', 'invoice'];
const INSTRUCTION_TYPES = ['cutting', 'packaging', 'warehouse', 'general'];

const idParamsSchema = z.object({
  id: z.string().trim().min(1, 'id is required'),
});

const activeMessageQuerySchema = z.object({
  customerId: z.string().trim().min(1, 'customerId is required'),
  type: z.enum(MESSAGE_TYPES).optional().default('order_entry'),
});

const messageBodySchema = z.object({
  customer_id: z.string().trim().min(1, 'customer_id is required'),
  message: z.string().trim().min(1, 'message is required').max(2000),
  message_type: z.enum(MESSAGE_TYPES),
  start_date: z.string().trim().min(1).optional().nullable(),
  end_date: z.string().trim().min(1).optional().nullable(),
});

const messagePatchSchema = messageBodySchema.partial().refine((body) => Object.keys(body).length > 0, {
  message: 'At least one message field is required',
});

const instructionQuerySchema = z.object({
  customerId: z.string().trim().min(1, 'customerId is required'),
  productId: z.string().trim().optional(),
});

const instructionBodySchema = z.object({
  customer_id: z.string().trim().min(1, 'customer_id is required'),
  product_id: z.string().trim().min(1, 'product_id is required'),
  instruction: z.string().trim().min(1, 'instruction is required').max(2000),
  instruction_type: z.enum(INSTRUCTION_TYPES),
});

const instructionPatchSchema = instructionBodySchema.partial().refine((body) => Object.keys(body).length > 0, {
  message: 'At least one instruction field is required',
});

function scopedRows(rows, context) {
  return filterRowsByContext(rows || [], context);
}

function activeOnDate(row, onDate = new Date().toISOString().slice(0, 10)) {
  const date = String(onDate).slice(0, 10);
  const start = row?.start_date ? String(row.start_date).slice(0, 10) : null;
  const end = row?.end_date ? String(row.end_date).slice(0, 10) : null;
  if (start && start > date) return false;
  if (end && end < date) return false;
  return true;
}

async function loadActiveMessages(customerId, type, context, onDate) {
  const { data, error } = await scopeQueryByContext(
    supabase.from('customer_hot_messages').select('*'),
    context,
  )
    .eq('customer_id', customerId)
    .eq('message_type', type);
  if (error) throw error;
  return scopedRows(data, context)
    .filter((row) => activeOnDate(row, onDate))
    .sort((a, b) => String(a.start_date || '').localeCompare(String(b.start_date || '')) || String(a.id || '').localeCompare(String(b.id || '')));
}

async function loadInstructions(customerId, productId, context) {
  let query = scopeQueryByContext(
    supabase.from('customer_item_instructions').select('*'),
    context,
  ).eq('customer_id', customerId);
  if (productId) query = query.eq('product_id', productId);
  const { data, error } = await query.order('instruction_type', { ascending: true });
  if (error) throw error;
  return scopedRows(data, context);
}

router.get('/', authenticateToken, messageReaders, validateQuery(activeMessageQuerySchema), async (req, res) => {
  try {
    const messages = await loadActiveMessages(req.validated.query.customerId, req.validated.query.type, req.context);
    res.json({ messages });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to load customer messages' });
  }
});

router.post('/', authenticateToken, messageManagers, validateBody(messageBodySchema), async (req, res) => {
  try {
    const result = await insertRecordWithOptionalScope(supabase, 'customer_hot_messages', {
      customer_id: req.validated.body.customer_id,
      message: req.validated.body.message,
      message_type: req.validated.body.message_type,
      start_date: req.validated.body.start_date || null,
      end_date: req.validated.body.end_date || null,
    }, req.context);
    if (result.error) throw result.error;
    res.status(201).json({ message: result.data });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to create customer message' });
  }
});

router.patch('/:id', authenticateToken, messageManagers, validateParams(idParamsSchema), validateBody(messagePatchSchema), async (req, res) => {
  try {
    const { data, error } = await scopeQueryByContext(
      supabase.from('customer_hot_messages').update(req.validated.body),
      req.context,
    )
      .eq('id', req.validated.params.id)
      .select()
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Customer message not found' });
    res.json({ message: data });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to update customer message' });
  }
});

router.delete('/:id', authenticateToken, messageManagers, validateParams(idParamsSchema), async (req, res) => {
  try {
    const { error } = await scopeQueryByContext(
      supabase.from('customer_hot_messages').delete(),
      req.context,
    ).eq('id', req.validated.params.id);
    if (error) throw error;
    res.json({ deleted: true, id: req.validated.params.id });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to delete customer message' });
  }
});

router.get('/instructions', authenticateToken, messageReaders, validateQuery(instructionQuerySchema), async (req, res) => {
  try {
    const instructions = await loadInstructions(req.validated.query.customerId, req.validated.query.productId, req.context);
    res.json({ instructions });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to load customer item instructions' });
  }
});

router.post('/instructions', authenticateToken, messageManagers, validateBody(instructionBodySchema), async (req, res) => {
  try {
    const result = await insertRecordWithOptionalScope(supabase, 'customer_item_instructions', req.validated.body, req.context);
    if (result.error) throw result.error;
    res.status(201).json({ instruction: result.data });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to create customer item instruction' });
  }
});

router.patch('/instructions/:id', authenticateToken, messageManagers, validateParams(idParamsSchema), validateBody(instructionPatchSchema), async (req, res) => {
  try {
    const { data, error } = await scopeQueryByContext(
      supabase.from('customer_item_instructions').update(req.validated.body),
      req.context,
    )
      .eq('id', req.validated.params.id)
      .select()
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Customer item instruction not found' });
    res.json({ instruction: data });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to update customer item instruction' });
  }
});

router.delete('/instructions/:id', authenticateToken, messageManagers, validateParams(idParamsSchema), async (req, res) => {
  try {
    const { error } = await scopeQueryByContext(
      supabase.from('customer_item_instructions').delete(),
      req.context,
    ).eq('id', req.validated.params.id);
    if (error) throw error;
    res.json({ deleted: true, id: req.validated.params.id });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to delete customer item instruction' });
  }
});

module.exports = router;
module.exports.loadActiveMessages = loadActiveMessages;
module.exports.loadInstructions = loadInstructions;
