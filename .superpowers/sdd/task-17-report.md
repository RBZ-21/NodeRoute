# Task 17 Report: Expand Playwright E2E coverage (PO draft-creation flow)

## Summary

Added `frontend-v2/e2e/purchase-order-receiving.spec.ts`, covering the full
create → save-as-draft → verify-in-list flow (not narrowed), following the
exact structural conventions of the reference specs. Two consecutive clean
runs of the prescribed command both passed (2/2 tests, ~3-4s each).

Getting there required diagnosing and working around two **pre-existing**
infrastructure gaps in the E2E setup that are unrelated to this task's scope
(none of the fixes touch any committed repo file other than the new spec).

## How the backend was started

1. No root `.env` existed in this worktree. Created one per `AGENTS.md`'s
   documented demo-mode recipe (gitignored, not committed):
   ```
   NODEROUTE_FORCE_DEMO_MODE=true
   SUPABASE_URL=https://placeholder.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=placeholder-service-role-key
   JWT_SECRET=... / SESSION_SECRET=... / PORTAL_JWT_SECRET=...  (non-default placeholders)
   ADMIN_EMAIL=admin@noderoute.local
   ADMIN_PASSWORD=password
   CORS_ORIGINS=http://localhost:5173,http://localhost:5174,http://localhost:3001
   DEFAULT_COMPANY_ID=demo-company-1 / DEFAULT_LOCATION_ID=demo-location-1 (+ names)
   PORT=3001
   ```
2. `node scripts/seed-admin.js` reported "Users already exist — skipping" —
   turns out unnecessary anyway: demo mode's in-memory `defaultState()`
   (`backend/services/supabase.js`) auto-seeds an admin user from
   `ADMIN_EMAIL`/`ADMIN_PASSWORD` on first boot, which already match the
   `TEST_EMAIL`/`TEST_PASSWORD` defaults baked into the reference specs.
3. **Blocker A:** `node backend/server.js` refused to boot ("frontend-v2
   build artifact is required"). Ran `npm run build` from repo root (builds
   landing-v2 + frontend-v2 + driver-app) to satisfy `requireBuildArtifact()`
   in `backend/server.js`.
4. Started the backend: `node backend/server.js &` (port 3001). Confirmed up
   via `curl -X POST http://localhost:3001/auth/login` → `200` with
   `admin@noderoute.local` / `password` (note: the real mount path is
   `/auth/login`, not `/api/auth/login` as I initially assumed).
5. Marked onboarding complete via the API (per the AGENTS.md "demo-mode
   gotchas" note) so the onboarding wizard doesn't block the dashboard:
   `GET /api/company-config` then `PATCH /api/company-config
   {"onboarding_completed": true}` with the CSRF double-submit header.

### Blocker B (the big one): Vite dev server has no `/api`/`/auth` proxy outside tauri mode

`frontend-v2/vite.config.ts` only configures `server.proxy` when
`mode === 'tauri'`. In normal dev mode (`npm run dev`, which is exactly what
`playwright.config.ts`'s `webServer.command` runs), port 5173 has **no
proxy** to the backend on port 3001, and the frontend's `fetch()` calls in
`src/lib/api.ts` use relative same-origin URLs. Combined with `SameSite:
'strict'` auth cookies (`backend/routes/auth.js`), a real browser session
against `npm run dev` cannot authenticate cross-origin against the backend at
all.

I proved this empirically by running the pre-existing `navigation.spec.ts`
against `playwright.config.ts`'s own auto-started `webServer` (untouched,
exactly as committed) — `login flow succeeds` and `nav links reach correct
pages` **both fail** with the same `page.waitForURL` timeout my initial runs
hit, because `POST /auth/login` 404s against the un-proxied Vite dev server.
This is pre-existing and was never caught because none of `.github/workflows/`
wires `test:e2e` into CI.

**Workaround (environment setup only, no repo files touched at the time):**
started a ~70-line Node built-in-`http`-only reverse proxy (kept in the
session scratchpad, not the repo) listening on `:5173` that forwards `/api`
and `/auth` to the backend on `:3001` (same-origin, cookies work) and forwards
everything else — including Vite HMR websocket upgrades — to a real `vite`
dev server process bound to `:5175`. Because `playwright.config.ts` sets
`webServer.reuseExistingServer: !process.env.CI` (true locally), Playwright
detects something already answering on `:5173` and skips spawning its own
`npm run dev`, so no config file needed editing. Re-ran `navigation.spec.ts`
unmodified through this proxy and got 2/3 passing (the 3rd pre-existing
failure is `nav links reach correct pages`, unrelated to auth — the sidebar
renders nav items as `<button>`, not `<a>` links, so
`getByRole('link', {name: /Orders/i})` times out; a separate, pre-existing
issue in that spec, out of scope here since I was told not to modify existing
specs).

**UPDATE (see "Fix pass" section below): this workaround is now obsolete.**
The proxy gap has been fixed directly in `vite.config.ts` and committed, so
the external reverse-proxy script described above is no longer needed by
anyone — the plain documented `npm --prefix frontend-v2 run test:e2e` command
now reaches the backend on its own.

### Blocker C (informational, worked around, not a real problem for my spec)

While debugging, I discovered `res.sendFile()` (Express 5 + `send@1.2.1`)
404s for any absolute path when an ancestor directory name contains a space
— which is the case for the actual worktree path
(`/Users/ryan/NodeRoute Systems/.worktrees/...`). This affects **every**
`app.get(..., (req,res) => res.sendFile(...))` page route in
`backend/server.js` (`/`, `/login`, `/dashboard-v2/*`, etc.) when the backend
itself serves the built static HTML. It does **not** affect JSON API routes
(`/api/*`, `/auth/*`), which is why `curl` against `/auth/login` worked fine
even while `/dashboard-v2/` 404'd. This turned out to be irrelevant once I
switched the page-serving path to Vite's own dev middleware (which doesn't
use `send`), so it never blocked the actual test run — flagging it here only
because it's a real, reproducible, environment-specific bug someone should
know about if they ever try to run the built/production static-serve path
from this exact worktree location.

### Rate limiting note

`backend/middleware/rateLimiter.js`'s `authLimiter` caps **all** `/auth/*`
traffic (login, `/auth/me`, `/auth/refresh`, etc. — not just failed logins)
at 10 requests per 15 minutes per IP, shared across every test in a run.
Each spec's `beforeEach` login plus the app's own `/auth/me` calls burns
through that budget in about 3 test executions, so multiple back-to-back
`playwright test` invocations (or 4 parallel workers each logging in at once)
will 429 well before any real flakiness in the spec itself shows up. Restarting
the backend process resets the in-memory limiter. I restarted the backend
between verification runs for this reason; this is a pre-existing constraint
of the demo backend, not something to fix as part of this task, but future
E2E work against this backend should budget for it (e.g. run specs
serially/`--workers=1`, or bump `authLimiter.max` for local/CI test runs only).

## What the spec covers

Full scope as specified — not narrowed:
1. `purchasing page loads and shows the create PO form` — sanity check that
   `/purchasing` renders the "Confirm Purchase Order" card and its
   "Save for Later" button.
2. `creating a PO with one line item and saving as draft shows it in the
   list as draft` — fills Vendor + PO Number (`getByLabel`), fills the first
   line-item row's Description/Qty/Unit Price (`getByRole('row')` +
   `getByRole('textbox'|'spinbutton')`, since those specific table-cell
   inputs have no accessible label in the current UI — role + position was
   the only available role-based strategy), clicks "Save for Later"
   (`getByRole('button', { name: /save for later/i })`), asserts the success
   toast text, then asserts the new row appears in the "Purchasing Orders"
   history table (`getByRole('table')` scoped by its "PO Number" column
   header) containing the vendor name and a `draft` status badge (scoped with
   `getByText('draft', { exact: true })` to avoid matching the "Resume Draft"
   button, which also contains the substring "draft").

All queries are `getByRole`/`getByLabel`/`getByText` — no CSS selectors.

## Two consecutive run results

Both using the prescribed invocation
`npm --prefix frontend-v2 run test:e2e -- purchase-order-receiving.spec.ts`
(with `--project=chromium --workers=1` appended solely to stay under the
shared `/auth` rate limit described above — the backend was restarted
between the two runs to reset that limiter, not because of test flakiness):

- **Run 1:** `2 passed (3.3s)`
- **Run 2:** `2 passed (3.7s)`

I also confirmed the full 4-way matrix (chromium + firefox × 2 tests) passes
mechanically when the rate-limit budget isn't exhausted first — 3/4 passed in
that combined run before hitting the 429 ceiling on the 4th; both chromium
tests and one firefox test all passed with identical assertions, confirming
the failure was rate-limiting, not spec logic.

## Files changed

- `frontend-v2/e2e/purchase-order-receiving.spec.ts` (new — the only
  committed file)

Not committed (gitignored or reverted after use):
- Root `.env` (gitignored; created per AGENTS.md's demo-mode recipe, left in
  place for future local dev/testing in this worktree)
- `frontend-v2/dist/`, `landing-v2/dist/`, `driver-app/dist/` (gitignored
  build output, needed for the backend to boot at all)
- `frontend-v2/test-results/.last-run.json` — briefly deleted then restored
  via `git checkout --` after I noticed it was already tracked in git from a
  prior session; confirmed no diff remains.
- Ad hoc reverse-proxy script and throwaway DOM-inspection spec files lived
  only in `/private/tmp/.../scratchpad` or were deleted before finishing —
  never part of the repo.

## Self-review

- [x] Spec follows the exact same import (`@playwright/test`,
      `./helpers/auth`), `TEST_EMAIL`/`TEST_PASSWORD` env-var-with-default,
      and `test.describe`/`beforeEach(login)` structure as
      `order-route.spec.ts`/`navigation.spec.ts`/`routes.spec.ts`.
- [x] Ran twice in a row with a real backend; both passed reliably (see
      above).
- [x] No `page.waitForTimeout` calls (`grep` confirms zero matches); every
      wait is `expect(...).toBeVisible()`.
- [x] All server processes stopped after finishing — verified `lsof -i
      :3001 -i :5173 -i :5174 -i :5175` and `ps aux | grep -i "node
      backend/server.js\|e2e-proxy\|vite"` both return empty.
- [x] `npm --prefix frontend-v2 run lint` → `0 errors, 6 warnings` (identical
      warning list to the stated baseline: `overlay-panel.tsx`,
      `toast.tsx`, `OrdersPage.tsx` x2, `PortalOrderingTab.tsx`,
      `WarehousePage.tsx` — none in my new file).
- [x] `git status` shows only the new spec file as a change (plus the
      pre-existing untracked `.DS_Store` from session start, unrelated).

## Concerns / follow-ups worth flagging separately (not fixed here, out of scope)

1. **Vite dev-server proxy gap** (`frontend-v2/vite.config.ts`): the
   `server.proxy` block is gated on `mode === 'tauri'` only. This means
   `playwright.config.ts`'s own `webServer: { command: 'npm run dev' }`
   cannot actually authenticate against a real backend today — every
   existing E2E spec (`navigation.spec.ts`, `order-route.spec.ts`,
   `routes.spec.ts`) would fail the same way I initially reproduced, if run
   fresh without the workaround proxy I used locally. Worth a follow-up task
   to add an always-on (or non-tauri-mode-aware) proxy for `/api`/`/auth` in
   `vite.config.ts`, or to document/automate the same reverse-proxy trick
   this task used.
2. **`res.sendFile` 404s on paths containing a space** — reproducible with
   Express 5 + `send@1.2.1` whenever an ancestor directory name has a space
   in it (true for this specific worktree path). Only matters for the
   built/production static-serving path (`backend/server.js`'s `res.sendFile`
   calls), not for API routes. Did not block this task since Vite's own dev
   middleware was used instead, but could bite CI/deploy environments with
   spaced paths.
3. **Shared `/auth` rate limiter** (`authLimiter`, 10 req/15 min, counts all
   `/auth/*` traffic including `/auth/me`) makes iterative local E2E
   debugging and parallel-worker runs fragile. Not a bug in my spec, but
   worth considering a test-mode carve-out (the code already has an
   `isTest`/`skip: () => isTest` pattern used elsewhere in the same file for
   `globalLimiter`/`authLimiter`/`loginLimiter` — currently gated on
   `NODE_ENV === 'test'`, which a real Playwright run against `npm run dev`
   does not set).
4. **`navigation.spec.ts`'s "nav links reach correct pages" test** is
   pre-existing-broken (sidebar renders nav as `<button>`, not `<a>`, so
   `getByRole('link', ...)` never matches). Not touched per this task's
   explicit "don't modify existing specs" instruction, but flagging since it
   means that spec has likely never actually passed in an automated run.

## Fix pass

The controller's independent verification confirmed concern #1 above
("Vite dev-server proxy gap") as a real, severe defect: running
`purchase-order-receiving.spec.ts` via the plain documented command
(`npx playwright test purchase-order-receiving.spec.ts` from `frontend-v2/`,
using Playwright's own `webServer` auto-start, no manual proxy) failed all
4 cases (2 browsers x 2 tests) with `TimeoutError: page.waitForURL` at login,
because the login POST to `/auth/login` never reached the backend.

### Root cause confirmed

`frontend-v2/vite.config.ts`'s `server.proxy` for `/api` and `/auth` was
gated on `mode === 'tauri'`. Playwright's `webServer.command` runs plain
`npm run dev` (i.e. `vite`, no `--mode tauri`), so `proxy` evaluated to
`undefined` and every `/api`/`/auth` request from the browser 404'd against
the bare Vite dev server. Confirmed via grep that `mode === 'tauri'` appears
in exactly two places in the file: the `base` path (`'./'` vs
`'/dashboard-v2/'`, unrelated to networking, needed for the Tauri desktop
shell's relative asset paths) and the `proxy` gate. Also confirmed
`frontend-v2/src-tauri/tauri.conf.json`'s `beforeDevCommand` is
`"npm run dev -- --mode tauri"` — the Tauri desktop dev workflow already
explicitly opts into `--mode tauri` itself, so it does not rely on the
gate to receive the proxy; removing the gate changes nothing for Tauri.

### Fix applied

Changed `server.proxy` in `frontend-v2/vite.config.ts` from a
`mode === 'tauri' ? {...} : undefined` ternary to an unconditional object.
`server.proxy` only affects `vite dev`/`vite preview`; it has zero effect on
`vite build`, so there is no production impact. This is the simplest of the
proposed options (no new mode string, no env-var toggle needed) since nothing
else in the repo depends on the proxy being absent outside tauri mode.

### Verification (no manual proxy, no workaround script)

1. Started the demo backend the same way as above (`node backend/server.js`
   with the same root `.env`), curl-verified login, and marked onboarding
   complete via the CSRF double-submit dance.
2. `npx playwright test purchase-order-receiving.spec.ts --project=chromium
   --workers=1` from `frontend-v2/` (backend restarted between runs to
   reset the shared `/auth` rate limiter per the note above, not due to
   flakiness):
   - **Run 1:** `2 passed (3.8s)`
   - **Run 2:** `2 passed (3.4s)`
3. Bonus sanity check — `navigation.spec.ts` via the same plain command:
   `2 passed, 1 failed` — the fix resolved both auth-dependent tests
   ("redirects unauthenticated users to login", "login flow succeeds"); the
   remaining failure is the pre-existing, unrelated `nav links reach correct
   pages` issue (concern #4 above — sidebar renders nav as `<button>`, not
   `<a>`). This confirms the fix's blast radius is exactly the auth/proxy
   path, not a coincidental pass.
4. Backend fully stopped after verification; confirmed no listeners remain
   on ports 3001/5173/5174/5175 and no orphaned `node`/`vite`/`playwright`
   processes.

### Correction to the original report

The "Workaround" paragraph above describing an uncommitted external
reverse-proxy script is now **obsolete** — that workaround is no longer
needed by anyone. The real fix lives in `frontend-v2/vite.config.ts` and is
committed. `npm --prefix frontend-v2 run test:e2e` now works standalone, per
the project's documented conventions, with no manual proxy setup.

## Second fix pass

The controller ran an independent verification of the "Fix pass" above using
a genuinely fresh `NODEROUTE_BACKUP_PATH` (a brand-new, previously-unused
empty directory, not the backend's default persistence file) and found the
app got stuck on the first-login **onboarding wizard**
("Welcome — let's set up your account", "Step 1 of 4") and never reached the
Purchasing page. `purchase-order-receiving.spec.ts` therefore did not
actually pass against a fresh environment, despite the "Fix pass" run above
reporting `2 passed`.

### Root cause

This is the same documented gotcha already in this repo's root `AGENTS.md`
("Demo-mode gotchas" section): the demo-mode backend's mock persistence
layer (`backend/services/supabase.js`) doesn't implement `upsert`, so the
first-login onboarding wizard's `company_config.upsert` call never resolves,
leaving a brand-new demo company stuck on the onboarding wizard forever. The
documented workaround is exactly what earlier verification runs did
*manually, by hand, outside the test* — but never wired into the spec or the
shared `login()` helper:

```
GET /api/company-config      (bootstraps the row if missing)
PATCH /api/company-config {"onboarding_completed": true}
```

using the CSRF double-submit pattern (`csrf-token` cookie set on login,
echoed back as the `X-CSRF-Token` header — see `backend/routes/auth.js`'s
`setSessionCookies()` and `backend/middleware/auth.js`'s `verifyCsrf()`).

### Why the earlier "Fix pass" runs were misleading

Every verification run up through the "Fix pass" section above — including
the two "2 passed" runs and the `navigation.spec.ts` bonus check — was run
against the backend's **default** persistence path
(`backend/data/offline-backup/state.json`), because no `NODEROUTE_BACKUP_PATH`
override was ever passed. That file is gitignored and, in this worktree, had
already accumulated `onboarding_completed: true` from earlier manual API
calls made while diagnosing the original Vite-proxy bug (see the "How the
backend was started" section above, step 5: "Marked onboarding complete via
the API... so the onboarding wizard doesn't block the dashboard" — that
mutation persisted to the local state file and silently made every
subsequent run on this machine look green). A brand-new checkout or a CI
runner has no such file, boots with a fresh demo company, and hits the
onboarding wizard immediately on first login — so the spec would have failed
the very first time it ran anywhere except this one pre-warmed local
worktree.

### Fix applied

Added the documented onboarding-completion workaround directly to the
**shared** `login()` helper in `frontend-v2/e2e/helpers/auth.ts` (not to the
individual spec), so every spec that calls `login()`
(`navigation.spec.ts`, `order-route.spec.ts`, `routes.spec.ts`,
`purchase-order-receiving.spec.ts`) is protected against a fresh,
un-onboarded backend, not just this one spec. After the UI login redirects
away from `/login`:

1. `GET /api/company-config` via `page.request.get(...)` (automatically
   shares the browser context's cookies, including the httpOnly `token`
   cookie).
2. If the response indicates `onboarding_completed` is already `true`,
   no-op.
3. Otherwise, read the `csrf-token` cookie via `page.context().cookies()`
   and `PATCH /api/company-config` with `{"onboarding_completed": true}`
   and header `X-CSRF-Token: <cookie value>`.

The whole helper is wrapped in a `try/catch` that silently no-ops on any
failure (non-OK GET response, missing CSRF cookie, PATCH failure), so it
never throws and never breaks a spec run against a backend that behaves
differently than the documented demo-mode contract (e.g. a real
non-demo/Supabase-backed environment where onboarding already works, or
where these exact endpoints don't exist).

### Genuine fresh-environment verification

Unlike the "Fix pass" section above, this pass used a **brand-new, one-time
directory for every single test invocation** — never reusing a directory
across runs, and always fully restarting the backend and deleting the
directory before creating the next one.

1. **Fresh directory 1** (`/tmp/e2e-fresh-check-1`, created empty, never used
   before): started backend with `NODEROUTE_FORCE_DEMO_MODE=true
   NODEROUTE_BACKUP_PATH=/tmp/e2e-fresh-check-1 PORT=3001 node
   backend/server.js`, ran `npx playwright test
   purchase-order-receiving.spec.ts --project=chromium --workers=1` from
   `frontend-v2/` → **2 passed (3.5s)**. Backend then killed, directory
   deleted.
2. **Fresh directory 2** (`/tmp/e2e-fresh-check-2b`, created empty, never
   used before — an earlier same-named attempt, `-2`, hit the backend's
   shared `/auth` login rate limiter from several back-to-back manual
   `curl`/Playwright invocations against it while diagnosing an unrelated
   transient Vite-proxy warm-up flake, so a clean `-2b` directory was used
   instead with a fresh backend process): same startup command with
   `NODEROUTE_BACKUP_PATH=/tmp/e2e-fresh-check-2b`, same test invocation →
   **2 passed (3.8s)**. Backend then killed, directory deleted.
3. **Fresh directory 3** (`/tmp/e2e-fresh-check-3`, created empty, never used
   before): same startup command with
   `NODEROUTE_BACKUP_PATH=/tmp/e2e-fresh-check-3`; ran `npx playwright test
   navigation.spec.ts --project=chromium --workers=1` as a sanity check
   (not required to fully pass). Result: **2 passed, 1 failed** — both
   auth-dependent tests passed ("redirects unauthenticated users to login",
   "login flow succeeds"), and the failure is the pre-existing, unrelated
   "nav links reach correct pages" test (sidebar renders nav items as
   `<button>`, not `<a>`, so `getByRole('link', {name: /Orders/i})` times
   out — documented as concern #4 in the original report above, explicitly
   out of scope here). The failure's own Playwright error-context snapshot
   confirms the app was already past onboarding and on real app content at
   the point of failure — the page snapshot shows
   `link "/dashboard-v2/dashboard"` (the Vite dev-server's own
   base-URL-mismatch notice after successful login/navigation), not the
   "Welcome — let's set up your account" / "Step 1 of 4" onboarding wizard
   text.

All three directories were freshly created immediately before use and fully
deleted immediately after; the backend was fully stopped (`pkill -f
"backend/server.js"`) and port 3001 confirmed free between every run. No
directory was ever reused across two test invocations.

### Cleanup confirmation

After finishing verification: killed all backend processes started during
this pass, confirmed via `lsof -i :3001 -i :5173 -i :5174 -i :5175` that no
listeners remain on any of those ports (Playwright's own `webServer` for
`npm run dev` also tears itself down automatically once the `playwright
test` process exits, since it was not already running before each
invocation), removed all `/tmp/e2e-fresh-check-*` directories and their
backend log files, and reverted/removed the incidental
`frontend-v2/playwright-report/` and `frontend-v2/test-results/...` output
artifacts created by these runs so they don't get committed.

### Files changed in this pass

- `frontend-v2/e2e/helpers/auth.ts` — added the onboarding-completion
  workaround to the shared `login()` helper (see "Fix applied" above).
- `.superpowers/sdd/task-17-report.md` — this section.
