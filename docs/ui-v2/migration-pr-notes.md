# UI V2 Migration Notes

## Scope
- Introduced a React + Vite + TypeScript `frontend-v2` application for the admin surface.
- Added Tailwind-based design tokens and shadcn-style component primitives.
- Migrated admin shell navigation to grouped dropdowns with role-aware visibility.
- Migrated pages:
  - Financial Overview (`Daily Sales` focus with date range + CSV export)
  - Orders workbench (read-only parity view on `/api/orders`)
  - Analytics rollups (`/api/reporting/rollups`)
  - Purchasing list (`/api/purchase-orders`)
  - Inventory overview (`/api/inventory`)
- Kept backend APIs unchanged.

## Screenshots
- Legacy dashboard: `docs/ui-v2/screenshots/legacy-dashboard.png`
- V2 dashboard shell: `docs/ui-v2/screenshots/v2-dashboard-shell.png`
- V2 financials: `docs/ui-v2/screenshots/v2-financials.png`
- V2 orders: `docs/ui-v2/screenshots/v2-orders.png`

## Feature Flag / Parallel Run
- Legacy remains on `/dashboard` by default.
- V2 is served on `/dashboard-v2`.
- `FEATURE_UI_V2_DEFAULT=true` flips `/dashboard` to redirect to V2.
- `?ui=v2` on `/dashboard` forces V2 routing when the V2 build exists.

## Known Follow-Ups
- Wire create/edit flows for Orders, Purchasing, and Inventory actions in V2.
- Add chart visualizations for analytics tabs.
- Add end-to-end UI tests for role gating and major workflows.
- Replace screenshot helper with CI-captured visual artifacts.

## Rollout Plan
1. Keep legacy and V2 running in parallel.
2. Enable V2 for internal/admin QA using `/dashboard-v2` and optional query-flag route.
3. Fix parity gaps and complete interaction flows.
4. Switch `FEATURE_UI_V2_DEFAULT=true` for production cutover.
5. Keep legacy reachable during a defined rollback window, then retire legacy UI.
