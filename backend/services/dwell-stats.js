'use strict';

const { buildScopeFields } = require('./operating-context');

const dwellCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

function cacheKeyFromContext(context = {}) {
  const scope = buildScopeFields(context);
  return `${scope.company_id || 'global'}:${scope.location_id || 'all'}`;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

/**
 * Returns the median dwell_ms across completed dwell records for a given company/location.
 * Falls back to defaultMs if fewer than MIN_SAMPLES records exist.
 */
async function getMedianDwellMs(supabase, context, { defaultMs = 8 * 60 * 1000, minSamples = 5 } = {}) {
  const cacheKey = cacheKeyFromContext(context);
  const cached = dwellCache.get(cacheKey);
  if (cached && Date.now() - cached.ts <= CACHE_TTL_MS) {
    return cached.value;
  }

  const scope = buildScopeFields(context);
  let query = supabase
    .from('dwell_records')
    .select('dwell_ms, arrived_at')
    .not('dwell_ms', 'is', null)
    .gt('dwell_ms', 0)
    .lt('dwell_ms', 2 * 60 * 60 * 1000)
    .order('arrived_at', { ascending: false })
    .limit(200);

  if (scope.company_id) query = query.eq('company_id', scope.company_id);
  if (scope.location_id) query = query.eq('location_id', scope.location_id);

  const { data, error } = await query;
  const values = error
    ? []
    : (data || [])
      .map((row) => Number(row.dwell_ms))
      .filter((value) => Number.isFinite(value) && value > 0 && value < 2 * 60 * 60 * 1000);

  const value = values.length < minSamples ? defaultMs : median(values);
  dwellCache.set(cacheKey, { value, ts: Date.now() });
  return value;
}

module.exports = {
  getMedianDwellMs,
};
