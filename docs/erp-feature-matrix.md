# Enterprise ERP Feature Matrix

## Supabase Readiness Notes

- Changelog scanned on 2026-06-28 with `curl -L https://supabase.com/changelog.md`.
- Relevant breaking changes: new tables are no longer automatically exposed to the Data and GraphQL APIs starting 2026-04-28; new ERP tables must pair any `anon`/`authenticated` grants with RLS and explicit tenant policies.
- Relevant auth/RLS items: pg_graphql is no longer enabled automatically and GraphQL introspection is disabled by default in pg_graphql 1.6.0; do not rely on GraphQL exposure for ERP tables unless explicitly enabled and reviewed.
- Relevant auth hardening: OAuth token endpoint status changed from 201 to 200; not expected to affect current backend service-role database flows.
- Relevant cron item: direct updates to `cron.job` are no longer allowed; future scheduled ERP reporting should use supported pg_cron scheduling functions or the existing backend scheduler.
- Relevant storage item: storage upsert behavior still requires insert/select/update policy coverage; future product image work should store external URLs or add bucket policies explicitly.

## Schema Inventory Summary

Existing migrations define or alter tenant-critical tables across `supabase/migrations` and legacy `backend/migrations`. Important current coverage includes:

- Tenant roots and scope: `companies`, `locations`, `users`, `company_config`.
- Inventory and products: `seafood_inventory`, `products`, `inventory_lots`, `lot_codes`, `inventory_stock_history`, `inventory_yield_log`, `inventory_location_assignments`, `catch_weight_entries`.
- Warehouse and purchasing: `warehouse_locations`, `warehouse_scans`, `warehouse_returns`, `vendors`, `purchase_orders`, `vendor_bills`, `po_invoice_scans`, `po_receipts`, `po_receiving_lines`, `po_discrepancy_log`, `po_receiving_approval_queue`.
- Orders, routing, and delivery: `orders`, `order_items`, `invoices`, `stops`, `routes`, `driver_locations`, `driver_client_actions`, `dwell_records`, `temperature_logs`, `route_mutation_audit_logs`, `recurring_orders`, `outbound_messages`.
- AR and payments: `customer_visit_logs`, `credit_hold_log`, `credit_hold_overrides`, `stripe_webhook_events`, `portal_payment_methods`, `portal_payment_settings`, `portal_payment_events`.
- Reporting and automation: `ai_insights`, `forecast_items`, `sms_blast_log`, `auth_refresh_sessions`.

Phase 0 regression coverage:

- `backend/tests/multi-tenant-penetration.test.js` now guards public tables created after the blanket RLS baseline and includes an optional live catalog check using `information_schema` and `pg_catalog`.
- `backend/tests/security-hardening.test.js` now rejects new RLS policies that use user-editable metadata, role-only authorization, or policies without `company_id` / `location_id` scope unless they deny direct access.

| Area | Feature | Existing coverage | Gap | Implementation phase | Primary files | Test file |
| --- | --- | --- | --- | --- | --- | --- |
| Shell/nav | Customizable menu order, command palette, dashboard preferences | `frontend-v2/src/lib/nav.ts`, `AppShell.tsx`, `Sidebar.tsx`, `CommandPalette.tsx` | No persisted per-user menu order or dashboard layout tables | Phase 1 | `frontend-v2/src/lib/nav.ts`, `frontend-v2/src/components/layout/*`, `backend/routes/user-preferences.js`, future `user_menu_preferences`, `dashboard_layouts` tables | `backend/tests/user-preferences.test.js`, `frontend-v2/src/lib/nav.test.ts` |
| Maps | Geocoding, drive times, route overlays | `backend/routes/routes.js`, `backend/routes/stops.js`, `frontend-v2/src/pages/MapPage.tsx`, `frontend-v2/src/hooks/useMap.ts`; routing tables already have `company_id` / `location_id` | No server-side Google Maps proxy, geocode cache, drive-time cache, or quota-safe API boundary | Phase 2 | `backend/routes/maps.js`, `backend/services/google-maps.js`, future `warehouse_geocodes`, `customer_geocodes`, `route_drive_time_cache` tables | `backend/tests/maps-route.test.js`, `backend/tests/route-geo-optimization.test.js`, `frontend-v2/src/pages/MapPage.test.tsx` |
| Inventory | Product catalog, lots, catch weight, warehouse locations, cycle counts, kits, projections | `backend/routes/inventory.js`, `backend/services/inventory-ledger.js`, `backend/services/lot-depletion.js`, `backend/routes/catch-weight.js`; tables include `products`, `inventory_lots`, `lot_codes`, `warehouse_locations`, `inventory_location_assignments`, `catch_weight_entries`, `op_cycle_counts` | Cost normalization, kit processing, availability projection, cycle-count UI, shortage/return workflows are incomplete | Phase 3 | `backend/routes/cycle-counts.js`, `backend/routes/kits.js`, `backend/routes/inventory-projections.js`, `backend/services/inventory-costs.js`, future inventory control migration | `backend/tests/cycle-counts.test.js`, `backend/tests/kits-processing.test.js`, `backend/tests/inventory-projections.test.js` |
| Pricing | Cost-driven pricing, promotions, rebates, quotes, minimum sell | Product cost fields and invoice/order calculations exist in pieces; no dedicated pricing engine tables | Missing price levels, customer special pricing, promotions, rebates, bill-backs, quote precedence, and scheduled price update audit | Phase 4 | `backend/routes/pricing.js`, `backend/routes/promotions.js`, `backend/services/pricing-engine.js`, future `price_levels`, `customer_special_prices`, `quotes`, `promotions`, `rebates`, `bill_backs` tables | `backend/tests/pricing-engine.test.js`, `backend/tests/promotions.test.js`, `backend/tests/orders-pricing-enforcement.test.js` |
| Order entry | Order guides, substitutions, backorders, returns, deposits, fuel surcharge, barcode entry, warehouse docs | `backend/routes/orders.js`, `backend/routes/phone-orders.js`, `backend/routes/print.js`, `frontend-v2/src/pages/OrderFormCard.tsx`; `recurring_orders` and `outbound_messages` exist | No order-guide tables, substitution engine, backorder/return workflow, deposit/fuel surcharge rules, or complete document variants | Phase 5 | `backend/routes/order-guides.js`, `backend/routes/customer-messages.js`, `backend/services/order-entry-engine.js`, future order-entry workflow migration | `backend/tests/order-guides.test.js`, `backend/tests/order-entry-engine.test.js`, `backend/tests/invoice-documents.test.js` |
| AR | Credit holds, cash receipts, aging, finance charges, tax, payment application | `backend/routes/ar-hub.js`, `backend/routes/credit-hold.js`, `frontend-v2/src/pages/FinancialsPage.tsx`, `CreditHoldPage.tsx`; tables include `credit_hold_log`, `credit_hold_overrides`, `portal_payment_*` | Need full AR ledger, cash receipts, aging snapshots, finance charges, tax workflows, and reconciliation views | Phase 6 | `backend/routes/ar.js`, `backend/services/ar-ledger.js`, future AR migration | `backend/tests/ar-ledger.test.js`, `backend/tests/cash-receipts.test.js`, `backend/tests/ar-aging.test.js` |
| Purchasing | Receiving, AP, reorder planning, vendor minimums, bank/cash reports | `backend/routes/ops-purchasing.js`, `purchase-orders.js`, `vendor-bills.js`, `vendors.js`; tables include `purchase_orders`, `vendors`, `vendor_bills`, `po_receipts`, `po_receiving_lines`, `po_discrepancy_log`, `reorder_suggestions` | Vendor minimums, AP approval depth, bank/cash reports, and automated reorder planning need consolidation | Phase 7 | `backend/routes/purchasing-planning.js`, `backend/routes/ap.js`, `backend/services/reorder-planning.js`, future purchasing/AP migration | `backend/tests/purchasing-planning.test.js`, `backend/tests/vendor-minimums.test.js`, `backend/tests/ap-workflows.test.js` |
| Reporting | Scheduled reports, exports, alerts, analytics packs | `backend/routes/reporting.js`, `backend/lib/scheduler.js`, `frontend-v2/src/pages/ReportsPage.tsx`, `DashboardPage.tsx`; tables include `ai_insights`, `forecast_items`, `sms_blast_log` | No report subscription table, export queue, alert routing, or per-role dashboard/report packs | Phase 8 | `backend/routes/report-scheduler.js`, `backend/services/report-exporter.js`, future `report_subscriptions`, `report_runs`, `alert_rules` tables | `backend/tests/report-scheduler.test.js`, `backend/tests/report-exporter.test.js`, `frontend-v2/src/pages/ReportsPage.test.tsx` |

## Phase 9 — Implementation Status

Status legend: **Implemented** = shipped with tests; **Partial** = core shipped,
some sub-capabilities deferred; **Deferred** = not in this release.

| Phase | Area | Status | Notes |
| --- | --- | --- | --- |
| 1 | Shell / nav / dashboards / product media | **Implemented** | `user_menu_preferences`, `dashboard_layouts`, `product_media`, `product_image_library` shipped with RLS; `backend/routes/user-preferences.js`, `product-media.js`. Image URLs gated by `ALLOWED_IMAGE_HOSTS`. |
| 2 | Maps (geocode, drive-time, overlays) | **Implemented** | `backend/routes/maps.js` + `services/google-maps.js`; caches `warehouse_geocodes`, `customer_geocodes`, `route_drive_time_cache`. Live map render requires Maps keys (see release notes); fails closed without them. |
| 3 | Advanced inventory control | **Implemented** | Cycle counts, kits, returns, shortages, UoM conversions; cost normalization columns. Routes: `cycle-counts.js`, `kits.js`, `inventory-projections.js`. |
| 4 | Pricing engine / promotions / quotes | **Implemented** | `services/pricing-engine.js`, `routes/pricing.js`, `promotions.js`; price levels, special prices, minimum-sell, promotions, rebates, bill-backs, quotes, scheduled price-update batches. Enforced from order entry. |
| 5 | Order entry workflows | **Implemented** | `services/order-entry-engine.js`, `routes/order-guides.js`, `customer-messages.js`; order guides, substitutions, returns, credit memos, invoice add-ons, deposits, fuel surcharge, barcode scan-to-add. |
| 6 | Accounts receivable | **Implemented** | `services/ar-ledger.js`, `finance-charges.js`, `routes/ar.js`; AR ledger, cash receipts + application, finance charges, sales-tax tracking. Append-only ledger (see rollback notes). |
| 7 | Purchasing / AP / reorder planning | **Implemented** | `routes/ap.js`, `ops/purchasing-planning-routes.js`, `ops/purchasing-order-routes.js`, `services/ap-ledger.js`, `reorderEngine.js`; vendor minimums, AP ledger/payment batches, bank accounts + reconciliation, cash-requirements snapshots, reorder suggestions. |
| 8 | Reporting / scheduler / alerts | **Implemented** | `routes/report-schedules.js`, `services/report-exporter.js`, `lib/scheduler.js`; report definitions/schedules/runs/delivery targets, credit + inventory alert rules. Exports: CSV, TXT, PDF, XLSX. |

## Phase 9 — Test Results

| Suite | Command | Result |
| --- | --- | --- |
| Backend | `npm run test --workspace=backend` | **438 passed, 0 failed, 1 skipped** + stress-smoke pass |
| Frontend | `npm run test --workspace=noderoute-frontend-v2` | **137 passed (24 files)** |

### Playwright smoke workflows

The available Playwright suites were executed during Phase 9:

- `npm run test:e2e --workspace=noderoute-frontend-v2 -- --project=chromium --reporter=line`
  now reaches the mounted dashboard app after a base-path fix; result:
  **1 passed, 8 failed**. The passing check is unauthenticated redirect. The
  remaining authenticated checks submit the login form but time out waiting to
  leave `/login`, so the local Vite-only run still needs a working backend auth
  target and seeded credentials before it can exercise the protected workflows.
- `npm run test:smoke --workspace=noderoute-frontend-v2 -- --reporter=line`
  result: **2 failed before workflow execution** because `TEST_EMAIL` and
  `TEST_PASSWORD` were not set for the live-stack smoke environment.

The ERP-specific workflows below are **not** encoded as standalone Playwright
specs yet; their behavior is covered by the backend integration and frontend
unit suites (all passing above). Status reflects that coverage path plus the
live-stack blocker for Playwright.

| Workflow (phase) | Playwright spec present | Verified via | Status |
| --- | --- | --- | --- |
| Navigation customization (P1) | no | `frontend-v2/src/lib/nav.test.ts`, backend user navigation preferences tests | Pass (unit/integration); Playwright deferred |
| Product image display in search (P1) | no | `backend/tests/product-media.test.js` | Pass (integration); Playwright deferred |
| Dashboard layout persistence (P1) | no | backend user-preferences round-trip tests and `DashboardBuilderPage` test | Pass (integration/unit); Playwright deferred |
| Order entry with pricing enforcement (P4+P5) | no | backend pricing-engine / orders-pricing-enforcement / order-entry tests | Pass (integration); Playwright deferred |
| Invoice add-on and return (P5) | no | backend order-entry / invoice-documents tests | Pass (integration); Playwright deferred |
| Cash receipt application (P6) | no | backend ar-ledger / cash-receipts tests | Pass (integration); Playwright deferred |
| Purchasing suggestion with vendor minimum (P7) | no | backend vendor-minimum / purchasing-planning tests | Pass (integration); Playwright deferred |
| Report run and download (P8) | no | backend report-scheduler / report-exporter tests; `ReportsPage.test.tsx` | Pass (integration/unit); Playwright deferred |
| Route map visualization (P2) | partial (`e2e/routes.spec.ts`) | `frontend-v2/src/pages/MapPage.test.tsx`; live render needs Maps key | Pass (unit); live Playwright blocked by auth/backend setup |

> Playwright follow-up: start the backend on `:3001`, provide `TEST_EMAIL` and
> `TEST_PASSWORD`, then run both Playwright tracks. The Vite e2e suite uses
> `/dashboard-v2/*` paths to match the configured frontend base.

## Phase 9 — RLS & Service-Role Verification

- **Migration ordering:** all 137 migrations confirmed present and in order on the
  remote project via Supabase CLI and MCP `list_migrations`, ending with the
  Phase 1–8 ERP migrations through `20260629223719_report_scheduler_alerts`.
  `supabase db push --dry-run` reports `Remote database is up to date`.
- **RLS coverage:** every new ERP table created in Phases 1–8 has both
  `enable row level security` and a tenant policy in the same migration —
  61 tables / 61 enable-RLS / 61 policies. Supabase **security advisor reports
  zero `rls_disabled` errors**. Live catalog check: 136 public tables, **0**
  without RLS. Of 130 tables with `company_id`/`location_id`, 128 have explicit
  tenant-policy references; the two exceptions are historical
  `credit_hold_log` / `credit_hold_overrides` tables whose authenticated-client
  policies are deny-all (`false` / `false`) and are accessed through backend
  service-role routes only.
- **Route scoping:** all new ERP route files were scanned for `.from()` calls not
  guarded by `scopeQueryByContext` / `filterRowsByContext` /
  `insertRecordWithOptionalScope` / `buildScopeFields`. Flagged sites were
  reviewed individually; all but one were correctly scoped (post-fetch filter,
  derived-from-scoped-IDs, or a prior scoped+verified fetch). **Fix applied:**
  `backend/routes/ops/purchasing-order-routes.js` auto product-creation (PO
  receiving, unmatched-inventory branch) inserted into `products` without
  `company_id` (a `NOT NULL` column with no default) — now scoped via
  `buildScopeFields(req.context)`.
- **Service-role exposure:** no `service_role` / `SUPABASE_SERVICE` references in
  `backend/routes/` or `frontend-v2/src/`. References are confined to
  `backend/lib/config.js` and `backend/services/supabase.js` (plus tests).
  The only live `auth.role() = 'service_role'` policy references are infra
  gates on `portal_auth_attempts`, `portal_challenges`, and
  `stripe_webhook_events`, not ERP tenant authorization.

## Phase 9 — DB Health

Source: Supabase CLI v2.108.0 through `npx --yes supabase@latest`, using the
`.env`-derived DB URL. `inspect db unused-indexes` is deprecated in favor of
`inspect db index-stats`, but still ran successfully for this pass.

**Security advisors:** 8 WARN-level lints, **zero ERROR**:
- `function_search_path_mutable` ×5 — `fn_audit_log_customer_change`,
  `fn_audit_log_order_change`, `seafood_inventory_insert_fn`,
  `set_reorder_suggestions_updated_at`, `sync_products_inventory_report_fields`
  (set an explicit `search_path` on these functions).
- `extension_in_public` ×2 — `pg_trgm`, `ltree` installed in `public` (pre-existing;
  consider relocating to a dedicated schema).
- `rls_policy_always_true` ×1 — `waitlist` INSERT policy is intentionally open for
  public signup.

**Performance advisors:** 595 lints, **zero ERROR**:
- Level split: 381 INFO, 214 WARN.
- `unused_index` (INFO) ×249 — expected immediately after a large migration batch;
  many new ERP indexes have no accumulated scan stats yet. Re-evaluate after the
  features see production traffic before dropping any.
- `multiple_permissive_policies` (WARN) ×213 — overlapping permissive RLS policies;
  a long-standing consolidation item (earlier `merge_permissive_policies`
  migrations addressed part of this).
- `unindexed_foreign_keys` (INFO) ×132.
- `auth_rls_initplan` (WARN) ×1.

**Unused index inspection:** 500 index rows returned; 359 currently show zero
scans. Largest zero-scan entries include `idx_products_reorder_enabled` (96 kB),
`idx_auth_refresh_sessions_token_hash` (40 kB), and `idx_orders_items_gin`
(32 kB). Treat as post-migration telemetry, not an immediate drop list.

**Bloat inspection:** 107 rows returned; 67 show non-zero estimated waste. Largest
items are small: `public."Customers"` (112 kB), `reorder_suggestions` (48 kB),
`auth_refresh_sessions` (40 kB), `products` (32 kB), and
`orders::idx_orders_items_gin` (24 kB).

## Known Deferred Integrations

The following are explicitly **not** included in this ERP release:

- **RTF report export** — exporter supports CSV, TXT, PDF, XLSX only
  (`backend/services/report-exporter.js`). No RTF.
- **Fax transmission** — `fax_number` is stored on customers, but there is no fax
  send/receive integration.
- **EDI** — `ops/admin-routes.js` exposes EDI job registry endpoints only; no
  live trading-partner EDI document exchange.
- **External accounting/ERP connectors** — `routes/integrations.js` registers a
  QuickBooks slug and the integrations registry, but two-way QuickBooks /
  NetSuite / SAP sync is not implemented.
- **Live Playwright smoke automation for ERP workflows** — ERP workflows are
  covered by unit/integration tests; dedicated Playwright specs are deferred.
