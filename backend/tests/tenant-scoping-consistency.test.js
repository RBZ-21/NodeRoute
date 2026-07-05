'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const routesDir = path.join(__dirname, '..', 'routes');

// Router-mounting shims that contain no Supabase queries of their own — verified by direct
// read during the 2026-07-04 audit. If one of these ever grows a `supabase.from(...)` call,
// this test will start failing it against the scoping check below, which is the point.
//
// Note: `portal.js` was originally assumed to be a pure mounting shim, but a direct read
// during this task found it now also handles GET /ordering-status with its own
// `supabase.from('companies')` query (scoped via req.portalContext.companyId). It has been
// moved to the standard scoped-route population below instead of this allowlist.
const PURE_MOUNTING_SHIMS = new Set(['ops.js', 'ops-purchasing.js', 'portal-payments.js']);

// Files intentionally outside the standard scopeQueryByContext()/req.context pattern, with
// their own justified scoping mechanism, verified by direct read during the 2026-07-04 audit:
const KNOWN_ALTERNATE_SCOPING = {
  'stripe-webhooks.js': 'verifies Stripe signature; not tenant-scoped by design (webhook has no user session)',
  'superadmin.js': 'superadmin-only; fail-closed sentinel gating instead of company scoping',
  'waitlist.js': 'public signup endpoint; no tenant context exists yet',
  'auth.js': 'pre-authentication login/signup flows; no tenant context exists yet',
};

function listRouteFiles() {
  return fs.readdirSync(routesDir).filter((name) => name.endsWith('.js'));
}

function fileUsesSupabaseQueries(source) {
  return /supabase\s*\.\s*from\s*\(/.test(source) || /\bdb\s*\.\s*from\s*\(/.test(source);
}

function fileHasRecognizedScoping(source) {
  return (
    source.includes('scopeQueryByContext') ||
    source.includes('req.context') ||
    source.includes('req.portalContext') ||
    source.includes('req.user.org_id') ||
    source.includes("req.user?.org_id") ||
    /\.eq\(\s*['"]company_id['"]/.test(source) ||
    /\.eq\(\s*['"]org_id['"]/.test(source)
  );
}

test('every route file with direct Supabase queries has a recognized tenant-scoping mechanism', () => {
  const unscoped = [];
  for (const file of listRouteFiles()) {
    if (PURE_MOUNTING_SHIMS.has(file)) continue;
    if (KNOWN_ALTERNATE_SCOPING[file]) continue;
    const source = fs.readFileSync(path.join(routesDir, file), 'utf8');
    if (fileUsesSupabaseQueries(source) && !fileHasRecognizedScoping(source)) {
      unscoped.push(file);
    }
  }
  assert.deepEqual(
    unscoped,
    [],
    `route files querying Supabase with no recognized tenant-scoping mechanism: ${unscoped.join(', ')}. ` +
      'If this is a new intentionally-global route, add it to KNOWN_ALTERNATE_SCOPING with a reason. ' +
      'Otherwise, add scopeQueryByContext() / req.context filtering before merging.'
  );
});

test('pure router-mounting shims stay free of direct Supabase queries', () => {
  const regressed = [];
  for (const file of PURE_MOUNTING_SHIMS) {
    const source = fs.readFileSync(path.join(routesDir, file), 'utf8');
    if (fileUsesSupabaseQueries(source)) regressed.push(file);
  }
  assert.deepEqual(
    regressed,
    [],
    `${regressed.join(', ')} now contains direct Supabase queries — remove it from PURE_MOUNTING_SHIMS ` +
      'in this test and verify it has proper tenant scoping.'
  );
});
