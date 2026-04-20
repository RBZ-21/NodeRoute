require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const bcrypt = require('bcryptjs');

const hasSupabaseConfig = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const isDemoMode = !hasSupabaseConfig;

const demoState = {
  users: [
    {
      id: 'admin-001',
      name: 'Admin',
      email: process.env.ADMIN_EMAIL || 'admin@noderoute.com',
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
};

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
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
  return true;
}

function applySelect(rows) {
  return rows;
}

class DemoQuery {
  constructor(tableName) {
    this.tableName = normalizeTableName(tableName);
    this.filters = [];
    this.limitCount = null;
    this.orderBy = null;
    this.operation = 'select';
    this.payload = null;
    this.shouldSingle = false;
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
    const table = demoState[this.tableName] || (demoState[this.tableName] = []);

    if (this.operation === 'insert') {
      const inserted = this.payload.map((row) => {
        const next = clone(row) || {};
        if (!next.id) next.id = `${this.tableName}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
        if (!next.created_at) next.created_at = new Date().toISOString();
        table.push(next);
        return next;
      });
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

    if (this.limitCount != null) {
      rows = rows.slice(0, this.limitCount);
    }

    if (this.operation === 'update') {
      const updated = [];
      for (let i = 0; i < table.length; i += 1) {
        if (this.filters.every((filter) => matchesFilter(table[i], filter))) {
          table[i] = { ...table[i], ...clone(this.payload) };
          updated.push(clone(table[i]));
        }
      }
      const result = this.shouldSingle ? updated[0] || null : updated;
      return { data: applySelect(clone(result)), error: null };
    }

    if (this.operation === 'delete') {
      let removed = [];
      demoState[this.tableName] = table.filter((row) => {
        const shouldRemove = this.filters.every((filter) => matchesFilter(row, filter));
        if (shouldRemove) removed.push(clone(row));
        return !shouldRemove;
      });
      const result = this.shouldSingle ? removed[0] || null : removed;
      return { data: applySelect(clone(result)), error: null };
    }

    if (this.shouldSingle) {
      return { data: clone(rows[0] || null), error: null };
    }

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

function createDemoSupabaseClient() {
  return {
    from(tableName) {
      return new DemoQuery(tableName);
    },
  };
}

let supabase;

if (hasSupabaseConfig) {
  const { createClient } = require('@supabase/supabase-js');
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
} else if (isProduction) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required in production.');
} else {
  supabase = createDemoSupabaseClient();
  console.warn('Supabase env vars are missing. Running in demo mode with local in-memory data.');
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

module.exports = { supabase, dbQuery, isDemoMode };
