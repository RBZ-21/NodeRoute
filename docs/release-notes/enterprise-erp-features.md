# Enterprise ERP Features — Release Notes & Rollout Checklist

Branch: `codex/enterprise-erp-next-phase`
Verification pass (Phase 9) completed: 2026-06-29

This document is the operational checklist for rolling out the Enterprise ERP
feature set (Phases 1–8). It covers required environment variables, third-party
setup, migration ordering, breaking changes, and rollback notes.

See [erp-feature-matrix.md](../erp-feature-matrix.md) for the per-feature
implementation status, RLS verification, and DB-health findings.

---

## 1. Required new environment variables

| Variable | Scope | Where to set | Notes |
| --- | --- | --- | --- |
| `GOOGLE_MAPS_API_KEY` | **Server only** | Backend host env (Railway/host secrets) | Read by `backend/services/google-maps.js` via `config.GOOGLE_MAPS_API_KEY` (falls back to legacy `GOOGLE_MAPS_KEY`). Never expose to the browser. Used for Geocoding, Distance Matrix, and Directions proxy calls. |
| `VITE_GOOGLE_MAPS_PUBLIC_KEY` | **Browser** | Frontend build env (`frontend-v2` Vite build) | Read by `frontend-v2/src/pages/MapPage.tsx` (falls back to legacy `VITE_GOOGLE_MAPS_KEY` / `VITE_MAP_API_KEY`). **Must be HTTP-referrer-restricted** in Google Cloud Console to the dashboard and public-tracking domains. |
| `ALLOWED_IMAGE_HOSTS` | Server only | Backend host env | Comma-separated allowlist of hostnames permitted for product image URLs. Enforced by `backend/routes/product-media.js`. **Default is empty** — meaning no remote image host is accepted until this is configured. Set it to your CDN/image hosts (e.g. `images.noderoute.com,cdn.example.com`). |
| `EMAIL_FROM` | Server only | Backend host env | From-address for scheduled report deliveries and alert emails (`backend/lib/scheduler.js`). Required for the report scheduler to dispatch. |

Supporting/optional scheduler cron overrides (all have sane defaults in
`backend/lib/scheduler.js`): `REPORT_SCHEDULER_CRON` (default `*/5 * * * *`),
`ALERT_CHECKER_CRON` (default `*/15 * * * *`), `DAILY_BLAST_CRON`,
`REORDER_CHECK_CRON`, `REORDER_USAGE_CRON`, `REORDER_DIGEST_CRON`,
`AI_INSIGHTS_CRON`, `RECURRING_ORDERS_CRON`.

> Note: `.env.example` currently documents `GOOGLE_MAPS_KEY` /
> `VITE_GOOGLE_MAPS_KEY` / `VITE_MAP_API_KEY` aliases. The canonical names above
> are preferred for new deployments; the aliases remain supported for backward
> compatibility. `ALLOWED_IMAGE_HOSTS` should be added to your environment.

---

## 2. Google Maps setup checklist

1. Create (or reuse) a Google Cloud project with billing enabled.
2. Enable the following APIs:
   - **Geocoding API**
   - **Distance Matrix API**
   - **Directions API**
3. Create **two** API keys:
   - A **server key** → `GOOGLE_MAPS_API_KEY` (no referrer restriction; restrict
     by API and optionally by server IP).
   - A **browser key** → `VITE_GOOGLE_MAPS_PUBLIC_KEY`, restricted by **HTTP
     referrer** to the dashboard and public tracking domains.
4. Set a **billing budget + alert** on the project so quota usage is bounded.
   The server proxy caches geocodes and drive-times (`warehouse_geocodes`,
   `customer_geocodes`, `route_drive_time_cache`) to minimize API spend.
5. If `GOOGLE_MAPS_API_KEY` is unset, the maps endpoints fail closed with a clear
   "not configured" error rather than calling Google.

---

## 3. Report scheduler setup

- The scheduler is started in-process from `backend/server.js`
  (`startScheduler()` in `backend/lib/scheduler.js`) and runs via `node-cron`.
  Confirm the backend process is long-running (not serverless-per-request) so the
  cron jobs actually fire. If `node-cron` is unavailable the scheduler degrades
  to a no-op and logs a warning.
- Set `EMAIL_FROM` to a verified sending address for your email provider (Resend).
  Without it, report/alert dispatch returns `no_recipients` / skips sending.
- Report delivery cadence is driven by `report_schedules` rows; the checker runs
  on `REPORT_SCHEDULER_CRON` (default every 5 minutes) and alerts on
  `ALERT_CHECKER_CRON` (default every 15 minutes).
- Supported export formats: **CSV, TXT, PDF, XLSX** (`backend/services/report-exporter.js`).

---

## 4. Migration notes (apply in order)

All migrations live in `supabase/migrations/` and are applied in version order.
The full chain (137 migrations) is confirmed present and ordered on the remote
project via `list_migrations`. The Phase 1–8 ERP migrations are:

| Version | Name | Adds |
| --- | --- | --- |
| `20260628151744` | erp_feature_foundation | Phase 0: shared extensions only (`pgcrypto`, `pg_trgm`, `ltree`); no feature tables. |
| `20260628114829` | user_navigation_dashboards_product_media | Phase 1: `user_menu_preferences`, `dashboard_layouts`, `product_media`, `product_image_library`. |
| `20260628160710` | maps_geocache | Phase 2: `warehouse_geocodes`, `customer_geocodes`, `route_drive_time_cache`. |
| `20260628162942` | advanced_inventory_control | Phase 3: `cycle_counts`, `cycle_count_items`, `inventory_returns`, `inventory_shortages`, `inventory_uom_conversions`, `kit_recipes`, `kit_recipe_items`, `kit_processing_runs`; product cost columns (`real_cost`, `landed_cost`, `base_cost`). |
| `20260628204305` | pricing_promotions_quotes | Phase 4: `price_levels`, `price_level_rules`, `customer_price_level_assignments`, `customer_special_prices`, `minimum_sell_rules`, `promotions`, `promotion_items`, `quotes`, `quote_items`, `rebates`, `bill_backs`, `pricing_update_batches`, `pricing_update_batch_items`. |
| `20260629085911` | order_entry_workflows | Phase 5: `order_guides`, `order_guide_items`, `customer_substitutions`, `customer_returns`, `credit_memos`, `invoice_addons`, `bottle_deposits`, `fuel_surcharge_rules`, `customer_item_instructions`, `customer_hot_messages`, `barcode_scan_events`. |
| `20260629105742` | accounts_receivable | Phase 6: `ar_ledger_entries`, `cash_receipts`, `cash_receipt_applications`, `customer_credit_events`, `finance_charge_runs`, `finance_charge_entries`, `sales_tax_jurisdictions`, `sales_tax_entries`. |
| `20260629211725` | orders_company_id_required | Support: requires `company_id` on every order row (orphan-order hardening). |
| `20260629211731` | driver_client_actions | Support: `driver_client_actions` idempotency keys for offline driver-queue replay. |
| `20260629211733` | inventory_location_assignments_rls | Support: adds `company_id` + tenant scope to `inventory_location_assignments`. |
| `20260629220219` | purchasing_ap_reports | Phase 7: `ap_ledger_entries`, `ap_payment_batches`, `ap_payment_batch_items`, `bank_accounts`, `bank_reconciliation_sessions`, `bank_reconciliation_items`, `cash_requirements_snapshots`; vendor minimums (`min_order_value`, `pallet_qty`, `layer_qty`). |
| `20260629223719` | report_scheduler_alerts | Phase 8: `report_definitions`, `report_schedules`, `report_delivery_targets`, `report_runs`, `alert_sends`, `credit_alert_rules`, `inventory_alert_rules`. |

Every new ERP table ships with `enable row level security` **and** a tenant
policy in the same migration (verified: 61 tables, 61 enable-RLS, 61 policies).

---

## 5. Breaking changes vs. the pre-ERP baseline

- **Orders require a tenant.** `orders.company_id` is now effectively required
  (`20260629211725`). Any external integration that inserts orders directly
  (e.g. phone/voice webhooks) **must** supply `company_id`, or the row will be an
  unreachable orphan invisible to every scoped query. No endpoint was renamed.
- **New tables are not auto-exposed to the Data/GraphQL APIs.** Per the Supabase
  2026-04-28 change, the new ERP tables are reachable only through the backend
  service (which carries tenant scoping) — not via direct PostgREST/GraphQL with
  anon/authenticated roles.
- No pre-ERP REST endpoint paths were renamed and no existing request/response
  shapes were removed. ERP features are additive (new routes under
  `/api/pricing`, `/api/promotions`, `/api/order-guides`, `/api/ar`, `/api/ap`,
  `/api/maps`, `/api/cycle-counts`, `/api/kits`, `/api/report-schedules`, etc.).

---

## 6. Rollback notes

**Independently reversible** (drop schema + remove routes; no destructive data
beyond the feature's own rows):

- Phase 1 — navigation/dashboard/product media (preference & media tables).
- Phase 2 — maps geocode/drive-time **caches** (regenerated on demand).
- Phase 3 — advanced inventory control (cycle counts, kits, returns/shortages).
  Note: reverting after cycle-count adjustments have posted to inventory leaves
  the adjusted on-hand quantities in place.
- Phase 4 — pricing/promotions/quotes (pricing config tables).
- Phase 7 — purchasing/AP planning tables and vendor-minimum columns
  (the **bank reconciliation and AP ledger** sub-tables hold financial records —
  treat like Phase 6 below if posted entries exist).
- Phase 8 — report scheduler & alerts (definitions/schedules/runs).

**Irreversible / care required** (append-only financial ledgers — dropping these
destroys an audit trail; do not roll back once posted entries exist):

- Phase 5 — credit memos and customer returns generate financial documents.
- Phase 6 — **AR ledger** (`ar_ledger_entries`), cash receipts/applications, and
  finance-charge entries are append-only accounting records.
- Phase 7 — **AP ledger** (`ap_ledger_entries`) and bank-reconciliation records.

For the irreversible phases, prefer disabling the routes/UI and freezing further
posting over dropping the schema.

---

## 7. Verification summary (Phase 9)

- Backend test suite: **438 passing, 0 failing, 1 skipped** + stress-smoke pass.
- Frontend (`noderoute-frontend-v2`) test suite: **137 passing** (24 files).
- RLS: every new ERP table has RLS enabled + a tenant policy; Supabase security
  advisor reports **zero `rls_disabled` errors**. A live catalog check found 136
  public tables and **0** without RLS; the only tenant-column tables without
  tenant-policy references are historical `credit_hold_log` /
  `credit_hold_overrides`, whose authenticated-client policies are deny-all.
- Supabase migration history: CLI and MCP both confirm 137 local/remote
  migrations through `20260629223719_report_scheduler_alerts`; `db push
  --dry-run` reports `Remote database is up to date`.
- Service-role exposure: **no** `service_role` / `SUPABASE_SERVICE` references in
  `backend/routes/` or `frontend-v2/src/` (confined to `backend/lib/` and
  `backend/services/`). The only live `auth.role() = 'service_role'` policy
  references are infra gates on portal challenge/audit and Stripe webhook tables.
- One latent scoping bug was found and fixed during this pass: the auto
  product-creation path in `backend/routes/ops/purchasing-order-routes.js` (PO
  receiving, unmatched-inventory branch) inserted into `products` without a
  `company_id`, which is `NOT NULL` with no default — now scoped via
  `buildScopeFields(req.context)`.
- Playwright: the Chromium Vite e2e suite now reaches `/dashboard-v2/*` after a
  base-path fix; unauthenticated redirect passes, while authenticated tests are
  blocked without a backend auth service behind the Vite dev server. The local
  smoke suite is blocked until `TEST_EMAIL` and `TEST_PASSWORD` are set. ERP
  workflow correctness is covered by the backend integration and frontend unit
  suites above. See the Playwright section in the feature matrix.
