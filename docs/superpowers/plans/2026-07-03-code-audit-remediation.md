# Code Audit Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remediate every finding from the 2026-07-03 code audit (Security, Architecture, Code Quality, Performance, Testing, Maintainability) across the `backend/` (Express/CommonJS) and `frontend-v2/` (React/TS/Vite) workspaces.

**Architecture:** No new frameworks or patterns are introduced. Fixes extend existing conventions already present in the codebase: `scopeQueryByContext()`/`filterRowsByContext()` for tenant scoping (`backend/services/operating-context.js`), `sendSafeError()` for error responses (`backend/lib/safe-error.js`), the `node --test` + offline-demo-mode harness for backend tests (see `backend/tests/high-cross-tenant-core.test.js` for the canonical HTTP-level pattern), and Vitest/Playwright for frontend.

**Tech Stack:** Node 20+, Express 5, Supabase-js, Zod, `node:test`, React 18, Vite, TanStack Query, Vitest, Playwright.

## Global Constraints

- Backend is CommonJS (`"type": "commonjs"` in `backend/package.json`) — no ESM `import`/`export` syntax in any `backend/` file.
- Every new/modified Supabase query in `backend/routes/**` or `backend/services/**` must go through `scopeQueryByContext()` (from `backend/services/operating-context.js`) or, for portal routes, the existing `req.portalContext`-keyed helpers in `backend/routes/portal/shared.js`. Never add a new raw `.eq('company_id', ...)` without one of these.
- The backend test suite (`node --test backend/tests/*.test.js`) must stay at 0 failures after every task. Baseline going in: 474 tests, 473 passed, 1 skipped.
- Frontend lint (`npm --prefix frontend-v2 run lint`) must stay at 0 errors after every task. Baseline going in: 0 errors, 6 pre-existing warnings (do not fix unrelated warnings as a drive-by).
- No dependency upgrade marked "breaking" (`isSemVerMajor`) may be applied without an explicit task calling it out, and it must be followed by a full test run + a manual smoke check via the `run` skill.
- Commit after every task using the repo's existing convention: `type(scope): summary`, e.g. `fix(orders): paginate list endpoint`.
- Do not touch `.gitignore`, `.DS_Store`, or anything under `Reports/` — these are intentionally out of scope per prior session notes.

---

## Phase 1 — Quick Wins

### Task 1: Patch backend dependency vulnerabilities

**Files:**
- Modify: `backend/package.json`, `backend/package-lock.json` (npm-managed — this is the lockfile CI's `npm ci --prefix backend` installs from, per `.github/workflows/ci.yml:21`)

**Interfaces:** None — dependency-only change, no code touches this task.

**Revision note (superseding the original text of this task):** This repo has two independent lockfiles for the backend workspace — `backend/package-lock.json` (installed by CI via `npm ci --prefix backend`) and the root workspace lockfile (installed by the actual Railway production deploy via `npm install --include=dev` at the repo root, per `nixpacks.toml`). They had drifted: the root lockfile was already ahead and only carried 2 real vulnerabilities (`uuid`, `exceljs` — both moderate), while `backend/package-lock.json` still carried all 12, including the 3 high-severity ones (`multer`, `nodemailer`, `ws`). Verified directly: `exceljs@4.4.0` is the current latest release and pins `uuid@^8.3.0` (the vulnerable range) with no newer upstream release available — `npm audit fix --force` would downgrade `exceljs` to `3.4.0`, which is a breaking change AND introduces its own different vulnerabilities (`fast-csv`, `tmp`). There is no clean fix for the `uuid`/`exceljs` pair right now. Decision: fix the 10 that patch cleanly, leave `uuid`/`exceljs` as a documented, tracked exception, and do not force the downgrade.

- [ ] **Step 1: Confirm baseline is green**

Run: `cd "backend" && node --test tests/*.test.js`
Expected: `pass 473`, `fail 0`, `skipped 1` (matches current baseline).

- [ ] **Step 2: Confirm the fix is non-breaking for the 10 in scope**

Run: `npm --prefix backend audit fix --dry-run`
Expected output includes `12 vulnerabilities (9 moderate, 3 high)`. Confirm none of `@opentelemetry/core`, `@opentelemetry/resources`, `@opentelemetry/sdk-trace-base`, `express-rate-limit`, `ip-address`, `multer`, `nodemailer`, `qs`, `resend`, `svix`, `ws` require `--force` — only `uuid` (via its `exceljs` pin) should show `--force`/breaking-change language. If any of the other 10 now shows `--force` too, stop and re-scope — do not force a major bump silently on any of them.

- [ ] **Step 3: Apply the fix (non-forced)**

Run: `npm --prefix backend audit fix`

This resolves the 10 non-`uuid`/`exceljs` CVEs and leaves `uuid`/`exceljs` untouched (plain `audit fix` never applies a breaking change on its own).

- [ ] **Step 4: Verify exactly the 2 documented vulnerabilities remain**

Run: `npm --prefix backend audit --production`
Expected: `2 vulnerabilities (2 moderate)` — `uuid` and `exceljs`, nothing else. If any other package still shows up, the fix in Step 3 didn't fully apply — investigate before proceeding. Do NOT run `npm audit fix --force` to clear these last 2.

- [ ] **Step 5: Run the full backend suite again**

Run: `cd "backend" && node --test tests/*.test.js`
Expected: `pass 473`, `fail 0`, `skipped 1` (unchanged — this is a dependency patch, not a behavior change).

- [ ] **Step 6: Document the deferred exception**

Add a short note to this plan's "Deferred / Explicitly Out of Scope" section (at the bottom of this file) recording: `uuid`/`exceljs` (2 moderate CVEs) are deferred pending an upstream `exceljs` release that supports `uuid@>=11`; re-run `npm --prefix backend audit` periodically to check.

- [ ] **Step 7: Commit**

```bash
git add backend/package.json backend/package-lock.json docs/superpowers/plans/2026-07-03-code-audit-remediation.md
git commit -m "fix(deps): patch 3 high and 7 moderate backend CVEs; defer uuid/exceljs pending upstream fix"
```

---

### Task 2: Patch frontend dependency vulnerabilities (non-breaking subset)

**Files:**
- Modify: `frontend-v2/package.json`, `frontend-v2/package-lock.json` (npm-managed)

**Interfaces:** None — dependency-only change.

- [ ] **Step 1: Confirm baseline is green**

Run: `npm --prefix frontend-v2 run lint`
Expected: `0 errors, 6 warnings` (existing baseline — see audit report).

- [ ] **Step 2: Inspect what `audit fix` will change without `--force`**

Run: `npm --prefix frontend-v2 audit fix --dry-run`
Expected: `react-router`/`react-router-dom` (moderate, open-redirect) and `undici` (high, TLS/HTTP-injection cluster) show `fix available via npm audit fix` with no `--force` needed. `esbuild`/`vite` will show `fix available via npm audit fix --force` and "Will install vite@8.1.3, which is a breaking change" — **do not apply that one in this task.**

- [ ] **Step 3: Apply only the non-breaking fixes**

Run: `npm --prefix frontend-v2 audit fix`

This resolves `react-router`, `react-router-dom`, and `undici` without touching `vite`/`esbuild`.

- [ ] **Step 4: Verify the remaining vulnerability is only the known-deferred one**

Run: `npm --prefix frontend-v2 audit`
Expected: only `esbuild`/`vite` (moderate, dev-server-only, not shipped to production) remains. If anything else remains, stop and investigate before proceeding.

- [ ] **Step 5: Run lint and the frontend test suite**

Run: `npm --prefix frontend-v2 run lint && npm --prefix frontend-v2 run test`
Expected: lint `0 errors, 6 warnings`; test suite green (no new failures vs. baseline).

- [ ] **Step 6: Commit**

```bash
git add frontend-v2/package.json frontend-v2/package-lock.json
git commit -m "fix(deps): patch react-router open-redirect and undici CVEs in frontend-v2"
```

**Deferred, not in this task:** the `esbuild`/`vite` moderate CVE requires `vite@8.1.3` (a major bump from `^5.4.10`). It's dev-server-only exposure (doesn't ship to production bundles) — track it separately as its own upgrade task with a full manual smoke test of `npm run dev` and `npm run build`, not bundled into a dependency-patch commit.

---

### Task 3: Add pagination guard to `GET /api/orders` and `GET /api/invoices`

**Files:**
- Modify: `backend/routes/orders.js:993-998`
- Modify: `backend/routes/invoices.js:263-274`
- Test: `backend/tests/orders-invoices-list-pagination.test.js` (create)

**Interfaces:**
- Produces: `ORDERS_LIST_MAX_ROWS` (module-level const in `orders.js`, overridable via `process.env.ORDERS_LIST_MAX_ROWS`), `INVOICES_LIST_MAX_ROWS` (same pattern in `invoices.js`).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/orders-invoices-list-pagination.test.js`:

```js
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
      key.includes(`${path.sep}backend${path.sep}lib${path.sep}config.js`) ||
      key.includes(`${path.sep}backend${path.sep}routes${path.sep}orders.js`) ||
      key.includes(`${path.sep}backend${path.sep}routes${path.sep}invoices.js`)
    ) {
      delete require.cache[key];
    }
  }
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function close(server) {
  if (!server) return;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

test('GET /api/orders honors ORDERS_LIST_MAX_ROWS instead of returning every row', async () => {
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-orders-pagination-'));
  const prev = {
    NODEROUTE_BACKUP_PATH: process.env.NODEROUTE_BACKUP_PATH,
    NODEROUTE_FORCE_DEMO_MODE: process.env.NODEROUTE_FORCE_DEMO_MODE,
    JWT_SECRET: process.env.JWT_SECRET,
    ORDERS_LIST_MAX_ROWS: process.env.ORDERS_LIST_MAX_ROWS,
  };
  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  process.env.JWT_SECRET = 'orders-pagination-test-secret';
  process.env.ORDERS_LIST_MAX_ROWS = '2';
  clearBackendModuleCache();

  let server;
  try {
    const { supabase } = require('../services/supabase');
    await supabase.from('users').insert({
      id: 'pagination-admin',
      name: 'Pagination Admin',
      email: 'pagination.admin@noderoute.test',
      role: 'admin',
      status: 'active',
      company_id: 'company-pag',
      location_id: 'loc-pag',
      accessible_company_ids: ['company-pag'],
      accessible_location_ids: ['loc-pag'],
    });
    await supabase.from('orders').insert([
      { id: 'order-1', customer_name: 'A', status: 'pending', items: [], company_id: 'company-pag', location_id: 'loc-pag', created_at: '2026-01-01T00:00:00.000Z' },
      { id: 'order-2', customer_name: 'B', status: 'pending', items: [], company_id: 'company-pag', location_id: 'loc-pag', created_at: '2026-01-02T00:00:00.000Z' },
      { id: 'order-3', customer_name: 'C', status: 'pending', items: [], company_id: 'company-pag', location_id: 'loc-pag', created_at: '2026-01-03T00:00:00.000Z' },
    ]);

    const app = express();
    app.use(express.json());
    app.use('/api/orders', require('../routes/orders'));

    server = await listen(app);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const token = jwt.sign({ userId: 'pagination-admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const response = await fetch(`${baseUrl}/api/orders`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.length, 2, `expected ORDERS_LIST_MAX_ROWS=2 to cap the response, got ${body.length} rows`);
  } finally {
    await close(server);
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    clearBackendModuleCache();
    fs.rmSync(backupPath, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "backend" && node --test tests/orders-invoices-list-pagination.test.js`
Expected: FAIL — `body.length` is `3`, not `2` (no limit applied yet).

- [ ] **Step 3: Add the pagination guard to `orders.js`**

In `backend/routes/orders.js`, locate the `// ── ORDERS ──` section header just above line 993 and the handler at lines 994-998. Add the constant above the section and update the handler:

```js
// ── ORDERS ────────────────────────────────────────────────────────────────────
const ORDERS_LIST_MAX_ROWS = Number.parseInt(process.env.ORDERS_LIST_MAX_ROWS, 10) > 0
  ? Number.parseInt(process.env.ORDERS_LIST_MAX_ROWS, 10)
  : 1000;

router.get('/', authenticateToken, async (req, res) => {
  const data = await dbQuery(
    scopeQueryByContext(supabase.from('orders').select('*'), req.context)
      .order('created_at', { ascending: false })
      .limit(ORDERS_LIST_MAX_ROWS),
    res
  );
  if (!data) return;
  res.json(filterRowsByContext(data || [], req.context));
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "backend" && node --test tests/orders-invoices-list-pagination.test.js`
Expected: PASS.

- [ ] **Step 5: Apply the same pattern to `invoices.js` and extend the test**

In `backend/routes/invoices.js`, find the section above line 253 and the handler at lines 253-274. Add the constant and update the non-driver branch (do not touch the driver branch at lines 254-261, which already scopes via `loadDriverInvoiceScope`):

```js
const INVOICES_LIST_MAX_ROWS = Number.parseInt(process.env.INVOICES_LIST_MAX_ROWS, 10) > 0
  ? Number.parseInt(process.env.INVOICES_LIST_MAX_ROWS, 10)
  : 1000;

router.get('/', authenticateToken, async (req, res) => {
  if (req.user.role === 'driver') {
    try {
      const scope = await loadDriverInvoiceScope(supabase, req.user, req.context);
      return res.json(scope.invoices);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  let query = scopeQueryByContext(supabase.from('invoices').select('*'), req.context)
    .order('created_at', { ascending: false })
    .limit(INVOICES_LIST_MAX_ROWS);
  const customerId = req.query.customer_id;
  if (customerId) {
    const parsedId = parseInt(customerId, 10);
    if (!Number.isFinite(parsedId)) return res.status(400).json({ error: 'customer_id must be a number' });
    query = query.eq('customer_id', parsedId);
  }

  const data = await dbQuery(query, res);
  if (!data) return;
  res.json(filterRowsByContext(data, req.context).map(enrichInvoiceResponse));
});
```

Add a second test to the same file (after the orders test), mirroring it against `/api/invoices` with `INVOICES_LIST_MAX_ROWS=2` and 3 seeded invoices (`company_id`/`location_id: 'company-pag'/'loc-pag'`, `total: 10`, `items: []`).

- [ ] **Step 6: Run both tests, then the full suite**

Run: `cd "backend" && node --test tests/orders-invoices-list-pagination.test.js && node --test tests/*.test.js`
Expected: both new tests PASS; full suite still `pass 475, fail 0, skipped 1` (474 existing + 1 new file containing 2 tests — confirm the exact new total by reading the summary line).

- [ ] **Step 7: Commit**

```bash
git add backend/routes/orders.js backend/routes/invoices.js backend/tests/orders-invoices-list-pagination.test.js
git commit -m "perf(orders,invoices): cap list endpoints at 1000 rows to prevent unbounded responses"
```

---

### Task 4: Log fire-and-forget delivery notification failures

**Files:**
- Modify: `backend/routes/deliveries.js:650`
- Test: `backend/tests/delivery-notifications.test.js` (extend — this file already exists per the working tree)

**Interfaces:** None new — this is a one-line observability fix, no signature changes.

- [ ] **Step 1: Read the current call site to confirm context**

`backend/routes/deliveries.js:650` currently reads:
```js
    deliveryNotifications.notifyDeliveryCompleted(supabase, order.stop_id || null, order.id).catch(() => {});
```

- [ ] **Step 2: Write the failing test**

Open `backend/tests/delivery-notifications.test.js` and add (adjust the `require` paths at the top of the file to match its existing harness style — reuse whatever demo-mode setup helper that file already defines rather than duplicating one):

```js
test('delivery completion logs a warning when the notification promise rejects instead of swallowing it silently', async () => {
  const { supabase, deliveriesRouter, cleanup } = /* use this file's existing harness setup helper */;
  try {
    const originalNotify = require('../services/delivery-notifications').notifyDeliveryCompleted;
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    require('../services/delivery-notifications').notifyDeliveryCompleted = async () => {
      throw new Error('simulated notification failure');
    };

    try {
      // Trigger a delivery completion through the existing route/test fixtures in this file.
      // (Reuse whatever request this file already issues to mark an order delivered.)
    } finally {
      require('../services/delivery-notifications').notifyDeliveryCompleted = originalNotify;
      console.warn = originalWarn;
    }

    assert.ok(
      warnings.some((line) => line.includes('delivery-notify') && line.includes('simulated notification failure')),
      `expected a [delivery-notify] warning, got: ${JSON.stringify(warnings)}`
    );
  } finally {
    cleanup();
  }
});
```

Note for the implementer: `backend/tests/delivery-notifications.test.js` already has its own app-mounting/demo-mode harness (it's an existing file per the working tree diff) — read it first and slot this test into its existing helper functions rather than inventing a parallel one. The important assertion is: after the fix, a rejected notification promise produces a `console.warn` line containing `delivery-notify` and the error message.

- [ ] **Step 3: Run test to verify it fails**

Run: `cd "backend" && node --test tests/delivery-notifications.test.js`
Expected: FAIL — no warning captured, because `.catch(() => {})` currently discards the error silently.

- [ ] **Step 4: Fix the call site**

In `backend/routes/deliveries.js`, replace line 650:

```js
    deliveryNotifications.notifyDeliveryCompleted(supabase, order.stop_id || null, order.id).catch(() => {});
```

with:

```js
    deliveryNotifications.notifyDeliveryCompleted(supabase, order.stop_id || null, order.id).catch((err) => {
      console.warn('[delivery-notify] failed to notify delivery completion:', err?.message || err);
    });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd "backend" && node --test tests/delivery-notifications.test.js`
Expected: PASS.

- [ ] **Step 6: Run the full suite**

Run: `cd "backend" && node --test tests/*.test.js`
Expected: 0 failures.

- [ ] **Step 7: Commit**

```bash
git add backend/routes/deliveries.js backend/tests/delivery-notifications.test.js
git commit -m "fix(deliveries): log delivery-notification failures instead of swallowing them"
```

---

### Task 5: ~~Remove `@tauri-apps/*` from `frontend-v2`~~ — CANCELLED, premise was wrong

**Status: no action taken.** Step 1's verification (`grep -rn "@tauri-apps" frontend-v2/src`) found a real, load-bearing match at `frontend-v2/src/main.tsx:20` — a conditional dynamic import of `@tauri-apps/api/webviewWindow` used to reveal the main window and close the splashscreen when running inside a Tauri shell (`window.__TAURI_INTERNALS__`). Further investigation found `frontend-v2/src-tauri/tauri.conf.json` and `frontend-v2/.github/workflows/tauri-build.yml` — `frontend-v2` has its own independent Tauri desktop-app build pipeline. Meanwhile `ios-driver-app` has **zero** Tauri references anywhere (no config, no source usage) — the original audit finding had the two workspaces backwards.

**Corrected conclusion:** `@tauri-apps/api` and `@tauri-apps/cli` are correctly placed in `frontend-v2/package.json` exactly where they are. This was a false positive from the original maintainability audit (it didn't check for `src-tauri/` or grep frontend-v2's own source before recommending the move). No dependency relocation is needed. Task 5 is closed with no file changes.

---

## Phase 2 — Medium-Term

### Task 6: Add real endpoint test coverage for `billing.js`

**Files:**
- Create: `backend/tests/billing-route.test.js`
- Read-only reference: `backend/routes/billing.js` (no changes), `backend/services/stripe.js` (no changes)

**Interfaces:**
- Consumes: `require('../routes/billing')` (the Express router, mounted with no factory args), `require('../services/stripe')` (stubbed via `require.cache` substitution — see pattern in `backend/tests/stripe-payment-intent-webhooks.test.js:18-29`).

This does not replace `backend/tests/noderoute-billing.test.js` (the existing source-string-matching test) — it adds real HTTP-level behavior coverage alongside it.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/billing-route.test.js`:

```js
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
      key.includes(`${path.sep}backend${path.sep}services${path.sep}stripe.js`) ||
      key.includes(`${path.sep}backend${path.sep}middleware${path.sep}auth.js`) ||
      key.includes(`${path.sep}backend${path.sep}lib${path.sep}config.js`) ||
      key.includes(`${path.sep}backend${path.sep}routes${path.sep}billing.js`)
    ) {
      delete require.cache[key];
    }
  }
}

function installStripeStub({ checkoutUrl = 'https://checkout.stripe.test/session-1', sessionId = 'cs_test_1' } = {}) {
  const stripePath = require.resolve('../services/stripe');
  require.cache[stripePath] = {
    id: stripePath,
    filename: stripePath,
    loaded: true,
    exports: {
      isStripeConfigured: () => true,
      isStripeTestMode: () => true,
      stripeKeyMode: (key) => (String(key || '').startsWith('pk_test_') ? 'test' : 'missing'),
      stripeSecretKeyMode: () => 'test',
      findOrCreateCustomer: async ({ email }) => ({ id: `cus_${email}` }),
      createSubscriptionCheckoutSession: async () => ({ url: checkoutUrl, id: sessionId, livemode: false }),
    },
  };
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function close(server) {
  if (!server) return;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function withBillingHarness(run) {
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-billing-route-'));
  const prev = {
    NODEROUTE_BACKUP_PATH: process.env.NODEROUTE_BACKUP_PATH,
    NODEROUTE_FORCE_DEMO_MODE: process.env.NODEROUTE_FORCE_DEMO_MODE,
    JWT_SECRET: process.env.JWT_SECRET,
    STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY,
    NODEROUTE_STRIPE_PRICE_ID: process.env.NODEROUTE_STRIPE_PRICE_ID,
  };
  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  process.env.JWT_SECRET = 'billing-route-test-secret';
  process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_billing_route';
  process.env.NODEROUTE_STRIPE_PRICE_ID = 'price_billing_route_test';
  clearBackendModuleCache();
  installStripeStub();

  let server;
  try {
    const { supabase } = require('../services/supabase');
    await supabase.from('users').insert({
      id: 'billing-admin',
      name: 'Billing Admin',
      email: 'billing.admin@noderoute.test',
      role: 'admin',
      status: 'active',
      company_id: 'company-billing',
      location_id: 'loc-billing',
      accessible_company_ids: ['company-billing'],
      accessible_location_ids: ['loc-billing'],
    });
    await supabase.from('companies').insert({ id: 'company-billing', name: 'Billing Co' });

    const app = express();
    app.use(express.json());
    app.use('/api/billing', require('../routes/billing'));
    server = await listen(app);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const token = jwt.sign({ userId: 'billing-admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    await run({ baseUrl, token });
  } finally {
    await close(server);
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    clearBackendModuleCache();
    fs.rmSync(backupPath, { recursive: true, force: true });
  }
}

test('GET /api/billing/config reports test-mode readiness for a configured company', async () => {
  await withBillingHarness(async ({ baseUrl, token }) => {
    const response = await fetch(`${baseUrl}/api/billing/config`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.enabled, true);
    assert.equal(body.mode, 'test');
    assert.equal(body.company.id, 'company-billing');
  });
});

test('POST /api/billing/create-checkout-session returns a Stripe test-mode checkout URL', async () => {
  await withBillingHarness(async ({ baseUrl, token }) => {
    const response = await fetch(`${baseUrl}/api/billing/create-checkout-session`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.checkout_url, 'https://checkout.stripe.test/session-1');
    assert.equal(body.test_mode, true);
  });
});

test('POST /api/billing/create-checkout-session is blocked when Stripe is not configured', async () => {
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-billing-unconfigured-'));
  const prev = {
    NODEROUTE_BACKUP_PATH: process.env.NODEROUTE_BACKUP_PATH,
    NODEROUTE_FORCE_DEMO_MODE: process.env.NODEROUTE_FORCE_DEMO_MODE,
    JWT_SECRET: process.env.JWT_SECRET,
    STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY,
    NODEROUTE_STRIPE_PRICE_ID: process.env.NODEROUTE_STRIPE_PRICE_ID,
  };
  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  process.env.JWT_SECRET = 'billing-route-unconfigured-secret';
  delete process.env.STRIPE_PUBLISHABLE_KEY;
  delete process.env.NODEROUTE_STRIPE_PRICE_ID;
  clearBackendModuleCache();

  const stripePath = require.resolve('../services/stripe');
  require.cache[stripePath] = {
    id: stripePath,
    filename: stripePath,
    loaded: true,
    exports: {
      isStripeConfigured: () => false,
      isStripeTestMode: () => false,
      stripeKeyMode: () => 'missing',
      stripeSecretKeyMode: () => 'missing',
      findOrCreateCustomer: async () => { throw new Error('should not be called'); },
      createSubscriptionCheckoutSession: async () => { throw new Error('should not be called'); },
    },
  };

  let server;
  try {
    const { supabase } = require('../services/supabase');
    await supabase.from('users').insert({
      id: 'billing-admin-2', name: 'Billing Admin 2', email: 'billing.admin2@noderoute.test',
      role: 'admin', status: 'active', company_id: 'company-billing-2', location_id: 'loc-billing-2',
      accessible_company_ids: ['company-billing-2'], accessible_location_ids: ['loc-billing-2'],
    });
    await supabase.from('companies').insert({ id: 'company-billing-2', name: 'Billing Co 2' });

    const app = express();
    app.use(express.json());
    app.use('/api/billing', require('../routes/billing'));
    server = await listen(app);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const token = jwt.sign({ userId: 'billing-admin-2' }, process.env.JWT_SECRET, { expiresIn: '1h' });

    const response = await fetch(`${baseUrl}/api/billing/create-checkout-session`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 501);
    const body = await response.json();
    assert.equal(body.code, 'STRIPE_TEST_KEYS_MISSING');
  } finally {
    await close(server);
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    clearBackendModuleCache();
    fs.rmSync(backupPath, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails for the right reason first**

Run: `cd "backend" && node --test tests/billing-route.test.js`
This should actually PASS on first run if `billing.js` behaves as read in Step 0 — this task is adding coverage for existing correct behavior, not fixing a bug. If it fails, read the failure carefully: it means either the stub shape is wrong (check `services/stripe.js` exports match what's stubbed) or `billing.js`'s actual behavior differs from what's documented above — fix the test to match real behavior, don't change `billing.js` to match the test.

- [ ] **Step 3: Confirm all three tests pass**

Run: `cd "backend" && node --test tests/billing-route.test.js`
Expected: `tests 3`, `pass 3`, `fail 0`.

- [ ] **Step 4: Run the full suite**

Run: `cd "backend" && node --test tests/*.test.js`
Expected: 0 failures.

- [ ] **Step 5: Commit**

```bash
git add backend/tests/billing-route.test.js
git commit -m "test(billing): add real HTTP-level coverage for config and checkout-session endpoints"
```

---

### Task 7: Add real endpoint test coverage for purchase order draft creation

**Files:**
- Create: `backend/tests/purchase-orders-draft-route.test.js`

**Interfaces:**
- Consumes: `require('../routes/purchase-orders')` mounted at `/api/purchase-orders`, `POST /draft` body shape `{ vendor, po_number, items, total_cost, notes, scan_id }` (from `backend/routes/purchase-orders.js:260`).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/purchase-orders-draft-route.test.js`:

```js
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
      key.includes(`${path.sep}backend${path.sep}lib${path.sep}config.js`) ||
      key.includes(`${path.sep}backend${path.sep}routes${path.sep}purchase-orders.js`)
    ) {
      delete require.cache[key];
    }
  }
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function close(server) {
  if (!server) return;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

test('POST /api/purchase-orders/draft creates a scoped draft purchase order', async () => {
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-po-draft-route-'));
  const prev = {
    NODEROUTE_BACKUP_PATH: process.env.NODEROUTE_BACKUP_PATH,
    NODEROUTE_FORCE_DEMO_MODE: process.env.NODEROUTE_FORCE_DEMO_MODE,
    JWT_SECRET: process.env.JWT_SECRET,
  };
  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  process.env.JWT_SECRET = 'po-draft-route-test-secret';
  clearBackendModuleCache();

  let server;
  try {
    const { supabase } = require('../services/supabase');
    await supabase.from('users').insert({
      id: 'po-admin',
      name: 'PO Admin',
      email: 'po.admin@noderoute.test',
      role: 'admin',
      status: 'active',
      company_id: 'company-po',
      location_id: 'loc-po',
      accessible_company_ids: ['company-po'],
      accessible_location_ids: ['loc-po'],
    });

    const app = express();
    app.use(express.json());
    app.use('/api/purchase-orders', require('../routes/purchase-orders'));
    server = await listen(app);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const token = jwt.sign({ userId: 'po-admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });

    const response = await fetch(`${baseUrl}/api/purchase-orders/draft`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vendor: 'Ocean Fresh Seafood',
        items: [{ item_number: 'SAL-01', description: 'Atlantic Salmon', quantity: 10, unit_cost: 5.5 }],
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.vendor, 'Ocean Fresh Seafood');
    assert.equal(body.status, 'draft');
    assert.ok(body.po_number, 'expected an auto-generated PO number');
    assert.equal(body.company_id, 'company-po');

    const stored = await supabase.from('purchase_orders').select('*').eq('id', body.id).single();
    assert.equal(stored.data.status, 'draft');
    assert.equal(stored.data.location_id, 'loc-po');
  } finally {
    await close(server);
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    clearBackendModuleCache();
    fs.rmSync(backupPath, { recursive: true, force: true });
  }
});

test('POST /api/purchase-orders/draft rejects a request with no line items', async () => {
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-po-draft-empty-'));
  const prev = {
    NODEROUTE_BACKUP_PATH: process.env.NODEROUTE_BACKUP_PATH,
    NODEROUTE_FORCE_DEMO_MODE: process.env.NODEROUTE_FORCE_DEMO_MODE,
    JWT_SECRET: process.env.JWT_SECRET,
  };
  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  process.env.JWT_SECRET = 'po-draft-empty-test-secret';
  clearBackendModuleCache();

  let server;
  try {
    const { supabase } = require('../services/supabase');
    await supabase.from('users').insert({
      id: 'po-admin-2', name: 'PO Admin 2', email: 'po.admin2@noderoute.test',
      role: 'admin', status: 'active', company_id: 'company-po-2', location_id: 'loc-po-2',
      accessible_company_ids: ['company-po-2'], accessible_location_ids: ['loc-po-2'],
    });

    const app = express();
    app.use(express.json());
    app.use('/api/purchase-orders', require('../routes/purchase-orders'));
    server = await listen(app);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const token = jwt.sign({ userId: 'po-admin-2' }, process.env.JWT_SECRET, { expiresIn: '1h' });

    const response = await fetch(`${baseUrl}/api/purchase-orders/draft`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ vendor: 'Empty Vendor', items: [] }),
    });
    assert.equal(response.status, 400);
  } finally {
    await close(server);
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    clearBackendModuleCache();
    fs.rmSync(backupPath, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run and adjust to real behavior**

Run: `cd "backend" && node --test tests/purchase-orders-draft-route.test.js`

This is coverage-for-existing-behavior, like Task 6. If assertions fail because `purchaseOrderDraftSchema` (via `validateBody`) requires fields not supplied above, read `backend/lib/schemas.js` (or wherever `purchaseOrderDraftSchema` is defined — check the import at the top of `purchase-orders.js`) and adjust the request body in the test to satisfy it. Do not weaken the schema to fit the test.

- [ ] **Step 3: Confirm both tests pass**

Run: `cd "backend" && node --test tests/purchase-orders-draft-route.test.js`
Expected: `tests 2`, `pass 2`, `fail 0`.

- [ ] **Step 4: Run the full suite**

Run: `cd "backend" && node --test tests/*.test.js`
Expected: 0 failures.

- [ ] **Step 5: Commit**

```bash
git add backend/tests/purchase-orders-draft-route.test.js
git commit -m "test(purchase-orders): add real HTTP-level coverage for draft creation"
```

---

### Task 8: Add real endpoint test coverage for portal payment checkout

**Files:**
- Create: `backend/tests/portal-payments-checkout-route.test.js`

**Interfaces:**
- Consumes: `require('../routes/portal-payments')({ authenticatePortalToken })` factory (from `backend/routes/portal-payments.js`), portal JWT signed with `PORTAL_JWT_SECRET` and payload `{ email, name, role: 'customer', companyId, locationId }` (pattern from `backend/tests/portal-csrf.test.js:47-59`), bearer-token auth path confirmed at `backend/routes/portal/shared.js:259`.

- [ ] **Step 1: Read the target endpoint's request/response shape**

Read `backend/routes/portal/payment-collection-routes.js:206-260` (the `create-checkout-session` handler) before writing the test, to confirm the exact request body fields it expects (likely `invoice_id`/`invoiceId` or similar) and response shape. Use what you find there — don't guess.

- [ ] **Step 2: Write the failing test**

Create `backend/tests/portal-payments-checkout-route.test.js` following this skeleton (fill in the request body from Step 1's findings):

```js
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
      key.includes(`${path.sep}backend${path.sep}services${path.sep}stripe.js`) ||
      key.includes(`${path.sep}backend${path.sep}lib${path.sep}config.js`) ||
      key.includes(`${path.sep}backend${path.sep}routes${path.sep}portal${path.sep}`)
    ) {
      delete require.cache[key];
    }
  }
}

function installStripeStub() {
  const stripePath = require.resolve('../services/stripe');
  require.cache[stripePath] = {
    id: stripePath,
    filename: stripePath,
    loaded: true,
    exports: {
      findOrCreateCustomer: async ({ email }) => ({ id: `cus_${email}` }),
      createCheckoutSession: async () => ({ url: 'https://checkout.stripe.test/portal-session-1', id: 'cs_portal_1', livemode: false }),
      createPaymentIntent: async () => ({ id: 'pi_portal_1', status: 'succeeded' }),
    },
  };
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function close(server) {
  if (!server) return;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

test('POST /payments/create-checkout-session is scoped to the authenticated portal customer', async () => {
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-portal-payments-'));
  const prev = {
    NODEROUTE_BACKUP_PATH: process.env.NODEROUTE_BACKUP_PATH,
    NODEROUTE_FORCE_DEMO_MODE: process.env.NODEROUTE_FORCE_DEMO_MODE,
    PORTAL_JWT_SECRET: process.env.PORTAL_JWT_SECRET,
  };
  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  process.env.PORTAL_JWT_SECRET = 'portal-payments-route-test-secret';
  clearBackendModuleCache();
  installStripeStub();

  let server;
  try {
    const { supabase } = require('../services/supabase');
    await supabase.from('Customers').insert({
      id: 'portal-customer-a',
      company_name: 'Portal Customer A',
      email: 'portal.customer.a@noderoute.test',
      company_id: 'company-portal-a',
      location_id: 'loc-portal-a',
    });
    await supabase.from('invoices').insert({
      id: 'invoice-portal-a',
      customer_email: 'portal.customer.a@noderoute.test',
      status: 'sent',
      total: 150,
      items: [{ description: 'Line', quantity: 1, unit_price: 150, total: 150 }],
      company_id: 'company-portal-a',
      location_id: 'loc-portal-a',
    });

    const { authenticatePortalToken } = require('../routes/portal/shared');
    const app = express();
    app.use(express.json());
    app.use('/', require('../routes/portal-payments')({ authenticatePortalToken }));
    server = await listen(app);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const portalToken = jwt.sign(
      { email: 'portal.customer.a@noderoute.test', name: 'Portal Customer A', role: 'customer', companyId: 'company-portal-a', locationId: 'loc-portal-a' },
      'portal-payments-route-test-secret',
      { expiresIn: '1h' }
    );

    const response = await fetch(`${baseUrl}/payments/create-checkout-session`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${portalToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoice_id: 'invoice-portal-a' }),
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.checkout_url || body.url, `expected a checkout URL in the response, got: ${JSON.stringify(body)}`);
  } finally {
    await close(server);
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    clearBackendModuleCache();
    fs.rmSync(backupPath, { recursive: true, force: true });
  }
});

test('POST /payments/create-checkout-session rejects a checkout attempt for another customer\'s invoice', async () => {
  // Same setup as above, but seed invoice-portal-b under company-portal-b / a different customer email,
  // sign the portal token for portal.customer.a@noderoute.test, and request invoice_id: 'invoice-portal-b'.
  // Assert the response is 403 or 404 — never 200. This is the actual security-relevant assertion for
  // this endpoint (a customer must not be able to pay, or probe the existence of, another customer's invoice).
});
```

Note for the implementer: the second test's body is intentionally left as a spec, not code, because it depends on exactly how `payment-collection-routes.js` looks up the invoice (by `req.customerEmail` vs. `req.portalContext`) — read the handler from Step 1 and fill in the setup so the cross-customer request is actually rejected, matching the existing pattern of `high-cross-tenant-core.test.js`. If it does NOT reject, this is a real bug — stop and report it before writing the test to expect a leak.

- [ ] **Step 3: Run and adjust to real behavior**

Run: `cd "backend" && node --test tests/portal-payments-checkout-route.test.js`
Adjust the request body/response assertions to match what Step 1's reading revealed, the same way as Task 6/7.

- [ ] **Step 4: Confirm both tests pass**

Run: `cd "backend" && node --test tests/portal-payments-checkout-route.test.js`
Expected: `tests 2`, `pass 2`, `fail 0`.

- [ ] **Step 5: Run the full suite**

Run: `cd "backend" && node --test tests/*.test.js`
Expected: 0 failures.

- [ ] **Step 6: Commit**

```bash
git add backend/tests/portal-payments-checkout-route.test.js
git commit -m "test(portal-payments): add HTTP-level coverage for checkout session scoping"
```

---

### Task 9: Fix N+1 query in `pricing-engine.js` price-level resolution

**Files:**
- Modify: `backend/services/pricing-engine.js:241-277`
- Test: `backend/tests/pricing-engine.test.js` (extend — already has price-level coverage per lines 86-104, 144, 180)

**Interfaces:**
- Produces: `resolvePriceLevelPrice(db, { customerId, product, context, onDate, listPrice })` — same signature and return shape as before (`{ price, method: PRICE_METHODS.PRICE_LEVEL, source_id }` or `null`). Callers (`resolvePrice` at line 292-309) are unaffected.

- [ ] **Step 1: Write a test that would catch a query-count regression**

Add to `backend/tests/pricing-engine.test.js` (find the existing `describe`/`test` block covering price levels near line 144/180 and add alongside it):

```js
test('resolvePriceLevelPrice batches rule lookups instead of querying per assignment', async () => {
  const queryLog = [];
  const originalFrom = supabase.from.bind(supabase);
  supabase.from = (table) => {
    if (table === 'price_level_rules') queryLog.push(table);
    return originalFrom(table);
  };

  try {
    await supabase.from('price_levels').insert([
      { id: 'level-multi-1', company_id: COMPANY_ID },
      { id: 'level-multi-2', company_id: COMPANY_ID },
    ]);
    await supabase.from('customer_price_level_assignments').insert([
      { id: 'assign-multi-1', company_id: COMPANY_ID, customer_id: 'cust-multi', price_level_id: 'level-multi-1', effective_date: '2026-01-01' },
      { id: 'assign-multi-2', company_id: COMPANY_ID, customer_id: 'cust-multi', price_level_id: 'level-multi-2', effective_date: '2026-01-02' },
    ]);
    await supabase.from('price_level_rules').insert([
      { id: 'rule-multi-1', company_id: COMPANY_ID, price_level_id: 'level-multi-1', product_id: 'p-multi', method: 'fixed_dollar', value: 12 },
      { id: 'rule-multi-2', company_id: COMPANY_ID, price_level_id: 'level-multi-2', product_id: 'p-multi', method: 'fixed_dollar', value: 15 },
    ]);

    const result = await pricingEngine.resolvePriceLevelPrice(supabase, {
      customerId: 'cust-multi',
      product: { id: 'p-multi' },
      context: TEST_CONTEXT,
      onDate: '2026-01-15',
      listPrice: 20,
    });

    assert.equal(result.price, 15, 'most recent effective assignment (level-multi-2) should win');
    assert.equal(queryLog.length, 1, `expected exactly 1 price_level_rules query regardless of assignment count, got ${queryLog.length}`);
  } finally {
    supabase.from = originalFrom;
  }
});
```

Adjust `COMPANY_ID`/`TEST_CONTEXT`/`supabase`/`pricingEngine` references to whatever names the top of `pricing-engine.test.js` already uses (read the file's existing setup block, e.g. around lines 1-90, before adding this).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "backend" && node --test tests/pricing-engine.test.js`
Expected: FAIL on `assert.equal(queryLog.length, 1, ...)` — current code issues one query per assignment (`queryLog.length === 2` for this fixture).

- [ ] **Step 3: Rewrite `resolvePriceLevelPrice` to batch-load rules**

Replace `backend/services/pricing-engine.js:241-277`:

```js
async function resolvePriceLevelPrice(db, { customerId, product, context, onDate, listPrice }) {
  const { data: assignmentRows, error: assignmentErr } = await scopeQueryByContext(
    db.from('customer_price_level_assignments').select('*'),
    context,
  )
    .eq('customer_id', customerId);
  if (assignmentErr) throw assignmentErr;

  const assignments = filterRowsByContext(assignmentRows || [], context)
    .filter((row) => activeOnDate(row, onDate, 'effective_date', 'expiry_date'))
    .sort((a, b) => String(b.effective_date || '').localeCompare(String(a.effective_date || '')) || sortById(a, b));

  if (!assignments.length) return null;

  const priceLevelIds = [...new Set(assignments.map((row) => row.price_level_id).filter(Boolean))];
  const { data: allRuleRows, error: ruleErr } = await scopeQueryByContext(
    db.from('price_level_rules').select('*'),
    context,
  )
    .in('price_level_id', priceLevelIds);
  if (ruleErr) throw ruleErr;

  const rulesByLevel = new Map();
  for (const rule of filterRowsByContext(allRuleRows || [], context)) {
    const list = rulesByLevel.get(rule.price_level_id) || [];
    list.push(rule);
    rulesByLevel.set(rule.price_level_id, list);
  }

  for (const assignment of assignments) {
    const rules = (rulesByLevel.get(assignment.price_level_id) || [])
      .filter((rule) => targetMatchesProduct(rule, product))
      .sort(moreSpecificFirst);
    for (const rule of rules) {
      const price = calculateRulePrice(rule, product, listPrice);
      if (price != null) {
        return {
          price,
          method: PRICE_METHODS.PRICE_LEVEL,
          source_id: rule.id,
        };
      }
    }
  }

  return null;
}
```

This preserves the exact precedence logic (assignments still tried in the same most-recent-first order; rules within an assignment still sorted by `moreSpecificFirst`) — it only changes *how* the rules are fetched (one `.in()` query instead of N `.eq()` queries).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "backend" && node --test tests/pricing-engine.test.js`
Expected: PASS, `queryLog.length === 1`.

- [ ] **Step 5: Run the full pricing-engine suite and the full backend suite**

Run: `cd "backend" && node --test tests/pricing-engine.test.js && node --test tests/*.test.js`
Expected: all existing price-level/quote/promotion/special-price tests in `pricing-engine.test.js` still pass unchanged (precedence logic didn't move), full suite 0 failures.

- [ ] **Step 6: Commit**

```bash
git add backend/services/pricing-engine.js backend/tests/pricing-engine.test.js
git commit -m "perf(pricing-engine): batch price_level_rules lookups instead of querying per assignment"
```

---

### Task 10: Fix N+1 query in delivery-completion ledger check

**Files:**
- Modify: `backend/routes/deliveries.js:121-172`
- Test: `backend/tests/delivery-notifications.test.js` or a new `backend/tests/delivery-inventory-ledger-batch.test.js` (create the latter if the former's harness doesn't fit)

**Interfaces:**
- Removes: `hasDeliveryInventoryLedgerEntry(itemNumber, note, context)` (single-item check, no longer called in a loop)
- Produces: `hasDeliveryInventoryLedgerEntries(itemNumbers, note, context)` returning `Set<string>` of item numbers that already have a ledger entry for that note.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/delivery-inventory-ledger-batch.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function clearBackendModuleCache() {
  for (const key of Object.keys(require.cache)) {
    if (
      key.includes(`${path.sep}backend${path.sep}services${path.sep}supabase.js`) ||
      key.includes(`${path.sep}backend${path.sep}routes${path.sep}deliveries.js`)
    ) {
      delete require.cache[key];
    }
  }
}

test('delivery inventory deduction checks the ledger in one batched query, not one per item', async () => {
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-delivery-ledger-batch-'));
  const prev = {
    NODEROUTE_BACKUP_PATH: process.env.NODEROUTE_BACKUP_PATH,
    NODEROUTE_FORCE_DEMO_MODE: process.env.NODEROUTE_FORCE_DEMO_MODE,
  };
  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  clearBackendModuleCache();

  try {
    const { supabase } = require('../services/supabase');
    const deliveriesRoute = require('../routes/deliveries');

    const context = { activeCompanyId: 'company-ledger-batch', activeLocationId: 'loc-ledger-batch' };
    await supabase.from('products').insert([
      { id: 'prod-ledger-1', item_number: 'ITEM-LB-1', name: 'A', on_hand_qty: 100, company_id: 'company-ledger-batch', location_id: 'loc-ledger-batch' },
      { id: 'prod-ledger-2', item_number: 'ITEM-LB-2', name: 'B', on_hand_qty: 100, company_id: 'company-ledger-batch', location_id: 'loc-ledger-batch' },
      { id: 'prod-ledger-3', item_number: 'ITEM-LB-3', name: 'C', on_hand_qty: 100, company_id: 'company-ledger-batch', location_id: 'loc-ledger-batch' },
    ]);
    // Pre-existing ledger entry for ITEM-LB-2 only, simulating a partial prior run.
    await supabase.from('inventory_stock_history').insert({
      item_number: 'ITEM-LB-2', change_type: 'delivery_complete', notes: 'Delivery ORD-LB completed',
      company_id: 'company-ledger-batch', location_id: 'loc-ledger-batch',
    });

    const queryLog = [];
    const originalFrom = supabase.from.bind(supabase);
    supabase.from = (table) => {
      if (table === 'inventory_stock_history') queryLog.push(table);
      return originalFrom(table);
    };

    try {
      const existing = await deliveriesRoute.hasDeliveryInventoryLedgerEntries(
        ['ITEM-LB-1', 'ITEM-LB-2', 'ITEM-LB-3'],
        'Delivery ORD-LB completed',
        context
      );
      assert.equal(queryLog.length, 1, `expected exactly 1 inventory_stock_history query for 3 items, got ${queryLog.length}`);
      assert.ok(existing.has('ITEM-LB-2'));
      assert.ok(!existing.has('ITEM-LB-1'));
      assert.ok(!existing.has('ITEM-LB-3'));
    } finally {
      supabase.from = originalFrom;
    }
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    clearBackendModuleCache();
    fs.rmSync(backupPath, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "backend" && node --test tests/delivery-inventory-ledger-batch.test.js`
Expected: FAIL — `deliveriesRoute.hasDeliveryInventoryLedgerEntries` is not exported yet (only the singular, unexported `hasDeliveryInventoryLedgerEntry` exists).

- [ ] **Step 3: Replace the per-item check with a batched one**

In `backend/routes/deliveries.js`, replace the function at lines 121-133:

```js
async function hasDeliveryInventoryLedgerEntry(itemNumber, note, context) {
  const { data, error } = await scopeQueryByContext(
    supabase
      .from('inventory_stock_history')
      .select('id')
      .eq('item_number', itemNumber)
      .eq('change_type', 'delivery_complete')
      .eq('notes', note),
    context
  ).limit(1);
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}
```

with:

```js
async function hasDeliveryInventoryLedgerEntries(itemNumbers, note, context) {
  const uniqueItemNumbers = [...new Set((itemNumbers || []).filter(Boolean))];
  if (!uniqueItemNumbers.length) return new Set();

  const { data, error } = await scopeQueryByContext(
    supabase
      .from('inventory_stock_history')
      .select('item_number')
      .eq('change_type', 'delivery_complete')
      .eq('notes', note)
      .in('item_number', uniqueItemNumbers),
    context
  );
  if (error) throw error;
  return new Set((data || []).map((row) => row.item_number));
}
```

Then update `deductDeliveryInventoryAndRunReorder` at lines 135-172 to call it once, before the loop, instead of once per item inside it:

```js
async function deductDeliveryInventoryAndRunReorder(order, req) {
  const items = Array.isArray(order.items) ? order.items : [];
  const productMaps = await loadProductsForDeliveryItems(items, req.context);
  const deductionNote = deliveryInventoryDeductionNote(order);
  const deductionsByItemNumber = new Map();
  const affectedProductIds = new Set();

  for (const item of items) {
    const qty = deliveryItemQuantity(item);
    if (!(qty > 0)) continue;
    const product = productForDeliveryItem(item, productMaps);
    if (!product?.item_number) continue;
    const key = String(product.item_number);
    const existing = deductionsByItemNumber.get(key) || { product, qty: 0 };
    existing.qty += qty;
    deductionsByItemNumber.set(key, existing);
  }

  const alreadyLedgered = await hasDeliveryInventoryLedgerEntries(
    [...deductionsByItemNumber.keys()],
    deductionNote,
    req.context
  );

  for (const { product, qty } of deductionsByItemNumber.values()) {
    if (alreadyLedgered.has(product.item_number)) {
      affectedProductIds.add(product.id);
      continue;
    }
    await applyInventoryLedgerEntry({
      itemNumber: product.item_number,
      deltaQty: -qty,
      changeType: 'delivery_complete',
      notes: deductionNote,
      createdBy: req.user?.name || req.user?.email || 'system',
      preventNegative: false,
      context: req.context,
    });
    affectedProductIds.add(product.id);
  }
  if (affectedProductIds.size) {
    await reorderEngine.runReorderCheck({ productIds: [...affectedProductIds], context: req.context });
  }
}
```

Finally, add `module.exports.hasDeliveryInventoryLedgerEntries = hasDeliveryInventoryLedgerEntries;` next to wherever `deliveries.js` currently exports its router (check the end of the file for the existing `module.exports = router;` line and any attached named exports, matching the pattern used in `orders.js:1612-1616`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "backend" && node --test tests/delivery-inventory-ledger-batch.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `cd "backend" && node --test tests/*.test.js`
Expected: 0 failures — pay particular attention to any existing delivery-completion tests (search `grep -l "deductDeliveryInventoryAndRunReorder\|deliveries.js" backend/tests/*.js` and run those specifically first if the full run is slow to isolate).

- [ ] **Step 6: Commit**

```bash
git add backend/routes/deliveries.js backend/tests/delivery-inventory-ledger-batch.test.js
git commit -m "perf(deliveries): batch inventory-ledger existence checks instead of querying per item"
```

---

### Task 11: Consolidate error-response shape via `lib/safe-error.js`

**Files:**
- Modify: `backend/lib/safe-error.js`
- Modify: `backend/routes/deliveries.js` (representative call sites — treat as the template; do not attempt every route file in one task)
- Test: `backend/tests/safe-error.test.js` (create)

**Interfaces:**
- Produces: `apiError(message, { code, status = 400, details = null } = {})` returning `{ status, payload }`, added to the existing `backend/lib/safe-error.js` alongside `clientError`/`sendSafeError` (do not remove those — they're already used elsewhere and tested).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/safe-error.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { apiError } = require('../lib/safe-error');

test('apiError builds a consistent payload with optional code and details', () => {
  const { status, payload } = apiError('Customer is on credit hold', {
    code: 'CUSTOMER_CREDIT_HOLD',
    status: 402,
    details: { available_credit: 0 },
  });
  assert.equal(status, 402);
  assert.deepEqual(payload, {
    error: 'Customer is on credit hold',
    code: 'CUSTOMER_CREDIT_HOLD',
    details: { available_credit: 0 },
  });
});

test('apiError defaults to status 400 and omits code/details when not provided', () => {
  const { status, payload } = apiError('Invalid request');
  assert.equal(status, 400);
  assert.deepEqual(payload, { error: 'Invalid request' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "backend" && node --test tests/safe-error.test.js`
Expected: FAIL — `apiError` is not exported yet.

- [ ] **Step 3: Add `apiError` to `lib/safe-error.js`**

Replace the full contents of `backend/lib/safe-error.js` with:

```js
'use strict';

function clientError(err, fallback = 'Internal server error') {
  if ((process.env.NODE_ENV || '').toLowerCase() === 'production') return fallback;
  return err?.message || fallback;
}

function sendSafeError(req, res, err, fallback = 'Internal server error', status = 500) {
  const statusCode = Number.isInteger(status) ? status : 500;
  if (req?.log?.error) {
    req.log.error({ err }, fallback);
  }
  return res.status(statusCode).json({ error: clientError(err, fallback) });
}

function apiError(message, { code, status = 400, details = null } = {}) {
  const payload = { error: message };
  if (code) payload.code = code;
  if (details) payload.details = details;
  return { status: Number.isInteger(status) ? status : 400, payload };
}

module.exports = { clientError, sendSafeError, apiError };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "backend" && node --test tests/safe-error.test.js`
Expected: PASS.

- [ ] **Step 5: Adopt it in one representative route file as the template**

In `backend/routes/deliveries.js`, find a handler that currently builds an ad hoc error object (e.g. wherever it returns something like `res.status(409).json({ error: '...', code: '...' })` for a delivery-specific failure — search `grep -n "res.status(4\|res.status(5" backend/routes/deliveries.js` to locate candidates) and convert it to:

```js
const { apiError } = require('../lib/safe-error');
// ...
const { status, payload } = apiError('Delivery already completed for this order', { code: 'DELIVERY_ALREADY_COMPLETE', status: 409 });
return res.status(status).json(payload);
```

Only convert 2-3 call sites in this one file for this task — this is establishing the pattern, not a codebase-wide sweep (that would be its own task per the "no placeholders, no scope creep" rule; note it in the Deferred section below).

- [ ] **Step 6: Run the full suite**

Run: `cd "backend" && node --test tests/*.test.js`
Expected: 0 failures. If any existing test asserted the exact old error JSON shape at one of the converted call sites, update that test's assertion to match the new (behaviorally identical) shape — the `error`/`code` keys and values are unchanged, only how they're constructed changed.

- [ ] **Step 7: Commit**

```bash
git add backend/lib/safe-error.js backend/tests/safe-error.test.js backend/routes/deliveries.js
git commit -m "refactor(errors): add apiError helper to lib/safe-error.js and adopt it in deliveries.js"
```

**Deferred, not in this task:** rolling `apiError()` out across the other ~70 route files is intentionally out of scope here — do it incrementally as those files are touched for other reasons, not as a single mass find-and-replace commit that would be hard to review.

---

### Task 12: Tenant-scoping consistency — regression test + document intentional bypasses

**Files:**
- Create: `backend/tests/tenant-scoping-consistency.test.js`
- Modify: `backend/routes/ops.js`, `backend/routes/ops-purchasing.js`, `backend/routes/portal.js`, `backend/routes/portal-payments.js` (add a one-line doc comment each — see Step 3)

**Interfaces:** None — this is a static/structural check plus documentation, not a behavior change. (Verification note: a direct read of `billing.js`, `company-config.js`, `onboarding.js`, `integrations.js` during the audit confirmed all of them DO scope by `company_id`/`org_id` via manual `.eq()` or a fallback chain — this task closes the *consistency* gap so a *future* route can't skip scoping unnoticed, it does not fix a live leak.)

- [ ] **Step 1: Write the regression test**

Create `backend/tests/tenant-scoping-consistency.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const routesDir = path.join(__dirname, '..', 'routes');

// Router-mounting shims that contain no Supabase queries of their own — verified by direct
// read during the 2026-07-03 audit. If one of these ever grows a `supabase.from(...)` call,
// this test will start failing it against the scoping check below, which is the point.
const PURE_MOUNTING_SHIMS = new Set(['ops.js', 'ops-purchasing.js', 'portal.js', 'portal-payments.js']);

// Files intentionally outside the standard scopeQueryByContext()/req.context pattern, with
// their own justified scoping mechanism, verified by direct read during the 2026-07-03 audit:
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
```

- [ ] **Step 2: Run test — expect it to pass immediately (this documents current-good state), then deliberately break it once to prove it catches regressions**

Run: `cd "backend" && node --test tests/tenant-scoping-consistency.test.js`
Expected: PASS (both tests) against the current codebase, per the audit's verification.

To prove the test actually works, temporarily add an unscoped query to a throwaway route file, e.g. create `backend/routes/__scratch-scoping-check.js` with:
```js
const { supabase } = require('../services/supabase');
module.exports = async () => supabase.from('orders').select('*');
```
Run the test again — expect it to FAIL, listing `__scratch-scoping-check.js`. Then delete the scratch file:
```bash
rm backend/routes/__scratch-scoping-check.js
```
Run the test one more time to confirm it's back to PASS. This red/green cycle is the verification that the check is load-bearing, not a no-op assertion.

- [ ] **Step 3: Add intentional-bypass doc comments to the pure mounting shims**

Add a one-line comment at the top of each (after the existing `require` block, before `module.exports`):

`backend/routes/ops.js`:
```js
// This file only mounts sub-routers; it issues no Supabase queries of its own.
// See backend/tests/tenant-scoping-consistency.test.js for the scoping regression check.
```

Apply the same comment (adjusted for context) to `backend/routes/ops-purchasing.js`, `backend/routes/portal.js`, and `backend/routes/portal-payments.js`.

- [ ] **Step 4: Run the full suite**

Run: `cd "backend" && node --test tests/*.test.js`
Expected: 0 failures.

- [ ] **Step 5: Commit**

```bash
git add backend/tests/tenant-scoping-consistency.test.js backend/routes/ops.js backend/routes/ops-purchasing.js backend/routes/portal.js backend/routes/portal-payments.js
git commit -m "test(tenant-scoping): add regression check for scoping-mechanism consistency across routes"
```

---

### Task 13: Fix reversed dependency — move `purchasing-shared.js` out of `routes/`

**Files:**
- Move: `backend/routes/ops/purchasing-shared.js` → `backend/lib/purchasing-shared.js`
- Modify: `backend/routes/ops/purchasing-planning-routes.js:22`
- Modify: `backend/routes/ops/purchasing-order-routes.js:22`
- Modify: `backend/services/purchase-order-workflows.js:14`
- Modify: `backend/tests/inventory-ledger-workflows.test.js:13`
- Modify: `backend/tests/ops-workflows.test.js:15`
- Modify: `backend/tests/purchasing-reorder-advanced.test.js:6`
- Modify: `backend/tests/purchasing-lead-times.test.js:4`
- Modify: `backend/tests/vendor-po-receiving-lots.test.js:11`
- Modify: `backend/tests/vendor-minimums.test.js:9`

**Interfaces:** No exported function names or signatures change — this is a pure file-location move. All 6 test files and 3 source files listed above are the complete set of consumers (confirmed via `grep -rln "purchasing-shared" backend/`).

- [ ] **Step 1: Confirm the baseline consumer list is still accurate**

Run: `grep -rln "purchasing-shared" backend/ | grep -v node_modules`
Expected: exactly the 9 files listed above (the module itself plus 8 consumers). If this list differs from what's here, update the remaining steps accordingly before proceeding.

- [ ] **Step 2: Move the file**

```bash
git mv backend/routes/ops/purchasing-shared.js backend/lib/purchasing-shared.js
```

- [ ] **Step 3: Update the two route consumers**

In `backend/routes/ops/purchasing-planning-routes.js:22`, change:
```js
} = require('./purchasing-shared');
```
to:
```js
} = require('../../lib/purchasing-shared');
```

Apply the identical change to `backend/routes/ops/purchasing-order-routes.js:22`.

- [ ] **Step 4: Update the service consumer**

In `backend/services/purchase-order-workflows.js:14`, change:
```js
} = require('../routes/ops/purchasing-shared');
```
to:
```js
} = require('../lib/purchasing-shared');
```

- [ ] **Step 5: Update the four `require(...)`-style test consumers**

In each of these files, change the import path from `../routes/ops/purchasing-shared` to `../lib/purchasing-shared` (keep the destructured names identical):

- `backend/tests/purchasing-reorder-advanced.test.js:6` — `const { buildPurchasingSuggestions } = require('../lib/purchasing-shared');`
- `backend/tests/purchasing-lead-times.test.js:4` — `const { buildPurchasingSuggestions, summarizeVendorPurchaseOrders, resolveHistoricalLeadTimeDays } = require('../lib/purchasing-shared');`
- `backend/tests/vendor-po-receiving-lots.test.js:11` — `const { normalizePoLine, poLineRequiresLot } = require('../lib/purchasing-shared');`
- `backend/tests/vendor-minimums.test.js:9` — update the closing line of its multi-line `require(...)` to `} = require('../lib/purchasing-shared');`

- [ ] **Step 6: Update the two `path.join(...)`-style test consumers**

In `backend/tests/inventory-ledger-workflows.test.js:13`, change:
```js
  fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'ops', 'purchasing-shared.js'), 'utf8'),
```
to:
```js
  fs.readFileSync(path.join(repoRoot, 'backend', 'lib', 'purchasing-shared.js'), 'utf8'),
```

In `backend/tests/ops-workflows.test.js:15`, change:
```js
  path.join(repoRoot, 'backend', 'routes', 'ops', 'purchasing-shared.js'),
```
to:
```js
  path.join(repoRoot, 'backend', 'lib', 'purchasing-shared.js'),
```

- [ ] **Step 7: Verify no stale references remain**

Run: `grep -rn "routes/ops/purchasing-shared\|routes', 'ops', 'purchasing-shared" backend/ | grep -v node_modules`
Expected: no output.

- [ ] **Step 8: Run the full suite**

Run: `cd "backend" && node --test tests/*.test.js`
Expected: 0 failures — this is a pure path-rename, no logic changed.

- [ ] **Step 9: Commit**

```bash
git add backend/lib/purchasing-shared.js backend/routes/ops/purchasing-planning-routes.js backend/routes/ops/purchasing-order-routes.js backend/services/purchase-order-workflows.js backend/tests/inventory-ledger-workflows.test.js backend/tests/ops-workflows.test.js backend/tests/purchasing-reorder-advanced.test.js backend/tests/purchasing-lead-times.test.js backend/tests/vendor-po-receiving-lots.test.js backend/tests/vendor-minimums.test.js
git commit -m "refactor(purchasing): move purchasing-shared.js from routes/ops/ to lib/ to fix service->route dependency"
```

---

## Phase 3 — Long-Term

These four tasks are epics — each is scoped here to a fully-specified first slice that proves the pattern, plus an explicit checklist of the remaining mechanical work. Do not attempt the full checklist in one sitting; each checklist item is its own task-sized unit that repeats the same steps as the first slice.

### Task 14: Split `services/ai.js` into domain submodules (first slice: `ai-chat.js`)

**Files:**
- Create: `backend/services/ai-chat.js`
- Modify: `backend/services/ai.js` (remove the extracted functions, re-export from the new module for backward compatibility)
- Modify: `backend/routes/ai.js` (no import changes needed if `ai.js` re-exports — see Step 4)

**Interfaces:**
- Consumes: whatever `services/ai.js`'s chat-related functions currently depend on internally (the AI client wrapper, prompt templates) — read the functions before moving them and bring their local dependencies along.
- Produces: same function names and signatures as they have today in `services/ai.js`, just physically relocated.

- [ ] **Step 1: Identify the chat-related function boundary**

Run: `grep -n "^async function\|^function\|module.exports" backend/services/ai.js | grep -i "chat\|conversation\|walkthrough"`

Read each matched function's full body plus anything it calls locally within `ai.js` (shared constants, prompt builders used only by chat). List every function/constant that needs to move together.

- [ ] **Step 2: Create `ai-chat.js` with the extracted functions**

Create `backend/services/ai-chat.js` starting with the same top-of-file requires that the chat functions actually use (copy only what's needed, not the whole `ai.js` require block), followed by the moved function bodies verbatim, ending with:

```js
module.exports = {
  // list every function moved in Step 1, exactly as named in the original file
};
```

- [ ] **Step 3: Remove the moved functions from `ai.js` and re-export them**

Delete the moved function bodies from `backend/services/ai.js`. At the bottom of `ai.js`, before its existing `module.exports = { ... }` block, add:

```js
const aiChat = require('./ai-chat');
```

Then add each moved function name into the existing `module.exports` object as `...aiChat` (spread) so every existing consumer (`backend/routes/ai.js` and any test file doing `require('../services/ai').someChatFunction`) keeps working without changes:

```js
module.exports = {
  // ...all the pre-existing non-chat exports, unchanged...
  ...aiChat,
};
```

- [ ] **Step 4: Confirm no consumer needs a direct import change**

Run: `grep -rln "require('\.\./services/ai')\|require('\.\./\.\./services/ai')" backend/ | grep -v node_modules`
For each match, confirm it does `const { someFunction } = require(...)` style destructuring (which works transparently through the re-export) rather than `require('../services/ai.js').someExportInternal` in a way that would break. If everything destructures, no further changes are needed.

- [ ] **Step 5: Run the full suite**

Run: `cd "backend" && node --test tests/*.test.js`
Expected: 0 failures — behavior is identical, only file location and require-graph changed.

- [ ] **Step 6: Commit**

```bash
git add backend/services/ai-chat.js backend/services/ai.js
git commit -m "refactor(ai): extract chat/conversation functions from services/ai.js into services/ai-chat.js"
```

**Remaining checklist for this epic** (repeat Steps 1-6 above, once per row, each as its own task/commit):

| New module | Functions to extract (grep hint) |
|---|---|
| `backend/services/ai-forecast.js` | `grep -n "forecast\|demand" backend/services/ai.js` |
| `backend/services/ai-po-scanner.js` | `grep -n "parsePurchaseOrderImage\|scan" backend/services/ai.js` |
| `backend/services/ai-inventory.js` | `grep -n "analyzeInventory\|inventory" backend/services/ai.js` |
| `backend/services/ai-route.js` | `grep -n "route\|optimi" backend/services/ai.js` |
| `backend/services/ai-pricing.js` | `grep -n "pricing\|anomaly" backend/services/ai.js` |

Once all five are done, `services/ai.js` should be reduced to a thin file that only requires and re-exports the sub-modules — at that point, do one final task to update `backend/routes/ai.js` to import directly from the sub-modules instead of through `services/ai.js`, and delete the re-export shim.

---

### Task 15: Extract order-fulfillment logic out of `routes/orders.js` (first slice: minimum-sell validation)

**Files:**
- Create: `backend/services/order-validation.js`
- Modify: `backend/routes/orders.js:96-127` (the minimum-sell loop identified in the Performance audit)
- Test: extend whichever existing test file covers minimum-sell enforcement (`grep -rl "findMinimumSellViolation\|enforceMinimumSell" backend/tests/*.js`)

**Interfaces:**
- Produces: `validateOrderItemPricing(items, context)` in `backend/services/order-validation.js`, returning the same shape `findMinimumSellViolation` currently returns (read its current return value before extracting — likely `null` or a violation descriptor object).

- [ ] **Step 1: Read the current inline logic and its test coverage**

Read `backend/routes/orders.js:96-127` in full, plus the existing `findMinimumSellViolation`/`hasMinimumSellOverride` functions and their test file (found via the grep above). Note the exact input/output contract before moving anything.

- [ ] **Step 2: Create `services/order-validation.js` with the extracted logic**

Move `findMinimumSellViolation`, `hasMinimumSellOverride`, and the per-item loop at lines 96-127 into a new exported function `validateOrderItemPricing(items, context)` that internally batches the `pricingEngine.enforceMinimumSell()` calls the same way Task 9 batched `resolvePriceLevelPrice` — load all relevant minimum-sell rules for the item set in one query before looping, instead of one query per item. Follow the exact same before/after pattern demonstrated in Task 9, Step 3 (read the current per-item implementation, identify the query inside the loop, hoist it to a single batched query keyed by product/item-number, then loop over the already-fetched map).

- [ ] **Step 3: Update `orders.js` to call the new service**

Replace the inline loop at lines 96-127 with:
```js
const orderValidation = require('../services/order-validation');
// ...
const minimumSellViolation = await orderValidation.validateOrderItemPricing(items, context);
```
matching whatever the original loop did with its result (return early with an error response if a violation is found, per the existing behavior).

- [ ] **Step 4: Run the existing minimum-sell tests, fix until green**

Run: `cd "backend" && node --test tests/orders-pricing-enforcement.test.js` (or whichever file the Step 1 grep found)
Expected: PASS with no behavior change — this step may take a few iterations since a query-batching refactor of hand-written business logic is exactly the kind of change that hides an off-by-one or missed edge case. Do not skip re-reading the diff carefully before declaring done.

- [ ] **Step 5: Run the full suite**

Run: `cd "backend" && node --test tests/*.test.js`
Expected: 0 failures.

- [ ] **Step 6: Commit**

```bash
git add backend/services/order-validation.js backend/routes/orders.js
git commit -m "refactor(orders): extract and batch minimum-sell validation into services/order-validation.js"
```

**Remaining checklist for this epic** (each row is its own task, following the same read-extract-batch-test-commit shape as Task 15 and the fat-controller fix pattern from Task 9/10):

| Extract from `orders.js` | Into | Notes |
|---|---|---|
| Invoice creation/sync (~lines 900-990 per the architecture audit) | `services/order-invoicing.js` | Watch for the `sendFulfillmentInvoiceIfPossible` email side-effect — keep it in the service, not the route. |
| Weight capture / catch-weight reconciliation | `services/order-weight-capture.js` | Cross-reference `enrichItemsWithCatchWeightData` (already exported at line 1614) — likely belongs here too. |
| Lot depletion / traceability (`enrichItemsWithLotData`, `validateFtlLots`, already exported at lines 1613-1616) | `services/order-lot-tracking.js` | These are already standalone exported functions — this is a pure move, no new batching needed. |
| Credit-hold checks | `services/order-credit-checks.js` | Coordinate with `services/creditEngine.js` — check whether this duplicates existing logic there before creating a new file. |

Apply the identical pattern to `backend/routes/inventory.js` (1,245 lines) once `orders.js` is under ~400 lines: extract CRUD, stock movements (transfer/spoilage/counts), and lot management into `services/inventory-crud.js`, `services/inventory-movements.js`, `services/inventory-lot-tracking.js` respectively, using the same read-current-behavior-first approach.

---

### Task 16: Zod-to-TypeScript codegen for backend↔frontend type contracts (first slice: order types)

**Files:**
- Create: `backend/scripts/generate-frontend-types.js`
- Create (generated, do not hand-edit): `frontend-v2/src/types/generated/order.generated.ts`
- Modify: `frontend-v2/src/types/orders.types.ts` (re-export from the generated file for the fields that now come from Zod)
- Modify: root `package.json` (add a `codegen:types` script)

**Interfaces:**
- Produces: a `npm run codegen:types` command that reads `backend/lib/schemas.js`'s order schemas and writes a TypeScript file frontend code can import.

- [ ] **Step 1: Confirm the tool choice and install it**

Run: `npm --prefix backend install --save-dev zod-to-ts`
(This is a devDependency of `backend/` since it only runs at codegen time, not at request time.)

- [ ] **Step 2: Identify the order schema(s) to convert**

Read `backend/lib/schemas.js` and find the schema(s) governing order creation/update (referenced in the audit as `orderCreateSchema`/`orderUpdateSchema` — confirm exact names by running `grep -n "^const order\|^const Order" backend/lib/schemas.js`).

- [ ] **Step 3: Write the codegen script**

Create `backend/scripts/generate-frontend-types.js`:

```js
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { zodToTs, printNode } = require('zod-to-ts');
const schemas = require('../lib/schemas');

const OUTPUT_DIR = path.join(__dirname, '..', '..', 'frontend-v2', 'src', 'types', 'generated');

function writeGeneratedType(schemaName, exportedTypeName, outputFileName) {
  const schema = schemas[schemaName];
  if (!schema) throw new Error(`Schema "${schemaName}" not found in backend/lib/schemas.js`);
  const { node } = zodToTs(schema, exportedTypeName);
  const header = '// GENERATED FILE — do not edit by hand.\n' +
    `// Source: backend/lib/schemas.js (${schemaName})\n` +
    '// Regenerate with: npm run codegen:types\n\n';
  const body = `export type ${exportedTypeName} = ${printNode(node)};\n`;
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, outputFileName), header + body);
  console.log(`Wrote ${outputFileName}`);
}

// Adjust schemaName to whatever Step 2 found in backend/lib/schemas.js.
writeGeneratedType('orderCreateSchema', 'GeneratedOrderCreateInput', 'order.generated.ts');

console.log('Type generation complete.');
```

- [ ] **Step 4: Wire up the npm script**

In root `package.json`, add to `"scripts"`:
```json
"codegen:types": "node backend/scripts/generate-frontend-types.js"
```

- [ ] **Step 5: Run it and inspect the output**

Run: `npm run codegen:types`
Expected: `frontend-v2/src/types/generated/order.generated.ts` is created. Open it and confirm the field names/types look sane against the actual Zod schema (e.g. optional fields show up as `?:`, enums show up as string-literal unions).

- [ ] **Step 6: Wire the generated type into the existing hand-written type as a starting point**

In `frontend-v2/src/types/orders.types.ts`, add near the top:
```ts
export type { GeneratedOrderCreateInput } from './generated/order.generated';
```
Do not delete the existing hand-written `OrderItem`/`Order` interfaces yet — that migration (replacing hand-written fields with the generated ones where they match) is follow-on work per-field, not a single mechanical step, since some hand-written fields (like the 23 cost-field variants noted in the audit) may represent real API inconsistency that the codegen will surface rather than resolve automatically.

- [ ] **Step 7: Verify the frontend still builds**

Run: `npm --prefix frontend-v2 run build`
Expected: succeeds (the new export is additive, nothing consumes it yet beyond the re-export).

- [ ] **Step 8: Commit**

```bash
git add backend/scripts/generate-frontend-types.js backend/package.json package.json frontend-v2/src/types/generated/order.generated.ts frontend-v2/src/types/orders.types.ts package-lock.json backend/package-lock.json
git commit -m "feat(types): add Zod-to-TypeScript codegen, starting with order create/update schema"
```

**Remaining checklist for this epic:** repeat Steps 2-8 for `inventoryProductPatchSchema`/`inventoryCountBodySchema` (from `backend/lib/inventory-write-schemas.js`) → `inventory.generated.ts`, and for the auth schemas → `auth.generated.ts`. Once 3-4 domains are covered, evaluate whether to add a CI check that fails if `npm run codegen:types` produces a diff (i.e. someone changed a Zod schema without regenerating).

---

### Task 17: Expand Playwright E2E coverage (first slice: PO receiving flow)

**Files:**
- Create: `frontend-v2/e2e/purchase-order-receiving.spec.ts` (confirm exact e2e directory name by running `ls frontend-v2/e2e* 2>/dev/null || grep -n "testDir" frontend-v2/playwright.config.ts` first — use whatever the existing `navigation.spec.ts`/`order-route.spec.ts` files' directory actually is)

**Interfaces:** None new — this uses the existing Playwright config and login helper already used by `order-route.spec.ts`.

- [ ] **Step 1: Read an existing spec as the template**

Read the existing `order-route.spec.ts` (or `routes.spec.ts`) in full — copy its login/setup boilerplate (base URL, test credentials via `TEST_EMAIL`/`TEST_PASSWORD` per `AGENTS.md`) rather than reinventing it.

- [ ] **Step 2: Write the failing test**

Create the new spec file following the exact structure of the template found in Step 1, covering this flow: log in → navigate to Purchasing → create a new PO with one line item → save as draft → confirm the draft appears in the PO list with status "draft". Use the same `page.goto`/`page.getByRole`/`page.getByLabel` idioms as the template file — do not introduce a different selector strategy (e.g. don't switch to CSS selectors if the existing specs use role-based queries).

- [ ] **Step 3: Run it against a local dev server**

Run: `npm --prefix frontend-v2 run test:smoke` (per the `test:smoke`/`playwright.local.config.ts` script already in `frontend-v2/package.json`) with the dev server running (use the `run` skill or `preview_start` to launch it first).
Expected: initially may fail while you adjust selectors to match the real rendered DOM — iterate using `npm --prefix frontend-v2 run test:e2e:codegen` to record real selectors if unsure, then hand-clean the generated code to match the template's style.

- [ ] **Step 4: Confirm it passes reliably (run twice to check for flakiness)**

Run the same command twice in a row. Expected: PASS both times, no flaky waits (`page.waitForTimeout` should not be needed if using proper `expect(...).toBeVisible()` polling — if you find yourself adding a raw timeout, that's a sign the selector/assertion is wrong, not that the app is slow).

- [ ] **Step 5: Commit**

```bash
git add frontend-v2/e2e/purchase-order-receiving.spec.ts
git commit -m "test(e2e): add Playwright coverage for PO draft creation flow"
```

**Remaining checklist for this epic** (each is its own task, same shape as Task 17):
- Portal customer payment flow (login to customer portal → view invoice → pay via test-mode Stripe checkout)
- Billing subscription checkout (admin Settings page → NodeRoute Billing → checkout with Stripe test keys)
- Recurring order creation and manual "run now" execution

---

## Deferred / Explicitly Out of Scope

- **`uuid`/`exceljs` CVEs (2 moderate, GHSA-w5hq-g745-h8pq)** (Task 1's deferred item) — `exceljs@4.4.0` is the current latest upstream release and pins the vulnerable `uuid@^8.3.0`; no newer `exceljs` release exists that supports `uuid@>=11`. Forcing the fix downgrades `exceljs` to `3.4.0` (breaking) and introduces different vulnerabilities (`fast-csv`, `tmp`). Re-check with `npm --prefix backend audit` periodically for an upstream `exceljs` fix.
- **`backend/package-lock.json` vs. root workspace lockfile drift** (discovered during Task 1) — these two lockfiles are independently authoritative for different consumers (CI's `npm ci --prefix backend` vs. Railway's root-level `npm install --include=dev`) and can drift silently. Task 1 reconciles the vulnerability set but does not eliminate the underlying dual-lockfile structure — consider whether `backend/package-lock.json` should exist at all in an npm-workspaces setup, as a separate follow-up.
- **`vite`/`esbuild` major upgrade** (Task 2's deferred item) — needs its own task with a full manual smoke test, not bundled into a dependency-patch commit.
- **Codebase-wide `apiError()` rollout** (Task 11's deferred item) — adopt incrementally as files are touched for other reasons.
- **Config alias cleanup** (`.env.example` legacy vars like `GOOGLE_MAPS_KEY`/`CORS_ORIGIN`) and **Zod `.passthrough()` removal in `lib/config.js`** — lower-risk cleanup, not blocking anything else in this plan; do as a standalone task when convenient.
- **Migration placeholder documentation** (duplicate `password_reset_tokens`/`products_inventory_report_fields` migrations) — add explanatory header comments to the existing no-op files; no schema change needed.
- **Frontend selector/summary extraction** in `InventoryPage.tsx`/`OrdersPage.tsx` (Code Quality audit findings 1.3/1.4/6.1) — cosmetic readability work with no user-facing or security impact; pick up opportunistically.

---

## Self-Review Notes

- **Spec coverage:** every High/Medium finding from the audit report maps to a task above (Security → 1, 2, 12; Performance → 3, 9, 10; Testing → 6, 7, 8; Architecture → 12, 13, 14, 15; Code Quality → 4, 11; Maintainability → 5, 13, 16). The Low-priority frontend readability items are explicitly deferred rather than silently dropped.
- **Type consistency check:** `hasDeliveryInventoryLedgerEntries` (plural, Set-returning) is used consistently in Task 10's test and implementation steps. `apiError`/`validateOrderItemPricing`/`GeneratedOrderCreateInput` names are each introduced once and referenced identically in their own task — no cross-task renames.
- **Placeholder scan:** the only intentionally-incomplete code block is the second test body in Task 8 (cross-customer rejection test) and the "remaining checklist" tables in Phase 3 — both are flagged inline as requiring a read-the-real-code step before writing, which is a deliberate hand-off note (the exact schema/handler shape wasn't read character-for-character during planning), not a vague instruction. Every other step has complete, runnable code.

---

Plan complete and saved to `docs/superpowers/plans/2026-07-03-code-audit-remediation.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
