const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const isNodeTestRunner = process.argv.includes('--test') || process.execArgv.includes('--test');
const nodeEnv = String(process.env.NODE_ENV || '').toLowerCase();
const isTestMode = nodeEnv === 'test' || isNodeTestRunner;
const forceDemoMode = String(process.env.NODEROUTE_FORCE_DEMO_MODE || '').toLowerCase() === 'true';
const allowLiveSupabaseInTests = isTestMode && String(process.env.NODEROUTE_ALLOW_LIVE_SUPABASE_TESTS || '').toLowerCase() === 'true';
if (!isTestMode || allowLiveSupabaseInTests) {
  require('dotenv').config({ path: path.join(__dirname, '../../.env') });
}

const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const hasSupabaseConfig = !!(process.env.SUPABASE_URL && serviceRoleKey);
const isProduction = nodeEnv === 'production';
const shouldUseCloudSupabase = hasSupabaseConfig && !forceDemoMode && (!isTestMode || allowLiveSupabaseInTests);
const isDemoMode = !shouldUseCloudSupabase;

const backupRoot = process.env.NODEROUTE_BACKUP_PATH
  ? path.resolve(process.env.NODEROUTE_BACKUP_PATH)
  : path.join(__dirname, '../data/offline-backup');
const backupStateFile = path.join(backupRoot, 'state.json');
const backupQueueFile = path.join(backupRoot, 'pending-sync.json');

function ensureBackupRoot() {
  if (!fs.existsSync(backupRoot)) fs.mkdirSync(backupRoot, { recursive: true });
}

function defaultState() {
  // Lazy require so config parses env after the dotenv load above.
  const { ADMIN_EMAIL, ADMIN_PASSWORD } = require('../lib/config');
  return {
    users: [
      {
        id: 'admin-001',
        name: 'Admin',
        email: ADMIN_EMAIL,
        password_hash: bcrypt.hashSync(ADMIN_PASSWORD, 10),
        role: 'admin',
        status: 'active',
        invite_token: null,
        invite_expires: null,
        created_at: new Date().toISOString(),
      },
    ],
    locations: [],
    orders: [],
    invoices: [],
    routes: [],
    stops: [],
    Customers: [],
    seafood_inventory: [],
    products: [],
    inventory_lots: [],
    inventory_stock_history: [],
    inventory_uom_conversions: [],
    cycle_counts: [],
    cycle_count_items: [],
    kit_recipes: [],
    kit_recipe_items: [],
    kit_processing_runs: [],
    inventory_shortages: [],
    inventory_returns: [],
    product_usage_history: [],
    warehouse_geocodes: [],
    customer_geocodes: [],
    route_drive_time_cache: [],
    ar_ledger_entries: [],
    cash_receipts: [],
    cash_receipt_applications: [],
    finance_charge_runs: [],
    finance_charge_entries: [],
    sales_tax_jurisdictions: [],
    sales_tax_entries: [],
    customer_credit_events: [],
    report_definitions: [],
    report_schedules: [],
    report_runs: [],
    report_delivery_targets: [],
    inventory_alert_rules: [],
    credit_alert_rules: [],
    alert_sends: [],
    reorder_suggestions: [],
    reorder_settings_audit: [],
    inventory_yield_log: [],
    purchase_orders: [],
    temperature_logs: [],
    route_mutation_audit_logs: [],
    platform_plan_tiers: [],
    platform_plan_features: [],
    platform_plan_feature_matrix: [],
    platform_plan_limits: [],
    platform_addons: [],
    company_billing_profiles: [],
    company_feature_entitlements: [],
    company_addon_entitlements: [],
    platform_pricing_audit_events: [],
  };
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return clone(fallback);
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return clone(fallback);
  }
}

function writeJsonSafe(filePath, data) {
  try {
    ensureBackupRoot();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.warn('[backup] failed to persist file:', filePath, error.message);
  }
}

let localState = readJsonSafe(backupStateFile, defaultState());
let pendingSyncQueue = readJsonSafe(backupQueueFile, []);

function persistLocalState() {
  writeJsonSafe(backupStateFile, localState);
}

function persistSyncQueue() {
  writeJsonSafe(backupQueueFile, pendingSyncQueue);
}

function normalizeTableName(tableName) {
  return tableName;
}

function formatOrFilterValue(value) {
  if (value === null || value === undefined) return 'null';
  const raw = String(value);
  if (/^[a-zA-Z0-9_-]+$/.test(raw)) return raw;
  return `"${raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function buildOrExpression(candidates) {
  return (candidates || [])
    .filter((candidate) => candidate?.field && candidate?.type)
    .map((candidate) => {
      const field = String(candidate.field);
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(field)) return null;
      return `${field}.${candidate.type}.${formatOrFilterValue(candidate.value)}`;
    })
    .filter(Boolean)
    .join(',');
}

function parseOrExpression(expression) {
  return String(expression || '')
    .split(',')
    .map((clause) => clause.trim())
    .filter(Boolean)
    .map((clause) => {
      const parts = clause.split('.');
      if (parts.length < 3) return null;
      const [field, operator, ...rest] = parts;
      let value = rest.join('.');
      if (value === 'null') value = null;
      if (operator === 'is') return { type: 'is', field, value };
      if (operator === 'gte') return { type: 'gte', field, value };
      if (operator === 'lte') return { type: 'lte', field, value };
      if (operator === 'gt') return { type: 'gt', field, value };
      if (operator === 'lt') return { type: 'lt', field, value };
      if (operator === 'eq') return { type: 'eq', field, value };
      return null;
    })
    .filter(Boolean);
}

function containsValue(haystack, needle) {
  if (Array.isArray(haystack) && Array.isArray(needle)) {
    return needle.every((expected) =>
      haystack.some((candidate) => containsValue(candidate, expected))
    );
  }
  if (haystack && typeof haystack === 'object' && needle && typeof needle === 'object') {
    return Object.entries(needle).every(([key, expected]) => containsValue(haystack[key], expected));
  }
  return haystack === needle;
}

function matchesFilter(row, filter) {
  const value = row?.[filter.field];
  if (filter.type === 'eq') {
    return String(value) === String(filter.value);
  }
  if (filter.type === 'is') {
    return filter.value === null ? value == null : value === filter.value;
  }
  if (filter.type === 'in') {
    return Array.isArray(filter.value) && filter.value.map(String).includes(String(value));
  }
  if (filter.type === 'ilike') {
    const haystack = String(value ?? '').toLowerCase();
    const needle = String(filter.value ?? '').toLowerCase().replace(/%/g, '');
    return haystack.includes(needle);
  }
  if (filter.type === 'gte') {
    return value != null && value >= filter.value;
  }
  if (filter.type === 'lte') {
    return value != null && value <= filter.value;
  }
  if (filter.type === 'gt') {
    return value != null && value > filter.value;
  }
  if (filter.type === 'lt') {
    return value != null && value < filter.value;
  }
  if (filter.type === 'not') {
    if (filter.operator === 'is') {
      return !(filter.value === null ? value == null : value === filter.value);
    }
    return true;
  }
  if (filter.type === 'or') {
    return (filter.value || []).some((candidate) => matchesFilter(row, candidate));
  }
  if (filter.type === 'contains') {
    let expected = filter.value;
    if (typeof expected === 'string') {
      try {
        expected = JSON.parse(expected);
      } catch {
        return false;
      }
    }
    return containsValue(value, expected);
  }
  return true;
}

function applySelect(rows) {
  return rows;
}

// Conflict targets used by the demo-mode `upsert` implementation. Real Postgres
// resolves conflicts from the table's primary key; the JSON store has no schema,
// so tables with non-`id` primary keys are listed here explicitly. Callers can
// always override with upsert(rows, { onConflict: 'col_a,col_b' }).
const DEMO_UPSERT_CONFLICT_KEYS = {
  platform_plan_tiers: ['code'],
  platform_plan_features: ['code'],
  platform_addons: ['code'],
  platform_plan_feature_matrix: ['tier_code', 'feature_code'],
  platform_plan_limits: ['tier_code', 'metric_code'],
  company_billing_profiles: ['company_id'],
  company_feature_entitlements: ['company_id', 'feature_code'],
  company_addon_entitlements: ['company_id', 'addon_code'],
};

function parseOnConflict(options) {
  if (!options || typeof options.onConflict !== 'string') return null;
  const keys = options.onConflict.split(',').map((key) => key.trim()).filter(Boolean);
  return keys.length ? keys : null;
}

class DemoQuery {
  constructor(tableName, options = {}) {
    this.tableName = normalizeTableName(tableName);
    this.filters = [];
    this.limitCount = null;
    this.orderBy = null;
    this.operation = 'select';
    this.payload = null;
    this.shouldSingle = false;
    this.stateRef = options.stateRef || localState;
    this.onWrite = typeof options.onWrite === 'function' ? options.onWrite : null;
  }

  select() {
    this.operation = this.operation || 'select';
    return this;
  }

  insert(rows) {
    this.operation = 'insert';
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  upsert(rows, options = {}) {
    this.operation = 'upsert';
    this.payload = Array.isArray(rows) ? rows : [rows];
    this.conflictKeys = parseOnConflict(options);
    return this;
  }

  update(fields) {
    this.operation = 'update';
    this.payload = fields || {};
    return this;
  }

  delete() {
    this.operation = 'delete';
    return this;
  }

  eq(field, value) {
    this.filters.push({ type: 'eq', field, value });
    return this;
  }

  ilike(field, value) {
    this.filters.push({ type: 'ilike', field, value });
    return this;
  }

  is(field, value) {
    this.filters.push({ type: 'is', field, value });
    return this;
  }

  in(field, values) {
    this.filters.push({ type: 'in', field, value: values });
    return this;
  }

  gte(field, value) {
    this.filters.push({ type: 'gte', field, value });
    return this;
  }

  lte(field, value) {
    this.filters.push({ type: 'lte', field, value });
    return this;
  }

  gt(field, value) {
    this.filters.push({ type: 'gt', field, value });
    return this;
  }

  lt(field, value) {
    this.filters.push({ type: 'lt', field, value });
    return this;
  }

  not(field, operator, value) {
    this.filters.push({ type: 'not', field, operator, value });
    return this;
  }

  or(expression) {
    this.filters.push({ type: 'or', value: parseOrExpression(expression) });
    return this;
  }

  contains(field, value) {
    this.filters.push({ type: 'contains', field, value });
    return this;
  }

  order(field, options = {}) {
    this.orderBy = { field, ascending: options.ascending !== false };
    return this;
  }

  limit(count) {
    this.limitCount = count;
    return this;
  }

  single() {
    this.shouldSingle = true;
    return this;
  }

  async execute() {
    const state = this.stateRef;
    const table = state[this.tableName] || (state[this.tableName] = []);

    if (this.operation === 'insert') {
      const inserted = this.payload.map((row) => {
        const next = clone(row) || {};
        if (!next.id) next.id = `${this.tableName}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
        if (!next.created_at) next.created_at = new Date().toISOString();
        table.push(next);
        return next;
      });
      if (this.onWrite) this.onWrite();
      const result = this.shouldSingle ? inserted[0] || null : inserted;
      return { data: applySelect(clone(result)), error: null };
    }

    if (this.operation === 'upsert') {
      const conflictKeys = this.conflictKeys || DEMO_UPSERT_CONFLICT_KEYS[this.tableName] || ['id'];
      const results = this.payload.map((row) => {
        const next = clone(row) || {};
        const hasAllKeys = conflictKeys.every((key) => next[key] !== undefined && next[key] !== null);
        const idx = hasAllKeys
          ? table.findIndex((item) => conflictKeys.every((key) => String(item?.[key]) === String(next[key])))
          : -1;
        if (idx >= 0) {
          table[idx] = { ...table[idx], ...next };
          return clone(table[idx]);
        }
        if (conflictKeys.includes('id') && next.id == null) {
          next.id = `${this.tableName}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
        }
        if (!next.created_at) next.created_at = new Date().toISOString();
        table.push(next);
        return clone(next);
      });
      if (this.onWrite) this.onWrite();
      const result = this.shouldSingle ? results[0] || null : results;
      return { data: applySelect(clone(result)), error: null };
    }

    let rows = table.filter((row) => this.filters.every((filter) => matchesFilter(row, filter)));

    if (this.orderBy) {
      const { field, ascending } = this.orderBy;
      rows = rows.slice().sort((a, b) => {
        const av = a?.[field];
        const bv = b?.[field];
        if (av === bv) return 0;
        if (av == null) return ascending ? -1 : 1;
        if (bv == null) return ascending ? 1 : -1;
        return ascending ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      });
    }

    if (this.limitCount != null) rows = rows.slice(0, this.limitCount);

    if (this.operation === 'update') {
      const updated = [];
      for (let i = 0; i < table.length; i += 1) {
        if (this.filters.every((filter) => matchesFilter(table[i], filter))) {
          table[i] = { ...table[i], ...clone(this.payload) };
          updated.push(clone(table[i]));
        }
      }
      if (this.onWrite) this.onWrite();
      const result = this.shouldSingle ? updated[0] || null : updated;
      return { data: applySelect(clone(result)), error: null };
    }

    if (this.operation === 'delete') {
      const removed = [];
      state[this.tableName] = table.filter((row) => {
        const shouldRemove = this.filters.every((filter) => matchesFilter(row, filter));
        if (shouldRemove) removed.push(clone(row));
        return !shouldRemove;
      });
      if (this.onWrite) this.onWrite();
      const result = this.shouldSingle ? removed[0] || null : removed;
      return { data: applySelect(clone(result)), error: null };
    }

    if (this.shouldSingle) return { data: clone(rows[0] || null), error: null };
    return { data: clone(rows), error: null };
  }

  then(resolve, reject) {
    return this.execute().then(resolve, reject);
  }

  catch(reject) {
    return this.execute().catch(reject);
  }

  finally(handler) {
    return this.execute().finally(handler);
  }
}

function createDemoSupabaseClient(options = {}) {
  return {
    from(tableName) {
      return new DemoQuery(tableName, options);
    },
    rpc(_funcName, _args) {
      return Promise.resolve({ data: null, error: null });
    },
  };
}

function normalizeDataRows(data) {
  if (data == null) return [];
  return Array.isArray(data) ? data : [data];
}

function mergeRowsIntoLocal(tableName, rows) {
  if (!Array.isArray(rows) || !rows.length) return;
  const table = localState[tableName] || (localState[tableName] = []);
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    if (row.id != null) {
      const idx = table.findIndex((item) => String(item.id) === String(row.id));
      if (idx >= 0) table[idx] = { ...table[idx], ...clone(row) };
      else table.push(clone(row));
    } else {
      table.push(clone(row));
    }
  }
  persistLocalState();
}

function isConnectionError(error) {
  const message = String(error?.message || error || '');
  return /(fetch failed|network|timeout|ECONN|ENOTFOUND|ETIMEDOUT|connection|Failed to fetch)/i.test(message);
}

class ResilientQuery {
  constructor(tableName, cloudClient, localClient) {
    this.tableName = normalizeTableName(tableName);
    this.cloudClient = cloudClient;
    this.localClient = localClient;
    this.filters = [];
    this.limitCount = null;
    this.orderBy = null;
    this.operation = 'select';
    this.payload = null;
    this.shouldSingle = false;
    this.selectArgs = [];
    this.selectCalled = false;
  }

  select(...args) {
    this.selectCalled = true;
    this.selectArgs = args;
    this.operation = this.operation || 'select';
    return this;
  }

  insert(rows) {
    this.operation = 'insert';
    this.payload = Array.isArray(rows) ? clone(rows) : [clone(rows)];
    return this;
  }

  upsert(rows, options = {}) {
    this.operation = 'upsert';
    this.payload = Array.isArray(rows) ? clone(rows) : [clone(rows)];
    this.upsertOptions = options && typeof options === 'object' ? clone(options) : {};
    return this;
  }

  update(fields) {
    this.operation = 'update';
    this.payload = clone(fields) || {};
    return this;
  }

  delete() {
    this.operation = 'delete';
    return this;
  }

  eq(field, value) {
    this.filters.push({ type: 'eq', field, value });
    return this;
  }

  ilike(field, value) {
    this.filters.push({ type: 'ilike', field, value });
    return this;
  }

  is(field, value) {
    this.filters.push({ type: 'is', field, value });
    return this;
  }

  in(field, values) {
    this.filters.push({ type: 'in', field, value: values });
    return this;
  }

  gte(field, value) {
    this.filters.push({ type: 'gte', field, value });
    return this;
  }

  lte(field, value) {
    this.filters.push({ type: 'lte', field, value });
    return this;
  }

  gt(field, value) {
    this.filters.push({ type: 'gt', field, value });
    return this;
  }

  lt(field, value) {
    this.filters.push({ type: 'lt', field, value });
    return this;
  }

  not(field, operator, value) {
    this.filters.push({ type: 'not', field, operator, value });
    return this;
  }

  or(expression) {
    this.filters.push({ type: 'or', value: parseOrExpression(expression) });
    return this;
  }

  contains(field, value) {
    this.filters.push({ type: 'contains', field, value });
    return this;
  }

  order(field, options = {}) {
    this.orderBy = { field, ascending: options.ascending !== false };
    return this;
  }

  limit(count) {
    this.limitCount = count;
    return this;
  }

  single() {
    this.shouldSingle = true;
    return this;
  }

  toSpec() {
    return {
      tableName: this.tableName,
      operation: this.operation,
      payload: clone(this.payload),
      upsertOptions: clone(this.upsertOptions),
      filters: clone(this.filters),
      orderBy: clone(this.orderBy),
      limitCount: this.limitCount,
      shouldSingle: this.shouldSingle,
      selectCalled: this.selectCalled,
      selectArgs: clone(this.selectArgs),
    };
  }

  static buildQuery(client, spec) {
    let query = client.from(spec.tableName);
    if (spec.operation === 'insert') query = query.insert(spec.payload);
    if (spec.operation === 'upsert') query = query.upsert(spec.payload, spec.upsertOptions || {});
    if (spec.operation === 'update') query = query.update(spec.payload);
    if (spec.operation === 'delete') query = query.delete();

    if (spec.selectCalled) query = query.select(...(spec.selectArgs || []));

    for (const filter of spec.filters || []) {
      if (filter.type === 'eq') query = query.eq(filter.field, filter.value);
      if (filter.type === 'ilike') query = query.ilike(filter.field, filter.value);
      if (filter.type === 'is' && typeof query.is === 'function') query = query.is(filter.field, filter.value);
      if (filter.type === 'in' && typeof query.in === 'function') query = query.in(filter.field, filter.value);
      if (filter.type === 'gte' && typeof query.gte === 'function') query = query.gte(filter.field, filter.value);
      if (filter.type === 'lte' && typeof query.lte === 'function') query = query.lte(filter.field, filter.value);
      if (filter.type === 'gt' && typeof query.gt === 'function') query = query.gt(filter.field, filter.value);
      if (filter.type === 'lt' && typeof query.lt === 'function') query = query.lt(filter.field, filter.value);
      if (filter.type === 'not' && typeof query.not === 'function') query = query.not(filter.field, filter.operator, filter.value);
      if (filter.type === 'or' && typeof query.or === 'function') {
        const expression = buildOrExpression(filter.value);
        if (expression) query = query.or(expression);
      }
      if (filter.type === 'contains' && typeof query.contains === 'function') query = query.contains(filter.field, filter.value);
    }

    if (spec.orderBy) query = query.order(spec.orderBy.field, { ascending: spec.orderBy.ascending !== false });
    if (spec.limitCount != null) query = query.limit(spec.limitCount);
    if (spec.shouldSingle) query = query.single();
    return query;
  }

  async execute() {
    const spec = this.toSpec();
    await flushPendingQueue(this.cloudClient, this.localClient);

    try {
      const cloudResult = await ResilientQuery.buildQuery(this.cloudClient, spec);
      if (cloudResult?.error) throw cloudResult.error;

      if (spec.operation === 'delete') {
        const localDelete = await ResilientQuery.buildQuery(this.localClient, spec);
        if (!localDelete?.error) persistLocalState();
      } else {
        mergeRowsIntoLocal(spec.tableName, normalizeDataRows(cloudResult?.data));
      }
      return cloudResult;
    } catch (error) {
      if (!isConnectionError(error)) return { data: null, error };

      const localResult = await ResilientQuery.buildQuery(this.localClient, spec);
      if (!localResult?.error && ['insert', 'upsert', 'update', 'delete'].includes(spec.operation)) {
        pendingSyncQueue.push(spec);
        persistSyncQueue();
        persistLocalState();
      }
      return localResult;
    }
  }

  then(resolve, reject) {
    return this.execute().then(resolve, reject);
  }

  catch(reject) {
    return this.execute().catch(reject);
  }

  finally(handler) {
    return this.execute().finally(handler);
  }
}

let flushingQueue = false;
async function flushPendingQueue(cloudClient, localClient) {
  if (!pendingSyncQueue.length || flushingQueue) return;
  flushingQueue = true;
  try {
    while (pendingSyncQueue.length) {
      const spec = pendingSyncQueue[0];
      try {
        const result = await ResilientQuery.buildQuery(cloudClient, spec);
        if (result?.error) throw result.error;
        pendingSyncQueue.shift();
        persistSyncQueue();
        if (spec.operation === 'delete') {
          await ResilientQuery.buildQuery(localClient, spec);
          persistLocalState();
        } else {
          mergeRowsIntoLocal(spec.tableName, normalizeDataRows(result?.data));
        }
      } catch (error) {
        if (isConnectionError(error)) break;
        pendingSyncQueue.shift();
        persistSyncQueue();
      }
    }
  } finally {
    flushingQueue = false;
  }
}

function createResilientSupabaseClient(cloudClient) {
  const localClient = createDemoSupabaseClient({
    stateRef: localState,
    onWrite: persistLocalState,
  });
  return {
    from(tableName) {
      return new ResilientQuery(tableName, cloudClient, localClient);
    },
    async rpc(funcName, args) {
      try {
        const result = await cloudClient.rpc(funcName, args);
        return result ?? { data: null, error: null };
      } catch (error) {
        if (isConnectionError(error)) return { data: null, error: null };
        return { data: null, error };
      }
    },
  };
}

let supabase;

if (shouldUseCloudSupabase) {
  const { createClient } = require('@supabase/supabase-js');
  const cloudSupabase = createClient(process.env.SUPABASE_URL, serviceRoleKey);
  supabase = createResilientSupabaseClient(cloudSupabase);
  console.log(`[backup] Resilient data mode enabled. Local backup path: ${backupRoot}`);
} else if (isProduction) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in production.');
} else {
  supabase = createDemoSupabaseClient({
    stateRef: localState,
    onWrite: persistLocalState,
  });
  if (forceDemoMode) {
    console.warn('Running in forced demo mode with local persistent backup data.');
  } else if (isTestMode && hasSupabaseConfig && !allowLiveSupabaseInTests) {
    console.warn('Ignoring Supabase cloud credentials during tests. Set NODEROUTE_ALLOW_LIVE_SUPABASE_TESTS=true to opt into live integration tests.');
  } else {
    console.warn('Running in demo mode with local persistent backup data.');
  }
}

async function dbQuery(promise, res) {
  const { data, error } = await promise;
  if (error) {
    console.error('Supabase error:', error.message);
    if (res) res.status(500).json({ error: error.message });
    return null;
  }
  return data;
}

module.exports = { supabase, dbQuery, isDemoMode, backupRoot };
