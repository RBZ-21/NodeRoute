# NodeRoute Comprehensive Code Audit — 2026-06-11

Scope: `backend/` (Express 5 + Supabase), `frontend-v2/` (React dashboard), `driver-app/` (React PWA), `landing-v2/`, `supabase/` migrations. Audit areas: functionality, error detection, SuperAdmin access, auth/authz, code quality.

**Architecture note:** there is no Socket.IO/WebSocket layer. Real-time behavior is HTTP polling: the dashboard refetches via React Query every ~30s (`frontend-v2/src/hooks/useMap.ts:35,44`), drivers send GPS via `PATCH /api/driver/location` every 60s (`driver-app/src/hooks/useLocationUpdater.ts:46-56`) with a 5s server-side throttle (`backend/routes/driver.js:242`), and the public tracking page polls `/api/track/:token` every 30s. Worst-case driver-action → dashboard latency is ~30s. The polling design is sound for this product; the audit items below are about specific gaps, not the architecture.

---

## CRITICAL

### C1. Hardcoded production admin credentials committed to the repo
- **Category:** Error / Auth
- **File:** `backend/check_production_email.js:37`
- **Description:** A diagnostic script contains the live production admin login (`admin@noderoutesystems.com` plus its real password) and posts it to the production domain `noderoutesystems.com`. Anyone with read access to the repo (or its git history) has production admin access. The credential is not reproduced in this report.
- **Fix:** Rotate the `admin@noderoutesystems.com` password immediately. Delete the script (or rewrite it to read credentials from env vars), and purge the secret from git history (`git filter-repo` / BFG) since deletion alone leaves it in history. Audit access logs for unauthorized logins.

### C2. Cross-tenant data exposure and unscoped writes in phone orders
- **Category:** Auth / Functionality
- **File:** `backend/routes/phone-orders.js:13-26` (read), `:44-60` (write)
- **Description:** The router applies `authenticateToken` but none of its queries use `scopeQueryByContext` (used by every other route file). `GET /api/phone-orders` returns **all companies'** phone orders to any authenticated user of any tenant and any role (including drivers). `PATCH /api/phone-orders/:id` lets any authenticated user update any order's `status`/`needs_callback` by ID, with no company scoping, no role check, and no validation of the status value.
- **Fix:** Wrap all queries in `scopeQueryByContext(..., req.context)`, add `requireRole('admin', 'manager')`, and validate `status` against the allowed enum.

---

## HIGH

### H1. SuperAdmin can be demoted (locked out) by a company admin
- **Category:** SuperAdmin Access
- **File:** `backend/routes/users.js:293-301`
- **Description:** `PATCH /api/users/:id/role` (guarded only by `requireRole('admin')`) has no check preventing a role change on a superadmin user. `DELETE /:id` has this protection (`users.js:285-287`) but the role endpoint does not — an admin whose company scope matches the superadmin row can demote the superadmin to `driver`, locking the platform owner out. Exploitability depends on the superadmin row sharing the admin's company scope.
- **Fix:** Mirror the delete guard: `if (currentUser.role === 'superadmin' && req.user.role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });`

### H2. SuperAdmin silently scoped out of sales-rep endpoints
- **Category:** SuperAdmin Access
- **File:** `backend/routes/sales-reps.js:14, 33` (also the upsell-alerts handler)
- **Description:** `if (!['admin', 'manager'].includes(req.user.role))` omits `superadmin`, so a superadmin falls into the `eq('sales_rep_id', req.user.id)` branch and sees only "their own" (i.e., zero) customers and visit logs instead of all data.
- **Fix:** Change to `!['admin', 'manager', 'superadmin'].includes(req.user.role)`, or centralize an `isAdminLike()` helper that includes superadmin.

### H3. Route handlers can return without sending any response (client hangs)
- **Category:** Functionality
- **Files:** `backend/routes/orders.js:964`, `invoices.js:156, 208`, `customers.js:195, 208`, `drivers.js:44`, `inventory.js:134`, `routes.js:105, 168`, similar in `vendors.js`
- **Description:** The pattern `const data = insertResult.data; if (!data) return;` exits the handler with no response when Supabase returns no error but a null row. The request hangs until client timeout. Rare in practice, but present in 8+ files.
- **Fix:** Replace with `if (!data) return res.status(500).json({ error: '...' });` (or 404 where appropriate). Consider a shared helper since the pattern is copy-pasted.

### H4. Permissive `USING (true)` RLS policies on two tables
- **Category:** Error / Auth
- **Files:** `supabase/migrations/20260520_inventory_location_assignments.sql:18-19`, `supabase/migrations/20260504_crm_ar_hub.sql:43-44`
- **Description:** `inventory_location_assignments` (which also lacks a `company_id` column) and `customer_visit_logs` grant `FOR ALL TO authenticated USING (true) WITH CHECK (true)`. Today the backend uses the service-role key (RLS bypassed) and no frontend creates a supabase-js client, so exposure requires a Supabase Auth user hitting PostgREST directly — but the tenant boundary is absent at the DB layer.
- **Fix:** Add `company_id` to `inventory_location_assignments`; replace both policies with tenant-scoped ones (match the pattern from `20260518004013_repair_permissive_inventory_rls.sql`).

### H5. Logout/refresh-token revocation is best-effort
- **Category:** Auth
- **File:** `backend/routes/auth.js:159-173`
- **Description:** `revokeRefreshSession()` failures are only logged; logout still returns 200, so a refresh token can remain valid after the user believes they signed out.
- **Fix:** Await revocation and return 500 (or at minimum surface the failure) when the session row cannot be revoked; add a test for revoked-token reuse.

### H6. No dedicated rate limiting on sensitive public endpoints
- **Category:** Error
- **File:** `backend/server.js:197-199, 234-235`; `backend/middleware/rateLimiter.js`
- **Description:** `/api/portal` (customer auth + payments), `/api/track`, `/api/waitlist`, and `/api/public/inventory` ride only the global limiter (high ceiling per IP). Portal auth is brute-forceable at global-limiter rates; waitlist is spammable.
- **Fix:** Apply the `authLimiter` (or stricter, e.g. 10/15min) to portal auth and payment submission; add a modest limiter to waitlist and tracking.

### H7. Driver-app offline queue lacks idempotency — duplicate status submissions
- **Category:** Functionality / Error
- **File:** `driver-app/src/hooks/useOfflineQueue.ts:189-199` (enqueue), `:226-270` (drain)
- **Description:** Queued stop-status actions carry only a timestamp. If the network drops after the server processes a request but before the response arrives, the retry re-submits the same action (double "delivered", duplicate dwell records). The drain loop also closes over component state, risking stale data being submitted after re-renders.
- **Fix:** Add a client-generated `idempotencyKey` (UUID) per action; have `POST /api/stops/:id/arrive|depart` deduplicate on it. Snapshot queue state at drain start.

### H8. Default bootstrap admin password `Admin@123`
- **Category:** Auth
- **File:** `backend/lib/config.js:7` (used by `backend/services/supabase.js:37` bootstrap)
- **Description:** When `ADMIN_PASSWORD` is unset the bootstrap admin is created with a well-known weak password. `config.validate()` warns but does not fail in production (`config.js:129-141`).
- **Fix:** Make `ADMIN_PASSWORD` mandatory in production (fatal, like `JWT_SECRET` at `config.js:115`), or require a forced password change on first login.

---

## MEDIUM

### M1. SuperAdmin cannot see 4 pages in dashboard navigation
- **Category:** SuperAdmin Access
- **File:** `frontend-v2/src/lib/nav.ts:91, 124, 144, 145`
- **Description:** Phone Orders (`['admin','manager']`), Credit Hold (`['admin','manager']`), Integrations (`['admin']`), and Compliance (`['admin','manager']`) exclude `superadmin`. `canAccess()` (`nav.ts:167-170`) does strict list membership, so superadmin can call the backend endpoints (the `requireRole` short-circuit allows it) but the nav items and pages are hidden. The audit requirement "nothing hidden from SuperAdmin" fails for these four.
- **Fix:** Add `'superadmin'` to the four `roles` arrays, or make `canAccess()` always return true for superadmin.

### M2. Superadmin UI lacks links to several platform features
- **Category:** SuperAdmin Access
- **Files:** `frontend-v2/src/lib/nav.ts:142`; `backend/routes/superadmin.js`
- **Description:** Superadmin nav exposes Companies, Users, and Audit Log, but there is no nav entry for the waitlist view (`/superadmin/waitlist` exists as a server route in `server.js:266`), vertical analytics (`GET /api/superadmin/analytics/verticals`), or impersonation history. Required dashboard coverage (user mgmt, company mgmt, drivers, all orders, live map, analytics, settings, audit log) is otherwise reachable through the standard nav thanks to the role short-circuit.
- **Fix:** Add a superadmin nav group exposing waitlist and platform analytics.

### M3. Impersonation flow gaps
- **Category:** SuperAdmin Access / Auth
- **File:** `backend/routes/superadmin.js:236-260` (impersonate), `:310-315` (restore-session)
- **Description:** Impersonation issues a 1h scoped token but writes no audit-log entry; `POST /api/superadmin/restore-session` (mounted at `server.js:221`) intentionally skips `requireSuperadmin` and trusts the `sa_session` cookie.
- **Fix:** Write an audit-trail row on impersonate/restore; validate the target company exists before issuing the token; bind `sa_session` to the issuing superadmin's user id and verify on restore.

### M4. Waitlist admin endpoint uses weaker superadmin gate
- **Category:** SuperAdmin Access
- **File:** `backend/routes/waitlist.js:39`
- **Description:** `GET /api/waitlist` uses `requireRole('superadmin')` (role only) while every `/api/superadmin/*` route uses `requireSuperadmin` (role + pinned `SUPERADMIN_EMAIL`). Any DB row with role `superadmin` bypasses the email pin here — inconsistent defense-in-depth.
- **Fix:** Use `requireSuperadmin`.

### M5. Synchronous bcrypt hashing in request paths
- **Category:** Error
- **File:** `backend/routes/auth.js:43` (`bcrypt.hashSync(pw, 10)`), used in signup/password-update handlers
- **Description:** Blocks the event loop ~100ms per call; concurrent signups/password changes degrade the whole server. (Startup-time use in `services/supabase.js:37` is fine. Salt rounds = 10, meets the ≥10 requirement.)
- **Fix:** `await bcrypt.hash(pw, 10)` in request handlers.

### M6. Supabase `.or()` filter expressions built by string interpolation
- **Category:** Error
- **File:** `backend/services/supabase.js:548-553`
- **Description:** `ResilientQuery` joins `candidate.field`/`candidate.value` into a PostgREST `.or()` expression without escaping. Values containing `,`, `.`, or `()` can alter filter logic (PostgREST filter injection) if any caller passes user input into an `or` filter. (`routes/lots.js:122` interpolates only a server-generated date — safe.)
- **Fix:** Escape/validate values (quote PostgREST reserved characters, allowlist fields) before joining; audit all `or` filter callers.

### M7. Delivery status vocabulary fragmented across the stack
- **Category:** Functionality / Code Quality
- **Files:** `backend/routes/deliveries.js:555-586`; `backend/routes/stops.js`; `driver-app/src/hooks/useDriverApp.tsx:132-137`; `frontend-v2/src/pages/TrackPage.tsx`
- **Description:** Three vocabularies coexist: orders (`pending/in_process/processed/invoiced/delivered`), stops (`pending/arrived/completed/deferred/failed/skipped`), API layer (`pending/in-transit/delivered`). The mapping layer in `deliveries.js` translates correctly, but `deliveries.js:584` contains a dead legacy `in_transit` transition the DB never writes, and every new feature must re-learn the mappings.
- **Fix:** Document the canonical state machines in one module (`lib/`), export shared constants, delete the dead `in_transit` entry.

### M8. Plan/delivery limits not enforced on invoice creation
- **Category:** Functionality
- **Files:** `backend/services/plan-limits.js`; enforced at `backend/routes/orders.js:875` but absent from the invoice POST (`backend/routes/invoices.js:160-215`)
- **Description:** Subscription delivery limits are checked at order creation only; creating invoices directly bypasses plan quota.
- **Fix:** Apply the same enforcement in invoice creation if invoices count toward plan quota.

### M9. Null-dereference risks on `.single()` results
- **Category:** Functionality
- **Files:** `backend/routes/ai.js:764`, `backend/routes/inventory.js:460`, `backend/routes/stops.js:51, 70`
- **Description:** Results of `.single()` queries used without null checks; crashes (500 via the async wrapper) instead of clean 404s when the row is missing.
- **Fix:** `if (!data) return res.status(404).json({ error: 'Not found' });` before property access.

### M10. Scheduler/cron jobs lack error wrapping
- **Category:** Error
- **File:** `backend/lib/scheduler.js:36-115`
- **Description:** `node-cron` jobs run async functions without try/catch; the global Express async wrapper (`lib/async-route-handler.js`) only covers route handlers, so a thrown job error becomes an unhandled rejection.
- **Fix:** Wrap each job body in try/catch with logger + Sentry capture.

### M11. POST create endpoints return 200 instead of 201
- **Category:** Functionality
- **Files:** `backend/routes/orders.js:986`, `backend/routes/invoices.js:214, 251`
- **Description:** Resource-creation endpoints return 200; minor REST-correctness issue called out by the audit's status-code requirement.
- **Fix:** `res.status(201).json(...)`.

### M12. Env vars referenced but absent from config validation
- **Category:** Error
- **File:** `backend/lib/config.js:19-61`; consumers e.g. `backend/routes/webhooks/bland.js:12`
- **Description:** `BLAND_WEBHOOK_SECRET`, `BLAND_INVENTORY_KEY`, `PRINTER_URL`, `PRINTER_SERVICE_URL`, `STAFF_PHONE`, `TWILIO_FROM_NUMBER`, `LOG_LEVEL`, `TZ` are read via `process.env` directly and never validated at startup; missing values fail silently at runtime. (Note: the Bland webhook itself is fail-closed when the secret is unset — `bland.js:13`.) The Bland webhook secret is also passed as a **query parameter**, so it lands in access logs.
- **Fix:** Move all env reads into `config.js` with startup validation; switch the Bland secret to a header.

### M13. Session-expiry handling has no user-facing warning
- **Category:** Functionality
- **Files:** `frontend-v2/src/lib/api.ts:9-10` (constants defined, unused); `frontend-v2/src/App.tsx:49-51`
- **Description:** `SESSION_TTL_MS`/`SESSION_WARNING_MS` exist but no component warns before expiry; idle users lose unsaved form data on the next 401→login redirect. The onboarding-status fetch in `App.tsx:49-51` fails silently (fail-open).
- **Fix:** Add a session-warning toast in AppShell; show an error state on onboarding fetch failure.

### M14. Missing index on `driver_locations.user_id`
- **Category:** Code Quality
- **Files:** `supabase/migrations/20260519_driver_locations_updated_at_index.sql`, `20260528_query_performance_indexes.sql:48`; queried by `backend/routes/tracking.js` and `routes/driver.js`
- **Description:** Driver-location lookups filter by `user_id`, but only `updated_at` and a `(company_name, updated_at)` index exist.
- **Fix:** `CREATE INDEX IF NOT EXISTS idx_driver_locations_user_id ON driver_locations(user_id);`

### M15. CSP permits `unsafe-inline` and `unsafe-eval`; helmet mostly disabled
- **Category:** Error
- **File:** `backend/server.js:76-84` (helmet with all protections off), `:115` (`script-src ... 'unsafe-inline' 'unsafe-eval'`)
- **Description:** Manual headers re-implement most of what helmet was disabled for, but the script-src directives neutralize much of the CSP's XSS protection.
- **Fix:** Remove `unsafe-eval` (verify Stripe/Maps still work), move toward nonce-based inline scripts; or configure helmet's CSP directly instead of disabling it.

### M16. Personal email hardcoded across debug scripts
- **Category:** Error
- **Files:** `backend/check_email.js:71`, `check_production_email.js:87`, `run_email_test.js:21`, `test_smtp_only.js:49, 53, 71`
- **Description:** A personal Gmail address is committed as the default test recipient in five places.
- **Fix:** Read from a `TEST_EMAIL` env var; remove the literals.

---

## LOW

### L1. `requireSuperadmin` contains a redundant condition
- **Category:** Code Quality — `backend/middleware/auth.js:169-174`: the inner `req.user.role === 'superadmin'` re-check is always true at that point. Harmless; simplify.

### L2. JWT payload carries `role` claim that is never used for authz
- **Category:** Auth — `backend/routes/auth.js:68-79`. Authorization correctly reads the DB row loaded in `authenticateToken` (`middleware/auth.js:123-131`), so the claim can't be spoofed into privileges, but removing it shrinks the attack surface. Role inputs on invite/create are Zod-enum-validated to `['admin','manager','driver']` (`lib/users-schemas.js:3`) — superadmin cannot be created via API. Signup hardcodes `role: 'admin'` (`auth.js:546`) — intentional (company owner) but worth documenting.

### L3. CSRF/session secrets derive from JWT_SECRET when unset
- **Category:** Auth — `backend/lib/config.js:74-75`. One leaked secret compromises all three. Make each mandatory in production.

### L4. PO number generation can collide
- **Category:** Error — `backend/services/purchase-order-numbers.js`: timestamp + 3-char random suffix; rely on a DB unique constraint and retry-on-conflict, or use a sequence.

### L5. Stripe webhook silently ignores unhandled event types
- **Category:** Functionality — `backend/routes/stripe-webhooks.js:272-279`. Add an else-branch log line. (Signature verification and company scoping are implemented correctly.)

### L6. `/api/drivers/invite` mutates body then 307-redirects
- **Category:** Code Quality — `backend/server.js:245-247`. Works (307 preserves method/body) but is fragile; call the users-invite handler directly.

### L7. Duplicated utilities across the three frontends
- **Category:** Code Quality — `frontend-v2/src/lib/utils.ts` vs `driver-app/src/lib/utils.ts` vs `landing-v2/src/lib/utils.ts` (cn/normalize/date+status formatting). Extract a shared workspace package.

### L8. Repeated per-route try/catch + error-response boilerplate
- **Category:** Code Quality — e.g. `backend/routes/sales-reps.js`, `deliveries.js:494+`. The global async wrapper already catches rejections; standardize on it plus a shared supabase-error helper (`dbQuery` exists in `users.js` but isn't used everywhere).

### L9. Legacy SQL files duplicate the migrations directory
- **Category:** Code Quality — `supabase/supabase-*-migration.sql` and `supabase/all-migrations.sql` overlap `supabase/migrations/`; the legacy orders file still contains a `USING (true)` policy superseded later. Archive to `supabase/legacy/` with a README.

### L10. Debug scripts live in the backend root
- **Category:** Code Quality — `backend/check_*.js`, `find_email_routes.js`, `grep_railway.js`, `run_email_test.js`, `test_smtp_only.js`. After stripping secrets (see C1/M16), move to `backend/scripts/debug/` with a README — or delete them.

### L11. API responses expose snake_case DB columns directly
- **Category:** Code Quality — backend serializes Supabase rows as-is; the frontends have adapted, but document this as the API convention to keep new code consistent.

---

## What checked out clean

- **Auth middleware coverage:** every `/api/*` router is mounted behind `authenticateToken` (`server.js:191-235`); the only exceptions (`/api/portal`, `/api/track`, `/api/waitlist`, webhooks, `/api/public/inventory`) are deliberately public/token-authenticated. Phone-orders is authenticated too (its problem is scoping, see C2).
- **Role checks are DB-backed:** `req.user` is reloaded from the DB on every request; token claims are never trusted for authz. Strict equality used throughout.
- **`requireRole` superadmin short-circuit** (`middleware/auth.js:139`) gives superadmin access to all standard admin/manager routes; `/api/superadmin/*` adds email pinning (fail-closed when `SUPERADMIN_EMAIL` unset).
- **CSRF:** double-submit cookie with constant-time compare (`middleware/auth.js:92-106`); applied to cookie-based sessions on all mutating methods.
- **Password hashing:** bcryptjs with 10 rounds (meets ≥10 requirement; see M5 about sync usage).
- **XSS:** no `dangerouslySetInnerHTML` anywhere in the three frontends; `users.js:44-50` has a proper `escapeHtml` for invite emails (extend it to `invoice-email.js` interpolations as defense-in-depth).
- **No circular dependencies** observed; module layering (routes → services → lib) is clean.
- **setInterval cleanup:** polling hooks correctly clear timers on unmount (`useLocationUpdater.ts:56`, `TrackPage.tsx:111`).
- **No secrets in frontend bundles**; Google Maps key is a `VITE_` var (add HTTP-referrer restrictions in Google Cloud Console).
- **Bland webhook is fail-closed** when its secret is unset (`routes/webhooks/bland.js:12-13`).
- **Stress/test suite exists:** 30+ backend test files including `security-hardening.test.js` and `multi-company-access.test.js`.

---

## Summary table

| # | Severity | Category | Location | Issue |
|---|----------|----------|----------|-------|
| C1 | Critical | Auth/Error | `backend/check_production_email.js:37` | Production admin credentials committed to repo |
| C2 | Critical | Auth/Functionality | `backend/routes/phone-orders.js:13-60` | Cross-tenant read/write — no company scoping or role check |
| H1 | High | SuperAdmin | `backend/routes/users.js:293-301` | Admin can demote superadmin (lockout) |
| H2 | High | SuperAdmin | `backend/routes/sales-reps.js:14,33` | Superadmin scoped out of sales-rep data |
| H3 | High | Functionality | 8+ route files (e.g. `orders.js:964`) | Handlers can return without responding (client hang) |
| H4 | High | Error/Auth | `20260520_...sql:18-19`, `20260504_crm_ar_hub.sql:43-44` | Permissive `USING (true)` RLS policies |
| H5 | High | Auth | `backend/routes/auth.js:159-173` | Logout token revocation best-effort |
| H6 | High | Error | `backend/server.js:197-199,234-235` | No dedicated rate limits on public endpoints |
| H7 | High | Functionality | `driver-app/src/hooks/useOfflineQueue.ts:189-270` | Offline queue lacks idempotency; duplicate submissions |
| H8 | High | Auth | `backend/lib/config.js:7` | Default bootstrap admin password `Admin@123` |
| M1 | Medium | SuperAdmin | `frontend-v2/src/lib/nav.ts:91,124,144,145` | 4 nav items hidden from superadmin |
| M2 | Medium | SuperAdmin | `nav.ts:142`, `routes/superadmin.js` | Waitlist/platform-analytics not linked in superadmin UI |
| M3 | Medium | SuperAdmin/Auth | `backend/routes/superadmin.js:236-315` | Impersonation unaudited; restore-session cookie trust |
| M4 | Medium | SuperAdmin | `backend/routes/waitlist.js:39` | Waitlist uses role-only superadmin gate (no email pin) |
| M5 | Medium | Error | `backend/routes/auth.js:43` | `bcrypt.hashSync` blocks event loop in request path |
| M6 | Medium | Error | `backend/services/supabase.js:548-553` | Unescaped `.or()` filter interpolation |
| M7 | Medium | Functionality | `backend/routes/deliveries.js:555-586` et al. | Fragmented delivery-status vocabularies; dead `in_transit` |
| M8 | Medium | Functionality | `backend/routes/invoices.js:160-215` | Plan limits not enforced on invoice creation |
| M9 | Medium | Functionality | `ai.js:764`, `inventory.js:460`, `stops.js:51,70` | Null-deref on `.single()` results |
| M10 | Medium | Error | `backend/lib/scheduler.js:36-115` | Cron jobs lack error handling |
| M11 | Medium | Functionality | `orders.js:986`, `invoices.js:214,251` | POST create returns 200 not 201 |
| M12 | Medium | Error | `backend/lib/config.js`, `webhooks/bland.js:12` | Unvalidated env vars; webhook secret in query string |
| M13 | Medium | Functionality | `frontend-v2/src/lib/api.ts:9-10`, `App.tsx:49-51` | No session-expiry warning; silent onboarding failure |
| M14 | Medium | Code Quality | `supabase/migrations/` | Missing `driver_locations.user_id` index |
| M15 | Medium | Error | `backend/server.js:76-84,115` | CSP allows `unsafe-inline`/`unsafe-eval`; helmet disabled |
| M16 | Medium | Error | 5 debug scripts | Personal email hardcoded |
| L1 | Low | Code Quality | `middleware/auth.js:169-174` | Redundant condition in `requireSuperadmin` |
| L2 | Low | Auth | `routes/auth.js:68-79` | Unused `role` claim in JWT (defense-in-depth) |
| L3 | Low | Auth | `lib/config.js:74-75` | CSRF/session secrets derive from JWT_SECRET |
| L4 | Low | Error | `services/purchase-order-numbers.js` | PO number collision possible |
| L5 | Low | Functionality | `routes/stripe-webhooks.js:272-279` | Unhandled Stripe event types not logged |
| L6 | Low | Code Quality | `server.js:245-247` | Body-mutating 307 redirect for driver invite |
| L7 | Low | Code Quality | 3× `lib/utils.ts` | Duplicated frontend utilities |
| L8 | Low | Code Quality | multiple route files | Repeated error-handling boilerplate |
| L9 | Low | Code Quality | `supabase/*.sql` | Legacy SQL files duplicate migrations dir |
| L10 | Low | Code Quality | `backend/` root | Debug scripts in backend root |
| L11 | Low | Code Quality | backend routes | snake_case API responses undocumented |

**Totals: 2 Critical · 8 High · 16 Medium · 11 Low — 37 findings.**

### Immediate actions (this week)
1. **Rotate the production admin password** and purge `check_production_email.js` secrets from git history (C1).
2. **Scope and role-gate `/api/phone-orders`** (C2).
3. **Guard superadmin role changes** in `users.js` (H1) and fix the sales-reps role check (H2).
4. Fix the `if (!data) return;` hang pattern (H3) and add rate limits to portal auth (H6).
