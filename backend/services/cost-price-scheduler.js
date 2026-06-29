'use strict';

const { supabase } = require('./supabase');
const logger = require('./logger');

const JOB_NAME = 'cost-price-updates';
const DEFAULT_CRON = process.env.COST_PRICE_UPDATE_CRON || '*/15 * * * *';
const DEFAULT_TZ = 'America/New_York';

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeCostField(field) {
  const normalized = String(field || '').trim();
  const allowed = new Set([
    'cost',
    'base_cost',
    'cost_base',
    'landed_cost',
    'lot_cost',
    'market_cost',
    'real_cost',
    'cost_real',
    'price_per_unit',
  ]);
  return allowed.has(normalized) ? normalized : '';
}

async function applyBatchItem(db, item) {
  const costField = normalizeCostField(item.cost_field);
  if (!costField || !item.product_id) return { applied: false, reason: 'invalid_item' };

  const update = {
    [costField]: item.new_value == null ? null : toNumber(item.new_value),
  };
  if (item.new_sell_price != null) update.price_per_unit = toNumber(item.new_sell_price);
  if (costField === 'cost_base') update.base_cost = update.cost_base;
  if (costField === 'base_cost') update.cost_base = update.base_cost;
  if (costField === 'cost_real') update.real_cost = update.cost_real;
  if (costField === 'real_cost') update.cost_real = update.real_cost;
  if (costField === 'cost') update.cost_base = update.cost;

  const { error } = await db
    .from('products')
    .update(update)
    .eq('id', item.product_id)
    .eq('company_id', item.company_id);
  if (error) throw error;
  return { applied: true };
}

async function runPendingCostPriceUpdates({ db = supabase, now = new Date(), log = logger } = {}) {
  const nowIso = now.toISOString();
  const { data: batches, error } = await db
    .from('pricing_update_batches')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_at', nowIso);
  if (error) throw error;

  const rows = batches || [];
  let applied = 0;
  let failed = 0;

  for (const batch of rows) {
    try {
      const { data: items, error: itemError } = await db
        .from('pricing_update_batch_items')
        .select('*')
        .eq('batch_id', batch.id)
        .eq('company_id', batch.company_id);
      if (itemError) throw itemError;

      for (const item of items || []) {
        await applyBatchItem(db, item);
      }

      const { error: updateError } = await db
        .from('pricing_update_batches')
        .update({ status: 'applied', applied_at: nowIso })
        .eq('id', batch.id)
        .eq('company_id', batch.company_id);
      if (updateError) throw updateError;
      applied += 1;
    } catch (err) {
      failed += 1;
      log.warn({ err, batchId: batch.id, job: JOB_NAME }, 'Cost-price update batch failed');
      await db
        .from('pricing_update_batches')
        .update({ status: 'failed' })
        .eq('id', batch.id)
        .eq('company_id', batch.company_id);
    }
  }

  return { job: JOB_NAME, checked: rows.length, applied, failed };
}

function registerCostPriceScheduler(cron, { log = logger, expression = DEFAULT_CRON, timezone = DEFAULT_TZ } = {}) {
  if (!cron) return false;
  if (!cron.validate(expression)) {
    log.error({ cron: expression, job: JOB_NAME }, 'COST_PRICE_UPDATE_CRON is invalid - job not scheduled');
    return false;
  }

  cron.schedule(expression, async () => {
    log.info({ cron: expression, job: JOB_NAME }, 'Cost-price update job started');
    try {
      const result = await runPendingCostPriceUpdates({ log });
      log.info(result, 'Cost-price update job completed');
    } catch (err) {
      log.error({ err, job: JOB_NAME }, 'Cost-price update job failed');
    }
  }, { timezone });
  return true;
}

module.exports = {
  DEFAULT_CRON,
  JOB_NAME,
  applyBatchItem,
  registerCostPriceScheduler,
  runPendingCostPriceUpdates,
};
