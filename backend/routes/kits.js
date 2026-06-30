'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { z } = require('zod');
const { supabase } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { validateBody } = require('../lib/zod-validate');
const {
  buildScopeFields,
  filterRowsByContext,
  insertRecordWithOptionalScope,
  rowMatchesContext,
  scopeQueryByContext,
} = require('../services/operating-context');
const { applyInventoryLedgerEntry } = require('../services/inventory-ledger');

const router = express.Router();
const kitRoles = requireRole('admin', 'manager');

const recipeItemSchema = z.object({
  input_product_id: z.string().trim().min(1),
  input_lot_id: z.string().trim().min(1).nullable().optional(),
  input_qty: z.coerce.number().finite().positive(),
  input_uom: z.string().trim().min(1),
});

const createRecipeSchema = z.object({
  name: z.string().trim().min(1),
  output_product_id: z.string().trim().min(1),
  output_qty: z.coerce.number().finite().positive(),
  output_uom: z.string().trim().min(1),
  is_active: z.boolean().optional().default(true),
  items: z.array(recipeItemSchema).min(1),
}).passthrough();

const processKitSchema = z.object({
  kit_recipe_id: z.string().trim().min(1),
  quantity_produced: z.coerce.number().finite().positive(),
  simulate_failure_after_debits: z.boolean().optional().default(false),
}).passthrough();

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function roundQty(value) {
  return Number(toNumber(value, 0).toFixed(4));
}

function activeCompany(context) {
  return context?.activeCompanyId || context?.companyId || null;
}

function activeLocation(context) {
  return context?.activeLocationId || context?.locationId || null;
}

async function loadProduct(productId, context) {
  const { data, error } = await scopeQueryByContext(
    supabase.from('products').select('*'),
    context,
  )
    .eq('id', productId)
    .single();
  if (error || !data || !rowMatchesContext(data, context)) return null;
  return data;
}

async function loadConversion(productId, fromUom, toUom, context) {
  const from = String(fromUom || '').trim();
  const to = String(toUom || '').trim();
  if (!from || !to) return null;
  if (from.toLowerCase() === to.toLowerCase()) return { factor: 1 };
  const { data, error } = await scopeQueryByContext(
    supabase.from('inventory_uom_conversions').select('*'),
    context,
  )
    .eq('product_id', productId)
    .eq('from_uom', from)
    .eq('to_uom', to)
    .limit(1);
  if (error) throw error;
  return filterRowsByContext(data || [], context)[0] || null;
}

async function loadRecipeWithItems(recipeId, context) {
  const { data: recipe, error } = await scopeQueryByContext(
    supabase.from('kit_recipes').select('*'),
    context,
  )
    .eq('id', recipeId)
    .single();
  if (error || !recipe || !rowMatchesContext(recipe, context)) return null;

  const { data: items, error: itemError } = await scopeQueryByContext(
    supabase.from('kit_recipe_items').select('*'),
    context,
  )
    .eq('kit_recipe_id', recipe.id);
  if (itemError) throw itemError;
  return { ...recipe, items: filterRowsByContext(items || [], context) };
}

async function insertRun({ recipeId, quantityProduced, status, ledgerGroupId, userId, context }) {
  const result = await insertRecordWithOptionalScope(supabase, 'kit_processing_runs', {
    kit_recipe_id: recipeId,
    run_date: new Date().toISOString().slice(0, 10),
    quantity_produced: roundQty(quantityProduced),
    status,
    ledger_group_id: ledgerGroupId,
    created_by: userId || null,
    created_at: new Date().toISOString(),
  }, context);
  if (result.error) throw result.error;
  return result.data;
}

async function restoreLot(lotBefore, context) {
  if (!lotBefore?.id) return;
  await scopeQueryByContext(
    supabase.from('inventory_lots').update({
      qty_on_hand: lotBefore.qty_on_hand,
      status: lotBefore.status,
    }),
    context,
  )
    .eq('id', lotBefore.id);
}

async function processKitRun({ recipeId, quantityProduced, user, context, simulateFailureAfterDebits = false }) {
  const recipe = await loadRecipeWithItems(recipeId, context);
  if (!recipe) {
    const error = new Error('Kit recipe not found');
    error.status = 404;
    throw error;
  }
  if (recipe.is_active === false) {
    const error = new Error('Kit recipe is inactive');
    error.status = 400;
    throw error;
  }

  const outputProduct = await loadProduct(recipe.output_product_id, context);
  if (!outputProduct) {
    const error = new Error('Output product not found');
    error.status = 400;
    throw error;
  }

  const productIds = [...new Set(recipe.items.map((item) => item.input_product_id))];
  const { data: inputProducts, error: productError } = await scopeQueryByContext(
    supabase.from('products').select('*'),
    context,
  )
    .in('id', productIds);
  if (productError) throw productError;
  const productsById = new Map(filterRowsByContext(inputProducts || [], context).map((product) => [String(product.id), product]));

  const lotIds = recipe.items.map((item) => item.input_lot_id).filter(Boolean);
  let lotsById = new Map();
  if (lotIds.length) {
    const { data: lots, error: lotError } = await scopeQueryByContext(
      supabase.from('inventory_lots').select('*'),
      context,
    )
      .in('id', lotIds);
    if (lotError) throw lotError;
    lotsById = new Map(filterRowsByContext(lots || [], context).map((lot) => [String(lot.id), lot]));
  }

  const requiredInputs = [];
  for (const item of recipe.items) {
    const product = productsById.get(String(item.input_product_id));
    if (!product) {
      const error = new Error('Input product not found');
      error.status = 400;
      throw error;
    }
    const conversion = await loadConversion(product.id, item.input_uom, product.unit || product.default_unit || item.input_uom, context);
    if (!conversion) {
      const error = new Error(`Missing UOM conversion for ${product.item_number || product.id}`);
      error.status = 400;
      throw error;
    }
    const requiredQty = roundQty(toNumber(item.input_qty) * toNumber(quantityProduced) * toNumber(conversion.factor, 1));
    const lot = item.input_lot_id ? lotsById.get(String(item.input_lot_id)) : null;
    const available = lot ? toNumber(lot.qty_on_hand) : toNumber(product.on_hand_qty ?? product.on_hand_quantity);
    if (requiredQty > available) {
      const error = new Error(`Insufficient stock for ${product.item_number || product.name}`);
      error.status = 422;
      error.code = 'KIT_INSUFFICIENT_STOCK';
      throw error;
    }
    requiredInputs.push({ item, product, lot, requiredQty, conversion });
  }

  const ledgerGroupId = crypto.randomUUID();
  const appliedInputs = [];
  try {
    for (const input of requiredInputs) {
      if (input.lot) {
        const nextQty = roundQty(toNumber(input.lot.qty_on_hand) - input.requiredQty);
        const nextStatus = nextQty <= 0 ? 'depleted' : input.lot.status || 'active';
        const { error: lotUpdateError } = await scopeQueryByContext(
          supabase.from('inventory_lots').update({ qty_on_hand: nextQty, status: nextStatus }),
          context,
        )
          .eq('id', input.lot.id);
        if (lotUpdateError) throw lotUpdateError;
      }

      const ledger = await applyInventoryLedgerEntry({
        itemNumber: input.product.item_number,
        deltaQty: -input.requiredQty,
        changeType: 'kit_input',
        notes: `Kit ${recipe.name}`,
        createdBy: user.name || user.email,
        lotId: input.lot?.id || null,
        uom: input.item.input_uom,
        conversion_factor: input.conversion.factor,
        ledger_ref: ledgerGroupId,
        context,
      });
      appliedInputs.push({ ...input, ledger });
    }

    if (simulateFailureAfterDebits && process.env.NODE_ENV !== 'production') {
      throw new Error('Simulated kit output failure');
    }

    const outputQty = roundQty(toNumber(recipe.output_qty) * toNumber(quantityProduced));
    const outputLedger = await applyInventoryLedgerEntry({
      itemNumber: outputProduct.item_number,
      deltaQty: outputQty,
      changeType: 'kit_output',
      notes: `Kit ${recipe.name}`,
      createdBy: user.name || user.email,
      uom: recipe.output_uom,
      conversion_factor: 1,
      ledger_ref: ledgerGroupId,
      preventNegative: false,
      context,
    });

    const run = await insertRun({
      recipeId: recipe.id,
      quantityProduced,
      status: 'completed',
      ledgerGroupId,
      userId: user.id,
      context,
    });
    return { run, ledger_group_id: ledgerGroupId, input_ledgers: appliedInputs.map((entry) => entry.ledger), output_ledger: outputLedger };
  } catch (error) {
    for (const input of appliedInputs.reverse()) {
      try {
        if (input.lot) await restoreLot(input.lot, context);
        await applyInventoryLedgerEntry({
          itemNumber: input.product.item_number,
          deltaQty: input.requiredQty,
          changeType: 'kit_compensation',
          notes: `Compensating kit ${recipe.name} · ${ledgerGroupId}`,
          createdBy: 'system',
          lotId: input.lot?.id || null,
          uom: input.item.input_uom,
          conversion_factor: input.conversion.factor,
          ledger_ref: ledgerGroupId,
          preventNegative: false,
          context,
        });
      } catch (compensationError) {
        console.error('[kits] compensation failed:', compensationError.message);
      }
    }
    try {
      await insertRun({
        recipeId: recipe.id,
        quantityProduced,
        status: 'failed',
        ledgerGroupId,
        userId: user.id,
        context,
      });
    } catch (runError) {
      console.error('[kits] failed-run insert failed:', runError.message);
    }
    error.ledger_group_id = ledgerGroupId;
    throw error;
  }
}

router.get('/recipes', authenticateToken, kitRoles, async (req, res) => {
  try {
    const { data, error } = await scopeQueryByContext(
      supabase.from('kit_recipes').select('*'),
      req.context,
    )
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(filterRowsByContext(data || [], req.context));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/recipes', authenticateToken, kitRoles, validateBody(createRecipeSchema), async (req, res) => {
  try {
    const body = req.validated.body;
    const outputProduct = await loadProduct(body.output_product_id, req.context);
    if (!outputProduct) return res.status(400).json({ error: 'Output product not found' });

    for (const item of body.items) {
      const product = await loadProduct(item.input_product_id, req.context);
      if (!product) return res.status(400).json({ error: 'Input product not found' });
      const conversion = await loadConversion(product.id, item.input_uom, product.unit || product.default_unit || item.input_uom, req.context);
      if (!conversion) return res.status(400).json({ error: `Missing UOM conversion for ${product.item_number || product.id}` });
    }

    const recipeResult = await insertRecordWithOptionalScope(supabase, 'kit_recipes', {
      name: body.name,
      output_product_id: body.output_product_id,
      output_qty: roundQty(body.output_qty),
      output_uom: body.output_uom,
      is_active: body.is_active,
    }, req.context);
    if (recipeResult.error) return res.status(500).json({ error: recipeResult.error.message });

    const itemRows = body.items.map((item) => ({
      kit_recipe_id: recipeResult.data.id,
      input_product_id: item.input_product_id,
      input_lot_id: item.input_lot_id || null,
      input_qty: roundQty(item.input_qty),
      input_uom: item.input_uom,
      ...buildScopeFields(req.context),
    }));
    const { data: items, error: itemError } = await supabase.from('kit_recipe_items').insert(itemRows).select();
    if (itemError) return res.status(500).json({ error: itemError.message });
    res.status(201).json({ ...recipeResult.data, items: items || itemRows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/process', authenticateToken, kitRoles, validateBody(processKitSchema), async (req, res) => {
  try {
    const result = await processKitRun({
      recipeId: req.validated.body.kit_recipe_id,
      quantityProduced: req.validated.body.quantity_produced,
      user: req.user,
      context: req.context,
      simulateFailureAfterDebits: req.validated.body.simulate_failure_after_debits,
    });
    res.status(201).json(result);
  } catch (error) {
    const status = Number(error.status) || 500;
    res.status(status).json({
      error: error.message,
      code: error.code,
      ledger_group_id: error.ledger_group_id,
    });
  }
});

router.get('/runs', authenticateToken, kitRoles, async (req, res) => {
  try {
    const { data, error } = await scopeQueryByContext(
      supabase.from('kit_processing_runs').select('*'),
      req.context,
    )
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(filterRowsByContext(data || [], req.context));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router._private = {
  activeCompany,
  activeLocation,
  processKitRun,
};

module.exports = router;
