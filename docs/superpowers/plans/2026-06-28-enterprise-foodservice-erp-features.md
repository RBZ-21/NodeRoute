# Enterprise Foodservice ERP Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring NodeRoute closer to a full foodservice distribution ERP by adding customizable navigation, Google Maps workflows, product media, stronger inventory control, advanced pricing, order-entry workflows, AR/AP workflows, route documents, scheduled reporting, and dashboard customization.

**Architecture:** Build on the current NodeRoute monorepo: Express backend, React/Vite `frontend-v2`, Supabase/Postgres migrations, tenant scoping through `backend/services/operating-context.js`, and existing domain routes for inventory, routes, purchasing, reporting, invoices, credit holds, vendors, warehouse, lots, and phone orders. Each phase adds one vertical slice with schema, API, UI, tests, and audit logging so it can ship independently.

**Tech Stack:** Express 5, `@supabase/supabase-js`, Supabase/Postgres with RLS, React 19/Vite, Vitest/Testing Library, Playwright, `node --test`, Google Maps Platform APIs, existing `pdfkit`/export services, existing email services, Stripe where payment cards are involved.

## Global Constraints

- Work from `/Users/ryan/NodeRoute Systems/NodeRoute`; `/Users/ryan/NodeRoute Systems` is only the container directory.
- Preserve existing dirty worktree changes unless the implementation task explicitly owns that file.
- All Supabase tables in exposed schemas must have RLS enabled and tenant policies using company/location scope, not role-only policies.
- Do not use `user_metadata` or client-supplied role fields for authorization.
- Follow existing backend route patterns: `authenticateToken`, `requireRole`, Zod validation, `scopeQueryByContext`, `filterRowsByContext`, and `insertRecordWithOptionalScope`.
- Follow existing frontend navigation and shell patterns in `frontend-v2/src/lib/nav.ts` and `frontend-v2/src/components/layout`.
- Every feature must include backend unit tests and focused frontend tests; user-facing workflows get Playwright coverage when practical.
- Google Maps work requires `GOOGLE_MAPS_API_KEY`, server-side distance/directions proxying where secrets are involved, and browser key restrictions in production.
- Use Supabase current docs/changelog before implementing schema, RLS, storage, cron, or edge-function changes.
- Commit after each independently working task.

---

## Current Codebase Anchors

- Navigation: `frontend-v2/src/lib/nav.ts`, `frontend-v2/src/components/layout/AppShell.tsx`, `frontend-v2/src/components/layout/Sidebar.tsx`, `frontend-v2/src/components/layout/CommandPalette.tsx`
- Inventory: `backend/routes/inventory.js`, `backend/services/inventory-ledger.js`, `backend/services/lot-depletion.js`, `backend/routes/catch-weight.js`, `frontend-v2/src/pages/InventoryPage.tsx`, `frontend-v2/src/pages/TraceabilityPage.tsx`
- Warehouse: `backend/routes/warehouse.js`, `backend/routes/warehouse-locations.js`, `frontend-v2/src/pages/WarehousePage.tsx`, `frontend-v2/src/components/warehouse/*`
- Purchasing/AP: `backend/routes/ops-purchasing.js`, `backend/routes/purchase-orders.js`, `backend/routes/vendor-bills.js`, `backend/routes/vendors.js`, `frontend-v2/src/pages/PurchasingPage.tsx`, `frontend-v2/src/pages/VendorsPage.tsx`
- Orders/invoices: `backend/routes/orders.js`, `backend/routes/invoices.js`, `backend/routes/phone-orders.js`, `backend/routes/print.js`, `frontend-v2/src/pages/OrdersPage.tsx`, `frontend-v2/src/pages/OrderFormCard.tsx`, `frontend-v2/src/pages/InvoicesPage.tsx`, `frontend-v2/src/pages/PhoneOrdersPage.tsx`
- AR/financials: `backend/routes/ar-hub.js`, `backend/routes/credit-hold.js`, `frontend-v2/src/pages/FinancialsPage.tsx`, `frontend-v2/src/pages/CreditHoldPage.tsx`
- Routes/maps: `backend/routes/routes.js`, `backend/routes/stops.js`, `frontend-v2/src/pages/RoutesPage.tsx`, `frontend-v2/src/pages/MapPage.tsx`, `frontend-v2/src/hooks/useMap.ts`
- Reporting/dashboards: `backend/routes/reporting.js`, `frontend-v2/src/pages/ReportsPage.tsx`, `frontend-v2/src/pages/DashboardPage.tsx`, `frontend-v2/src/hooks/useReports.ts`, `backend/lib/scheduler.js`
- Search: `backend/routes/search.js`, `frontend-v2/src/components/layout/CommandPalette.tsx`
- Supabase migrations: `supabase/migrations/*`

## Recommended Sub-Project Split

This feature list is too large for one engineering branch. Execute it as these independently releasable workstreams:

1. Core shell, search, images, and dashboards
2. Maps, drive times, routing documents, and route visualization
3. Inventory control, costing, processing kits, cycle counts, projections
4. Pricing, promotions, rebates, bill-backs, quotes, and minimum sell enforcement
5. Order entry, order guides, substitutions, backorders, returns, bottle deposits, fuel surcharge, warehouse instructions
6. AR, payments, credit holds, cash receipts, finance charges, tax, aging
7. Purchasing, AP, receiving, reorder planning, vendor minimums, bank/cash reports
8. Reporting scheduler, exports, alerts, and analytics packs

## Phase 0: Supabase And Baseline Readiness

**Files:**
- Create: `supabase/migrations/<generated>_erp_feature_foundation.sql`
- Modify: `backend/tests/multi-tenant-penetration.test.js`
- Modify: `backend/tests/security-hardening.test.js`
- Create: `docs/erp-feature-matrix.md`

**Deliverable:** A checked feature matrix mapping each requested capability to existing coverage, planned implementation, database tables, routes, and tests.

- [ ] Run `curl -L https://supabase.com/changelog.md` and scan for breaking changes affecting RLS, auth, storage, cron, and Data API exposure.
- [ ] Run `supabase --version` and `supabase migration new erp_feature_foundation`.
- [ ] Inventory existing schema with `rg -n "create table|alter table" supabase/migrations backend/migrations`.
- [ ] Create `docs/erp-feature-matrix.md` with columns: `Area`, `Feature`, `Existing coverage`, `Gap`, `Implementation phase`, `Primary files`, `Test file`.
- [ ] Add regression tests that fail if new exposed tables are missing RLS or tenant scope fields.
- [ ] Verify with `npm run test --workspace=backend -- --test-name-pattern=multi-tenant`.
- [ ] Commit: `docs: map enterprise erp feature implementation`.

## Phase 1: Core Shell, Custom Menus, Search, Images, Dashboards

**Files:**
- Create: `supabase/migrations/<generated>_user_navigation_dashboards_product_media.sql`
- Create: `backend/routes/user-preferences.js`
- Create: `backend/routes/product-media.js`
- Modify: `backend/server.js`
- Modify: `backend/routes/search.js`
- Modify: `frontend-v2/src/lib/nav.ts`
- Modify: `frontend-v2/src/components/layout/Sidebar.tsx`
- Modify: `frontend-v2/src/components/layout/CommandPalette.tsx`
- Create: `frontend-v2/src/pages/DashboardBuilderPage.tsx`
- Create: `frontend-v2/src/hooks/useUserPreferences.ts`
- Create: `frontend-v2/src/hooks/useProductMedia.ts`
- Test: `backend/tests/user-preferences.test.js`
- Test: `backend/tests/product-media.test.js`
- Test: `frontend-v2/src/lib/nav.test.ts`
- Test: `frontend-v2/src/pages/DashboardPage.test.tsx`

**Deliverable:** Users can customize their visible menu order, search screens show product/customer images, products can attach curated/library/internet image URLs, and dashboards can be configured per role/user.

- [ ] Add tenant-scoped tables: `user_menu_preferences`, `dashboard_layouts`, `product_media`, `product_image_library`.
- [ ] Seed an initial product image library with imported CSV/JSON records, not binary image blobs.
- [ ] Add `GET/PUT /api/user-preferences/navigation`.
- [ ] Add `GET/POST/PATCH/DELETE /api/product-media` with URL validation and allowed image host policy.
- [ ] Extend `/api/search` response objects with optional `image_url` for products and customers.
- [ ] Add a `customize` mode to the sidebar using existing nav item ids from `frontend-v2/src/lib/nav.ts`.
- [ ] Add dashboard layout persistence keyed by `view_type`: `inventory`, `customer`, `vendor`, `salesperson`, `brand`, `class`.
- [ ] Add tests for tenant isolation, invalid menu ids, image URL validation, and dashboard layout persistence.
- [ ] Verify with `npm run test --workspace=backend -- user-preferences product-media` and `npm run test --workspace=noderoute-frontend-v2 -- nav DashboardPage`.
- [ ] Commit: `feat: add customizable shell and product media foundation`.

## Phase 2: Google Maps, Drive Times, Route Visualization

**Files:**
- Create: `backend/routes/maps.js`
- Create: `backend/services/google-maps.js`
- Modify: `backend/routes/customers.js`
- Modify: `backend/routes/routes.js`
- Modify: `backend/routes/stops.js`
- Modify: `frontend-v2/src/pages/MapPage.tsx`
- Modify: `frontend-v2/src/pages/RoutesPage.tsx`
- Modify: `frontend-v2/src/hooks/useMap.ts`
- Test: `backend/tests/maps-route.test.js`
- Test: `backend/tests/route-geo-optimization.test.js`
- Test: `frontend-v2/src/pages/MapPage.test.tsx`

**Deliverable:** Customer records can geocode addresses, show warehouse-to-customer drive times, and visualize routes on Google Maps.

- [ ] Add `warehouse_geocodes`, `customer_geocodes`, and `route_drive_time_cache` tables with company/location scope.
- [ ] Add a server-side Google Maps client for geocoding, distance matrix, and directions; never expose unrestricted server keys to the browser.
- [ ] Add `POST /api/maps/geocode-customer/:customerId`, `GET /api/maps/drive-time`, and `GET /api/maps/route/:routeId`.
- [ ] Store cache rows by origin, destination, travel mode, and day bucket to control Maps API cost.
- [ ] Add customer profile UI location panel and Map page route overlay.
- [ ] Add empty/error states for missing warehouse address, invalid customer address, and quota errors.
- [ ] Verify mocked backend tests plus one manual smoke using a restricted test key.
- [ ] Commit: `feat: add google maps route and drive time workflows`.

## Phase 3: Inventory Control Expansion

**Files:**
- Create: `supabase/migrations/<generated>_advanced_inventory_control.sql`
- Create: `backend/routes/cycle-counts.js`
- Create: `backend/routes/kits.js`
- Create: `backend/routes/inventory-projections.js`
- Create: `backend/services/inventory-costs.js`
- Create: `backend/services/inventory-projections.js`
- Modify: `backend/routes/inventory.js`
- Modify: `backend/routes/ops/purchasing-order-routes.js`
- Modify: `backend/services/inventory-ledger.js`
- Modify: `frontend-v2/src/pages/InventoryPage.tsx`
- Modify: `frontend-v2/src/pages/WarehousePage.tsx`
- Create: `frontend-v2/src/pages/KitsPage.tsx`
- Test: `backend/tests/cycle-counts.test.js`
- Test: `backend/tests/kits-processing.test.js`
- Test: `backend/tests/inventory-projections.test.js`
- Test: `backend/tests/inventory-ledger-workflows.test.js`

**Deliverable:** NodeRoute supports case breaking, catch weight refinements, lot cost, kit/in-house processing, cycle counts, returns, shortage adjustments, 30-day availability, warehouse locations, and five cost fields.

- [ ] Extend products/lots with normalized cost fields: `real_cost`, `landed_cost`, `base_cost`, `lot_cost`, `market_cost`.
- [ ] Add `inventory_uom_conversions` for case/each/lb conversion and case breaking.
- [ ] Add `cycle_counts`, `cycle_count_items`, `kit_recipes`, `kit_recipe_items`, `kit_processing_runs`, `inventory_shortages`, and `inventory_returns`.
- [ ] Update `applyInventoryLedgerEntry` to accept `cost_basis`, `uom`, `conversion_factor`, and `ledger_ref`.
- [ ] Add kit processing service that consumes ingredients and creates finished goods in a single verified transaction or compensating ledger group.
- [ ] Add 30-day projection service using on-hand, open POs, allocations from open orders, and scheduled receipts.
- [ ] Add UI tabs: `Costs`, `Cycle Counts`, `Kits`, `Availability`, `Returns`.
- [ ] Verify no negative stock bypasses, lot-required items enforce lot capture, and projections match fixture data.
- [ ] Commit: `feat: expand inventory control workflows`.

## Phase 4: Pricing, Promotions, Rebates, Quotes, Minimum Sell

**Files:**
- Create: `supabase/migrations/<generated>_pricing_promotions_quotes.sql`
- Create: `backend/routes/pricing.js`
- Create: `backend/routes/promotions.js`
- Create: `backend/services/pricing-engine.js`
- Create: `backend/services/cost-price-scheduler.js`
- Modify: `backend/routes/orders.js`
- Modify: `backend/routes/invoices.js`
- Modify: `frontend-v2/src/pages/PricingPage.tsx`
- Modify: `frontend-v2/src/pages/OrderFormCard.tsx`
- Test: `backend/tests/pricing-engine.test.js`
- Test: `backend/tests/promotions.test.js`
- Test: `backend/tests/orders-pricing-enforcement.test.js`

**Deliverable:** Pricing can be driven by cost changes, customer-specific rules, quote/bid pricing, scheduled updates, promotions, rebates, bill-backs, and minimum sell enforcement.

- [ ] Add tables: `price_levels`, `customer_special_prices`, `quotes`, `quote_items`, `pricing_update_batches`, `promotions`, `promotion_items`, `rebates`, `bill_backs`, `minimum_sell_rules`.
- [ ] Implement pricing methods: fixed dollar float, percent of cost, percent of sell price, special customer override, bid quote override.
- [ ] Add minimum sell enforcement in order and invoice line calculation.
- [ ] Log every automated cost/price update with before/after values and triggering cost field.
- [ ] Add scheduler job for pending price updates using existing `backend/lib/scheduler.js`.
- [ ] Add pricing UI under a new `Pricing` nav item in the Financials or Inventory group.
- [ ] Verify price precedence with table-driven tests.
- [ ] Commit: `feat: add pricing engine and promotions`.

## Phase 5: Order Entry And Invoicing Workflows

**Files:**
- Create: `supabase/migrations/<generated>_order_entry_workflows.sql`
- Create: `backend/routes/order-guides.js`
- Create: `backend/routes/customer-messages.js`
- Create: `backend/services/order-entry-engine.js`
- Modify: `backend/routes/orders.js`
- Modify: `backend/routes/invoices.js`
- Modify: `backend/routes/phone-orders.js`
- Modify: `backend/routes/print.js`
- Modify: `frontend-v2/src/pages/OrderFormCard.tsx`
- Modify: `frontend-v2/src/pages/InvoicesPage.tsx`
- Modify: `frontend-v2/src/pages/PhoneOrdersPage.tsx`
- Test: `backend/tests/order-guides.test.js`
- Test: `backend/tests/order-entry-engine.test.js`
- Test: `backend/tests/invoice-documents.test.js`

**Deliverable:** Order entry supports standard orders, department order guides, call lists, backorders, returns, credit memos, bottle deposits, fuel surcharge, substitutions, hot messages, catch weight, barcode entry, add-ons, document email/fax hooks, cutting instructions, and warehouse document generation.

- [ ] Add tables: `order_guides`, `order_guide_items`, `customer_substitutions`, `customer_hot_messages`, `customer_item_instructions`, `invoice_addons`, `customer_returns`, `credit_memos`, `bottle_deposits`, `fuel_surcharge_rules`, `barcode_scan_events`.
- [ ] Extend order entry engine to apply guides, substitutions, customer messages, deposit items, fuel surcharge rules, and minimum sell rules from Phase 4.
- [ ] Add barcode scan endpoint that resolves product and appends to draft order/invoice.
- [ ] Add add-on flow for existing invoices with audit history.
- [ ] Add PDF/print variants: loading sheet, cut list, pick list, pull sheet, picking labels.
- [ ] Keep fax as an integration abstraction; implement email first through existing document email services.
- [ ] Verify fixture orders cover substitutions, deposits, fuel surcharge, catch weight, and backorder fulfillment.
- [ ] Commit: `feat: add advanced order entry workflows`.

## Phase 6: Accounts Receivable And Payments

**Files:**
- Create: `supabase/migrations/<generated>_accounts_receivable.sql`
- Create: `backend/routes/ar.js`
- Create: `backend/services/ar-ledger.js`
- Create: `backend/services/finance-charges.js`
- Modify: `backend/routes/credit-hold.js`
- Modify: `backend/routes/portal/payments-shared.js`
- Modify: `backend/routes/stripe-webhooks.js`
- Modify: `frontend-v2/src/pages/FinancialsPage.tsx`
- Modify: `frontend-v2/src/pages/CreditHoldPage.tsx`
- Test: `backend/tests/ar-ledger.test.js`
- Test: `backend/tests/cash-receipts.test.js`
- Test: `backend/tests/finance-charges.test.js`

**Deliverable:** AR supports full account inquiry, mixed cash receipts, automatic/manual credit holds, card processing, finance charges, aging, tax tracking, and receipt journals.

- [ ] Add tables: `ar_ledger_entries`, `cash_receipts`, `cash_receipt_applications`, `finance_charge_runs`, `sales_tax_jurisdictions`, `sales_tax_entries`, `customer_credit_events`.
- [ ] Build account inquiry endpoint returning open invoices, credits, unapplied cash, aging buckets, credit status, payment methods, and recent activity.
- [ ] Support mixed receipt application: cash, check, card, credit memo, unapplied credit.
- [ ] Reuse Stripe payment method and webhook hardening already present; keep service role out of clients.
- [ ] Add finance charge calculation job with preview and commit modes.
- [ ] Add AR aging and cash receipts journal report endpoints.
- [ ] Verify payment application idempotency and credit hold thresholds.
- [ ] Commit: `feat: add ar ledger and cash receipts`.

## Phase 7: Purchasing, AP, Vendor Minimums, Bank/Cash Reports

**Files:**
- Create: `supabase/migrations/<generated>_purchasing_ap_reports.sql`
- Create: `backend/routes/ap.js`
- Create: `backend/services/ap-ledger.js`
- Modify: `backend/routes/ops/purchasing-planning-routes.js`
- Modify: `backend/routes/ops/purchasing-order-routes.js`
- Modify: `backend/routes/vendor-bills.js`
- Modify: `backend/routes/vendors.js`
- Modify: `frontend-v2/src/pages/PurchasingPage.tsx`
- Modify: `frontend-v2/src/pages/VendorsPage.tsx`
- Test: `backend/tests/purchasing-reorder-advanced.test.js`
- Test: `backend/tests/ap-ledger.test.js`
- Test: `backend/tests/vendor-minimums.test.js`

**Deliverable:** Purchasing suggestions account for sales history, order points, lead times, pallet configs, vendor minimums, seasonal usage, and minimum stock; AP supports aging, journal, approve-to-pay, bank reconciliation, and cash requirements.

- [ ] Add vendor config fields: minimum order value, pallet/layer config, lead-time overrides, seasonal usage windows.
- [ ] Extend reorder engine with vendor minimums, pallet rounding, seasonal coefficients, and minimum stock.
- [ ] Add PO reports for status, in-transit, receiving, and value verification.
- [ ] Add AP tables: `ap_ledger_entries`, `ap_payment_batches`, `bank_accounts`, `bank_reconciliation_sessions`, `cash_requirements_snapshots`.
- [ ] Add approve-to-pay workflow from vendor bills.
- [ ] Add Purchasing and Vendor UI sections for vendor terms, AP status, and cash requirements.
- [ ] Verify reorder suggestions and AP aging with deterministic fixtures.
- [ ] Commit: `feat: expand purchasing and ap workflows`.

## Phase 8: Reporting Scheduler, Exports, Alerts, Analytics

**Files:**
- Create: `supabase/migrations/<generated>_report_scheduler_alerts.sql`
- Create: `backend/routes/report-schedules.js`
- Create: `backend/services/report-exporter.js`
- Create: `backend/services/report-alerts.js`
- Modify: `backend/routes/reporting.js`
- Modify: `backend/lib/scheduler.js`
- Modify: `frontend-v2/src/pages/ReportsPage.tsx`
- Modify: `frontend-v2/src/pages/AnalyticsPage.tsx`
- Test: `backend/tests/report-schedules.test.js`
- Test: `backend/tests/report-exporter.test.js`
- Test: `backend/tests/report-alerts.test.js`
- Test: `frontend-v2/src/pages/ReportsPage.test.tsx`

**Deliverable:** Users can schedule daily/weekly/monthly reports, export PDF/Excel/RTF/CSV/text, receive low-stock and credit-limit alerts, and run sales/customer analytics packs.

- [ ] Add tables: `report_definitions`, `report_schedules`, `report_runs`, `report_delivery_targets`, `inventory_alert_rules`, `credit_alert_rules`.
- [ ] Refactor existing reporting rollups into named report definitions.
- [ ] Implement export adapters for CSV/text first, PDF through existing PDF service, and Excel/RTF through server libraries selected during implementation.
- [ ] Add scheduled report runner with idempotent run keys.
- [ ] Add alerts for low stock, out of stock, and customer over credit limit.
- [ ] Add analytics report packs: chain store, commodity, gross profit, invoice register, tonnage, comparative sales, price exceptions, weekly projections.
- [ ] Verify scheduler idempotency, export content type, and email delivery behavior with mocked mailer.
- [ ] Commit: `feat: add report scheduling exports and alerts`.

## Phase 9: Final Integration And Release

**Files:**
- Modify: `README.md`
- Modify: `docs/erp-feature-matrix.md`
- Create: `docs/release-notes/enterprise-erp-features.md`

**Deliverable:** The full feature set has documented coverage, regression tests, migration verification, and a release checklist.

- [ ] Run backend focused tests touched by all phases.
- [ ] Run `npm run test --workspace=noderoute-frontend-v2`.
- [ ] Run Playwright smoke tests for navigation, orders, inventory, purchasing, reports, routes/maps.
- [ ] Run Supabase migration list and advisors where available.
- [ ] Re-check RLS and service-role usage across new routes.
- [ ] Update `docs/erp-feature-matrix.md` with completed coverage and known deferred integrations.
- [ ] Add release notes with required env vars, Google Maps setup, report scheduler setup, and migration notes.
- [ ] Commit: `docs: document enterprise erp rollout`.

## Coverage Map

- Ribbon/customizable menus: Phase 1
- Google Maps locations, directions, drive times, route visualization: Phase 2
- Product image library and internet image URLs: Phase 1
- SQL client/server crash-safe integrity: covered by Supabase/Postgres foundation and strengthened in all migration phases
- Search screens with image display: Phase 1
- Custom dashboards: Phase 1 and Phase 8
- Catch weight, case breaking, lots, kits, shortages, returns, cycle counts, projections, warehouse locations, cost fields: Phase 3
- Promotions, rebates, bill-backs: Phase 4
- Customer price updates, price levels, special pricing, quotes, scheduling/logging, minimum sell: Phase 4
- Standard orders, order guides, call list, sales orders, backorders, credit memos, returns, deposits, fuel surcharge, substitutions, hot messages, invoice catch weight, barcode entry, add-ons, documents, cutting instructions, warehouse sheets/labels: Phase 5
- AR inquiry, cash receipts, credit holds, credit cards, finance charges, aging, sales tax, journals: Phase 6
- Reorder suggestions, PO reports, vendors, AP aging/journal/approve-to-pay/bank/cash reports: Phase 7
- Truck routing, route tickets, pull sheets, map route visualization: Phase 2 and Phase 5
- Report scheduler, exports, email alerts, sales/customer analytics: Phase 8

## Execution Notes

- Start with Phase 0 and Phase 1. They give the rest of the work a visible navigation, dashboard, search, and feature-matrix spine.
- Do not start Maps until Google Maps API key restrictions and billing budget are defined.
- Do not start AR/AP ledger changes until the existing Stripe/payment worktree changes are either committed or deliberately included in that branch.
- Treat each phase as a separate branch/PR because schema, backend, and frontend files overlap heavily.
