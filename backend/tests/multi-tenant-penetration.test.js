const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildRequestContext,
  filterRowsByContext,
  rowMatchesContext,
} = require('../services/operating-context');

const repoRoot = path.join(__dirname, '..', '..');
const migrationDirs = [
  path.join(repoRoot, 'supabase', 'migrations'),
];
const blanketRlsMigration = '20260528_enable_rls_all_public_tables.sql';
const directClientDenylist = new Set([
  'auth_refresh_sessions',
  'driver_client_actions',
  'portal_payment_events',
  'portal_payment_methods',
  'portal_payment_settings',
]);
const publicWriteExceptions = new Set(['waitlist']);

function listMigrationFiles() {
  return migrationDirs
    .filter((dir) => fs.existsSync(dir))
    .flatMap((dir) => fs.readdirSync(dir).map((file) => path.join(dir, file)))
    .filter((file) => file.endsWith('.sql'))
    .sort();
}

function normalizeTableName(rawName) {
  return rawName
    .replace(/^if\s+not\s+exists\s+/i, '')
    .replace(/^public\./i, '')
    .replace(/"/g, '')
    .trim()
    .toLowerCase();
}

function tableNamePattern(tableName) {
  const quoted = tableName.includes(' ') || /[A-Z]/.test(tableName)
    ? `"${tableName.replace(/"/g, '')}"`
    : tableName.replace(/"/g, '');
  return new RegExp(`alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:public\\.)?${quoted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+enable\\s+row\\s+level\\s+security`, 'i');
}

function createdPublicTables(sql) {
  return [...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?((?:public\.)?(?:"[^"]+"|[a-zA-Z_][\w$]*))/gi)]
    .map((match) => normalizeTableName(match[1]));
}

function rlsEnabledTablesByFile() {
  const enabled = new Map();

  for (const file of listMigrationFiles()) {
    const sql = fs.readFileSync(file, 'utf8');
    for (const match of sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?((?:public\.)?(?:"[^"]+"|[a-zA-Z_][\w$]*))\s+enable\s+row\s+level\s+security/gi)) {
      const table = normalizeTableName(match[1]);
      const files = enabled.get(table) || [];
      files.push(path.basename(file));
      enabled.set(table, files);
    }
  }

  return enabled;
}

test('tenant context ignores forged company and location headers outside allowed scope', () => {
  const user = {
    id: 'ops-1',
    email: 'ops@example.com',
    company_id: 'company-a',
    location_id: 'loc-a',
    accessible_company_ids: ['company-a'],
    accessible_location_ids: ['loc-a'],
  };

  const context = buildRequestContext({
    headers: {
      'x-company-id': 'company-b',
      'x-location-id': 'loc-b',
    },
    query: {},
    body: {},
  }, user);

  assert.equal(context.activeCompanyId, 'company-a');
  assert.equal(context.activeLocationId, 'loc-a');
  assert.equal(context.requestedCompanyId, 'company-b');
  assert.equal(context.requestedLocationId, 'loc-b');
});

test('tenant filtering rejects cross-company rows for route and temperature-log data', () => {
  const context = {
    companyId: 'company-a',
    activeCompanyId: 'company-a',
    accessibleCompanyIds: ['company-a'],
    locationId: 'loc-a',
    activeLocationId: 'loc-a',
    accessibleLocationIds: ['loc-a'],
    isGlobalOperator: false,
  };

  const rows = [
    { id: 'route-1', company_id: 'company-a', location_id: 'loc-a', route_id: 'route-1' },
    { id: 'route-2', company_id: 'company-b', location_id: 'loc-b', route_id: 'route-2' },
  ];

  assert.equal(rowMatchesContext(rows[0], context), true);
  assert.equal(rowMatchesContext(rows[1], context), false);
  assert.deepEqual(filterRowsByContext(rows, context), [rows[0]]);
});

test('global operators may intentionally cross tenant boundaries', () => {
  const context = {
    companyId: 'company-a',
    activeCompanyId: 'company-b',
    accessibleCompanyIds: ['company-a', 'company-b'],
    locationId: 'loc-a',
    activeLocationId: 'loc-b',
    accessibleLocationIds: ['loc-a', 'loc-b'],
    isGlobalOperator: true,
  };

  const foreignRow = { id: 'audit-1', company_id: 'company-b', location_id: 'loc-b' };
  assert.equal(rowMatchesContext(foreignRow, context), true);
});

test('multi-tenant public tables created after the blanket RLS baseline explicitly enable RLS', () => {
  const offenders = [];
  const rlsByTable = rlsEnabledTablesByFile();

  for (const file of listMigrationFiles()) {
    const basename = path.basename(file);
    if (basename <= blanketRlsMigration) continue;

    const sql = fs.readFileSync(file, 'utf8');
    for (const table of createdPublicTables(sql)) {
      if (publicWriteExceptions.has(table)) continue;

      const hasExplicitRls = (rlsByTable.get(table) || []).some((rlsFile) => rlsFile >= basename)
        || tableNamePattern(table).test(sql);
      if (!hasExplicitRls) {
        offenders.push(`${path.relative(repoRoot, file)} creates ${table} without enabling RLS`);
      }
    }
  }

  assert.deepEqual(offenders, []);
});

test('multi-tenant live public schema RLS check queries Supabase catalog when credentials are provided', async (t) => {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY || !process.env.SUPABASE_SQL_RPC_NAME) {
    t.skip('SUPABASE_URL, SUPABASE_SERVICE_KEY, and SUPABASE_SQL_RPC_NAME are required for the live catalog check');
    return;
  }

  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const rlsCatalogSql = `
    select
      c.relname as table_name,
      c.relrowsecurity as rls_enabled
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join information_schema.tables t
      on t.table_schema = n.nspname
     and t.table_name = c.relname
    where n.nspname = 'public'
      and t.table_type = 'BASE TABLE'
      and c.relkind = 'r'
    order by c.relname;
  `;

  const { data, error } = await supabase.rpc(process.env.SUPABASE_SQL_RPC_NAME, { query: rlsCatalogSql });
  assert.ifError(error);

  const allowlist = new Set([...publicWriteExceptions, ...directClientDenylist]);
  const rows = Array.isArray(data) ? data : [];
  const missingRls = rows
    .filter((row) => !allowlist.has(String(row.table_name).toLowerCase()))
    .filter((row) => row.rls_enabled !== true)
    .map((row) => row.table_name);

  assert.deepEqual(missingRls, []);
});
