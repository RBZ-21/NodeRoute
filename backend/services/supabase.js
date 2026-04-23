require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const hasSupabaseConfig = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const isDemoMode = !hasSupabaseConfig;

const backupRoot = process.env.NODEROUTE_BACKUP_PATH
  ? path.resolve(process.env.NODEROUTE_BACKUP_PATH)
  : path.join(__dirname, '../data/offline-backup');
const backupStateFile = path.join(backupRoot, 'state.json');
const backupQueueFile = path.join(backupRoot, 'pending-sync.json');

function ensureBackupRoot() {
  if (!fs.existsSync(backupRoot)) fs.mkdirSync(backupRoot, { recursive: true });
}

function defaultState() {
  return {
    users: [
      {
        id: 'admin-001',
        name: 'Admin',
        email: process.env.ADMIN_EMAIL || 'admin@noderoutesystems.com',
        password_hash: bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'Admin@123', 10),
        role: 'admin',
        status: 'active',
        invite_token: null,
        invite_expires: null,
        created_at: new Date().toISOString(),
      },
    ],
    orders: [],
    invoices: [],
    routes: [],
    stops: [],
    Customers: [],
    seafood_inventory: [],
    inventory_lots: [],
    inventory_stock_history: [],
    inventory_yield_log: [],
    purchase_orders: [],
    temperature_logs: [],
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

function matchesFilter(row, filter) {
  const value = row?.[filter.field];
  if (filter.type === 'eq') {
    return String(value) === String(filter.value);
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
  return true;
}

function applySelect(rows) {
  return rows;
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

  gte(field, value) {
    this.filters.push({ type: 'gte', field, value });
    return this;
  }

  lte(field, value) {
    this.filters.push({ type: 'lte', field, value });
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

  gte(field, value) {
    this.filters.push({ type: 'gte', field, value });
    return this;
  }

  lte(field, value) {
    this.filters.push({ type: 'lte', field, value });
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
    if (spec.operation === 'update') query = query.update(spec.payload);
    if (spec.operation === 'delete') query = query.delete();

    for (const filter of spec.filters || []) {
      if (filter.type === 'eq') query = query.eq(filter.field, filter.value);
      if (filter.type === 'ilike') query = query.ilike(filter.field, filter.value);
      if (filter.type === 'gte' && typeof query.gte === 'function') query = query.gte(filter.field, filter.value);
      if (filter.type === 'lte' && typeof query.lte === 'function') query = query.lte(filter.field, filter.value);
    }

    if (spec.orderBy) query = query.order(spec.orderBy.field, { ascending: spec.orderBy.ascending !== false });
    if (spec.limitCount != null) query = query.limit(spec.limitCount);
    if (spec.selectCalled) query = query.select(...(spec.selectArgs || []));
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
      if (!localResult?.error && ['insert', 'update', 'delete'].includes(spec.operation)) {
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
  };
}

let supabase;

if (hasSupabaseConfig) {
  const { createClient } = require('@supabase/supabase-js');
  const cloudSupabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  supabase = createResilientSupabaseClient(cloudSupabase);
  console.log(`[backup] Resilient data mode enabled. Local backup path: ${backupRoot}`);
} else if (isProduction) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required in production.');
} else {
  supabase = createDemoSupabaseClient({
    stateRef: localState,
    onWrite: persistLocalState,
  });
  console.warn('Supabase env vars are missing. Running in demo mode with local persistent backup data.');
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
