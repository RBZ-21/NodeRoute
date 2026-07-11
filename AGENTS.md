# AGENTS.md

## Cursor Cloud specific instructions

NodeRoute is an npm-workspaces monorepo (Node 20+; works on Node 22). One Express
backend (`backend/`, port `3001`) serves the three built web apps from their
`dist/` folders: `landing-v2` at `/`, `frontend-v2` (admin dashboard) at
`/dashboard-v2`, and `driver-app` at `/driver-app`. Standard commands live in the
root `README.md` and each workspace `package.json`; this section only covers
non-obvious caveats.

### Running / building
- Run everything with `npm start` (serves all apps + API on `http://localhost:3001`).
  Admin login lives at `/login`, dashboard at `/dashboard`.
- **The backend refuses to boot unless all three `dist/` builds exist.** They are
  gitignored and only persist via the VM snapshot. After pulling frontend changes,
  rebuild with `npm run build` (build is intentionally NOT in the startup update
  script). For hot-reload dev, run a workspace Vite server, e.g.
  `npm --prefix frontend-v2 run dev` (port 5173, proxies `/api` + `/auth` to :3001).
- Config validation also fatally exits if `JWT_SECRET` (non-default), `SUPABASE_URL`,
  and `SUPABASE_SERVICE_ROLE_KEY` are unset — see the local `.env` note below.

### Local `.env` (gitignored — demo/offline mode)
A root `.env` is required and persists only through the VM snapshot. If it is
missing, recreate it for offline demo development with these key settings:
- `NODEROUTE_FORCE_DEMO_MODE=true` — uses a local JSON store
  (`backend/data/offline-backup/state.json`) instead of a real Supabase project.
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` — any non-empty placeholders (only
  needed so config validation passes; ignored in demo mode).
- `JWT_SECRET` / `SESSION_SECRET` / `PORTAL_JWT_SECRET` — any non-default values.
- `ADMIN_EMAIL` + `ADMIN_PASSWORD` — seeded as the bootstrap admin login.
- `CORS_ORIGINS=http://localhost:5173,http://localhost:3001`.
- `DEFAULT_COMPANY_ID` / `DEFAULT_LOCATION_ID` (+ names) — **required in demo mode.**
  Without a tenant context the bootstrap admin (role `admin`, not `superadmin`) hits
  the fail-closed tenant scoping and every tenant-scoped list endpoint returns empty.

### Demo-mode gotchas (offline JSON store)
- The mock Supabase client does not implement `upsert` or count selects, so the
  **first-login onboarding wizard gets stuck** (it calls `company_config.upsert`).
  Mark onboarding done via the API instead (then the dashboard loads normally):
  `GET /api/company-config` (bootstraps the row) then
  `PATCH /api/company-config {"onboarding_completed": true}`.
  Mutations require the CSRF double-submit: read the `csrf-token` cookie set on
  login and send it back as the `X-CSRF-Token` header.
- The customers **list** endpoint paginates with a numeric `id >= 0` filter, so
  demo-store rows (which get string ids) never appear in the customers list even
  though they persist. Use **Orders** to demonstrate end-to-end CRUD in demo mode.
- Demo data lives in `backend/data/offline-backup/state.json` (gitignored). Deleting
  it resets to a freshly seeded admin user on next boot.

### Lint / test
- Lint: `npm --prefix frontend-v2 run lint` (ESLint; currently warnings only).
- Tests: `npm test` runs backend (`node --test`) + `frontend-v2` Vitest.
- **`npm test` gotcha:** the demo `.env` sets `DEFAULT_COMPANY_ID`/`DEFAULT_LOCATION_ID`,
 which leak into the test process and break one auth test
 (`authenticateToken rejects non-global users without a resolved tenant context`,
 in `backend/tests/auth-compat.test.js`) — it asserts a tenantless admin is rejected,
 but the default tenant resolves one. Run tests with those two vars cleared:
 `DEFAULT_COMPANY_ID= DEFAULT_LOCATION_ID= npm test` (then all pass). This is an
 env-pollution quirk, not a code bug.
- The `ios-driver-app/` (SwiftUI) requires macOS + Xcode and is out of scope on Linux.

### Local reports
- Do not commit generated reports, scans, Playwright reports, audit exports, or
  similar output artifacts to the repo.
- Save all report artifacts locally under `Reports/` at the repo root
  (`/Users/ryan/NodeRoute Systems/Reports`). The folder is gitignored.
