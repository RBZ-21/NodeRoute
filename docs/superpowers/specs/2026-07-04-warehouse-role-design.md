# Warehouse Role — Design Spec

**Date:** 2026-07-04
**Status:** Approved (brainstorming session)

## Goal

Add a new user role, `warehouse`, scoped to warehouse-floor inventory work:
receiving, stock adjustments, spoilage, lot/traceability lookups, and physical
counts — without exposing dispatch, sales, financial, or company-admin data.

## Discovery

The backend already anticipates this role: `backend/routes/warehouse.js` and
`backend/routes/warehouse-locations.js` both gate their endpoints with
`requireRole(...WAREHOUSE_ROLES)` where `WAREHOUSE_ROLES = ['admin', 'manager',
'warehouse']`. That wiring is dead code today because `'warehouse'` doesn't
exist anywhere else in the system:

- Not in the `users_role_check` DB constraint (`admin`, `manager`, `driver`,
  `superadmin` only) — creating a user with this role is rejected at the DB.
- Not in the backend `USER_ROLES` validation array
  (`backend/lib/users-schemas.js`) — the invite/create/role-patch APIs reject it.
- Not in the frontend `Role` type unions or the Users page's invite/edit
  dropdowns — there's no way to assign it from the UI.
- Not referenced by `inventory.js` or `lots.js`'s `requireRole` calls, so even
  once assignable, a warehouse user couldn't do most inventory actions.

This spec finishes that wiring and extends it to match the requested scope.

## Scope

### A. Role plumbing

- New Supabase migration: extend `users_role_check` to include `'warehouse'`.
- `backend/lib/users-schemas.js`: add `'warehouse'` to `USER_ROLES`.
- `frontend-v2/src/lib/nav.ts`, `frontend-v2/src/lib/api.ts`,
  `frontend-v2/src/hooks/useUsers.ts`: add `'warehouse'` to the `Role` union.
- `frontend-v2/src/pages/UsersPage.tsx`: add `'warehouse'` to the
  invite-role options and the editable/assignable role list for admins.

### B. Sidebar navigation (`frontend-v2/src/lib/nav.ts`)

Warehouse sees the Dashboard plus the entire Inventory group; everything else
is hidden.

| Group | Item | Visible to `warehouse`? |
|---|---|---|
| Home | Dashboard | Yes |
| Dispatch | Orders, Routes, Map | No |
| Inventory | Inventory | Yes |
| Inventory | Kits | Yes |
| Inventory | Purchasing | Yes |
| Inventory | Warehouse | Yes |
| Inventory | Traceability | Yes |
| Customers | Customers, Vendors, Sales Rep, Phone Orders | No |
| Financials | Financials, Pricing, Invoices, Credit Hold | No |
| Insights | Analytics, Dashboard Builder, DSR, Forecasting, Reports, AI Help | No |
| Admin | Superadmin, Users, Companies, Settings, Integrations, Compliance, Planning, Audit Log | No |

Implementation: add explicit `roles` arrays (including `'warehouse'`) to the
Inventory-group items that don't already have one (`inventory`, `purchasing`,
`warehouse`, `traceability` currently have no `roles`, meaning they're open to
every role today — they need an explicit list added so the *other* roles
without inventory needs, e.g. `driver`/`rep`, aren't accidentally changed).
Add `'warehouse'` to `kits`'s existing `roles: ['admin', 'manager']`. Every
non-Inventory item that currently has no `roles` restriction needs an explicit
list of the existing roles (`admin`, `manager`, `driver`, `rep`) so it stops
being visible to `warehouse` specifically, without changing behavior for
anyone else (`superadmin` always bypasses via `canAccess`).

### C. Backend permission grants

| File | Endpoints | Grant to `warehouse`? |
|---|---|---|
| `inventory.js` | `POST /` (create item), `PATCH /:id` (edit item), `GET /low-stock` | Yes |
| `inventory.js` | `POST /:id/restock`, `/:id/adjust`, `/:id/pick`, `/:id/spoilage` | Yes |
| `inventory.js` | `POST /transfer`, `POST /count` | Yes |
| `inventory.js` | `POST /lots`, `PATCH /lots/:lotId`, `POST /lots/:lotId/deplete`, `DELETE /lots/:lotId` | Yes |
| `inventory.js` | `POST /adjust-shortage`, `POST /return` | No — shortage adjustment ties to purchasing discrepancies (out of scope); the customer-return workflow already has a dedicated, already-`warehouse`-gated endpoint at `warehouse.js`'s `POST /returns`, so this older `inventory.js` route doesn't need to be opened too |
| `inventory.js` | `POST /alerts/send`, `GET /ai-analysis`, `POST /:id/reorder-alert` | No (AI/notification tooling, not requested) |
| `lots.js` | `GET /:lotNumber/trace`, `GET /traceability/report`, `POST /` (create lot) | Yes — also adds `manager` (currently missing), per approved answer |
| `lots.js` | `POST /:lotNumber/notice` (FDA recall notice), `PATCH /products/:itemNumber/ftl` | No (compliance/config actions, admin-level) |
| `warehouse.js` / `warehouse-locations.js` | All `WAREHOUSE_ROLES`-gated routes | Already coded — just needs the DB/type work in section A to actually function |
| `warehouse.js` | `POST/PATCH/DELETE /locations`, `PATCH /returns/:id` | No change (stay `admin`/`manager` only, as today) |
| `cycle-counts.js` | `POST /`, `PATCH /:id/items`, `POST /:id/commit` | Yes |
| `kits.js` | `GET /recipes`, `GET /runs` | Yes (view only) |
| `kits.js` | `POST /recipes`, `POST /process` | No (production/recipe decisions stay manager-level) |
| `purchase-orders.js` | everything (`draft`, `confirm`, `scan`, `status`, list, pdf) | No — Purchasing stays visible in nav (per "anything associated with inventory") but not actionable by `warehouse`, mirroring how `driver`/`rep` already see-but-can't-act on this page today |

### D. Cost/price fields

`frontend-v2/src/pages/InventoryPage.tsx`'s `canEditCosts = hasRole(getUserRole(),
'manager')` stays unchanged (still `manager`+ only). `warehouse` isn't part of
the linear `hasRole` hierarchy, so this naturally excludes it — no code change
needed here, just confirming it's not accidentally granted.

## Explicitly out of scope

- Purchase order creation/confirmation/receiving.
- Kit recipe creation or running a kit process.
- AI-driven inventory tooling (health analysis, smart reorder, markdown
  suggestions) and email alert sending.
- Warehouse location create/edit/delete, and editing/approving returns
  (stays `admin`/`manager`).
- Cost/price field edits on inventory items.
- Any change to the `driver`/`rep`/`manager`/`admin`/`superadmin` roles beyond
  the two `lots.js` traceability endpoints gaining `manager`.

## Testing

- Existing backend route tests (if any target `inventory.js`/`lots.js`
  `requireRole` behavior) should be extended with a `warehouse`-role case.
- `frontend-v2/src/lib/nav.test.ts` already tests `canAccess`/`canAccessGroup`
  — add cases asserting `warehouse` sees only Dashboard + Inventory group.
- Manual check: sign in as a seeded `warehouse` user (or patch a test user's
  role via SQL) and confirm the sidebar matches section B.
