# NodeRoute Full-Stack Security & Code Quality Audit — 2026-06-12

Scope: entire repository — `backend/`, `frontend-v2/`, `driver-app/`, `landing-v2/`, `ios-driver-app/`, `supabase/`, root scripts, CI, and dependencies. This audit follows up on `code-audit-2026-06-11.md` and the fix PR #183: it verifies which prior findings are fixed, re-checks the open ones, and adds new findings the prior pass missed.

**Verified fixed since 2026-06-11:** C1 (`check_production_email.js` now env-var-gated), C2 (phone-orders authenticated at `routes/phone-orders.js:13`, all queries scoped), H1 (superadmin role-change guard), H2 (sales-reps superadmin visibility), H3 (`if (!data) return;` hang sites), H6 (`publicLimiter`/`waitlistLimiter` mounted), M10 (scheduler jobs wrapped in try/catch), M13-part (SessionExpiryBanner now wired), M14 (`driver_locations.user_id` index in `20260519_driver_locations_user_id_fk.sql`), M16 (personal email removed from debug scripts), and the `customer_visit_logs` half of H4 (repaired by `20260517_security_hardening_rls_gaps.sql`).

**Still open from 2026-06-11:** H4-part (`inventory_location_assignments` RLS), H5, H7, H8, M1, M3, M4, M5, M6, M9, M11, M12, M15, L3, L4, L6–L11.

---

## Section 1 — Structure map

```
NodeRoute/
├── package.json                      # root workspace scripts (build/test orchestration)
├── railway.toml / nixpacks.toml      # deploy config (Railway)
├── .github/workflows/ci.yml          # CI: backend tests + frontend builds
├── .github/workflows/codeql.yml      # CodeQL scanning (+ codeql-config.yml)
├── qa_audit_full.js / qa_check.js / qa_recon.js   # Playwright QA scripts vs PRODUCTION (⚠ hardcoded creds)
├── scripts/seed-admin.js             # admin bootstrap (env-var driven — clean)
├── scripts/capture-v2-screenshots.mjs# screenshot capture (⚠ fallback password)
├── recon_shots/, test_screenshot.png # committed QA artifacts (hygiene)
├── NodeRoute_Backend_Frontend_Scan_Summary.docx   # committed binary doc (hygiene)
├── docs/                             # training guide, specs, security docs, ui-v2 notes
│
├── backend/                          # Express 5 API server (Supabase service-role client)
│   ├── server.js                     # entry: helmet/CSP/CORS, rate limits, router mounts, SPA serving
│   ├── instrument.js                 # Sentry init (DSN from env)
│   ├── middleware/auth.js            # JWT auth, CSRF double-submit, requireRole/requireSuperadmin
│   ├── middleware/rateLimiter.js     # global/auth/login/setup/public/waitlist/ai limiters
│   ├── lib/                          # config.js (env validation), zod schemas (auth/users/lots/inventory/
│   │                                 #   ops-po-drafts/schemas), validate.js, zod-validate.js (global body guard),
│   │                                 #   scheduler.js (cron), orderParser.js (AI transcript→order),
│   │                                 #   notifications.js, delivery-window.js, tracking-url.js, async-route-handler.js
│   ├── routes/                       # 50 routers:
│   │   ├── auth.js                   # login/signup/refresh/logout/setup-password (JWT + refresh sessions)
│   │   ├── users.js, drivers.js, driver.js, customers.js, vendors.js, sales-reps.js
│   │   ├── orders.js, invoices.js, deliveries.js, stops.js, routes.js, phone-orders.js
│   │   ├── inventory.js, lots.js, reorder.js, catch-weight.js, warehouse.js, warehouse-locations.js
│   │   ├── purchase-orders.js, vendor-bills.js, ops*.js + ops/ (purchasing/planning/admin/store)
│   │   ├── portal.js + portal/ (auth-routes, payment-{collection,method,profile}-routes, payments-shared, shared)
│   │   ├── portal-customer.js, portal-payments.js      # live portal modules
│   │   ├── portal-autopay.js, portal-invoice-payments.js, portal-payment-methods.js,
│   │   │   portal-payment-config.js, portal-payment-utils.js   # ⚠ DEAD legacy modules (unmounted)
│   │   ├── stripe-webhooks.js        # signature-verified, idempotent, amount-checked (clean)
│   │   ├── webhooks/bland.js         # phone-call webhook (⚠ secret in query, no company_id on insert)
│   │   ├── superadmin.js             # companies/users/impersonation/config override
│   │   ├── tracking.js, waitlist.js, public/inventory.js   # public surfaces
│   │   └── settings.js, integrations.js, company-config.js, onboarding.js, compliance.js,
│   │       credit-hold.js, ar-hub.js, audit-log.js, dwell.js, temperature-logs.js,
│   │       forecast.js, reporting.js, print.js
│   ├── services/                     # supabase.js (client + ResilientQuery), stripe.js (⚠ truncated),
│   │                                 #   email/sms/ai/pdf/printer, operating-context.js (tenant scoping),
│   │                                 #   creditEngine, reorderEngine, plan-limits, invoice-*, lot-*,
│   │                                 #   purchase-order-*, delivery-notifications, route-stop-sync, logger
│   ├── tests/                        # 57 test files incl. security-hardening, multi-tenant-penetration
│   ├── migrations/, db/migrations/   # ad-hoc SQL migrations
│   └── check_*.js, run_email_test.js, test_smtp_only.js, find_email_routes.js, grep_railway.js  # debug scripts
│
├── frontend-v2/                      # React 18 + React Query dashboard (served at /dashboard-v2)
│   ├── src/main.tsx                  # entry; BrowserRouter basename (dynamic /dashboard-v2)
│   ├── src/App.tsx                   # route-type dispatch, onboarding gate
│   ├── src/lib/                      # api.ts (cookie JWT + CSRF header), portalApi.ts (sessionStorage token),
│   │                                 #   nav.ts (nav config + RBAC), utils.ts
│   ├── src/hooks/                    # 33 data hooks (useAuth, useOrders, useMap polling, …)
│   ├── src/pages/                    # 70 page/feature components + helpers/types
│   ├── src/components/               # layout (AppShell/Sidebar), ui kit, warehouse/inventory widgets,
│   │                                 #   SessionExpiryBanner, SuperadminGuard, OnboardingWizard
│   ├── src-tauri/                    # desktop wrapper (⚠ csp: null in tauri.conf.json)
│   └── e2e/, tests/                  # Playwright specs
│
├── driver-app/                       # React PWA for drivers (cookie-session auth)
│   └── src/                          # hooks/useDriverApp.tsx, useOfflineQueue.ts (⚠ no idempotency),
│                                     #   useLocationUpdater.ts, lib/api.ts, lib/storage.ts (mostly dead),
│                                     #   pages (Login/Route/Stops/StopDetail/Invoices/Temperature/Sync)
│
├── landing-v2/                       # marketing site + WaitlistForm
├── ios-driver-app/                   # SwiftUI driver app (Keychain token storage; APIClient force-cast)
└── supabase/
    ├── migrations/                   # 60+ migrations; RLS broadly enabled (20260512/20260528)
    ├── supabase-*-migration.sql, all-migrations.sql   # legacy duplicates (hygiene)
    └── seeds/inventory_templates.json
```

---

## Section 5 format — all findings

Severity: C=Critical, H=High, M=Medium, L=Low. Line numbers verified against the working tree at commit `af02650`.

| # | File | Line | Category | Issue | Severity | Recommended fix |
|---|------|------|----------|-------|----------|-----------------|
| 1 | `qa_audit_full.js` | 7–9 | Exposed secrets | Production base URL + admin email + password (redacted) hardcoded; missed by prior audit | **Critical** | Read from env (`QA_BASE_URL`, `QA_EMAIL`, `QA_PASSWORD`); rotate the admin password; purge from git history with `git filter-repo` |
| 2 | `qa_recon.js` | 85, 90 | Exposed secrets | Same production admin credentials hardcoded into Playwright fills | **Critical** | Same as #1 |
| 3 | `backend/services/stripe.js` | 60 | Functionality / payments | Exports only `getClient`/`verifyWebhookSignature`, but the **live** portal payment chain (`routes/portal/payments-shared.js:9–19`, used by payment-collection/method/profile routes) destructures 8 missing functions (`isStripeConfigured`, `findOrCreateCustomer`, `createPaymentIntent`, `createSetupIntent`, `createCheckoutSession`, `retrievePaymentMethod`, `attach/detachPaymentMethod`, `portalMethodTypeForStripeType`) — all `undefined`. TypeError as soon as `PORTAL_PAYMENT_PROVIDER=stripe` (short-circuit at `payments-shared.js:124` hides it in manual/stub mode) | **Critical** | Restore the Stripe wrapper functions in `services/stripe.js` (they were dropped in the "Lazy load Stripe SDK client" refactor) and add a smoke test that requires every imported symbol to be a function |
| 4 | `backend/routes/webhooks/bland.js` | 27–43 | Tenant isolation | Phone orders inserted with **no `company_id`/`location_id`** — orphaned rows invisible to every tenant's scoped queries (and visible to context-less users, see #6) | **High** | Resolve tenant from the webhook secret (per-company secrets) or `DEFAULT_COMPANY_ID` and set `company_id`/`location_id` on insert |
| 5 | `backend/routes/webhooks/bland.js` | 12–13 | Secrets handling | Webhook secret accepted as `?secret=` query param — lands in access logs/proxies (prior M12, still open) | **Medium** | Move to an `Authorization: Bearer` header and compare with `crypto.timingSafeEqual` |
| 6 | `backend/services/operating-context.js` | 229, 237; 204–221 | AuthZ / tenant isolation | Fail-open scoping: `scopeQueryByContext` applies **no filter** when the user has no `companyId`, and `rowMatchesContext` passes rows whose `company_id` is NULL for every user | **High** | Fail closed: when `activeCompanyId` is null for a non-global operator, return an impossible filter (or throw); treat NULL-company rows as non-matching in `rowMatchesContext` |
| 7 | `backend/routes/portal/payment-collection-routes.js` | 100 | Payments / idempotency | Stripe `idempotencyKey` = `portal-autopay-${invoice.id}-${Date.now()}` — retries get a *new* key, so network-level retries can double-charge | **High** | Derive the key from stable client intent: `\`portal-autopay-${invoice.id}-${crypto.randomUUID()}\`` generated once per user action and reused across retries |
| 8 | `backend/lib/config.js` | 7, 129–133 | Weak credentials | Default bootstrap admin password `Admin@123`; production only **warns** (prior H8, still open) | **High** | Treat missing/weak `ADMIN_PASSWORD` as fatal in production, like `JWT_SECRET` at `config.js:115` |
| 9 | `backend/routes/auth.js` | 159–173 | Session management | Logout refresh-token revocation is best-effort; failure still returns 200 (prior H5, still open) | **High** | Await revocation, return 500 on failure, add revoked-token-reuse test |
| 10 | `driver-app/src/hooks/useOfflineQueue.ts` | 184–200, 226–270 | Real-time / data integrity | Offline queue actions carry only a timestamp — retry after a dropped response duplicates stop-status submissions (prior H7, still open) | **High** | Add `id: crypto.randomUUID()` to each queued action; dedupe server-side on the key; snapshot queue state at drain start |
| 11 | `driver-app/src/hooks/useDriverApp.tsx` | 247–326, 703–731 | Real-time / data integrity | Queued temperature logs and stop-note updates also lack idempotency keys; temp-log IDs use `Date.now()+Math.random()` | **High** | Same idempotency-key approach; use `crypto.randomUUID()` |
| 12 | `supabase/migrations/20260520_inventory_location_assignments.sql` | 18–19 | RLS | `FOR ALL TO authenticated USING (true) WITH CHECK (true)` and table has no `company_id` — tenant boundary absent at DB layer (prior H4, **still unfixed**; the `customer_visit_logs` half was fixed in `20260517_security_hardening_rls_gaps.sql`) | **High** | New migration: add `company_id`, replace the policy with `company_id = auth_company_id()` scoping (pattern from `20260518004013_repair_permissive_inventory_rls.sql`) |
| 13 | `frontend-v2/src-tauri/tauri.conf.json` | 39 | Security headers (desktop) | `"csp": null` — no CSP in the Tauri webview | **High** | Set `"csp": "default-src 'self'; connect-src 'self' https://<api-domain>; img-src 'self' data: blob:"` |
| 14 | `frontend-v2/package.json`, `driver-app/package.json` | dep | Dependency vuln | `react-router-dom` 6.x affected by same-origin open-redirect advisory (GHSA-2j2x-hqr9-3h42) | **High** | `npm audit fix` in both apps; retest routing |
| 15 | `backend/package.json` | dep | Dependency vuln | `npm audit --omit=dev`: 3 moderate (`qs` stringify DoS GHSA-q8mj-m7cp-5q26, `brace-expansion`); dev tree additionally flags `ws`, `uuid`, `ip-address`, `@anthropic-ai/sdk` | **Medium** | `npm audit fix` in `backend/`; schedule `@anthropic-ai/sdk` upgrade |
| 16 | `backend/routes/superadmin.js` | 392 | Mass assignment | `const updates = { ...req.body, … }` into `company_config` — superadmin-only, but no field allowlist and **no audit-log row** for feature-flag changes | **Medium** | Allowlist updatable columns; write an `audit_log` entry with the diff |
| 17 | `backend/routes/superadmin.js` | 236–247 | AuthZ / performance | Impersonation: `select('*')` over the **entire users table** per request; fallback matcher `String(u.company_id \|\| u.id) === id` lets the param match a bare user id; no audit-log entry (prior M3, still open) | **Medium** | Query by `company_id` directly; validate the company exists; insert an audit row on impersonate and restore |
| 18 | `backend/routes/superadmin.js` | restore-session handler (~310) | AuthZ | `restore-session` trusts the `sa_session` cookie + JWT role claim without re-verifying the caller is still the pinned superadmin in the DB | **Medium** | Re-load the user row and apply the `requireSuperadmin` email-pin check before reissuing the admin token |
| 19 | `backend/routes/waitlist.js` | 40 | AuthZ consistency | `GET /api/waitlist` uses `requireRole('superadmin')` instead of `requireSuperadmin` — bypasses the email pin (prior M4, still open) | **Medium** | Swap to `requireSuperadmin` |
| 20 | `backend/routes/waitlist.js` | 46 | Error leakage | Raw `error.message` returned to client | **Medium** | Log server-side; return generic message |
| 21 | `backend/routes/auth.js` | 43, 671 | Event-loop blocking | `bcrypt.hashSync` in signup/change-password request paths (prior M5, still open) | **Medium** | `await bcrypt.hash(pw, 10)` |
| 22 | `backend/services/supabase.js` | 548–553 | Injection (PostgREST) | `.or()` filter expression built by string interpolation without escaping (prior M6, still open) | **Medium** | Escape/quote values and allowlist fields before joining |
| 23 | `backend/server.js` | 76–84, 115 | Security headers | Helmet fully disabled; manual CSP allows `unsafe-inline` + `unsafe-eval` in `script-src` (prior M15, still open) | **Medium** | Remove `unsafe-eval`; configure helmet's CSP instead of disabling it |
| 24 | `backend/routes/ai.js`:764, `inventory.js`:460, `stops.js`:51,70 | — | Null deref | `.single()` results used without null checks → 500 instead of 404 (prior M9, still open) | **Medium** | `if (!data) return res.status(404).json({ error: 'Not found' })` |
| 25 | `backend/routes/superadmin.js`, `portal-customer.js` (22, 90, 135, 155, 170, 197) | various | Error leakage | Raw Supabase `error.message` echoed to clients (schema enumeration) | **Medium** | Generic client errors + server-side logging, repo-wide convention |
| 26 | `backend/routes/orders.js` ~986; `invoices.js` 214, 251 | — | REST correctness | POST create endpoints return 200 not 201 (prior M11, still open) | **Low** | `res.status(201)` |
| 27 | `backend/lib/config.js` | 74–75 | Key separation | `SESSION_SECRET`/`CSRF_SECRET` derive from `JWT_SECRET` when unset (prior L3) | **Low** | Make each mandatory in production |
| 28 | `backend/services/purchase-order-numbers.js` | 12–13 | Collision | 3-char base-36 random suffix on PO numbers (prior L4) | **Low** | `crypto.randomBytes(4).toString('hex')` + DB unique constraint with retry |
| 29 | `backend/routes/portal-autopay.js`, `portal-invoice-payments.js`, `portal-payment-methods.js`, `portal-payment-config.js`, `portal-payment-utils.js` | whole files | Dead code | Legacy portal payment modules are mounted nowhere (superseded by `routes/portal/*`) yet import the missing Stripe functions — confuses audits and grep | **Medium** | Delete them (git history preserves them) |
| 30 | `backend/server.js` | 233 | Misleading docs | Comment claims phone-orders is "authenticated via own webhook secret … not requireApiAuth" — it actually authenticates inside the router (`phone-orders.js:13`); comment invites a future regression | **Low** | Fix the comment (or mount `requireApiAuth` at server level for consistency) |
| 31 | `frontend-v2/src/lib/nav.ts` | 91, 124, 144, 145 | RBAC (UI) | Phone Orders / Credit Hold / Integrations / Compliance roles arrays exclude `superadmin` — pages hidden from the platform owner (prior M1, still open) | **Medium** | Add `'superadmin'` or make `canAccess()` return true for superadmin |
| 32 | `backend/server.js` 259–273 vs `frontend-v2/src/lib/nav.ts` | — | Routing | Top-level SPA alias list out of sync with nav paths: `/compliance`, `/dsr`, `/credit-hold`, `/ai-help`, `/forecasting`, `/traceability`, `/companies`, `/dashboard` not served; stale entries `/credit`, `/aihelp`, `/forecast`, `/admin/traceability`, `/superadmin/companies`, `/reorder` silently redirect to dashboard. (Deep links under `/dashboard-v2/*` are unaffected — catch-all at `server.js:255`.) | **Medium** | Generate `frontendV2Routes` from one shared route manifest, or drop top-level aliases entirely and redirect to `/dashboard-v2/<path>` |
| 33 | `frontend-v2/src/App.tsx` | 51 | Silent failure | Onboarding gate fail-open: fetch error silently treated as "done" (prior M13 remainder) | **Low** | Show an error state / retry instead of `catch(() => setState('done'))` |
| 34 | `scripts/capture-v2-screenshots.mjs` | 11, 29 | Weak default secret | Falls back to password `Admin@123` when `CAPTURE_PASSWORD` unset; writes `nr_token` into localStorage | **Low** | Require env vars; fail with a clear error when unset |
| 35 | `backend/routes/portal/payments-shared.js` | 21–26 | Config hygiene | Reads `PORTAL_PAYMENT_*`, `STRIPE_PUBLISHABLE_KEY` from `process.env` directly, bypassing `lib/config.js` validation (prior M12 pattern) | **Low** | Move reads into `config.js` with startup validation |
| 36 | `ios-driver-app/.../Networking/APIClient.swift` | 140 | Crash risk | `EmptyResponse() as! Response` force-cast crashes on non-empty generic responses | **Medium** | Use `as?` with a decoding error fallback |
| 37 | `ios-driver-app/.../App/SessionStore.swift` | 24 | Silent failure | `try? tokenStore.read(.access)` — Keychain read errors indistinguishable from logged-out | **Low** | do/catch with logging; surface the error state |
| 38 | `driver-app/src/lib/storage.ts` | 41–68 | Dead code | Token persistence functions never called (auth is cookie-based) | **Low** | Delete; document the cookie-session design |
| 39 | `driver-app/src/hooks/useLocationUpdater.ts` | 31–36 | Missing feedback | Geolocation errors swallowed — driver never learns GPS sharing failed | **Low** | One-time toast on permission denial |
| 40 | `driver-app/src/components/SignatureCaptureModal.tsx` | 56–78 | Missing feedback | `getContext('2d')` failures silent; null-canvas error message misleading | **Low** | Guard the context, distinguish error messages |
| 41 | `landing-v2/src/components/WaitlistForm.tsx` | 40, 93–98 | Missing feedback | All failures collapse to "Something went wrong" — no distinction between validation/network/server errors | **Low** | Branch on response status / error type |
| 42 | `.github/workflows/ci.yml` | — | Supply chain | Actions pinned by tag (`@v4`), not commit SHA | **Low** | Pin to full SHAs |
| 43 | `supabase/supabase-*-migration.sql`, `all-migrations.sql` | — | Hygiene | Legacy SQL duplicates the migrations dir; old orders file still contains a superseded `USING (true)` policy (prior L9) | **Low** | Move to `supabase/legacy/` with README |
| 44 | `backend/` root debug scripts; `recon_shots/`, `test_screenshot.png`, `*.docx` | — | Hygiene | Debug scripts and binary QA artifacts committed at repo root (prior L10 + new) | **Low** | Move scripts to `backend/scripts/debug/`; remove artifacts and gitignore them |
| 45 | git history | — | Exposed secrets | The pre-#183 production admin password remains in git history (`check_production_email.js`), now joined by the QA-script credentials (#1/#2) | **Critical** (until rotated) | Rotate the password **now**; purge history with `git filter-repo`/BFG; audit access logs |

### Frontend behavior — verified clean (frontend-v2, driver-app, landing-v2)

- No `dangerouslySetInnerHTML`/`eval`; print popups (`InventoryPage.tsx:350`, `InvoicesPage.tsx:229`) escape content before `document.write`.
- JWT in httpOnly cookie; CSRF token read from readable cookie and sent as `X-CSRF-Token` (`frontend-v2/src/lib/api.ts:39–42`); portal token in sessionStorage; no tokens in localStorage (only the `nr_user` role marker).
- All sampled form buttons carry explicit `type=`; `onSubmit` handlers call `preventDefault`; mutation buttons sampled all guard with `isPending`-style `disabled` and have `onError` handlers; `useEffect` listeners/intervals have cleanups (`SessionExpiryBanner.tsx:31–34`, `useLocationUpdater.ts:56`, `useAuth.ts:66`).
- Driver-app token refresh loop bounded (`allowRefresh: false` retry guard); offline queue surfaces 409 conflicts instead of dropping them.

### Backend — verified clean

- Every `/api/*` router authenticated except the deliberate public set; role checks DB-backed; `requireSuperadmin` email-pinned and fail-closed.
- Stripe webhook: signature verified with timestamp tolerance (`services/stripe.js:29–58`), idempotent via `stripe_webhook_events` unique constraint, amount and `company_id` cross-checked.
- Scheduler cron jobs wrapped in try/catch (prior M10 fixed). No `.env` ever committed (history checked). Sentry DSNs env-based. No SECURITY DEFINER search-path issues; no GRANTs to `anon`; RLS broadly enabled by the 20260512/20260528 migrations.

---

## Priority fix list (top 10 by severity × ease)

1. **Rotate the production admin password and strip the QA scripts (#1, #2, #45).**
   ```js
   // qa_audit_full.js / qa_recon.js
   const BASE_URL       = process.env.QA_BASE_URL  || 'http://localhost:3001';
   const LOGIN_EMAIL    = process.env.QA_EMAIL;
   const LOGIN_PASSWORD = process.env.QA_PASSWORD;
   if (!LOGIN_EMAIL || !LOGIN_PASSWORD) { console.error('Set QA_EMAIL / QA_PASSWORD'); process.exit(1); }
   ```
   Then purge history: `git filter-repo --replace-text <(echo 'Admin123==>REDACTED')` and force-rotate the account.

2. **Scope Bland webhook orders to a tenant (#4).**
   ```js
   const { DEFAULT_COMPANY_ID, DEFAULT_LOCATION_ID } = require('../../lib/config');
   .insert({
     source: 'phone', status: 'draft',
     company_id: DEFAULT_COMPANY_ID || null,   // better: map per-company webhook secrets
     location_id: DEFAULT_LOCATION_ID || null,
     ...
   })
   ```

3. **Move the Bland secret out of the query string (#5).**
   ```js
   const provided = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
   const expected = process.env.BLAND_WEBHOOK_SECRET || '';
   const ok = expected && provided.length === expected.length &&
     crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
   if (!ok) return res.status(401).json({ error: 'Unauthorized' });
   ```

4. **Stable Stripe idempotency keys (#7).**
   ```js
   // payment-collection-routes.js — accept a client-generated key, fall back once per attempt
   const idempotencyKey = req.body.idempotencyKey
     ? `portal-autopay-${invoice.id}-${String(req.body.idempotencyKey).slice(0, 64)}`
     : `portal-autopay-${invoice.id}-${crypto.randomUUID()}`;
   ```

5. **Restore the Stripe service functions (#3).** Re-add `isStripeConfigured`, `findOrCreateCustomer`, `createPaymentIntent`, `createSetupIntent`, `createCheckoutSession`, `retrievePaymentMethod`, `attachPaymentMethod`, `detachPaymentMethod`, `portalMethodTypeForStripeType` to `services/stripe.js` and export them; add a contract test:
   ```js
   const stripe = require('../services/stripe');
   for (const fn of ['isStripeConfigured','findOrCreateCustomer','createPaymentIntent',
     'createSetupIntent','createCheckoutSession','retrievePaymentMethod',
     'attachPaymentMethod','detachPaymentMethod','portalMethodTypeForStripeType'])
     expect(typeof stripe[fn]).toBe('function');
   ```

6. **Fail-closed tenant scoping (#6).**
   ```js
   function scopeQueryByContext(query, context, options = {}) {
     if (!query || !context || context.isGlobalOperator) return query;
     const activeCompanyId = normalizeId(context.activeCompanyId || context.companyId);
     if (!activeCompanyId) {
       // No tenant context — match nothing rather than everything.
       return query.eq(options.companyField || 'company_id', '00000000-0000-0000-0000-000000000000');
     }
     ...
   }
   ```

7. **Make `ADMIN_PASSWORD` fatal in production (#8).**
   ```js
   // lib/config.js validate()
   if (isProduction && (!process.env.ADMIN_PASSWORD || isWeakPassword(ADMIN_PASSWORD)))
     fatal.push('ADMIN_PASSWORD is missing or too weak — required in production');
   ```

8. **Email-pin the waitlist admin endpoint (#19, #20).**
   ```js
   const { requireSuperadmin } = require('../middleware/auth');
   router.get('/', authenticateToken, requireSuperadmin, async (req, res) => {
     ...
     if (error) { logger.error({ err: error.message }, 'waitlist list failed');
       return res.status(500).json({ error: 'Failed to load waitlist' }); }
   ```

9. **Dependency patching (#14, #15).**
   ```bash
   npm audit fix --prefix backend && npm audit fix --prefix frontend-v2 && npm audit fix --prefix driver-app
   ```

10. **Unhide pages from superadmin (#31).**
    ```ts
    export function canAccess(item: NavItem, role: Role): boolean {
      if (role === 'superadmin') return true;          // platform owner sees everything
      if (!item.roles || item.roles.length === 0) return true;
      return item.roles.includes(role);
    }
    ```

---

## Health score

| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Security | **15 / 25** | Strong core (DB-backed authz, CSRF, cookie JWTs, webhook verification, broad RLS) undermined by live credentials in the repo, a fail-open scoping layer, one permissive RLS policy, and weak default admin password |
| Frontend Reliability | **19 / 25** | Disciplined React patterns — loading guards, cleanups, escaping all verified clean; deductions for the stale top-level route aliases, superadmin-hidden pages, and silent failure states |
| Code Quality | **16 / 25** | Good layering and 57-file test suite; deductions for five dead legacy portal modules importing nonexistent functions, debug scripts/artifacts at repo root, duplicated utils, error-leakage inconsistency |
| Real-Time Safety | **17 / 25** | Polling architecture is sound and intervals are cleaned up; offline queue still lacks idempotency (duplicate deliveries/temp logs possible), payment idempotency keys unstable |
| **Total** | **67 / 100** | |

**Totals: 4 Critical · 9 High · 14 Medium · 18 Low — 45 findings** (10 of which are carried over, still open, from the 2026-06-11 audit).
