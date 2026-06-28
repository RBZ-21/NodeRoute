# NodeRoute Deep Security And Code Quality Audit

Date: 2026-06-25
Scope: `/Users/ryan/NodeRoute Systems/NodeRoute`
Method: static source review, targeted pattern searches, three parallel read-only audit passes, and `npm audit --workspaces --omit=dev --json`.

## Coverage Notes

- Reviewed source/runtime surfaces: `backend/`, `frontend-v2/src`, `driver-app/src`, `landing-v2/src`, `ios-driver-app/NodeRouteDriver`, `frontend-v2/src-tauri`, `supabase/**/*.sql`, root deployment/config scripts, package manifests.
- Enumerated 747 non-dependency source/config/doc files. `node_modules`, `.git`, Rust/Tauri `target`, generated `dist` bundles, screenshots, binary assets, spreadsheets, PDF/DOCX, and generated schema JSON were treated as generated/artifact surfaces unless they directly affect runtime configuration.
- `.env` exists locally and contains real secrets, but `.gitignore` excludes `.env` and `.env.*`. Do not commit it. Rotate if it has ever been shared.
- Supabase findings are static-analysis only; no live database/advisor connection was available.

## Structure Map

| Path | Role |
|---|---|
| `.env.example` | Environment variable template for backend, frontend, payments, email, AI, maps, SMS, QA tooling. |
| `.gitignore` | Secret/build/dependency exclusions; correctly ignores `.env` and `.env.*`. |
| `.github/workflows/ci.yml`, `.github/workflows/codeql.yml` | CI and CodeQL security workflow configuration. |
| `AGENTS.md` | Local agent/developer operational notes, including auth/CSRF/security expectations. |
| `README.md` | Product and setup documentation. |
| `backend/server.js` | Express app bootstrap, middleware, CORS, headers, route mounting, static asset serving, error handler. |
| `backend/middleware/auth.js` | JWT/cookie auth, CSRF double submit, role guards, superadmin guard. |
| `backend/middleware/rateLimiter.js` | Express rate-limit policies for global/auth/public/AI/portal flows. |
| `backend/lib/*.js` | Validation schemas, config validation, scheduler helpers, tracking URLs, notification parsing, safe error utilities. |
| `backend/routes/*.js` | Express route controllers for auth, users, orders, invoices, inventory, deliveries, stops, routes, customers, AI, reports, payments, superadmin, etc. |
| `backend/routes/portal/*.js` | Customer portal auth, payment profile, payment method, and payment collection controllers. |
| `backend/routes/public/inventory.js` | API-key protected public inventory integration endpoint. |
| `backend/routes/webhooks/bland.js` | Bland.ai webhook receiver and phone order ingestion. |
| `backend/services/*.js` | Supabase adapter, email, Stripe, AI, PDF/print, inventory ledger, reorder, recurring orders, delivery notifications, company settings, and business workflows. |
| `backend/tests/*.test.js` | Backend unit/security/contract tests. |
| `backend/migrations/*.sql`, `backend/db/migrations/*.sql` | Older backend-local SQL migrations. |
| `supabase/migrations/*.sql` | Supabase schema, RLS, indexes, functions, feature migrations. |
| `supabase/*.sql` | Rollup/legacy Supabase migration files. |
| `supabase/seeds/inventory_templates.json` | Product/inventory template seed data. |
| `frontend-v2/src/App.tsx`, `main.tsx`, `instrument.ts` | Main dashboard React app bootstrap, routing, Sentry instrumentation. |
| `frontend-v2/src/lib/*.ts` | Browser API clients, portal API client, navigation utilities. |
| `frontend-v2/src/hooks/*.ts(x)` | React Query/data hooks for dashboard, auth, portal, inventory, orders, routes, reports, users, etc. |
| `frontend-v2/src/pages/*.tsx` | Dashboard/product pages and page-local workflows. |
| `frontend-v2/src/components/**/*.tsx` | Shared UI, layout, inventory, warehouse, onboarding, map, session/impersonation components. |
| `frontend-v2/src-tauri/*` | Tauri desktop configuration, Rust app shell, capabilities, bundle config. |
| `driver-app/src/*.tsx`, `driver-app/src/pages/*.tsx` | Driver PWA React app, route/stops/sync/login/invoice/temperature pages. |
| `driver-app/src/lib/*.ts`, `driver-app/src/hooks/*.tsx` | Driver API/storage/offline/location/toast hooks. |
| `landing-v2/src/*.tsx`, `landing-v2/src/components/*.tsx` | Public landing page and waitlist form. |
| `ios-driver-app/NodeRouteDriver/**/*.swift` | Native iOS driver app: session store, API client, views, models, theme. |
| `scripts/*.mjs`, `qa_*.js`, `backend/check_*.js` | Local QA, screenshots, email, Railway, and seed tooling. |
| `docs/**` | Security notes, PR notes, feature specs, training guide, screenshots. |
| `outputs/**`, `recon_shots/**`, `*.pdf`, `*.docx`, images/videos | Generated artifacts, QA evidence, media, exports. |

## Findings

| # | File | Line | Category | Issue Description | Severity | Recommended Fix |
|---|---|---:|---|---|---|---|
| 1 | `.env` | 2 | Exposed secrets/local secret hygiene | Local `.env` contains live Supabase, JWT, Resend/SMTP, OpenAI, Maps, Twilio, and admin secrets. It is ignored by Git, but it is still high-impact if copied, uploaded, or used in screenshots/logs. | High | Keep ignored, restrict file permissions, never attach it to support prompts, and rotate secrets if the file was ever shared. |
| 2 | `backend/routes/stripe-webhooks.js` | 117 | Payment authorization | Portal checkout webhook pays all open invoices for `company_id`, not the exact portal customer/invoice set that initiated checkout. A customer could pay/mark another same-tenant customer's invoices if balances match. | High | Store immutable `customer_email` plus invoice IDs/hash in checkout metadata and update only invoices matching `company_id`, optional `location_id`, `customer_email`, and those IDs. |
| 3 | `supabase/migrations/20260528_enable_rls_all_public_tables.sql` | 85 | Supabase RLS | Global hardening creates new tenant policies but does not drop older permissive policies. Because permissive policies OR together, old `USING (true)` policies can keep data globally accessible. | High | Add a hardening migration that drops legacy broad policy names before recreating final policies; verify `pg_policies` has no `qual in ('true','(true)')` except intentional write-only/public tables. |
| 4 | `supabase/migrations/20260601144934_repair_signup_setup_schema.sql` | 66 | Supabase RLS | `company_config` is granted to `authenticated` after the global RLS sweep but no RLS is enabled in that migration. | High | Enable RLS and add a tenant policy in the same/follow-up migration, or revoke direct `authenticated` grants. |
| 5 | `supabase/migrations/20260601_fix_sync_route_stop_uuid_cast.sql` | 13 | Privileged database function | Public `SECURITY DEFINER` RPC rewrites `stops` without tenant/auth checks, search_path pinning, or execute revocation. | High | Move to private schema or make invoker. If definer is required, set `search_path`, check `auth.uid()`/tenant ownership, reject cross-company IDs, revoke from `PUBLIC/anon/authenticated`, and grant only to a safe backend role. |
| 6 | `supabase/migrations/20260528_enable_rls_all_public_tables.sql` | 10 | Supabase authz | RLS trusts top-level JWT `companyId`/`role` before `app_metadata`. If those claims are ever user-editable/stale, tenants or platform role can be spoofed. | High | Use only server-controlled `app_metadata` or table-derived membership keyed by `auth.uid()` for RLS authorization. |
| 7 | `backend/services/supabase.js` | 677 | RLS bypass blast radius | Backend always uses the Supabase service-role key, bypassing RLS. Any route-layer auth or scoping bug becomes full database access. | Medium | Split admin/service client from request-scoped user client; restrict service-role operations to explicit backend jobs and enforce centralized tenant checks. |
| 8 | `backend/services/supabase.js` | 663 | RPC exposure | Resilient wrapper forwards arbitrary RPC names to Supabase. Combined with service-role use, accidental route use can invoke privileged functions without an allowlist. | Medium | Add an RPC allowlist and route-specific wrappers for approved functions only. |
| 9 | `backend/package.json` | 26 | Dependency vulnerabilities | `multer@2.1.1` is affected by high/moderate DoS advisories. Upload routes are reachable in AI and purchase-order scan flows. | High | Upgrade to patched `multer` (`>=2.2.0` when available per audit), rerun `npm audit`, and keep file count/field limits. |
| 10 | `backend/package.json` | 28 | Dependency vulnerabilities | `nodemailer@8.0.5` has multiple advisories, including high raw-option file read/SSRF and header/TLS issues. Mail sending is used by auth, invoices, lots, scheduler, and portal flows. | High | Upgrade Nodemailer to current patched major, ensure `disableFileAccess` and `disableUrlAccess` are set where supported, and do not pass raw user-controlled mail fields. |
| 11 | `backend/package.json` | 21 | Dependency vulnerabilities | `npm audit --workspaces --omit=dev` reports a moderate Sentry/OpenTelemetry unbounded baggage memory allocation chain. | Medium | Upgrade `@sentry/node`/related OpenTelemetry packages and rerun audit. |
| 12 | `backend/server.js` | 299 | Error handling | Central error handler hides details in production, but many route handlers return `err.message` directly, bypassing the central handler. | Medium | Add and use a shared `sendSafeError` helper that logs full details but sends generic production messages. |
| 13 | `backend/routes/stops.js` | 220 | Error handling | Stop creation returns raw `err.message` to clients. Similar raw DB errors recur through stops, deliveries, lots, invoices, AI, portal payments, and superadmin routes. | Medium | Replace raw error responses with safe messages and structured logging. |
| 14 | `backend/lib/config.js` | 144 | Config hardening | Missing/invalid production `BASE_URL` and missing `CORS_ORIGINS` are logged as errors but the process still starts because only `fatal` exits. | Medium | Treat production config errors as fatal or explicitly downgrade them to warnings; exit on unsafe production redirect/CORS config. |
| 15 | `backend/routes/auth.js` | 602 | Code quality/race | Signup fetches all users to check duplicate email, causing full-table scans and race-prone uniqueness enforcement. | Medium | Query the normalized target email only and rely on a unique DB index; handle `23505` conflicts. |
| 16 | `backend/routes/auth.js` | 432 | Code quality/race | Company slug generation fetches all company slugs and races under concurrent signups. | Medium | Add a unique slug index and generate candidates with bounded retries, handling `23505`. |
| 17 | `backend/lib/auth-schemas.js` | 27 | Weak password policy | User passwords only require 12 characters, weaker than the bootstrap admin complexity rule. | Medium | Reuse the strong password regex/entropy check for signup, setup, reset, and change-password flows. |
| 18 | `backend/routes/auth.js` | 138 | Event-loop blocking | Login uses synchronous bcrypt compare in request handling. Under bursts this blocks Node's event loop. | Low | Switch to `await bcrypt.compare(...)`. |
| 19 | `backend/routes/purchase-orders.js` | 52 | Upload hardening | Purchase-order scan upload accepts any `image/*` and PDF by MIME, with memory storage and no field-count/nested-field guard. | Medium | Upgrade Multer, add `limits.files`, `limits.fields`, validate file magic bytes, and reject SVG/unsupported image types. |
| 20 | `backend/routes/ai.js` | 31 | Upload hardening | AI upload uses memory storage and file-size limit but no file type filter in the route-local multer config. | Medium | Add file filter, magic-byte validation, file count/field limits, and explicit allowed MIME list. |
| 21 | `backend/routes/stops.js` | 647 | Authorization | `POST /api/stops/:id/notes` lets any driver role update notes on any in-scope stop without checking assignment, unlike other stop driver actions. | Medium | For drivers, fetch the stop and require `stop.driver_id === req.user.id` or route assignment before update. |
| 22 | `backend/routes/stops.js` | 225 | Input validation | Stop patch accepts allowlisted fields but does not schema-validate values for many fields before updating the DB. | Medium | Add Zod schemas for stop patch, signature, weight, notes, arrive/depart/defer payloads. |
| 23 | `backend/routes/stops.js` | 248 | Service-role scoping | Driver stop patch verifies assignment, then updates via unscoped `supabase.from('stops')` service-role query. | Medium | Keep the assignment check and also use `scopeQueryByContext(...).eq('driver_id', req.user.id)` for the update. |
| 24 | `backend/routes/deliveries.js` | 551 | Authorization | `PATCH /deliveries/:id/status` allows any authenticated non-driver role, not just admin/manager/assigned driver. | Medium | Add `requireRole('admin','manager','driver')` and preserve driver assignment check. |
| 25 | `backend/routes/portal/shared.js` | 236 | CSRF | Portal mutating APIs rely on SameSite Strict portal cookies but do not use a CSRF token/header like the main app. | Low | Add portal CSRF double-submit or at minimum Origin/Referer validation for portal mutating requests. |
| 26 | `driver-app/src/pages/StopDetailPage.tsx` | 94 | Sensitive local storage | Proof photos and stop drafts, including base64 images and notes, are persisted to localStorage. | High | Store blobs in IndexedDB with TTL, clear after sync/logout, and consider WebCrypto encryption for offline drafts. |
| 27 | `driver-app/src/lib/storage.ts` | 89 | Sensitive local storage | Driver route cache and offline queues store operational PII without schema validation, expiry, or user scoping. | Medium | Add versioned schemas, TTLs, user/route scoping, and clear stale records on account mismatch. |
| 28 | `driver-app/src/pages/StopDetailPage.tsx` | 355 | Frontend reliability | Photo capture reads whole files as data URLs with no size/type validation or compression. | Medium | Validate MIME/size, downscale/compress, store Blob in IndexedDB, and show errors before save/upload. |
| 29 | `driver-app/src/pages/RoutePage.tsx` | 77 | Async UX | `prepareOfflineRoute()` is invoked with `void`; failures are not handled at page level. | Medium | Wrap calls in `try/catch`, show toast/inline errors, and report partial offline pack failures. |
| 30 | `driver-app/src/pages/InvoicesPage.tsx` | 9 | Async UX | `viewInvoice()` sets loading but has no catch/user-facing error for PDF fetch/open failures. | Medium | Catch errors, show toast/inline error, and distinguish offline cache miss from server failure. |
| 31 | `ios-driver-app/NodeRouteDriver/App/SessionStore.swift` | 56 | Mobile auth | iOS stores access/refresh tokens but API calls only use access token and no refresh-on-401 flow. | Medium | Implement token refresh/retry in the shared API layer and rotate stored tokens. |
| 32 | `ios-driver-app/NodeRouteDriver/App/SessionStore.swift` | 110 | Mobile auth | iOS action methods often catch errors as alerts and leave a bad token marked authenticated. | Medium | On `APIError.unauthorized`, refresh or logout consistently across all authenticated actions. |
| 33 | `ios-driver-app/NodeRouteDriver/Features/Temperature/TemperatureLogView.swift` | 41 | Form reliability | Temperature form clears values even when submission fails because the store swallows failures into alert state. | Medium | Return/throw success from submit and clear fields only on success; add submitting state. |
| 34 | `frontend-v2/src-tauri/capabilities/default.json` | 10 | Desktop app permissions | Tauri grants broad `fs:default` and `dialog:default` permissions to a window that loads `https://noderoutesystems.com/login`. | Medium | Minimize Tauri permissions for remote content; prefer least-privilege command allowlists and strict origin isolation. |
| 35 | `supabase/migrations/20260517_security_hardening_rls_gaps.sql` | 52 | Supabase RLS | Several policies allow `company_id is null`, making unscoped rows globally visible/writable to authenticated users. | Medium | Backfill tenant IDs, set `company_id not null` for tenant-owned data, and model intentional global rows separately. |
| 36 | `supabase/migrations/20260512_enable_rls_tenant_tables.sql` | 6 | Supabase RLS | Older self-referential `users` policies remain and can cause recursion or confusing policy expansion. | Medium | Drop old `*_tenant_isolation` policies during final hardening and use non-recursive helpers. |
| 37 | `supabase/migrations/20260528_query_performance_indexes.sql` | 5 | Privileged helper cleanup | Public migration helper for dynamic index creation may remain callable and interpolates raw index column SQL. | Low | Drop helper after use or revoke execute from `PUBLIC`, `anon`, and `authenticated`; validate/quote structured identifiers. |
| 38 | `supabase/migrations/20260612_ai_insights.sql` | 20 | Schema consistency/indexing | `ai_insights.company_id` is text rather than a UUID FK; generic RLS casts `company_id::text`, weakening index use and consistency. | Low | Standardize tenant IDs as UUID FKs and compare UUID-to-UUID in RLS helpers. |
| 39 | `landing-v2/src/components/WaitlistForm.tsx` | 34 | Frontend error handling | Waitlist parses JSON and accepts duplicate status before checking HTTP success. | Low | Check `res.ok` first, parse JSON defensively, and branch only on expected statuses. |
| 40 | `landing-v2/src/components/Nav.tsx` | 55 | Routing | Landing CTAs point to `/login` and `/signup?fresh=1`; static landing-only deployment will 404 unless rewrites exist. | Low | Use absolute product URLs or configure hosting rewrites to the dashboard app. |

## Positive Controls Observed

- `.gitignore` excludes `.env` and `.env.*`.
- Main app auth uses HttpOnly access/refresh cookies with SameSite Strict and a readable CSRF double-submit token.
- Express has global rate limiting, auth-specific rate limiting, Helmet plus explicit security headers, and explicit CORS allowlists.
- Many backend routes use role guards plus `scopeQueryByContext`/`rowMatchesContext`.
- Public tracking and portal auth flows show enumeration-aware design.
- There are dedicated security and multi-tenant tests in `backend/tests`.

## Priority Fix List

1. Lock portal checkout to exact customer/invoice set.

```js
metadata: {
  checkout_type: 'portal_checkout',
  customer_email: req.customerEmail,
  invoice_ids: balance.openInvoices.map((i) => i.id).join(','),
  invoice_hash: hashInvoiceSet(balance.openInvoices),
  company_id: portalCompanyId(req.portalContext),
  location_id: portalLocationId(req.portalContext) || '',
}
```

2. Drop permissive legacy RLS policies.

```sql
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies
           where schemaname = 'public'
             and (qual in ('true', '(true)') or policyname like '%tenant_isolation%')
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;
```

3. Enable RLS on `company_config`.

```sql
alter table public.company_config enable row level security;
drop policy if exists "company_config: tenant scoped" on public.company_config;
create policy "company_config: tenant scoped"
on public.company_config for all to authenticated
using (public.is_platform_admin() or company_id::text = public.auth_company_id_text())
with check (public.is_platform_admin() or company_id::text = public.auth_company_id_text());
```

4. Harden or remove the definer RPC.

```sql
alter function public.sync_route_stop_assignments(text, text[], text[])
  set search_path = public, pg_temp;
revoke all on function public.sync_route_stop_assignments(text, text[], text[]) from public, anon, authenticated;
```

5. Stop trusting top-level JWT RLS claims.

```sql
create or replace function public.auth_company_id_text()
returns text language sql stable as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'company_id', '')
$$;
```

6. Upgrade vulnerable runtime dependencies.

```bash
npm install --workspace=backend multer@latest nodemailer@latest @sentry/node@latest
npm audit --workspaces --omit=dev
npm test --workspace=backend
```

7. Add safe route error helper.

```js
function sendSafeError(res, err, fallback = 'Request failed') {
  req?.log?.error?.({ err }, fallback);
  const message = process.env.NODE_ENV === 'production' ? fallback : (err?.message || fallback);
  return res.status(err?.status || 500).json({ error: message });
}
```

8. Fix stop notes driver authorization.

```js
if (req.user.role === 'driver') {
  const { data: stop } = await scopeQueryByContext(
    supabase.from('stops').select('driver_id, company_id, location_id'),
    req.context
  ).eq('id', stopId).single();
  if (!stop || String(stop.driver_id) !== String(req.user.id)) {
    return res.status(403).json({ error: 'Access denied' });
  }
}
```

9. Move POD drafts out of localStorage.

```ts
// Store metadata in localStorage only; store photo Blob in IndexedDB with TTL.
await podDraftDb.put('photos', { id: draftId, blob: compressedBlob, expiresAt, userId, stopId });
localStorage.setItem(STOP_DRAFTS_KEY, JSON.stringify({ [stopId]: { draftId, notes, updatedAt } }));
```

10. Treat production config errors as fatal.

```js
if (isProduction && errors.length) {
  errors.forEach((msg) => logger.fatal(msg));
  process.exit(1);
}
```

## Health Score

| Dimension | Score |
|---|---:|
| Security | 14/25 |
| Frontend Reliability | 18/25 |
| Code Quality | 17/25 |
| Real-Time / Offline Safety | 16/25 |
| Total | 65/100 |

## Verification Commands Run

```bash
git --no-pager status --short --branch
npm audit --workspaces --omit=dev --json
rg --pcre2 -n "<button(?![^>]*type=)|..."
rg -n "SECURITY DEFINER|auth.jwt|auth.role|create policy|grant .* authenticated" supabase -g '*.sql'
curl -fsSL https://supabase.com/changelog.md
```

## Residual Risk

- I did not connect to the live Supabase project, so actual applied policies may differ from migration text. Run Supabase advisors/RLS tester against the deployed database.
- I did not run the full test suite; this was an audit-only pass.
- Generated bundles and binary artifacts were inventoried but not reverse-reviewed line by line because source files are present.

## Remediation Implementation - 2026-06-25

Status: top 10 remediation items implemented or prepared as exact deployable changes.

### Files Changed

| Area | Files |
|---|---|
| Portal checkout and Stripe webhook | `backend/lib/invoice-set-hash.js`, `backend/routes/portal/payments-shared.js`, `backend/routes/portal/payment-collection-routes.js`, `backend/routes/stripe-webhooks.js` |
| Supabase RLS/RPC migration | `supabase/migrations/20260625204708_harden_rls_rpc_portal_checkout.sql` |
| Runtime dependency upgrades | `package.json`, `backend/package.json`, `package-lock.json` |
| Safe errors and config fail-fast | `backend/lib/safe-error.js`, `backend/lib/config.js` |
| Driver/backend authorization | `backend/routes/stops.js`, `backend/routes/deliveries.js` |
| Driver POD draft storage | `driver-app/src/lib/storage.ts`, `driver-app/src/hooks/useDriverApp.tsx`, `driver-app/src/hooks/useOfflineQueue.ts`, `driver-app/src/pages/StopDetailPage.tsx`, `driver-app/src/pages/SyncPage.tsx`, `driver-app/src/types.ts`, `driver-app/src/pages/StopDetailPage.test.tsx` |
| Regression coverage | `backend/tests/top-remediation-hardening.test.js` |

### Fix Breakdown

1. Portal checkout is now locked to the exact invoice set.

Before:

```js
metadata: {
  source: 'portal_checkout',
  customer_email: req.customerEmail,
  company_id: portalCompanyId(req.portalContext),
  location_id: portalLocationId(req.portalContext),
}
```

After:

```js
metadata: {
  source: 'portal_checkout',
  checkout_type: 'portal_checkout',
  customer_email: req.customerEmail,
  invoice_ids: invoiceIds,
  invoice_hash: hashInvoiceSet(balance.openInvoices),
  company_id: portalCompanyId(req.portalContext),
  location_id: portalLocationId(req.portalContext),
}
```

The webhook now parses `invoice_ids`, reloads only those invoices for `company_id`, optional `location_id`, and `customer_email`, verifies payable statuses, verifies `invoice_hash`, verifies total paid, and updates only that scoped set.

2. Legacy permissive RLS policies are dropped in a follow-up migration.

```sql
do $$
declare
  policy_record record;
begin
  for policy_record in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename <> 'waitlist'
      and (
        policyname = 'Allow all for authenticated'
        or policyname ilike '%tenant_isolation%'
        or coalesce(qual, '') in ('true', '(true)')
      )
  loop
    execute format('drop policy if exists %I on %I.%I', policy_record.policyname, policy_record.schemaname, policy_record.tablename);
  end loop;
end $$;
```

3. `company_config` RLS is reasserted.

```sql
alter table if exists public.company_config enable row level security;
create policy "company_config: tenant scoped authenticated"
  on public.company_config
  for all
  to authenticated
  using (public.is_platform_admin() or company_id::text = public.auth_company_id_text())
  with check (public.is_platform_admin() or company_id::text = public.auth_company_id_text());
```

4. The public definer RPC is pinned and revoked.

```sql
create or replace function public.sync_route_stop_assignments(...)
returns void
language plpgsql
security definer
set search_path = public, pg_temp;

revoke all on function public.sync_route_stop_assignments(text, text[], text[]) from public;
revoke all on function public.sync_route_stop_assignments(text, text[], text[]) from anon;
revoke all on function public.sync_route_stop_assignments(text, text[], text[]) from authenticated;
grant execute on function public.sync_route_stop_assignments(text, text[], text[]) to service_role;
```

5. RLS helpers now use only server-controlled `app_metadata`.

Before:

```sql
coalesce(auth.jwt() ->> 'company_id', auth.jwt() -> 'app_metadata' ->> 'company_id')
```

After:

```sql
auth.jwt() -> 'app_metadata' ->> 'company_id'
```

6. Runtime dependency vulnerabilities were remediated.

Updated:

```text
@sentry/node: ^10.51.0 -> ^10.61.0
multer:       ^2.1.1  -> ^2.2.0
nodemailer:   ^8.0.5  -> ^9.0.1
```

`npm audit --omit=dev` and `npm audit --workspaces --omit=dev` now report zero production vulnerabilities. `npm audit` still reports dev-only Vite/esbuild issues requiring a semver-major Vite upgrade.

7. Safe route error helper added with the correct signature.

```js
function sendSafeError(req, res, err, fallback = 'Internal server error', status = 500) {
  const statusCode = Number.isInteger(status) ? status : 500;
  if (req?.log?.error) req.log.error({ err }, fallback);
  return res.status(statusCode).json({ error: clientError(err, fallback) });
}
```

8. Driver stop notes now require assigned-stop authorization.

Before:

```js
scopeQueryByContext(supabase.from('stops').update({ notes }), req.context).eq('id', stopId)
```

After:

```js
const { data: existing } = await scopeQueryByContext(
  supabase.from('stops').select('id,driver_id,company_id,location_id'),
  req.context
).eq('id', stopId).single();

if (req.user.role === 'driver' && String(existing.driver_id) !== String(req.user.id)) {
  return res.status(403).json({ ok: false, error: 'Access denied' });
}
```

9. POD draft photos moved out of localStorage.

Before:

```ts
saveStopDraft({ stopId, notes, proofImage, updatedAt: new Date().toISOString() });
```

After:

```ts
const nextDraftId = await savePodDraftPhoto(stopId, image, proofImageDraftId);
saveStopDraft({ stopId, notes, proofImage: null, proofImageDraftId: nextDraftId, updatedAt });
```

Offline status queue payloads now store `proofImageDraftId`; the localStorage mirror strips `proofImage` from legacy/new queue entries. Draft photo blobs live in IndexedDB database `noderoute-driver-pod-drafts` with a seven-day TTL and are deleted after sync/clear.

10. Production config errors are fatal.

Before:

```js
if (fatal.length) process.exit(1);
```

After:

```js
const fatalMessages = isProduction ? fatal.concat(errors) : fatal;
if (fatalMessages.length) process.exit(1);
```

### Deployment Notes

1. Deploy backend/runtime changes and the dependency lockfile together.
2. Apply `supabase/migrations/20260625204708_harden_rls_rpc_portal_checkout.sql` to staging first.
3. After migration, verify:
   - `select * from pg_policies where schemaname = 'public' and qual in ('true','(true)');`
   - `select has_function_privilege('authenticated', 'public.sync_route_stop_assignments(text,text[],text[])', 'execute');` returns false.
   - Portal checkout still creates Stripe sessions and webhook completion only pays the signed invoice IDs.
4. Roll the driver PWA build so clients receive the IndexedDB draft storage change.

### Rollback Notes

- Backend rollback: revert the listed JS/TS/package files and redeploy the previous lockfile.
- Supabase rollback: re-granting the definer RPC to `authenticated` or recreating broad RLS policies is not recommended. If an emergency rollback is unavoidable, prefer temporarily routing affected operations through the backend service role while preserving the revokes.
- Driver draft rollback: old localStorage drafts with `proofImage` are sanitized on read. Once sanitized, legacy embedded photos cannot be restored from localStorage.

### Verification Run

```bash
node --check backend/lib/invoice-set-hash.js backend/routes/stripe-webhooks.js backend/routes/portal/payment-collection-routes.js backend/routes/portal/payments-shared.js backend/routes/stops.js backend/routes/deliveries.js backend/lib/config.js backend/lib/safe-error.js
node --test backend/tests/top-remediation-hardening.test.js backend/tests/stripe-webhooks.test.js backend/tests/portal-payments.test.js backend/tests/security-hardening.test.js
npm run test --workspace=backend
npm run test --workspace=noderoute-driver-app
npm run build --workspace=noderoute-driver-app
npm audit --omit=dev
npm audit --workspaces --omit=dev
```

Results: all listed checks passed, including 358 backend tests plus stress smoke; production audit found 0 vulnerabilities.

### Updated Health Score

| Dimension | Previous | Updated |
|---|---:|---:|
| Security | 14/25 | 20/25 |
| Frontend Reliability | 18/25 | 20/25 |
| Code Quality | 17/25 | 19/25 |
| Real-Time / Offline Safety | 16/25 | 19/25 |
| Total | 65/100 | 78/100 |

### Residual Risk After Remediation

- Backend still uses the Supabase service-role client broadly; route-level scoping remains critical.
- The new RLS migration was not applied to a live Supabase project from this environment because the Supabase CLI is not installed here.
- Full `npm audit` still reports dev-only Vite/esbuild issues that require a semver-major Vite upgrade. Production audit is clean.
- POD photo blobs are moved out of localStorage but are not encrypted at rest. Add WebCrypto encryption if offline device compromise is in scope.
- Several medium/low findings from the original audit remain open, including portal CSRF, upload magic-byte validation, broader raw route errors, and iOS refresh-on-401 behavior.
