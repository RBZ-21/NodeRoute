# Claude Code Prompt — Verify & Complete Superadmin Access-Control Fixes

Paste everything below the line into Claude Code from the repo root (`NodeRoute/`).

---

You are auditing and finishing a security fix in the NodeRoute codebase. NodeRoute is a multi-tenant delivery/wholesale platform with this role hierarchy:

- **`superadmin`** — NodeRoute's *creator/platform owner*. MUST be able to access every page, every feature, and every tenant company's data. Identity is double-gated: `role === 'superadmin'` AND email matches `SUPERADMIN_EMAIL`.
- **`admin`** — the *customer's* business owner. Full access to THEIR OWN company only. MUST NOT gain access to creator-only functions (the `/api/superadmin/*` routes, the Companies page, the waitlist, cross-tenant data).
- **`manager`**, **`driver`** — scoped staff/driver roles.

A prior pass already applied fixes. Your job is to **verify those fixes are correct, find any remaining gaps where `superadmin` is accidentally excluded, and confirm `admin` was NOT accidentally given creator-only access.** Apply fixes for anything still missing. Do not weaken any existing restriction on `admin`.

## Step 1 — Confirm the already-applied fixes exist and are correct

Check each of these and report PASS/FAIL with the exact current line:

1. `backend/services/operating-context.js` — `getUserOperatingContext` must set `isGlobalOperator` true when the user's primary `role` is `superadmin` (not only the legacy `platform_role`). Expected logic:
   ```js
   const primaryRole = String(firstValue(user, ['role']) || '').toLowerCase();
   // ...
   isGlobalOperator:
     primaryRole === 'superadmin'
     || ['platform_admin', 'super_admin', 'superadmin'].includes(String(platformRole || '').toLowerCase()),
   ```
2. `backend/routes/sales-reps.js` — all three privileged checks must read `['admin', 'manager', 'superadmin'].includes(req.user.role)` (lines ~14, ~33, ~87).
3. `frontend-v2/src/lib/nav.ts` — `canAccess()` must early-return `true` when `role === 'superadmin'`.
4. `frontend-v2/src/pages/DashboardPage.tsx` — must define `const isAdmin = role === 'admin' || role === 'superadmin'` and use it for the purchase-orders query, low-stock query, refresh invalidation, the Purchasing button, the AI Anomaly card, the Purchasing Command Center card, and the Inventory Health card.
5. `frontend-v2/src/pages/OrdersPage.tsx` (~line 503), `RoutesPage.tsx` (`canManageStops`), `SettingsPage.tsx` (`canManageCompanySettings`) — each must include `|| role === 'superadmin'`.

## Step 2 — Sweep for any REMAINING superadmin exclusions

Run these searches and inspect every hit. Flag any spot where a **functional** gate (rendering an action, enabling a control, running a privileged query, or a backend authorization decision) includes `admin`/`manager` but omits `superadmin`:

```bash
# Frontend functional role gates
grep -rnE "role *===? *'admin'|role *!== *'admin'|=== *'manager'|\]\.includes\((role|userRole)" frontend-v2/src --include=*.tsx --include=*.ts | grep -viE "superadmin"

# Backend inline role checks (route handlers / services)
grep -rnE "\.role *(===|!==|==)|\]\.includes\((req\.user\.role|role)" backend --include=*.js | grep -v node_modules | grep -viE "superadmin|service_role|orderParser|ai\.js|role: '"
```

For each hit decide:
- **Functional gate missing superadmin** → fix it (add `superadmin` to the allowed set, or use an `isAdmin = role === 'admin' || role === 'superadmin'` helper consistent with the existing code style).
- **Cosmetic only** (badge color via `roleVariant`, a `normalizeRole` fallback, an AI chat-message `role`, a DB `service_role`) → leave it, but list it so I can decide. Known cosmetic spots: `UsersPage.tsx` and `SettingsPage.tsx` `roleVariant`/`normalizeRole`.

## Step 3 — Confirm admin is NOT over-privileged (regression guard)

Verify these creator-only protections still EXCLUDE admin:

1. `backend/routes/superadmin.js` — router still uses `requireSuperadmin` (role + `SUPERADMIN_EMAIL` match). The only intentionally-unguarded route is `restore-session`, which must independently verify a signed impersonation token (`payload.role`).
2. `backend/routes/waitlist.js` — GET still uses `requireRole('superadmin')` (admin is NOT in the list and `requireRole` only bypasses for superadmin).
3. `frontend-v2/src/lib/nav.ts` — the `companies` nav item still has `roles: ['superadmin']`; confirm `canAccess` returns false for `admin` on it.
4. `backend/lib/users-schemas.js` — `USER_ROLES` must remain `['admin', 'manager', 'driver']` (NO superadmin). This is intentional: it prevents an admin from creating or elevating a user to superadmin via the API. Do NOT add superadmin here.
5. `backend/services/operating-context.js` — confirm `admin` yields `isGlobalOperator === false` (admin stays scoped to their own company).

## Step 4 — Tests

Run the two role-related test files and confirm they pass:

```bash
cd backend && node --test tests/operating-context.test.js tests/superadmin-access.test.js
```

Then add/run a quick behavioral assertion (create it as a throwaway if no equivalent exists) proving the boundary holds both ways:

```bash
cd backend && node -e "
const { getUserOperatingContext, rowMatchesContext, scopeQueryByContext } = require('./services/operating-context');
const sa = getUserOperatingContext({ id:'sa', role:'superadmin', company_id:'company-a' });
console.assert(sa.isGlobalOperator === true, 'superadmin must be global operator');
console.assert(rowMatchesContext({ company_id:'company-Z' }, sa) === true, 'superadmin must see other-company rows');
const guard = { eq(){ throw new Error('scoped!'); } };
console.assert(scopeQueryByContext(guard, sa) === guard, 'superadmin query must be unscoped');
const admin = getUserOperatingContext({ id:'a', role:'admin', company_id:'company-a' });
console.assert(admin.isGlobalOperator === false, 'admin must NOT be global operator');
console.assert(rowMatchesContext({ company_id:'company-Z' }, { ...admin, activeCompanyId:'company-a' }) === false, 'admin must NOT see other-company rows');
console.log('BOUNDARY OK: superadmin unscoped, admin scoped');
"
```

If a TypeScript build is available, also run the frontend type-check (e.g. `cd frontend-v2 && npx tsc --noEmit`) to confirm the edits didn't break types.

## Step 5 — Report

Output a table: file | line | change made (or "verified, no change") | why. End with an explicit statement confirming (a) superadmin now reaches every feature, and (b) admin gained nothing creator-only.

### Note
If `git status` reports `index file corrupt` or a stuck `.git/index.lock`, run `rm -f .git/index.lock && git read-tree HEAD` (or `rm -f .git/index && git reset`) before committing — this was an environment artifact, not a code issue.
