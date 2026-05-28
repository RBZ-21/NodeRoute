# NodeRoute Hardening Before/After Report - 2026-05-28

This report covers fixes currently applied on branch `Vega/security-auth-refresh-hardening`.

## 1. Protect private API router mounts

FILE PATH: `backend/server.js`

BEFORE:
```js
app.use('/api/users', usersRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api', deliveriesRouter);
```

AFTER:
```js
const { authenticateToken, requireRole } = require('./middleware/auth');
const requireApiAuth = authenticateToken;

app.use('/api/users', requireApiAuth, usersRouter);
app.use('/api/orders', requireApiAuth, ordersRouter);
app.use('/api/invoices', requireApiAuth, invoicesRouter);
app.use('/api/inventory', requireApiAuth, inventoryRouter);
app.use('/api/portal', portalRouter);
app.use('/api/track', trackingRouter);
app.use('/api/waitlist', waitlistRouter);
app.use('/api', requireApiAuth, deliveriesRouter);
```

Explanation: Private API routers now require authentication at the mount layer while public token/landing routes stay intentionally public.

## 2. Short access JWTs and refresh rotation

FILE PATH: `backend/routes/auth.js`

BEFORE:
```js
const JWT_EXPIRY = '1h';
const COOKIE_MAX_AGE = 24 * 60 * 60 * 1000;

function signJWT(user) {
  return signUserJWT(user, JWT_EXPIRY, 'session');
}

function setAuthCookies(res, token) {
  res.cookie('token', token, { httpOnly: true, maxAge: COOKIE_MAX_AGE, path: '/' });
}
```

AFTER:
```js
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';
const ACCESS_COOKIE_MAX_AGE = 15 * 60 * 1000;
const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const REFRESH_SESSION_TABLE = 'auth_refresh_sessions';

function signJWT(user) {
  return signUserJWT(user, ACCESS_TOKEN_EXPIRY, 'access');
}

async function createRefreshSession(user) {
  const sessionId = crypto.randomUUID();
  const refreshToken = signUserJWT(user, REFRESH_TOKEN_EXPIRY, 'refresh', { sessionId });
  await supabase.from(REFRESH_SESSION_TABLE).insert({
    id: sessionId,
    user_id: user.id,
    token_hash: hashRefreshToken(refreshToken),
    expires_at: refreshExpiresAt().toISOString(),
  });
  return { refreshToken, sessionId };
}
```

Explanation: Browser sessions now use 15-minute access cookies and persisted 7-day refresh sessions that rotate on refresh.

## 3. Reject refresh tokens as access tokens

FILE PATH: `backend/middleware/auth.js`

BEFORE:
```js
payload = jwt.verify(token, JWT_SECRET);
const { user, dbError, notFound } = await findUserFromTokenPayload(payload);
```

AFTER:
```js
payload = jwt.verify(token, JWT_SECRET);

if (payload?.tokenType === 'refresh' || payload?.tokenType === 'driver_refresh') {
  return res.status(401).json({ error: 'Access token required' });
}

const { user, dbError, notFound } = await findUserFromTokenPayload(payload);
```

Explanation: Refresh tokens can no longer be replayed against normal protected API routes.

## 4. Frontend refresh retry

FILE PATH: `frontend-v2/src/lib/api.ts`

BEFORE:
```ts
if (response.status === 401) {
  clearSession();
  redirectToLogin('Your session could not be verified. Please sign in again.');
  throw new Error('Unauthorized');
}
```

AFTER:
```ts
async function parseResponseWithRefresh<T>(response: Response, url: string, retry: () => Promise<Response>): Promise<T> {
  if (response.status === 401 && await refreshSession()) {
    response = await retry();
  }
  if (response.status === 401) {
    clearSession();
    redirectToLogin('Your session could not be verified. Please sign in again.');
    throw new Error('Unauthorized');
  }
  return parseResponse<T>(response, url);
}
```

Explanation: The browser app now rotates refresh cookies before forcing users back to login.

## 5. Refresh-session RLS migration

FILE PATH: `supabase/migrations/20260528_security_auth_refresh_sessions.sql`

BEFORE:
```sql
-- No persisted refresh-token table existed.
```

AFTER:
```sql
create table if not exists public.auth_refresh_sessions (
  id uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  replaced_by uuid references public.auth_refresh_sessions(id),
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

alter table public.auth_refresh_sessions enable row level security;
revoke all on public.auth_refresh_sessions from anon, authenticated;
```

Explanation: Refresh tokens are now stored as hashes in a backend-only RLS-protected table.

## 6. Broad public-table RLS sweep

FILE PATH: `supabase/migrations/20260528_enable_rls_all_public_tables.sql`

BEFORE:
```sql
-- RLS coverage depended on table-specific historical migrations.
```

AFTER:
```sql
do $$
begin
  for table_record in select ... loop
    execute format('alter table public.%I enable row level security', table_record.table_name);
    if table_record.has_company_id then
      execute format('create policy %I on public.%I for all to authenticated using (public.is_platform_admin() or company_id::text = public.auth_company_id_text()) with check (...)', ...);
    else
      execute format('create policy %I on public.%I for all to anon, authenticated using (false) with check (false)', ...);
    end if;
  end loop;
end $$;
```

Explanation: Every current public base table gets RLS enabled with either tenant-scoped or deny-direct-client policies.

## 7. Global JSON mutation validation

FILE PATH: `backend/lib/zod-validate.js`

BEFORE:
```js
function validateBody(schema, options) {
  return validatePart('body', schema, options);
}
```

AFTER:
```js
const jsonMutationBodySchema = z.union([
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
]);

function validateJsonMutationBody() {
  return function jsonMutationBodyMiddleware(req, res, next) {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
    if (!req.is('application/json')) return next();
    const result = jsonMutationBodySchema.safeParse(req.body === undefined ? {} : req.body);
    if (!result.success) return res.status(400).json({ error: firstIssueMessage(result.error, 'JSON request body must be an object or array') });
    req.body = result.data;
    return next();
  };
}
```

Explanation: All JSON mutation routes now pass through a Zod body-shape validator before route-specific logic.

## 8. CORS allow-list enforcement

FILE PATH: `backend/server.js`

BEFORE:
```js
if (allowedOrigins.length > 0 && allowedOrigins.includes(origin)) {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
}
```

AFTER:
```js
if (origin) {
  if (!allowedOrigins.includes(origin)) {
    return res.status(403).json({ error: 'CORS origin not allowed' });
  }
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
}
```

Explanation: Browser requests from unlisted origins are now rejected instead of silently omitting CORS headers.

## 9. Tenant query helper

FILE PATH: `backend/services/operating-context.js`

BEFORE:
```js
function filterRowsByContext(rows, context) {
  if (!Array.isArray(rows)) return rows;
  return rows.filter((row) => rowMatchesContext(row, context));
}
```

AFTER:
```js
function scopeQueryByContext(query, context, options = {}) {
  if (!query || !context || context.isGlobalOperator) return query;
  const activeCompanyId = normalizeId(context.activeCompanyId || context.companyId);
  let scopedQuery = query;
  if (activeCompanyId) scopedQuery = scopedQuery.eq(options.companyField || 'company_id', activeCompanyId);
  return scopedQuery;
}
```

Explanation: Tenant filters can now be applied before rows are fetched from Supabase, not only after retrieval.

## 10. Driver route query isolation

FILE PATH: `backend/routes/driver.js`

BEFORE:
```js
const { data: routes } = await supabase
  .from('routes')
  .select('*')
  .order('created_at', { ascending: false });
```

AFTER:
```js
const { data: routes } = await scopeQueryByContext(
  supabase.from('routes').select('*'),
  req.context
).order('created_at', { ascending: false });
```

Explanation: Driver route reads now include tenant scoping in the database query.

## 11. Delivery dashboard query isolation

FILE PATH: `backend/routes/deliveries.js`

BEFORE:
```js
supabase.from('orders').select('id, order_number, customer_name, ...').order('created_at', { ascending: false })
```

AFTER:
```js
scopeQueryByContext(
  supabase.from('orders').select('id, order_number, customer_name, ..., company_id, location_id'),
  context
).order('created_at', { ascending: false })
```

Explanation: Dispatch dashboard reads now apply company filters in Supabase instead of only filtering response arrays.

## 12. Plan limits

FILE PATH: `backend/services/plan-limits.js`

BEFORE:
```js
-- No shared API-level plan limit enforcement existed.
```

AFTER:
```js
const PLAN_LIMITS = {
  trial: { maxDrivers: 3, maxDeliveriesPerMonth: 100 },
  starter: { maxDrivers: 5, maxDeliveriesPerMonth: 500 },
  growth: { maxDrivers: 25, maxDeliveriesPerMonth: 5000 },
  pro: { maxDrivers: 100, maxDeliveriesPerMonth: 25000 },
  enterprise: { maxDrivers: Infinity, maxDeliveriesPerMonth: Infinity },
};
```

Explanation: Driver invites and order creation now have a shared API-layer plan-limit gate.

## 13. Delivery N+1 product lookup

FILE PATH: `backend/routes/deliveries.js`

BEFORE:
```js
for (const item of Array.isArray(order.items) ? order.items : []) {
  const product = await findProductForDeliveryItem(item);
  ...
}
```

AFTER:
```js
const items = Array.isArray(order.items) ? order.items : [];
const productMaps = await loadProductsForDeliveryItems(items, req.context);

for (const item of items) {
  const product = productForDeliveryItem(item, productMaps);
  ...
}
```

Explanation: Product lookup for delivery completion is now batched by product IDs and item numbers.

## 14. Performance indexes

FILE PATH: `supabase/migrations/20260528_query_performance_indexes.sql`

BEFORE:
```sql
-- Index coverage for common filters/joins/order columns was incomplete.
```

AFTER:
```sql
select public.create_index_if_columns_exist('idx_orders_company_status_created', 'orders', 'company_id, status, created_at desc', array['company_id','status','created_at']);
select public.create_index_if_columns_exist('idx_routes_company_driver_created', 'routes', 'company_id, driver_id, created_at desc', array['company_id','driver_id','created_at']);
select public.create_index_if_columns_exist('idx_driver_locations_company_name_updated', 'driver_locations', 'company_id, lower(driver_name), updated_at desc', array['company_id','driver_name','updated_at']);
```

Explanation: Conditional indexes now cover common tenant filters, joins, and sort paths without failing on older schemas.

## 15. Driver location throttling

FILE PATH: `backend/routes/driver.js`

BEFORE:
```js
if (scopedExisting[0]?.id) {
  result = await executeWithOptionalScope(...);
}
```

AFTER:
```js
const lastUpdatedAt = scopedExisting[0]?.updated_at ? new Date(scopedExisting[0].updated_at).getTime() : 0;
if (lastUpdatedAt && Date.now() - lastUpdatedAt < LOCATION_UPDATE_MIN_INTERVAL_MS) {
  res.setHeader('Retry-After', '5');
  return res.status(429).json({ error: 'Driver location updates are limited to once every 5 seconds' });
}
```

Explanation: The backend now enforces a 5-second minimum interval between driver location updates.

## 16. Driver app location throttling

FILE PATH: `driver-app/src/hooks/useLocationUpdater.ts`

BEFORE:
```ts
async function sendLocation() {
  if (!enabled || !window.navigator.geolocation) return;
```

AFTER:
```ts
const LOCATION_UPDATE_MIN_INTERVAL_MS = 5000;

async function sendLocation() {
  if (!enabled || !window.navigator.geolocation) return;
  const now = Date.now();
  if (now - lastSentAtRef.current < LOCATION_UPDATE_MIN_INTERVAL_MS) return;
  lastSentAtRef.current = now;
```

Explanation: The driver app avoids sending redundant location updates faster than the server limit.

## 17. Environment documentation

FILE PATH: `.env.example`

BEFORE:
```env
JWT_SECRET=change-me-to-a-long-random-string
SESSION_SECRET=change-me-to-a-long-random-string
CSRF_SECRET=
```

AFTER:
```env
# Auth: access-token signing secret. Use a long random value; required in production.
JWT_SECRET=change-me-to-a-long-random-string
# Auth: session/CSRF signing secret. Use a separate long random value when possible.
SESSION_SECRET=change-me-to-a-long-random-string
# Auth: optional CSRF-specific secret. Falls back to SESSION_SECRET when empty.
CSRF_SECRET=
```

Explanation: Runtime variables are now documented with one-line purpose comments.

## 18. Stale TODO cleanup

FILE PATH: `backend/services/invoice-lots.js`

BEFORE:
```js
// TODO: Order items need to carry lot_number forward from the PO scan confirm step.
// Until that path is wired, lot_numbers on invoices will always be [].
```

AFTER:
```js
// Order and PO scan flows now pass lot_number through item payloads; derive invoice lot rows from those items.
```

Explanation: Removed stale TODO text that no longer matched the implemented invoice lot forwarding behavior.

## 19. Tests

FILE PATH: `backend/tests/critical-workflows-contract.test.js`

BEFORE:
```js
-- No focused contract test covered the new plan limits and private API auth mount.
```

AFTER:
```js
test('order creation unit: delivery plan limit blocks over-limit companies', async () => { ... });
test('driver assignment unit: driver plan limit blocks over-limit invites', async () => { ... });
test('delivery status update unit: plan-limit errors serialize with payment-required status', () => { ... });
test('critical route integration contract: private order API is mounted behind auth', () => { ... });
```

Explanation: Added three unit tests and one integration-style contract test for critical workflows.

## Summary Table

| # | Priority | File | Issue Fixed | Status |
|---|---|---|---|---|
| 1 | Security | `backend/server.js` | Protected private API router mounts | Done on branch |
| 2 | Security | `backend/routes/auth.js`, `frontend-v2/src/lib/api.ts`, `backend/middleware/auth.js` | 15m access, 7d refresh, refresh rotation, HttpOnly browser cookies | Done on branch |
| 3 | Security | `supabase/migrations/20260528_enable_rls_all_public_tables.sql` | RLS sweep for remaining public tables | Done on branch |
| 4 | Security | `backend/lib/zod-validate.js`, `backend/server.js` | Global Zod validation for JSON mutations | Done on branch |
| 5 | Security | `.env.example` | Environment variables documented; secret hardcoding search found no live key hits | Done on branch |
| 6 | Security | `backend/server.js`, `backend/lib/config.js` | Strict CORS allow-list enforcement | Done on branch |
| 7 | Multi-tenant | `backend/services/operating-context.js`, `backend/routes/driver.js`, `backend/routes/deliveries.js` | Tenant filters added before high-risk DB queries | Partial; broader route audit still needed |
| 8 | Multi-tenant | `backend/routes/driver.js`, `backend/routes/deliveries.js` | Driver delivery reads scoped by company | Done for driver/delivery surfaces |
| 9 | Multi-tenant | `backend/services/plan-limits.js`, `backend/routes/users.js`, `backend/routes/orders.js` | API-level driver and delivery plan limits | Done on branch |
| 10 | Performance | `backend/routes/deliveries.js` | Replaced delivery product N+1 lookup with batched queries | Done for identified N+1 path |
| 11 | Performance | `supabase/migrations/20260528_query_performance_indexes.sql` | Conditional indexes for common filters/joins/sorts | Done on branch |
| 12 | Performance | Repo search | No socket/realtime subscriptions found to clean up | Verified by search |
| 13 | Performance | `backend/routes/driver.js`, `driver-app/src/hooks/useLocationUpdater.ts` | Location updates throttled to 5 seconds | Done on branch |
| 14 | Code Quality | Existing Express 5/global handler plus syntax checks | Async thrown/rejected errors flow to global handler; exhaustive wrapping still needs deeper audit | Partial |
| 15 | Code Quality | `backend/server.js` | Global Express error handler already present and preserved | Done |
| 16 | Code Quality | `backend/services/operating-context.js`, `backend/services/plan-limits.js` | Shared tenant scoping and plan-limit utilities extracted | Done on branch |
| 17 | Code Quality | `backend/services/invoice-lots.js` | Stale TODO resolved | Done on branch |
| 18 | Infrastructure | `backend/instrument.js`, `frontend-v2/src/instrument.ts` | Sentry already present and preserved | Done |
| 19 | Infrastructure | `backend/tests/critical-workflows-contract.test.js` | Added required unit/contract tests | Done on branch |
| 20 | Infrastructure | `.env.example` | Environment variable descriptions added | Done on branch |