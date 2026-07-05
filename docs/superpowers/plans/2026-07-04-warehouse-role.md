# Warehouse Role Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish wiring the already-half-built `warehouse` role (backend `warehouse.js`/`warehouse-locations.js` already gate on it, but it's missing from the DB, other route files, and the entire frontend) so a Warehouse-role user can log in, see only Dashboard + the Inventory nav group, and perform inventory floor tasks (restock, adjust, spoilage, lot tracking, cycle counts, transfers) without touching purchasing decisions, kit recipes, cost/pricing fields, or anything outside Inventory.

**Architecture:** No new subsystems — this extends the existing role-string-based RBAC. Three layers, all string-driven by the literal value `'warehouse'`: (1) a Postgres CHECK constraint on `users.role`, (2) Express route guards (`requireRole(...)`) per backend route file, (3) a React nav-config (`roles` arrays) plus a couple of hardcoded role lists in `UsersPage.tsx`.

**Tech Stack:** Supabase/Postgres migrations, Express + Zod (backend), React + TypeScript + Vitest (frontend), `node:test` (backend tests).

## Global Constraints

- The role string is exactly `'warehouse'` (lowercase), matching the existing `WAREHOUSE_ROLES` constant already present in `backend/routes/warehouse.js` and `backend/routes/warehouse-locations.js`.
- Do not change behavior for any existing role (`superadmin`, `admin`, `manager`, `driver`, `rep`) except the two named exceptions in Task 2 (Manager gains Lot Trace / Lot Movements Report access, which was a gap even before this change).
- `warehouse` must NOT be added to the linear `hasRole()` hierarchy in `frontend-v2/src/lib/api.ts` — leave that function and its `order` array untouched. (`hasRole('warehouse', 'manager')` already correctly evaluates `false` because `Array.prototype.indexOf` returns `-1` for a value not in the array, and `-1 >= 3` is `false` — no code change needed there, and none should be made.)
- No cost/pricing field edit access for `warehouse` (`canEditCosts` in `InventoryPage.tsx` stays `hasRole(getUserRole(), 'manager')`, untouched).
- Follow the spec exactly: `docs/superpowers/specs/2026-07-04-warehouse-role-design.md`.

---

### Task 1: Database migration — allow `warehouse` in `users.role`

**Files:**
- Create: `supabase/migrations/20260704010000_add_warehouse_role.sql`

**Interfaces:**
- Produces: a `users_role_check` CHECK constraint that accepts `'warehouse'` in addition to the four existing values. No other task depends on this file's exact content, only on the constraint accepting the new value.

- [ ] **Step 1: Create the migration file**

```sql
-- ================================================================
-- Migration: 20260704010000_add_warehouse_role
-- Adds 'warehouse' to the users.role CHECK constraint. This role
-- is already referenced by backend/routes/warehouse.js and
-- backend/routes/warehouse-locations.js (WAREHOUSE_ROLES constant)
-- but was never added to the database, so creating a user with
-- this role has been rejected until now.
-- ================================================================

DO $$
BEGIN
  ALTER TABLE public.users
    DROP CONSTRAINT IF EXISTS users_role_check;

  ALTER TABLE public.users
    DROP CONSTRAINT IF EXISTS "users_role_check1";
EXCEPTION WHEN others THEN
  NULL; -- ignore if no constraint existed
END $$;

ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('superadmin', 'admin', 'manager', 'driver', 'warehouse'));
```

- [ ] **Step 2: Verify the migration file is syntactically consistent with its predecessor**

Run: `diff <(grep -o "CHECK (role IN ([^)]*" supabase/migrations/20260510000300_superadmin_schema_fixes.sql) <(grep -o "CHECK (role IN ([^)]*" supabase/migrations/20260704010000_add_warehouse_role.sql)`
Expected: a diff showing only the added `, 'warehouse'` — confirms the new file follows the same constraint-naming convention (`users_role_check`) as the migration it supersedes.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260704010000_add_warehouse_role.sql
git commit -m "feat(db): allow warehouse role in users.role constraint"
```

---

### Task 2: Backend — validation schema + route-guard grants

**Files:**
- Modify: `backend/lib/users-schemas.js:3`
- Modify: `backend/routes/inventory.js` (12 `requireRole` call sites, listed below)
- Modify: `backend/routes/lots.js` (3 call sites)
- Modify: `backend/routes/cycle-counts.js` (3 call sites)
- Modify: `backend/routes/kits.js` (splits one shared `kitRoles` constant into two)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: every endpoint listed in the spec's Section C table now accepts a JWT with `role: 'warehouse'` where the spec says "Yes"; every endpoint listed "No" is untouched. Task 3's tests assert on this.

- [ ] **Step 1: Add `warehouse` to the backend role-validation enum**

In `backend/lib/users-schemas.js`, change line 3:

```javascript
// Before
const USER_ROLES = ['admin', 'manager', 'driver'];

// After
const USER_ROLES = ['admin', 'manager', 'driver', 'warehouse'];
```

- [ ] **Step 2: Grant `warehouse` on `backend/routes/inventory.js`**

Apply these 12 exact one-line replacements (each `old_string` is unique in the file because the route path differs):

```javascript
// Line 224 — create item
// Before: router.post('/', authenticateToken, requireRole('admin', 'manager'), validateBody(inventoryCreateBodySchema), async (req, res) => {
// After:
router.post('/', authenticateToken, requireRole('admin', 'manager', 'warehouse'), validateBody(inventoryCreateBodySchema), async (req, res) => {
```

```javascript
// Line 286 — low-stock list (supports the Inventory Overview reorder banner)
// Before: router.get('/low-stock', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
// After:
router.get('/low-stock', authenticateToken, requireRole('admin', 'manager', 'warehouse'), async (req, res) => {
```

```javascript
// Line 535 — create lot
// Before: router.post('/lots', authenticateToken, requireRole('admin', 'manager'), validateBody(inventoryLotCreateBodySchema), async (req, res) => {
// After:
router.post('/lots', authenticateToken, requireRole('admin', 'manager', 'warehouse'), validateBody(inventoryLotCreateBodySchema), async (req, res) => {
```

```javascript
// Line 608 — patch lot
// Before: router.patch('/lots/:lotId', authenticateToken, requireRole('admin', 'manager'), validateBody(inventoryLotPatchBodySchema), async (req, res) => {
// After:
router.patch('/lots/:lotId', authenticateToken, requireRole('admin', 'manager', 'warehouse'), validateBody(inventoryLotPatchBodySchema), async (req, res) => {
```

```javascript
// Line 618 — deplete lot
// Before: router.post('/lots/:lotId/deplete', authenticateToken, requireRole('admin', 'manager'), validateBody(inventoryLotDepleteBodySchema), async (req, res) => {
// After:
router.post('/lots/:lotId/deplete', authenticateToken, requireRole('admin', 'manager', 'warehouse'), validateBody(inventoryLotDepleteBodySchema), async (req, res) => {
```

```javascript
// Line 661 — delete lot
// Before: router.delete('/lots/:lotId', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
// After:
router.delete('/lots/:lotId', authenticateToken, requireRole('admin', 'manager', 'warehouse'), async (req, res) => {
```

```javascript
// Line 670 — post a physical count
// Before: router.post('/count', authenticateToken, requireRole('admin', 'manager'), validateBody(inventoryCountBodySchema), async (req, res) => {
// After:
router.post('/count', authenticateToken, requireRole('admin', 'manager', 'warehouse'), validateBody(inventoryCountBodySchema), async (req, res) => {
```

```javascript
// Line 713 — restock
// Before: router.post('/:id/restock', authenticateToken, requireRole('admin', 'manager'), validateBody(inventoryRestockBodySchema), async (req, res) => {
// After:
router.post('/:id/restock', authenticateToken, requireRole('admin', 'manager', 'warehouse'), validateBody(inventoryRestockBodySchema), async (req, res) => {
```

```javascript
// Line 747 — adjust
// Before: router.post('/:id/adjust', authenticateToken, requireRole('admin', 'manager'), validateBody(inventoryAdjustBodySchema), async (req, res) => {
// After:
router.post('/:id/adjust', authenticateToken, requireRole('admin', 'manager', 'warehouse'), validateBody(inventoryAdjustBodySchema), async (req, res) => {
```

```javascript
// Line 770 — pick
// Before: router.post('/:id/pick', authenticateToken, requireRole('admin', 'manager'), validateBody(inventoryPickBodySchema), async (req, res) => {
// After:
router.post('/:id/pick', authenticateToken, requireRole('admin', 'manager', 'warehouse'), validateBody(inventoryPickBodySchema), async (req, res) => {
```

```javascript
// Line 834 — spoilage
// Before: router.post('/:id/spoilage', authenticateToken, requireRole('admin', 'manager'), validateBody(inventorySpoilageBodySchema), async (req, res) => {
// After:
router.post('/:id/spoilage', authenticateToken, requireRole('admin', 'manager', 'warehouse'), validateBody(inventorySpoilageBodySchema), async (req, res) => {
```

```javascript
// Line 858 — transfer
// Before: router.post('/transfer', authenticateToken, requireRole('admin', 'manager'), validateBody(inventoryTransferBodySchema), async (req, res) => {
// After:
router.post('/transfer', authenticateToken, requireRole('admin', 'manager', 'warehouse'), validateBody(inventoryTransferBodySchema), async (req, res) => {
```

```javascript
// Line 1155 — edit item
// Before: router.patch('/:id', authenticateToken, requireRole('admin', 'manager'), validateBody(inventoryProductPatchBodySchema), async (req, res) => {
// After:
router.patch('/:id', authenticateToken, requireRole('admin', 'manager', 'warehouse'), validateBody(inventoryProductPatchBodySchema), async (req, res) => {
```

Do **not** touch these `inventory.js` lines (they must stay `requireRole('admin', 'manager')` exactly as-is): line 402 (`/alerts/send`), line 461 (`/ai-analysis`), line 884 (`/adjust-shortage`), line 933 (`/return`), line 1084 (`/:id/reorder-alert`), line 1236 (`DELETE /:id`).

- [ ] **Step 3: Grant `warehouse` on `backend/routes/lots.js`**

```javascript
// Before: router.post('/', authenticateToken, requireRole('admin', 'manager'), validateBody(lotCreateBodySchema), async (req, res) => {
// After:
router.post('/', authenticateToken, requireRole('admin', 'manager', 'warehouse'), validateBody(lotCreateBodySchema), async (req, res) => {
```

```javascript
// Before: router.get('/:lotNumber/trace', authenticateToken, requireRole('admin'), async (req, res) => {
// After:
router.get('/:lotNumber/trace', authenticateToken, requireRole('admin', 'manager', 'warehouse'), async (req, res) => {
```

```javascript
// Before: router.get('/traceability/report', authenticateToken, requireRole('admin'), async (req, res) => {
// After:
router.get('/traceability/report', authenticateToken, requireRole('admin', 'manager', 'warehouse'), async (req, res) => {
```

Do **not** touch `POST /:lotNumber/notice` (line 247) or `PATCH /products/:itemNumber/ftl` (line 292) — both stay `requireRole('admin')`.

- [ ] **Step 4: Grant `warehouse` on `backend/routes/cycle-counts.js`**

```javascript
// Before: router.post('/', authenticateToken, requireRole('admin', 'manager'), validateBody(startCountSchema), async (req, res) => {
// After:
router.post('/', authenticateToken, requireRole('admin', 'manager', 'warehouse'), validateBody(startCountSchema), async (req, res) => {
```

```javascript
// Before: router.patch('/:id/items', authenticateToken, requireRole('admin', 'manager'), validateParams(countParamsSchema), validateBody(submitItemsSchema), async (req, res) => {
// After:
router.patch('/:id/items', authenticateToken, requireRole('admin', 'manager', 'warehouse'), validateParams(countParamsSchema), validateBody(submitItemsSchema), async (req, res) => {
```

```javascript
// Before: router.post('/:id/commit', authenticateToken, requireRole('admin', 'manager'), validateParams(countParamsSchema), async (req, res) => {
// After:
router.post('/:id/commit', authenticateToken, requireRole('admin', 'manager', 'warehouse'), validateParams(countParamsSchema), async (req, res) => {
```

- [ ] **Step 5: Split `kits.js`'s role gate into view-only vs. write**

In `backend/routes/kits.js`, replace the single shared constant (currently line 19):

```javascript
// Before
const kitRoles = requireRole('admin', 'manager');
```

```javascript
// After
const kitRoles = requireRole('admin', 'manager');
const kitViewRoles = requireRole('admin', 'manager', 'warehouse');
```

Then change the two read-only routes to use `kitViewRoles` (leave `POST /recipes` and `POST /process` on `kitRoles`, unchanged):

```javascript
// Before: router.get('/recipes', authenticateToken, kitRoles, async (req, res) => {
// After:
router.get('/recipes', authenticateToken, kitViewRoles, async (req, res) => {
```

```javascript
// Before: router.get('/runs', authenticateToken, kitRoles, async (req, res) => {
// After:
router.get('/runs', authenticateToken, kitViewRoles, async (req, res) => {
```

- [ ] **Step 6: Sanity-check no stray edits with a diff review**

Run: `git diff --stat backend/`
Expected: exactly 4 files changed (`users-schemas.js`, `inventory.js`, `lots.js`, `cycle-counts.js`, `kits.js` — 5 files). Read the full diff (`git diff backend/`) and confirm every hunk matches one of the snippets above — no other lines touched.

- [ ] **Step 7: Commit**

```bash
git add backend/lib/users-schemas.js backend/routes/inventory.js backend/routes/lots.js backend/routes/cycle-counts.js backend/routes/kits.js
git commit -m "feat(backend): grant warehouse role access to inventory, lot-tracking, and cycle-count endpoints"
```

---

### Task 3: Backend tests proving the warehouse grants

**Files:**
- Create: `backend/tests/warehouse-role-schema.test.js`
- Create: `backend/tests/warehouse-role.test.js`

**Interfaces:**
- Consumes: the migration file from Task 1 and the route files from Task 2 (read as plain text and/or exercised over HTTP — no new exports).

- [ ] **Step 1: Write the source-marker test (mirrors the existing `sales-rep-schema.test.js` pattern)**

Create `backend/tests/warehouse-role-schema.test.js`:

```javascript
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..', '..');

function source(...parts) {
  return fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');
}

test('users_role_check constraint includes warehouse', () => {
  const migration = source('supabase', 'migrations', '20260704010000_add_warehouse_role.sql');
  assert.ok(migration.includes("CHECK (role IN ('superadmin', 'admin', 'manager', 'driver', 'warehouse'))"));
});

test('USER_ROLES validation array includes warehouse', () => {
  const schemas = source('backend', 'lib', 'users-schemas.js');
  assert.ok(schemas.includes("const USER_ROLES = ['admin', 'manager', 'driver', 'warehouse'];"));
});

test('inventory.js grants warehouse on the intended endpoints only', () => {
  const routeSource = source('backend', 'routes', 'inventory.js');
  const grantedMarkers = [
    "router.post('/', authenticateToken, requireRole('admin', 'manager', 'warehouse')",
    "router.get('/low-stock', authenticateToken, requireRole('admin', 'manager', 'warehouse')",
    "router.post('/lots', authenticateToken, requireRole('admin', 'manager', 'warehouse')",
    "router.patch('/lots/:lotId', authenticateToken, requireRole('admin', 'manager', 'warehouse')",
    "router.post('/lots/:lotId/deplete', authenticateToken, requireRole('admin', 'manager', 'warehouse')",
    "router.delete('/lots/:lotId', authenticateToken, requireRole('admin', 'manager', 'warehouse')",
    "router.post('/count', authenticateToken, requireRole('admin', 'manager', 'warehouse')",
    "router.post('/:id/restock', authenticateToken, requireRole('admin', 'manager', 'warehouse')",
    "router.post('/:id/adjust', authenticateToken, requireRole('admin', 'manager', 'warehouse')",
    "router.post('/:id/pick', authenticateToken, requireRole('admin', 'manager', 'warehouse')",
    "router.post('/:id/spoilage', authenticateToken, requireRole('admin', 'manager', 'warehouse')",
    "router.post('/transfer', authenticateToken, requireRole('admin', 'manager', 'warehouse')",
    "router.patch('/:id', authenticateToken, requireRole('admin', 'manager', 'warehouse')",
  ];
  for (const marker of grantedMarkers) {
    assert.ok(routeSource.includes(marker), `Expected inventory.js to include: ${marker}`);
  }

  const untouchedMarkers = [
    "router.post('/adjust-shortage', authenticateToken, requireRole('admin', 'manager')",
    "router.post('/return', authenticateToken, requireRole('admin', 'manager')",
    "router.delete('/:id', authenticateToken, requireRole('admin', 'manager')",
  ];
  for (const marker of untouchedMarkers) {
    assert.ok(routeSource.includes(marker), `Expected inventory.js to still exclude warehouse from: ${marker}`);
  }
});

test('lots.js opens trace/report to manager and warehouse, leaves notice/ftl admin-only', () => {
  const routeSource = source('backend', 'routes', 'lots.js');
  assert.ok(routeSource.includes("router.get('/:lotNumber/trace', authenticateToken, requireRole('admin', 'manager', 'warehouse')"));
  assert.ok(routeSource.includes("router.get('/traceability/report', authenticateToken, requireRole('admin', 'manager', 'warehouse')"));
  assert.ok(routeSource.includes("router.post('/', authenticateToken, requireRole('admin', 'manager', 'warehouse')"));
  assert.ok(routeSource.includes("router.post('/:lotNumber/notice', authenticateToken, requireRole('admin')"));
  assert.ok(routeSource.includes("router.patch('/products/:itemNumber/ftl', authenticateToken, requireRole('admin')"));
});

test('cycle-counts.js grants warehouse on all three endpoints', () => {
  const routeSource = source('backend', 'routes', 'cycle-counts.js');
  assert.ok(routeSource.includes("router.post('/', authenticateToken, requireRole('admin', 'manager', 'warehouse')"));
  assert.ok(routeSource.includes("router.patch('/:id/items', authenticateToken, requireRole('admin', 'manager', 'warehouse')"));
  assert.ok(routeSource.includes("router.post('/:id/commit', authenticateToken, requireRole('admin', 'manager', 'warehouse')"));
});

test('kits.js keeps recipe/process creation manager-only but opens viewing to warehouse', () => {
  const routeSource = source('backend', 'routes', 'kits.js');
  assert.ok(routeSource.includes("const kitViewRoles = requireRole('admin', 'manager', 'warehouse');"));
  assert.ok(routeSource.includes("router.get('/recipes', authenticateToken, kitViewRoles"));
  assert.ok(routeSource.includes("router.get('/runs', authenticateToken, kitViewRoles"));
  assert.ok(routeSource.includes("router.post('/recipes', authenticateToken, kitRoles"));
  assert.ok(routeSource.includes("router.post('/process', authenticateToken, kitRoles"));
});
```

- [ ] **Step 2: Run the marker test**

Run: `cd backend && node --test tests/warehouse-role-schema.test.js`
Expected: all 6 tests PASS (Task 2 already made these edits, so this is confirmation, not red-green).

- [ ] **Step 3: Write the HTTP behavioral test**

Create `backend/tests/warehouse-role.test.js`, adapting the harness pattern from `backend/tests/cycle-counts.test.js`:

```javascript
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');

function clearBackendModuleCache() {
  for (const key of Object.keys(require.cache)) {
    if (
      key.includes(`${path.sep}backend${path.sep}services${path.sep}supabase.js`) ||
      key.includes(`${path.sep}backend${path.sep}middleware${path.sep}auth.js`) ||
      key.includes(`${path.sep}backend${path.sep}routes${path.sep}inventory.js`) ||
      key.includes(`${path.sep}backend${path.sep}routes${path.sep}lots.js`) ||
      key.includes(`${path.sep}backend${path.sep}routes${path.sep}kits.js`) ||
      key.includes(`${path.sep}backend${path.sep}services${path.sep}inventory-ledger.js`)
    ) {
      delete require.cache[key];
    }
  }
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function withWarehouseApp(fn) {
  const previousBackupPath = process.env.NODEROUTE_BACKUP_PATH;
  const previousForceDemoMode = process.env.NODEROUTE_FORCE_DEMO_MODE;
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-warehouse-role-'));

  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  clearBackendModuleCache();

  let server;
  try {
    const { supabase } = require('../services/supabase');
    const inventoryRouter = require('../routes/inventory');
    const lotsRouter = require('../routes/lots');
    const kitsRouter = require('../routes/kits');
    const jwtSecret = process.env.JWT_SECRET || 'noderoute-dev-secret-change-in-production';

    await supabase.from('users').insert([{
      id: 'warehouse-worker',
      name: 'Warehouse Worker',
      email: 'warehouse-worker@noderoute.test',
      role: 'warehouse',
      status: 'active',
      company_id: 'company-warehouse-role',
      location_id: 'location-warehouse-role',
    }]);
    await supabase.from('products').insert([{
      id: 'product-warehouse-role-salmon',
      item_number: 'SAL-WHROLE',
      description: 'Warehouse Role Test Salmon',
      name: 'Warehouse Role Test Salmon',
      unit: 'lb',
      on_hand_qty: 10,
      cost: 5,
      company_id: 'company-warehouse-role',
      location_id: 'location-warehouse-role',
    }]);

    const app = express();
    app.use(express.json());
    app.use('/api/inventory', inventoryRouter);
    app.use('/api/lots', lotsRouter);
    app.use('/api/kits', kitsRouter);
    server = await listen(app);

    await fn({
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      supabase,
      token: jwt.sign({ userId: 'warehouse-worker' }, jwtSecret, { expiresIn: '1h' }),
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (previousBackupPath === undefined) delete process.env.NODEROUTE_BACKUP_PATH;
    else process.env.NODEROUTE_BACKUP_PATH = previousBackupPath;
    if (previousForceDemoMode === undefined) delete process.env.NODEROUTE_FORCE_DEMO_MODE;
    else process.env.NODEROUTE_FORCE_DEMO_MODE = previousForceDemoMode;
    clearBackendModuleCache();
    fs.rmSync(backupPath, { recursive: true, force: true });
  }
}

test('warehouse role can restock inventory', async () => {
  await withWarehouseApp(async ({ baseUrl, token }) => {
    const res = await fetch(`${baseUrl}/api/inventory/SAL-WHROLE/restock`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ qty: 5 }),
    });
    assert.equal(res.status, 200, await res.text());
  });
});

test('warehouse role can trace a lot and pull the traceability report', async () => {
  await withWarehouseApp(async ({ baseUrl, token }) => {
    const trace = await fetch(`${baseUrl}/api/lots/SAL-WHROLE-DOES-NOT-EXIST/trace`, {
      headers: authHeaders(token),
    });
    // Not-found is fine here — the point is the role gate lets the request
    // through to the handler instead of stopping it with 403.
    assert.notEqual(trace.status, 403);

    const report = await fetch(`${baseUrl}/api/lots/traceability/report`, {
      headers: authHeaders(token),
    });
    assert.notEqual(report.status, 403);
  });
});

test('warehouse role can view kit recipes but cannot create one', async () => {
  await withWarehouseApp(async ({ baseUrl, token }) => {
    const view = await fetch(`${baseUrl}/api/kits/recipes`, { headers: authHeaders(token) });
    assert.equal(view.status, 200, await view.text());

    const create = await fetch(`${baseUrl}/api/kits/recipes`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        name: 'Should be rejected',
        output_product_id: 'x',
        output_qty: 1,
        output_uom: 'ea',
        items: [{ input_product_id: 'product-warehouse-role-salmon', input_qty: 1, input_uom: 'lb' }],
      }),
    });
    assert.equal(create.status, 403);
  });
});
```

- [ ] **Step 4: Run the behavioral test and confirm it passes**

Run: `cd backend && node --test tests/warehouse-role.test.js`
Expected: all 3 tests PASS.

- [ ] **Step 5: Run the full backend test suite to confirm no regressions**

Run: `cd backend && npm test`
Expected: all existing tests still PASS, plus the new ones from this task.

- [ ] **Step 6: Commit**

```bash
git add backend/tests/warehouse-role-schema.test.js backend/tests/warehouse-role.test.js
git commit -m "test(backend): cover warehouse role grants across inventory, lots, kits"
```

---

### Task 4: Frontend `Role` type unions

**Files:**
- Modify: `frontend-v2/src/lib/nav.ts:23`
- Modify: `frontend-v2/src/lib/api.ts` (the `Role` type and `getUserRole()`)
- Modify: `frontend-v2/src/hooks/useUsers.ts:4`

**Interfaces:**
- Produces: `Role` (all three files) now includes the literal `'warehouse'`, and `getUserRole()` recognizes it instead of falling through to `'unknown'`.

- [ ] **Step 1: Update `nav.ts`**

```typescript
// Before (line 23)
export type Role = 'superadmin' | 'admin' | 'manager' | 'driver' | 'rep' | string;

// After
export type Role = 'superadmin' | 'admin' | 'manager' | 'driver' | 'rep' | 'warehouse' | string;
```

- [ ] **Step 2: Update `api.ts`**

```typescript
// Before
export type Role = 'superadmin' | 'admin' | 'manager' | 'driver' | 'rep' | 'unknown';

// After
export type Role = 'superadmin' | 'admin' | 'manager' | 'driver' | 'rep' | 'warehouse' | 'unknown';
```

```typescript
// Before
export function getUserRole(): Role {
  try {
    const raw = localStorage.getItem('nr_user');
    if (!raw) return 'unknown';
    const parsed = JSON.parse(raw);
    const role = String(parsed?.role || '').toLowerCase();
    if (role === 'superadmin' || role === 'admin' || role === 'manager' || role === 'driver' || role === 'rep') {
      return role as Role;
    }
  } catch { return 'unknown'; }
  return 'unknown';
}

// After
export function getUserRole(): Role {
  try {
    const raw = localStorage.getItem('nr_user');
    if (!raw) return 'unknown';
    const parsed = JSON.parse(raw);
    const role = String(parsed?.role || '').toLowerCase();
    if (role === 'superadmin' || role === 'admin' || role === 'manager' || role === 'driver' || role === 'rep' || role === 'warehouse') {
      return role as Role;
    }
  } catch { return 'unknown'; }
  return 'unknown';
}
```

Leave `hasRole()` and its `order` array in this same file completely untouched (see Global Constraints).

- [ ] **Step 3: Update `useUsers.ts`**

```typescript
// Before (line 4)
export type Role = 'superadmin' | 'admin' | 'manager' | 'driver' | 'rep';

// After
export type Role = 'superadmin' | 'admin' | 'manager' | 'driver' | 'rep' | 'warehouse';
```

- [ ] **Step 4: Typecheck**

Run: `cd frontend-v2 && npx tsc --noEmit`
Expected: no new errors (this task only widens union types, which is additive and should not break existing call sites).

- [ ] **Step 5: Commit**

```bash
git add frontend-v2/src/lib/nav.ts frontend-v2/src/lib/api.ts frontend-v2/src/hooks/useUsers.ts
git commit -m "feat(frontend): add warehouse to the Role type unions"
```

---

### Task 5: Sidebar nav gating for the Warehouse role

**Files:**
- Modify: `frontend-v2/src/lib/nav.ts` (the `navGroups` array)
- Modify: `frontend-v2/src/lib/nav.test.ts`

**Interfaces:**
- Consumes: `Role` type from Task 4 (already includes `'warehouse'`); `canAccess`/`canAccessGroup`/`allNavItems`/`NAV_ITEM_IDS` already exported by `nav.ts` (unchanged signatures).
- Produces: nothing new is exported — this task only changes data (the `roles` arrays on existing `NavItem` objects).

- [ ] **Step 1: Write the failing test**

Add to `frontend-v2/src/lib/nav.test.ts` (append a new `describe` block after the existing `canAccess` block):

```typescript
describe('warehouse role scoping', () => {
  const inventoryGroupItemIds = ['inventory', 'kits', 'purchasing', 'warehouse', 'traceability'];
  const hiddenItemIds = [
    'orders', 'routes', 'map',
    'customers', 'vendors', 'sales-rep', 'phone-orders',
    'financials', 'pricing', 'invoices', 'credit-hold',
    'analytics', 'dashboard-builder', 'dsr', 'forecasting', 'reports', 'ai-help',
    'superadmin', 'users', 'companies', 'settings', 'integrations', 'compliance', 'planning', 'audit-log',
  ];

  it('can access Dashboard and every item in the Inventory group', () => {
    const dashboard = allNavItems.find((i) => i.id === 'dashboard')!;
    expect(canAccess(dashboard, 'warehouse')).toBe(true);
    for (const id of inventoryGroupItemIds) {
      const item = allNavItems.find((i) => i.id === id)!;
      expect(canAccess(item, 'warehouse')).toBe(true);
    }
  });

  it('cannot access Dispatch, Customers, Financials, Insights, or Admin items', () => {
    for (const id of hiddenItemIds) {
      const item = allNavItems.find((i) => i.id === id)!;
      expect(canAccess(item, 'warehouse')).toBe(false);
    }
  });

  it('sees only Dashboard and Inventory in the group listing', () => {
    const visibleGroupLabels = navGroups
      .filter((g) => canAccessGroup(g, 'warehouse'))
      .map((g) => g.label);
    expect(visibleGroupLabels).toEqual(['', 'Inventory']);
  });
});
```

This requires importing `canAccessGroup` — update the top import line:

```typescript
// Before
import { canAccess, findNavItem, navGroups, navRedirects, allNavItems, defaultPath, NAV_ITEM_IDS } from './nav';

// After
import { canAccess, canAccessGroup, findNavItem, navGroups, navRedirects, allNavItems, defaultPath, NAV_ITEM_IDS } from './nav';
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd frontend-v2 && npx vitest run src/lib/nav.test.ts`
Expected: FAIL — the new `warehouse role scoping` tests fail because every item in `hiddenItemIds` currently has no `roles` restriction (so `canAccess` returns `true` for all of them today).

- [ ] **Step 3: Add `roles` arrays to `nav.ts`, restricting the non-inventory groups**

In the `dispatch` group, add `roles: ['admin', 'manager', 'driver', 'rep']` to all three items:

```typescript
// Before
  {
    id: 'dispatch',
    label: 'Dispatch',
    items: [
      { id: NAV_ITEM_IDS.orders, label: 'Orders', path: '/orders', icon: Package, component: OrdersPage },
      { id: NAV_ITEM_IDS.routes, label: 'Routes', path: '/routes', icon: Map, component: RoutesPage },
      { id: NAV_ITEM_IDS.map, label: 'Map', path: '/map', icon: Globe2, component: MapPage },
    ],
  },

// After
  {
    id: 'dispatch',
    label: 'Dispatch',
    items: [
      { id: NAV_ITEM_IDS.orders, label: 'Orders', path: '/orders', icon: Package, component: OrdersPage, roles: ['admin', 'manager', 'driver', 'rep'] },
      { id: NAV_ITEM_IDS.routes, label: 'Routes', path: '/routes', icon: Map, component: RoutesPage, roles: ['admin', 'manager', 'driver', 'rep'] },
      { id: NAV_ITEM_IDS.map, label: 'Map', path: '/map', icon: Globe2, component: MapPage, roles: ['admin', 'manager', 'driver', 'rep'] },
    ],
  },
```

In the `inventory` group, add `'warehouse'` to `kits`'s existing roles (leave `inventory`, `purchasing`, `warehouse`, `traceability` untouched — they stay open to everyone, which already includes `warehouse`):

```typescript
// Before
      { id: NAV_ITEM_IDS.kits, label: 'Kits', path: '/kits', icon: PackageCheck, component: KitsPage, roles: ['admin', 'manager'] },

// After
      { id: NAV_ITEM_IDS.kits, label: 'Kits', path: '/kits', icon: PackageCheck, component: KitsPage, roles: ['admin', 'manager', 'warehouse'] },
```

In the `customers` group, add `roles: ['admin', 'manager', 'driver', 'rep']` to the three items that currently have no restriction (leave `phoneOrders` untouched — it's already `['admin', 'manager']`, which already excludes `warehouse`):

```typescript
// Before
  {
    id: 'customers',
    label: 'Customers',
    items: [
      { id: NAV_ITEM_IDS.customers, label: 'Customers', path: '/customers', icon: Users, component: CustomersPage },
      { id: NAV_ITEM_IDS.vendors, label: 'Vendors', path: '/vendors', icon: Handshake, component: VendorsPage },
      { id: NAV_ITEM_IDS.salesRep, label: 'Sales Rep', path: '/sales-rep', icon: Briefcase, component: SalesRepPage },
      { id: NAV_ITEM_IDS.phoneOrders, label: 'Phone Orders', path: '/phone-orders', icon: Phone, component: PhoneOrdersPage, roles: ['admin', 'manager'] },
    ],
  },

// After
  {
    id: 'customers',
    label: 'Customers',
    items: [
      { id: NAV_ITEM_IDS.customers, label: 'Customers', path: '/customers', icon: Users, component: CustomersPage, roles: ['admin', 'manager', 'driver', 'rep'] },
      { id: NAV_ITEM_IDS.vendors, label: 'Vendors', path: '/vendors', icon: Handshake, component: VendorsPage, roles: ['admin', 'manager', 'driver', 'rep'] },
      { id: NAV_ITEM_IDS.salesRep, label: 'Sales Rep', path: '/sales-rep', icon: Briefcase, component: SalesRepPage, roles: ['admin', 'manager', 'driver', 'rep'] },
      { id: NAV_ITEM_IDS.phoneOrders, label: 'Phone Orders', path: '/phone-orders', icon: Phone, component: PhoneOrdersPage, roles: ['admin', 'manager'] },
    ],
  },
```

In the `financials` group, add `roles: ['admin', 'manager', 'driver', 'rep']` to `financials` and `invoices` (leave `pricing` and `creditHold` untouched — already `['admin', 'manager']`):

```typescript
// Before
  {
    id: 'financials',
    label: 'Financials',
    items: [
      { id: NAV_ITEM_IDS.financials, label: 'Financials', path: '/financials', icon: DollarSign, component: FinancialsPage },
      { id: NAV_ITEM_IDS.pricing, label: 'Pricing', path: '/pricing', icon: DollarSign, component: PricingPage, roles: ['admin', 'manager'] },
      { id: NAV_ITEM_IDS.invoices, label: 'Invoices', path: '/invoices', icon: Receipt, component: InvoicesPage },
      { id: NAV_ITEM_IDS.creditHold, label: 'Credit Hold', path: '/credit-hold', icon: Lock, component: CreditHoldPage, roles: ['admin', 'manager'] },
    ],
  },

// After
  {
    id: 'financials',
    label: 'Financials',
    items: [
      { id: NAV_ITEM_IDS.financials, label: 'Financials', path: '/financials', icon: DollarSign, component: FinancialsPage, roles: ['admin', 'manager', 'driver', 'rep'] },
      { id: NAV_ITEM_IDS.pricing, label: 'Pricing', path: '/pricing', icon: DollarSign, component: PricingPage, roles: ['admin', 'manager'] },
      { id: NAV_ITEM_IDS.invoices, label: 'Invoices', path: '/invoices', icon: Receipt, component: InvoicesPage, roles: ['admin', 'manager', 'driver', 'rep'] },
      { id: NAV_ITEM_IDS.creditHold, label: 'Credit Hold', path: '/credit-hold', icon: Lock, component: CreditHoldPage, roles: ['admin', 'manager'] },
    ],
  },
```

In the `insights` group, add `roles: ['admin', 'manager', 'driver', 'rep']` to `analytics`, `dsr`, `forecasting`, `reports`, `aiHelp` (leave `dashboardBuilder` untouched — already `['admin', 'manager']`):

```typescript
// Before
  {
    id: 'insights',
    label: 'Insights',
    items: [
      { id: NAV_ITEM_IDS.analytics, label: 'Analytics', path: '/analytics', icon: BarChart2, component: AnalyticsPage },
      { id: NAV_ITEM_IDS.dashboardBuilder, label: 'Dashboard Builder', path: '/dashboard/builder', icon: LayoutDashboard, component: DashboardBuilderPage, roles: ['admin', 'manager'] },
      { id: NAV_ITEM_IDS.dsr, label: 'DSR', path: '/dsr', icon: ClipboardList, component: DSRPage },
      { id: NAV_ITEM_IDS.forecasting, label: 'Forecasting', path: '/forecasting', icon: Sparkles, component: ForecastPage },
      { id: NAV_ITEM_IDS.reports, label: 'Reports', path: '/reports', icon: FileText, component: ReportsPage },
      { id: NAV_ITEM_IDS.aiHelp, label: 'AI Help', path: '/ai-help', icon: Bot, component: AIHelpPage },
    ],
  },

// After
  {
    id: 'insights',
    label: 'Insights',
    items: [
      { id: NAV_ITEM_IDS.analytics, label: 'Analytics', path: '/analytics', icon: BarChart2, component: AnalyticsPage, roles: ['admin', 'manager', 'driver', 'rep'] },
      { id: NAV_ITEM_IDS.dashboardBuilder, label: 'Dashboard Builder', path: '/dashboard/builder', icon: LayoutDashboard, component: DashboardBuilderPage, roles: ['admin', 'manager'] },
      { id: NAV_ITEM_IDS.dsr, label: 'DSR', path: '/dsr', icon: ClipboardList, component: DSRPage, roles: ['admin', 'manager', 'driver', 'rep'] },
      { id: NAV_ITEM_IDS.forecasting, label: 'Forecasting', path: '/forecasting', icon: Sparkles, component: ForecastPage, roles: ['admin', 'manager', 'driver', 'rep'] },
      { id: NAV_ITEM_IDS.reports, label: 'Reports', path: '/reports', icon: FileText, component: ReportsPage, roles: ['admin', 'manager', 'driver', 'rep'] },
      { id: NAV_ITEM_IDS.aiHelp, label: 'AI Help', path: '/ai-help', icon: Bot, component: AIHelpPage, roles: ['admin', 'manager', 'driver', 'rep'] },
    ],
  },
```

In the `admin` group, add `roles: ['admin', 'manager', 'driver', 'rep']` to `settings` and `planning` (leave `superadmin`, `users`, `companies`, `integrations`, `compliance`, `auditLog` untouched — none of their existing lists include `warehouse` already):

```typescript
// Before
      { id: NAV_ITEM_IDS.settings, label: 'Settings', path: '/settings', icon: Settings, component: SettingsPage },
      { id: 'integrations', label: 'Integrations', path: '/integrations', icon: Plug, component: IntegrationsPage, roles: ['admin'] },
      { id: NAV_ITEM_IDS.compliance, label: 'Compliance', path: '/compliance', icon: CheckSquare, component: CompliancePage, roles: ['admin', 'manager'] },
      { id: 'planning', label: 'Planning', path: '/planning', icon: Calendar, component: PlanningPage },

// After
      { id: NAV_ITEM_IDS.settings, label: 'Settings', path: '/settings', icon: Settings, component: SettingsPage, roles: ['admin', 'manager', 'driver', 'rep'] },
      { id: 'integrations', label: 'Integrations', path: '/integrations', icon: Plug, component: IntegrationsPage, roles: ['admin'] },
      { id: NAV_ITEM_IDS.compliance, label: 'Compliance', path: '/compliance', icon: CheckSquare, component: CompliancePage, roles: ['admin', 'manager'] },
      { id: 'planning', label: 'Planning', path: '/planning', icon: Calendar, component: PlanningPage, roles: ['admin', 'manager', 'driver', 'rep'] },
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd frontend-v2 && npx vitest run src/lib/nav.test.ts`
Expected: PASS — all tests including the new `warehouse role scoping` block.

- [ ] **Step 5: Run the full frontend test suite to confirm no regressions**

Run: `cd frontend-v2 && npm test`
Expected: all existing tests still PASS (in particular, re-check the existing `preserves role guards after the nav consolidation` test — it asserts exact `roles` arrays for `phone-orders` and `companies`, both of which this task leaves untouched, so it should still pass unmodified).

- [ ] **Step 6: Commit**

```bash
git add frontend-v2/src/lib/nav.ts frontend-v2/src/lib/nav.test.ts
git commit -m "feat(frontend): scope the sidebar to Dashboard + Inventory for the warehouse role"
```

---

### Task 6: Users page — invite, assign, and filter by Warehouse

**Files:**
- Modify: `frontend-v2/src/pages/UsersPage.tsx`
- Modify: `frontend-v2/src/pages/UsersPage.test.tsx`

**Interfaces:**
- Consumes: `Role` type from `useUsers.ts` (Task 4, already includes `'warehouse'`).
- Produces: nothing new exported — only behavior changes within `UsersPage`.

- [ ] **Step 1: Write the failing test**

Add to `frontend-v2/src/pages/UsersPage.test.tsx` (append a new test inside the existing `describe('UsersPage', ...)` block, after the `'filters the directory and supports role updates and removal'` test):

```typescript
  it('offers Warehouse as an assignable role and can promote a user to it', async () => {
    sendWithAuthMock.mockResolvedValue({});

    renderWithQueryClient(<UsersPage />);

    expect(await screen.findByText('Jamie Driver')).toBeInTheDocument();

    const inviteRoleSelects = screen.getAllByLabelText('Role');
    for (const select of inviteRoleSelects) {
      expect(within(select).getByRole('option', { name: 'Warehouse' })).toBeInTheDocument();
    }

    const jamieRow = screen.getByText('Jamie Driver').closest('tr') as HTMLElement | null;
    if (!jamieRow) throw new Error('Expected Jamie row');
    fireEvent.change(jamieRow.querySelector('select') as HTMLSelectElement, { target: { value: 'warehouse' } });
    await waitFor(() => {
      expect(sendWithAuthMock).toHaveBeenCalledWith('/api/users/user-2/role', 'PATCH', { role: 'warehouse' });
    });
  });
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd frontend-v2 && npx vitest run src/pages/UsersPage.test.tsx`
Expected: FAIL — `inviteRoleOptions` doesn't include `'warehouse'` yet, so the "Warehouse" option doesn't exist, and the table's role `<select>` doesn't offer it either (the row's `editable` check also excludes `role === 'warehouse'` from ever appearing editable, but `Jamie` is `'driver'` so the select renders — it just won't have a `warehouse` `<option>` to select).

- [ ] **Step 3: Add `'warehouse'` to the invite role options**

```typescript
// Before (line 70)
  const inviteRoleOptions: Role[] = canAdminister ? ['driver', 'manager', 'admin'] : ['driver', 'manager'];

// After
  const inviteRoleOptions: Role[] = canAdminister ? ['driver', 'warehouse', 'manager', 'admin'] : ['driver', 'warehouse', 'manager'];
```

(This single array drives both the "Add User" and "Send Invite" `<select>` dropdowns, which map over it and auto-capitalize the label — no other rendering change needed for those two selects.)

- [ ] **Step 4: Allow `warehouse` to be recognized and edited in the Access Directory table**

```typescript
// Before
function normalizeRole(value: string | undefined): Role {
  const role = String(value || '').trim().toLowerCase();
  if (role === 'superadmin' || role === 'admin' || role === 'manager' || role === 'driver' || role === 'rep') return role;
  return 'driver';
}

// After
function normalizeRole(value: string | undefined): Role {
  const role = String(value || '').trim().toLowerCase();
  if (role === 'superadmin' || role === 'admin' || role === 'manager' || role === 'driver' || role === 'rep' || role === 'warehouse') return role;
  return 'driver';
}
```

```typescript
// Before
                const editable = canAdminister && !self && (role === 'driver' || role === 'manager' || role === 'admin');

// After
                const editable = canAdminister && !self && (role === 'driver' || role === 'warehouse' || role === 'manager' || role === 'admin');
```

```typescript
// Before
                          <SelectInput value={role} onChange={(e) => void changeRole.mutateAsync({ id: user.id, role: e.target.value as Role })} disabled={busy} className="h-9 px-2 text-xs">
                            <option value="driver">Driver</option>
                            <option value="manager">Manager</option>
                            <option value="admin">Admin</option>
                          </SelectInput>

// After
                          <SelectInput value={role} onChange={(e) => void changeRole.mutateAsync({ id: user.id, role: e.target.value as Role })} disabled={busy} className="h-9 px-2 text-xs">
                            <option value="driver">Driver</option>
                            <option value="warehouse">Warehouse</option>
                            <option value="manager">Manager</option>
                            <option value="admin">Admin</option>
                          </SelectInput>
```

- [ ] **Step 5: Add `warehouse` to the Access Directory's role filter dropdown**

```typescript
// Before
              <SelectInput value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}>
                <option value="all">All Roles</option>
                <option value="superadmin">Superadmin</option>
                <option value="admin">Admin</option>
                <option value="manager">Manager</option>
                <option value="driver">Driver</option>
              </SelectInput>

// After
              <SelectInput value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}>
                <option value="all">All Roles</option>
                <option value="superadmin">Superadmin</option>
                <option value="admin">Admin</option>
                <option value="manager">Manager</option>
                <option value="warehouse">Warehouse</option>
                <option value="driver">Driver</option>
              </SelectInput>
```

- [ ] **Step 6: Run the test and confirm it passes**

Run: `cd frontend-v2 && npx vitest run src/pages/UsersPage.test.tsx`
Expected: PASS — all tests including the new Warehouse one.

- [ ] **Step 7: Run the full frontend test suite**

Run: `cd frontend-v2 && npm test`
Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend-v2/src/pages/UsersPage.tsx frontend-v2/src/pages/UsersPage.test.tsx
git commit -m "feat(frontend): let admins invite, assign, and filter by the Warehouse role"
```

---

### Task 7: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full backend suite**

Run: `cd backend && npm test`
Expected: all tests PASS (including the two new files from Task 3).

- [ ] **Step 2: Full frontend suite**

Run: `cd frontend-v2 && npm test`
Expected: all tests PASS (including the updates from Tasks 5 and 6).

- [ ] **Step 3: Frontend typecheck**

Run: `cd frontend-v2 && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Frontend production build**

Run: `cd frontend-v2 && npm run build`
Expected: build succeeds (confirms no dead imports or type errors slipped past the checks above).

- [ ] **Step 5: Manual smoke check (optional but recommended)**

If a local Supabase/dev environment is running: seed or patch one user's row to `role = 'warehouse'`, log in as that user, and confirm the sidebar shows only "Dashboard" and the "Inventory" group (Inventory, Kits, Purchasing, Warehouse, Traceability), and that restocking an item and tracing a lot both succeed.
