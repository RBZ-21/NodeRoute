# NodeRoute Enterprise ERP — Implementation Prompts

Each prompt below is self-contained and ready to paste into a Claude Code / subagent session. Execute them in order; each phase should be committed before the next begins.

---

## PROMPT 0 — Supabase & Baseline Readiness

```
You are implementing Phase 0 of the NodeRoute Enterprise ERP plan.
Working directory: /Users/ryan/NodeRoute Systems/NodeRoute

GOAL: Establish a feature matrix, verify Supabase health, and add regression tests that enforce RLS and tenant scope on every new exposed table.

CONSTRAINTS:
- Do not modify files outside the NodeRoute directory.
- Do not alter existing migrations; only create new ones.
- All new tables in exposed schemas must have RLS enabled and tenant-scoped policies (company_id / location_id), never role-only policies.
- Do not use user_metadata or client-supplied role fields for authorization.
- Follow existing backend patterns: authenticateToken, requireRole, Zod, scopeQueryByContext, filterRowsByContext, insertRecordWithOptionalScope.

STEPS:
1. Run `curl -L https://supabase.com/changelog.md` and scan the output for breaking changes affecting RLS, auth, storage, cron, and Data API exposure. Note any relevant items in docs/erp-feature-matrix.md.
2. Run `supabase --version` to confirm CLI is available, then run `supabase migration new erp_feature_foundation` from the project root to create the migration file.
3. Run `rg -n "create table|alter table" supabase/migrations backend/migrations` to inventory existing schema. Use the output to populate docs/erp-feature-matrix.md.
4. Create docs/erp-feature-matrix.md with columns: Area | Feature | Existing coverage | Gap | Implementation phase | Primary files | Test file. Cover all areas from the plan: shell/nav, maps, inventory, pricing, order entry, AR, purchasing, reporting.
5. In the new migration file (supabase/migrations/*_erp_feature_foundation.sql) add any shared enum types or extensions needed across phases (e.g. ltree, pg_trgm if not already enabled). Do not add tables in this migration — those belong to per-phase migrations.
6. In backend/tests/multi-tenant-penetration.test.js, add regression tests that query the Supabase information_schema to assert every table in the public schema that is NOT in an explicit allowlist has RLS enabled. Fail the test if a new table is detected without RLS.
7. In backend/tests/security-hardening.test.js, add tests asserting that new RLS policies reference company_id or location_id columns, not user role metadata.
8. Run `npm run test --workspace=backend -- --test-name-pattern=multi-tenant` and fix failures.
9. Commit: `docs: map enterprise erp feature implementation`

FILES TO CREATE:
- supabase/migrations/<timestamp>_erp_feature_foundation.sql
- docs/erp-feature-matrix.md

FILES TO MODIFY:
- backend/tests/multi-tenant-penetration.test.js
- backend/tests/security-hardening.test.js
```

---

## PROMPT 1 — Core Shell, Custom Menus, Search, Images, Dashboards

```
You are implementing Phase 1 of the NodeRoute Enterprise ERP plan.
Working directory: /Users/ryan/NodeRoute Systems/NodeRoute
Prerequisite: Phase 0 is committed.

GOAL: Let users customize their sidebar nav order, display product/customer images in search results, let products attach curated or URL-based images, and persist dashboard layouts per role/user.

CONSTRAINTS:
- All new Supabase tables must have RLS with company_id/location_id tenant scope.
- Backend routes must use authenticateToken, requireRole, Zod validation, scopeQueryByContext, filterRowsByContext, insertRecordWithOptionalScope.
- Follow existing nav patterns in frontend-v2/src/lib/nav.ts and layout components.
- Image storage: store URLs only — no binary blobs in the database.
- Allowed image hosts must be validated server-side (configurable allowlist).
- Do not break existing Sidebar or CommandPalette behavior.

STEPS:
1. Create supabase/migrations/<timestamp>_user_navigation_dashboards_product_media.sql with:
   - user_menu_preferences (id, company_id, user_id, nav_item_ids jsonb, updated_at)
   - dashboard_layouts (id, company_id, location_id, user_id nullable, view_type text, layout jsonb, updated_at)
     - view_type values: 'inventory' | 'customer' | 'vendor' | 'salesperson' | 'brand' | 'class'
   - product_media (id, company_id, product_id, media_type text, url text, label text, sort_order int, created_at)
   - product_image_library (id, company_id, source text, url text, label text, tags text[], created_at)
   Enable RLS and add company_id-scoped policies on all four tables.

2. Create backend/routes/user-preferences.js:
   - GET  /api/user-preferences/navigation  → return user's menu order
   - PUT  /api/user-preferences/navigation  → save ordered nav_item_ids array (validate each id exists in nav.ts enum)
   Use authenticateToken, Zod validation.

3. Create backend/routes/product-media.js:
   - GET    /api/product-media?productId=  → list media for a product
   - POST   /api/product-media             → create (validate URL host against allowlist, max 10 per product)
   - PATCH  /api/product-media/:id         → update label/sort_order
   - DELETE /api/product-media/:id         → soft delete
   Include allowed-host config in backend/config or env: ALLOWED_IMAGE_HOSTS (comma-separated).

4. Modify backend/routes/search.js: after resolving products and customers, LEFT JOIN product_media and a customer avatar field; append image_url to each result object when present.

5. Register new routes in backend/server.js.

6. Modify frontend-v2/src/lib/nav.ts: export a stable NAV_ITEM_IDS const map so backend validation can use the same list (share via a types package or duplicate with a comment linking them).

7. Modify frontend-v2/src/components/layout/Sidebar.tsx: add a "Customize" toggle mode. When active, render nav items as draggable cards (use existing dnd or a simple reorder). On save, call PUT /api/user-preferences/navigation. On cancel, revert. Persist order from GET /api/user-preferences/navigation on mount.

8. Create frontend-v2/src/hooks/useUserPreferences.ts: encapsulate GET/PUT for navigation preferences.

9. Create frontend-v2/src/hooks/useProductMedia.ts: encapsulate CRUD for product media.

10. Create frontend-v2/src/pages/DashboardBuilderPage.tsx: allow selecting view_type, configuring widget visibility (use a simple checklist of widget keys), and saving layout. Load existing layout on mount via GET /api/dashboard-layouts (add this endpoint to user-preferences.js). Route: /dashboard/builder.

11. Add tests:
    - backend/tests/user-preferences.test.js: invalid nav ids rejected, tenant isolation (user from company A cannot read company B prefs), round-trip save/load.
    - backend/tests/product-media.test.js: disallowed host rejected, max-10 enforced, tenant isolation.
    - frontend-v2/src/lib/nav.test.ts: NAV_ITEM_IDS keys match Sidebar items.
    - frontend-v2/src/pages/DashboardPage.test.tsx: layout loads and persists.

12. Run `npm run test --workspace=backend -- user-preferences product-media` and `npm run test --workspace=noderoute-frontend-v2 -- nav DashboardPage`. Fix failures.

13. Commit: `feat: add customizable shell and product media foundation`

FILES TO CREATE:
- supabase/migrations/<timestamp>_user_navigation_dashboards_product_media.sql
- backend/routes/user-preferences.js
- backend/routes/product-media.js
- frontend-v2/src/pages/DashboardBuilderPage.tsx
- frontend-v2/src/hooks/useUserPreferences.ts
- frontend-v2/src/hooks/useProductMedia.ts
- backend/tests/user-preferences.test.js
- backend/tests/product-media.test.js
- frontend-v2/src/lib/nav.test.ts
- frontend-v2/src/pages/DashboardPage.test.tsx

FILES TO MODIFY:
- backend/server.js
- backend/routes/search.js
- frontend-v2/src/lib/nav.ts
- frontend-v2/src/components/layout/Sidebar.tsx
- frontend-v2/src/components/layout/CommandPalette.tsx (add image_url rendering to result rows)
```

---

## PROMPT 2 — Google Maps, Drive Times, Route Visualization

```
You are implementing Phase 2 of the NodeRoute Enterprise ERP plan.
Working directory: /Users/ryan/NodeRoute Systems/NodeRoute
Prerequisite: Phase 1 is committed. GOOGLE_MAPS_API_KEY is set in .env (server-side only).

GOAL: Geocode customer addresses, display warehouse-to-customer drive times, and visualize route stop sequences on Google Maps — all proxied through the backend so the restricted server key never reaches the browser.

CONSTRAINTS:
- GOOGLE_MAPS_API_KEY must only be used server-side. The browser receives a separate VITE_GOOGLE_MAPS_PUBLIC_KEY with HTTP referrer restrictions.
- All cache tables must have company_id/location_id scope and RLS.
- Respect Maps API rate limits: batch geocoding with exponential backoff, cache distance matrix results by (origin, destination, travel_mode, day_bucket).
- Provide clear empty/error states: missing warehouse address, invalid customer address, quota exceeded.
- Do not start this phase without confirming API key restrictions and billing budget with the user.

STEPS:
1. Create supabase/migrations/<timestamp>_maps_geocache.sql with:
   - warehouse_geocodes (id, company_id, location_id, address_hash text, lat numeric, lng numeric, geocoded_at timestamptz)
   - customer_geocodes (id, company_id, customer_id, address_hash text, lat numeric, lng numeric, geocoded_at timestamptz)
   - route_drive_time_cache (id, company_id, origin_hash text, destination_hash text, travel_mode text, day_bucket date, duration_seconds int, distance_meters int, cached_at timestamptz)
   Enable RLS on all three with company_id policies.

2. Create backend/services/google-maps.js:
   - geocodeAddress(address): calls Maps Geocoding API, returns {lat, lng, formatted_address}
   - getDistanceMatrix(origins[], destinations[], mode): calls Distance Matrix API, returns matrix rows
   - getDirections(routeId, waypointLatLngs[]): calls Directions API, returns encoded polyline and leg durations
   - All methods check cache first; write misses to cache; implement exponential backoff on 429.

3. Create backend/routes/maps.js and register in backend/server.js:
   - POST /api/maps/geocode-customer/:customerId  → geocode customer address, store in customer_geocodes, return {lat, lng}
   - GET  /api/maps/drive-time?from=warehouseLocationId&to=customerId&mode=driving  → check cache, call service if miss, return {duration_seconds, distance_meters}
   - GET  /api/maps/route/:routeId  → return ordered stop coordinates, encoded polyline, per-stop drive times

4. Modify backend/routes/customers.js: add GET /api/customers/:id/location — returns geocode data and triggers geocoding if missing.

5. Modify backend/routes/routes.js and backend/routes/stops.js: when stops are reordered, invalidate the route_drive_time_cache rows for that route.

6. Modify frontend-v2/src/hooks/useMap.ts: add hooks — useCustomerGeocode(customerId), useDriveTime(from, to), useRoutePolyline(routeId). Handle loading/error states.

7. Modify frontend-v2/src/pages/MapPage.tsx:
   - Display route stops as markers in sequence order with drive time labels.
   - Render encoded polyline as a route overlay.
   - Show error banner for missing warehouse address or quota errors.

8. Modify frontend-v2/src/pages/RoutesPage.tsx: add a "Drive Times" column to the route list, fetching from the cache endpoint.

9. Add tests:
   - backend/tests/maps-route.test.js: mock the Google Maps service; test geocode caching, cache hit skips API call, tenant isolation.
   - backend/tests/route-geo-optimization.test.js: test drive-time calculation with fixture waypoints, verify stop order preserved.
   - frontend-v2/src/pages/MapPage.test.tsx: renders markers and polyline from mocked hook data; shows error state for quota exceeded.

10. Run tests. Fix failures.
11. Commit: `feat: add google maps route and drive time workflows`

FILES TO CREATE:
- supabase/migrations/<timestamp>_maps_geocache.sql
- backend/routes/maps.js
- backend/services/google-maps.js
- backend/tests/maps-route.test.js
- backend/tests/route-geo-optimization.test.js
- frontend-v2/src/pages/MapPage.test.tsx

FILES TO MODIFY:
- backend/server.js
- backend/routes/customers.js
- backend/routes/routes.js
- backend/routes/stops.js
- frontend-v2/src/pages/MapPage.tsx
- frontend-v2/src/pages/RoutesPage.tsx
- frontend-v2/src/hooks/useMap.ts
```

---

## PROMPT 3 — Inventory Control Expansion

```
You are implementing Phase 3 of the NodeRoute Enterprise ERP plan.
Working directory: /Users/ryan/NodeRoute Systems/NodeRoute
Prerequisite: Phase 1 is committed (Phase 2 can be in parallel).

GOAL: Add case breaking, catch-weight refinements, five cost fields per lot, kit/in-house processing, cycle counts, shortage adjustments, inventory returns, 30-day availability projections, and warehouse location support.

CONSTRAINTS:
- All schema changes go through Supabase migrations with RLS.
- Kit processing must be a single verified transaction or use a compensating ledger group — no partial kits.
- Negative stock must never bypass lot-required checks.
- applyInventoryLedgerEntry signature can be extended but must remain backward-compatible (new params optional).
- Cost fields are numeric(12,4); never store strings.

STEPS:
1. Create supabase/migrations/<timestamp>_advanced_inventory_control.sql:
   Add to products/lots:
   - real_cost, landed_cost, base_cost, lot_cost, market_cost (numeric(12,4), nullable)
   New tables:
   - inventory_uom_conversions (id, company_id, product_id, from_uom text, to_uom text, factor numeric(12,6))
   - cycle_counts (id, company_id, location_id, status text, started_by uuid, started_at, completed_at)
   - cycle_count_items (id, cycle_count_id, product_id, lot_id, warehouse_location_id, expected_qty, counted_qty, variance_qty, notes)
   - kit_recipes (id, company_id, name text, output_product_id, output_qty numeric, output_uom text, is_active bool)
   - kit_recipe_items (id, kit_recipe_id, input_product_id, input_lot_id nullable, input_qty numeric, input_uom text)
   - kit_processing_runs (id, company_id, kit_recipe_id, run_date date, quantity_produced numeric, status text, ledger_group_id uuid, created_by uuid, created_at)
   - inventory_shortages (id, company_id, product_id, lot_id, shortage_qty numeric, reason text, adjusted_by uuid, adjusted_at)
   - inventory_returns (id, company_id, order_id nullable, product_id, lot_id, return_qty numeric, return_uom text, condition text, restocked bool, restocked_at, created_by uuid, created_at)
   Enable RLS on all with company_id/location_id scope.

2. Modify backend/services/inventory-ledger.js:
   - Extend applyInventoryLedgerEntry to accept optional: { cost_basis, uom, conversion_factor, ledger_ref }
   - All existing callers continue to work (new params default to null).

3. Create backend/services/inventory-costs.js:
   - computeWeightedAverageCost(productId, locationId): queries lot_cost across open lots and returns weighted average.
   - updateLotCosts(lotId, costFields): updates the five cost fields atomically.

4. Create backend/routes/kits.js:
   - GET    /api/kits/recipes          → list kit recipes for company
   - POST   /api/kits/recipes          → create recipe (validate output product exists, inputs have uom conversions)
   - POST   /api/kits/process          → run kit: validate sufficient input stock, deduct inputs, credit output in one transaction. Return ledger_group_id.
   - GET    /api/kits/runs             → list processing runs
   Register in backend/server.js.

5. Create backend/routes/cycle-counts.js:
   - POST /api/cycle-counts            → start new count (snapshot expected_qty from current on-hand)
   - GET  /api/cycle-counts/:id        → get count with items
   - PATCH /api/cycle-counts/:id/items → submit counted_qty values
   - POST /api/cycle-counts/:id/commit → compute variances, post ledger adjustments, mark complete
   Register in backend/server.js.

6. Create backend/routes/inventory-projections.js:
   - GET /api/inventory/projections?productId=&days=30 → return daily projected on-hand using:
     current on-hand + scheduled PO receipts - open order allocations over the window.

7. Create backend/services/inventory-projections.js: implement the projection logic (query open POs, open order lines, lot on-hand) and return a [{date, projected_qty}] array.

8. Modify backend/routes/inventory.js:
   - Add shortage adjustment endpoint: POST /api/inventory/adjust-shortage
   - Add return endpoint: POST /api/inventory/return
   - Both must post ledger entries.

9. Modify frontend-v2/src/pages/InventoryPage.tsx: add tabs — Costs, Cycle Counts, Kits, Availability, Returns. Stub each tab's content (functional routing, placeholder panels are OK; full UI per tab is a follow-up).

10. Create frontend-v2/src/pages/KitsPage.tsx: list recipes, button to run a kit, show processing runs history.

11. Add tests:
    - backend/tests/cycle-counts.test.js: start → submit counts → commit → verify ledger entries match variances.
    - backend/tests/kits-processing.test.js: insufficient stock returns 422; successful run debits inputs and credits output atomically; verify no partial state on simulated mid-run failure.
    - backend/tests/inventory-projections.test.js: fixture with known POs and orders returns expected projection curve.
    - backend/tests/inventory-ledger-workflows.test.js: backward compat — existing callers without cost_basis still succeed.

12. Run tests. Fix failures.
13. Commit: `feat: expand inventory control workflows`

FILES TO CREATE:
- supabase/migrations/<timestamp>_advanced_inventory_control.sql
- backend/routes/cycle-counts.js
- backend/routes/kits.js
- backend/routes/inventory-projections.js
- backend/services/inventory-costs.js
- backend/services/inventory-projections.js
- frontend-v2/src/pages/KitsPage.tsx
- backend/tests/cycle-counts.test.js
- backend/tests/kits-processing.test.js
- backend/tests/inventory-projections.test.js
- backend/tests/inventory-ledger-workflows.test.js

FILES TO MODIFY:
- backend/server.js
- backend/routes/inventory.js
- backend/routes/ops/purchasing-order-routes.js (add receipt scheduling fields if missing)
- backend/services/inventory-ledger.js
- frontend-v2/src/pages/InventoryPage.tsx
- frontend-v2/src/pages/WarehousePage.tsx
```

---

## PROMPT 4 — Pricing, Promotions, Rebates, Quotes, Minimum Sell

```
You are implementing Phase 4 of the NodeRoute Enterprise ERP plan.
Working directory: /Users/ryan/NodeRoute Systems/NodeRoute
Prerequisite: Phase 3 is committed.

GOAL: Implement a pricing engine that supports cost-driven pricing, customer-specific overrides, quote/bid pricing, scheduled price updates, promotions, rebates, bill-backs, and minimum sell enforcement.

CONSTRAINTS:
- Pricing precedence must be deterministic and table-driven (test every combination).
- Every automated price/cost update must log before/after values and the triggering field.
- Minimum sell enforcement must apply in both order and invoice line calculation.
- Scheduler jobs use the existing backend/lib/scheduler.js pattern.

PRICING METHOD PRECEDENCE (highest to lowest):
1. Active bid/quote override for customer+product
2. Customer special price record
3. Active promotion price (lowest wins if multiple)
4. Price level matrix (customer's assigned price level)
5. Standard list price

STEPS:
1. Create supabase/migrations/<timestamp>_pricing_promotions_quotes.sql:
   - price_levels (id, company_id, name text, description text)
   - customer_price_level_assignments (id, company_id, customer_id, price_level_id, effective_date, expiry_date)
   - price_level_rules (id, company_id, price_level_id, product_id nullable, category_id nullable, method text, value numeric(12,4))
     - method: 'fixed_dollar' | 'percent_of_cost' | 'percent_of_list' | 'dollar_over_cost'
   - customer_special_prices (id, company_id, customer_id, product_id, special_price numeric(12,4), effective_date, expiry_date)
   - quotes (id, company_id, customer_id, status text, valid_from date, valid_until date, notes text, created_by uuid, created_at)
   - quote_items (id, quote_id, product_id, quoted_price numeric(12,4), min_qty numeric, uom text)
   - pricing_update_batches (id, company_id, scheduled_at timestamptz, applied_at timestamptz, status text, triggered_by text, created_by uuid)
   - pricing_update_batch_items (id, batch_id, product_id, cost_field text, old_value numeric, new_value numeric, new_sell_price numeric)
   - promotions (id, company_id, name text, promo_type text, status text, start_date date, end_date date)
     - promo_type: 'sale_price' | 'percent_off' | 'dollar_off' | 'buy_x_get_y'
   - promotion_items (id, promotion_id, product_id nullable, category_id nullable, value numeric(12,4))
   - rebates (id, company_id, vendor_id nullable, customer_id nullable, name text, rebate_type text, value numeric(12,4), period_start date, period_end date)
   - bill_backs (id, company_id, vendor_id, name text, amount numeric(12,4), effective_date date, settled_at timestamptz)
   - minimum_sell_rules (id, company_id, product_id nullable, category_id nullable, min_margin_pct numeric(5,2), min_price numeric(12,4))
   Enable RLS with company_id scope on all.

2. Create backend/services/pricing-engine.js:
   - resolvePrice(customerId, productId, qty, uom, context): applies precedence rules and returns {price, method, source_id}.
   - enforceMinimumSell(price, productId, companyId): checks minimum_sell_rules; returns {allowed: bool, min_price}.
   - logPriceUpdate(batchId, productId, costField, oldValue, newValue): inserts into pricing_update_batch_items.
   All functions must be pure and unit-testable with injected DB clients.

3. Create backend/routes/pricing.js:
   - GET /api/pricing/levels              → list price levels
   - POST /api/pricing/levels             → create
   - GET /api/pricing/special?customerId= → list customer specials
   - POST /api/pricing/special            → create/update
   - GET /api/pricing/resolve?customerId=&productId=&qty= → call pricing engine, return resolved price + method
   - GET /api/pricing/quotes              → list quotes
   - POST /api/pricing/quotes             → create quote
   - PATCH /api/pricing/quotes/:id        → update/activate/expire
   Register in backend/server.js.

4. Create backend/routes/promotions.js:
   - Full CRUD for promotions and promotion_items.
   - GET /api/promotions/active?date= → return currently active promotions.
   Register in backend/server.js.

5. Create backend/services/cost-price-scheduler.js:
   - Registers a job with backend/lib/scheduler.js named 'cost-price-updates'.
   - On trigger: query pricing_update_batches where status='pending' and scheduled_at <= now(); for each batch, apply new prices using pricing engine, mark applied_at, status='applied'.

6. Modify backend/routes/orders.js: before saving each line, call enforceMinimumSell; if violated and user does not have 'override_minimum_sell' permission, return 422 with {error: 'minimum_sell_violation', min_price}.

7. Modify backend/routes/invoices.js: same minimum sell enforcement on invoice line updates.

8. Modify frontend-v2/src/pages/PricingPage.tsx (create if missing): tabs for Price Levels, Customer Specials, Quotes, Promotions, Rebates, Minimum Sell Rules. Each tab lists records and has a create/edit form.

9. Modify frontend-v2/src/pages/OrderFormCard.tsx: after product is selected, display resolved price from GET /api/pricing/resolve; show warning badge if price is below minimum sell (but still allow if user has override permission).

10. Add tests:
    - backend/tests/pricing-engine.test.js: table-driven tests for all five precedence levels, expiry filtering, and minimum sell enforcement.
    - backend/tests/promotions.test.js: overlapping promotions → lowest price wins; expired promotions excluded.
    - backend/tests/orders-pricing-enforcement.test.js: minimum sell violation returns 422; user with override role succeeds.

11. Run tests. Fix failures.
12. Commit: `feat: add pricing engine and promotions`

FILES TO CREATE:
- supabase/migrations/<timestamp>_pricing_promotions_quotes.sql
- backend/routes/pricing.js
- backend/routes/promotions.js
- backend/services/pricing-engine.js
- backend/services/cost-price-scheduler.js
- backend/tests/pricing-engine.test.js
- backend/tests/promotions.test.js
- backend/tests/orders-pricing-enforcement.test.js

FILES TO MODIFY:
- backend/server.js
- backend/routes/orders.js
- backend/routes/invoices.js
- frontend-v2/src/pages/PricingPage.tsx
- frontend-v2/src/pages/OrderFormCard.tsx
```

---

## PROMPT 5 — Order Entry & Invoicing Workflows

```
You are implementing Phase 5 of the NodeRoute Enterprise ERP plan.
Working directory: /Users/ryan/NodeRoute Systems/NodeRoute
Prerequisite: Phase 4 is committed.

GOAL: Extend order entry to support order guides, call lists, backorders, returns, credit memos, bottle deposits, fuel surcharge, substitutions, hot messages, catch weight, barcode scan-to-add, add-ons to existing invoices, document variants (loading sheet, cut list, pick list, pull sheet, picking labels), and warehouse instruction generation.

CONSTRAINTS:
- Pricing engine from Phase 4 must be called on every line item resolution.
- Add-ons to existing invoices require audit history (who added what, when).
- Email comes first for document delivery; fax is an abstraction stub only.
- Barcode scan endpoint must be idempotent (scanning same barcode twice on same draft does not duplicate).
- All new tables: RLS + company_id/location_id scope.

STEPS:
1. Create supabase/migrations/<timestamp>_order_entry_workflows.sql:
   - order_guides (id, company_id, customer_id, name text, is_active bool, created_at)
   - order_guide_items (id, order_guide_id, product_id, sort_order int, default_qty numeric, default_uom text)
   - customer_substitutions (id, company_id, customer_id, original_product_id, substitute_product_id, priority int, is_active bool)
   - customer_hot_messages (id, company_id, customer_id, message text, message_type text, start_date date, end_date date)
     - message_type: 'order_entry' | 'delivery' | 'invoice'
   - customer_item_instructions (id, company_id, customer_id, product_id, instruction text, instruction_type text)
     - instruction_type: 'cutting' | 'packaging' | 'warehouse' | 'general'
   - invoice_addons (id, company_id, invoice_id, product_id, qty numeric, uom text, price numeric(12,4), added_by uuid, added_at timestamptz, reason text)
   - customer_returns (id, company_id, order_id nullable, invoice_id nullable, customer_id, return_date date, status text, created_by uuid)
   - credit_memos (id, company_id, customer_id, original_invoice_id nullable, amount numeric(12,4), reason text, status text, created_at)
   - bottle_deposits (id, company_id, product_id, deposit_amount numeric(12,4), deposit_uom text, is_active bool)
   - fuel_surcharge_rules (id, company_id, name text, method text, value numeric(12,4), min_order_value numeric, effective_date date, expiry_date date)
     - method: 'flat' | 'percent_of_order'
   - barcode_scan_events (id, company_id, order_id, barcode text, resolved_product_id, scanned_by uuid, scanned_at timestamptz)
   Enable RLS on all.

2. Create backend/routes/order-guides.js:
   - CRUD for order_guides and order_guide_items.
   - GET /api/order-guides?customerId= → return active guides with items pre-fetched.
   Register in backend/server.js.

3. Create backend/routes/customer-messages.js:
   - CRUD for customer_hot_messages and customer_item_instructions.
   - GET /api/customer-messages?customerId=&type= → return active messages for display in order entry.
   Register in backend/server.js.

4. Create backend/services/order-entry-engine.js:
   - resolveOrderLine(customerId, productId, qty, uom): applies order guide default, substitution fallback, pricing engine, bottle deposit auto-add, cutting/warehouse instructions, hot messages.
   - applyFuelSurcharge(orderId): calculates and appends surcharge line using fuel_surcharge_rules.
   - processBackorder(orderId): splits unshippable lines into a new backorder order.
   - validateMinimumSell (delegate to pricing engine).

5. Modify backend/routes/orders.js:
   - On order line add/update, call resolveOrderLine; include resolved instructions and messages in response.
   - Add POST /api/orders/:id/backorder → call processBackorder.
   - Add POST /api/orders/:id/scan → barcode scan, resolve product, append line or increment qty if already present (idempotency: check existing lines by product within same scan session).

6. Modify backend/routes/invoices.js:
   - Add POST /api/invoices/:id/addons → create invoice_addon, post to ledger.
   - Add POST /api/invoices/:id/return → create customer_return + credit_memo.

7. Modify backend/routes/phone-orders.js: integrate order-entry-engine.resolveOrderLine for line resolution.

8. Modify backend/routes/print.js: add document variants:
   - GET /api/print/loading-sheet/:routeId
   - GET /api/print/cut-list/:orderId
   - GET /api/print/pick-list/:orderId
   - GET /api/print/pull-sheet/:routeId
   - GET /api/print/picking-labels/:orderId  (label format: product, lot, qty, location)
   All use existing pdfkit service pattern.

9. Modify frontend-v2/src/pages/OrderFormCard.tsx:
   - Show hot messages as banners when customer is selected.
   - Load applicable order guide and pre-populate lines.
   - Add barcode scan input field (press Enter to scan).
   - Show substitution suggestion when product is out of stock.
   - Display cutting/warehouse instruction badges on lines.

10. Modify frontend-v2/src/pages/InvoicesPage.tsx: add "Add-On" button on open invoices; add "Return / Credit" button.

11. Modify frontend-v2/src/pages/PhoneOrdersPage.tsx: integrate order guide selector and hot message display.

12. Add tests:
    - backend/tests/order-guides.test.js: guide items load in sort order, inactive guides excluded.
    - backend/tests/order-entry-engine.test.js: fixture covering substitution, deposit auto-add, fuel surcharge, catch weight line, backorder split, barcode idempotency.
    - backend/tests/invoice-documents.test.js: each print variant returns content-type application/pdf with expected section headers (parse pdfkit buffer).

13. Run tests. Fix failures.
14. Commit: `feat: add advanced order entry workflows`

FILES TO CREATE:
- supabase/migrations/<timestamp>_order_entry_workflows.sql
- backend/routes/order-guides.js
- backend/routes/customer-messages.js
- backend/services/order-entry-engine.js
- backend/tests/order-guides.test.js
- backend/tests/order-entry-engine.test.js
- backend/tests/invoice-documents.test.js

FILES TO MODIFY:
- backend/server.js
- backend/routes/orders.js
- backend/routes/invoices.js
- backend/routes/phone-orders.js
- backend/routes/print.js
- frontend-v2/src/pages/OrderFormCard.tsx
- frontend-v2/src/pages/InvoicesPage.tsx
- frontend-v2/src/pages/PhoneOrdersPage.tsx
```

---

## PROMPT 6 — Accounts Receivable & Payments

```
You are implementing Phase 6 of the NodeRoute Enterprise ERP plan.
Working directory: /Users/ryan/NodeRoute Systems/NodeRoute
Prerequisite: Phase 5 is committed. Existing Stripe/payment worktree changes must be committed or deliberately included before starting this phase.

GOAL: Add a full AR ledger, mixed cash receipt application, automatic/manual credit holds, Stripe card processing hardening, finance charge calculation, aging reports, sales tax tracking, and receipt journals.

CONSTRAINTS:
- Service role key must never reach the browser; all Stripe calls remain server-side.
- Payment application must be idempotent (safe to retry on network failure).
- Credit hold thresholds: configurable per customer; auto-hold triggers on overdue balance > threshold.
- Finance charge job: preview mode returns calculation without writing; commit mode writes entries.
- All new tables: RLS + company_id/location_id scope.

STEPS:
1. Create supabase/migrations/<timestamp>_accounts_receivable.sql:
   - ar_ledger_entries (id, company_id, customer_id, entry_type text, reference_id uuid, reference_type text, amount numeric(12,4), balance_after numeric(12,4), entry_date date, created_at)
     - entry_type: 'invoice' | 'payment' | 'credit_memo' | 'finance_charge' | 'adjustment'
   - cash_receipts (id, company_id, customer_id, receipt_date date, total_amount numeric(12,4), payment_method text, check_number text, stripe_payment_intent_id text, status text, created_by uuid, created_at)
     - payment_method: 'cash' | 'check' | 'card' | 'credit_memo' | 'unapplied'
   - cash_receipt_applications (id, cash_receipt_id, invoice_id, applied_amount numeric(12,4), applied_at timestamptz)
   - finance_charge_runs (id, company_id, run_date date, mode text, status text, total_charges numeric(12,4), created_by uuid, created_at)
     - mode: 'preview' | 'committed'
   - finance_charge_entries (id, finance_charge_run_id, customer_id, invoice_id, days_overdue int, charge_amount numeric(12,4))
   - sales_tax_jurisdictions (id, company_id, name text, rate numeric(6,4), state_code text, county text, city text)
   - sales_tax_entries (id, company_id, invoice_id, jurisdiction_id, taxable_amount numeric(12,4), tax_amount numeric(12,4), entry_date date)
   - customer_credit_events (id, company_id, customer_id, event_type text, old_status text, new_status text, triggered_by text, note text, created_at)
     - event_type: 'auto_hold' | 'manual_hold' | 'manual_release' | 'threshold_change'
   Enable RLS on all with company_id scope.

2. Create backend/services/ar-ledger.js:
   - postInvoice(invoiceId): creates ar_ledger_entry of type 'invoice'.
   - applyReceipt(receiptId, applications[]): in a transaction, creates cash_receipt_applications and ar_ledger_entries; idempotent via receipt status check.
   - getAccountInquiry(customerId, companyId): returns { open_invoices, unapplied_cash, aging_buckets: [current, 30, 60, 90, 120+], credit_status, payment_methods, recent_activity }.
   - getAgingReport(companyId, asOfDate): returns aging rows grouped by customer.

3. Create backend/services/finance-charges.js:
   - calculateFinanceCharges(companyId, runDate, mode): queries overdue invoices, applies configured rate, returns entries. In 'commit' mode, writes finance_charge_run and entries and posts to AR ledger.

4. Create backend/routes/ar.js:
   - GET  /api/ar/account-inquiry/:customerId   → getAccountInquiry
   - POST /api/ar/cash-receipts                 → create receipt + apply (call ar-ledger.applyReceipt)
   - GET  /api/ar/cash-receipts/:id             → get receipt with applications
   - GET  /api/ar/aging-report                  → getAgingReport (query param: asOfDate)
   - GET  /api/ar/cash-receipts-journal?from=&to= → list receipts in date range
   - POST /api/ar/finance-charges/preview        → calculateFinanceCharges mode='preview'
   - POST /api/ar/finance-charges/commit         → calculateFinanceCharges mode='commit'
   Register in backend/server.js.

5. Modify backend/routes/credit-hold.js:
   - After each invoice post, check if customer balance > credit_limit; if so, auto-insert customer_credit_event type='auto_hold' and update customer status.
   - Add POST /api/credit-hold/:customerId/release with note; insert event type='manual_release'.

6. Modify backend/routes/portal/payments-shared.js and backend/routes/stripe-webhooks.js:
   - On successful Stripe payment_intent.succeeded, call ar-ledger.applyReceipt automatically.
   - Ensure webhook handler is idempotent (skip if receipt already applied).

7. Modify frontend-v2/src/pages/FinancialsPage.tsx:
   - Add tabs: Account Inquiry, Cash Receipts, Aging Report, Finance Charges, Tax, Journals.
   - Account Inquiry tab: customer selector, then displays aging buckets, open invoices, and recent activity.
   - Cash Receipts tab: form to enter receipt with invoice application table.

8. Modify frontend-v2/src/pages/CreditHoldPage.tsx: show credit event history timeline per customer; add Release button.

9. Add tests:
    - backend/tests/ar-ledger.test.js: invoice post updates balance; receipt application reduces open balance; double-apply is idempotent.
    - backend/tests/cash-receipts.test.js: mixed payment method, partial application, unapplied remainder.
    - backend/tests/finance-charges.test.js: preview returns expected amounts without DB writes; commit writes entries; re-running committed run is a no-op.

10. Run tests. Fix failures.
11. Commit: `feat: add ar ledger and cash receipts`

FILES TO CREATE:
- supabase/migrations/<timestamp>_accounts_receivable.sql
- backend/routes/ar.js
- backend/services/ar-ledger.js
- backend/services/finance-charges.js
- backend/tests/ar-ledger.test.js
- backend/tests/cash-receipts.test.js
- backend/tests/finance-charges.test.js

FILES TO MODIFY:
- backend/server.js
- backend/routes/credit-hold.js
- backend/routes/portal/payments-shared.js
- backend/routes/stripe-webhooks.js
- frontend-v2/src/pages/FinancialsPage.tsx
- frontend-v2/src/pages/CreditHoldPage.tsx
```

---

## PROMPT 7 — Purchasing, AP, Vendor Minimums, Bank/Cash Reports

```
You are implementing Phase 7 of the NodeRoute Enterprise ERP plan.
Working directory: /Users/ryan/NodeRoute Systems/NodeRoute
Prerequisite: Phase 6 is committed.

GOAL: Extend purchasing suggestions with vendor minimums, pallet rounding, lead times, and seasonal coefficients. Add an AP ledger with aging, approve-to-pay, bank reconciliation, and cash requirements.

CONSTRAINTS:
- All new tables: RLS + company_id/location_id scope.
- Reorder engine changes must be backward-compatible (existing callers still work without new vendor config fields).
- Approve-to-pay workflow requires an explicit role permission (e.g., 'approve_ap_payment').
- Bank reconciliation is additive — never delete reconciliation sessions; mark them as completed.

STEPS:
1. Create supabase/migrations/<timestamp>_purchasing_ap_reports.sql:
   Extend vendors table (via ALTER TABLE):
   - min_order_value numeric(12,4)
   - pallet_qty numeric
   - layer_qty numeric
   - lead_time_days int
   - seasonal_usage_windows jsonb  (array of {month_start, month_end, coefficient})
   New tables:
   - ap_ledger_entries (id, company_id, vendor_id, entry_type text, reference_id uuid, reference_type text, amount numeric(12,4), balance_after numeric(12,4), entry_date date, created_at)
     - entry_type: 'bill' | 'payment' | 'credit' | 'adjustment'
   - ap_payment_batches (id, company_id, status text, approved_by uuid, approved_at timestamptz, paid_at timestamptz, total_amount numeric(12,4), payment_method text, created_by uuid, created_at)
   - ap_payment_batch_items (id, ap_payment_batch_id, vendor_bill_id, amount numeric(12,4))
   - bank_accounts (id, company_id, name text, account_type text, account_number_last4 text, routing_number_last4 text, is_active bool)
   - bank_reconciliation_sessions (id, company_id, bank_account_id, statement_date date, statement_ending_balance numeric(12,4), status text, completed_at timestamptz, created_by uuid, created_at)
   - bank_reconciliation_items (id, session_id, entry_type text, reference_id uuid, amount numeric(12,4), cleared bool, cleared_at timestamptz)
   - cash_requirements_snapshots (id, company_id, snapshot_date date, horizon_days int, total_due numeric(12,4), details jsonb, created_at)
   Enable RLS with company_id scope on all.

2. Modify backend/routes/ops/purchasing-planning-routes.js (reorder engine):
   - After computing base suggestion qty, apply:
     a. Vendor minimum order enforcement: if total order value < min_order_value, add filler items or warn.
     b. Pallet rounding: round up each product qty to nearest pallet_qty (or layer_qty if pallet not set).
     c. Lead time: add lead_time_days to suggested order date.
     d. Seasonal coefficient: multiply by vendor seasonal_usage_windows coefficient for current month if defined.
   - All new logic is gated on whether vendor has those fields populated; default behavior unchanged if fields are null.

3. Create backend/services/ap-ledger.js:
   - postBill(vendorBillId): creates ap_ledger_entry type='bill'.
   - processPaymentBatch(batchId): in a transaction, marks bills paid, posts ap_ledger_entries type='payment', updates batch status.
   - getAPAging(companyId, asOfDate): returns aging rows grouped by vendor.
   - getCashRequirements(companyId, horizonDays): sums open payables by due date.

4. Create backend/routes/ap.js:
   - GET  /api/ap/aging                          → getAPAging
   - GET  /api/ap/cash-requirements?horizonDays= → getCashRequirements + snapshot
   - POST /api/ap/payment-batches                → create batch from approved bills
   - PATCH /api/ap/payment-batches/:id/approve   → requireRole('approve_ap_payment'); set approved_by/at
   - POST /api/ap/payment-batches/:id/pay        → processPaymentBatch
   - GET  /api/ap/journal?from=&to=              → list ap_ledger_entries in range
   - CRUD /api/ap/bank-accounts
   - POST /api/ap/bank-reconciliation            → start reconciliation session
   - PATCH /api/ap/bank-reconciliation/:id/items → mark items cleared
   - POST /api/ap/bank-reconciliation/:id/complete → finalize session
   Register in backend/server.js.

5. Modify backend/routes/vendor-bills.js: on bill approval, call ap-ledger.postBill.

6. Modify backend/routes/vendors.js: expose new vendor config fields in GET/PATCH endpoints. Add GET /api/vendors/:id/ap-status → current balance, aging summary, open bills.

7. Modify frontend-v2/src/pages/PurchasingPage.tsx:
   - Show vendor minimum warning in suggestion list when suggested order is below min_order_value.
   - Add "Approve to Pay" tab listing ap_payment_batches pending approval.
   - Add "Cash Requirements" panel.

8. Modify frontend-v2/src/pages/VendorsPage.tsx:
   - Add "Vendor Config" tab (lead time, pallet, minimums, seasonal windows).
   - Add "AP Status" tab (current balance, aging buckets, open bills).

9. Add tests:
    - backend/tests/purchasing-reorder-advanced.test.js: fixture with vendor minimums and pallet config → verify suggestions are rounded and meet minimums; seasonal coefficient multiplied correctly.
    - backend/tests/ap-ledger.test.js: bill post increases balance; payment batch reduces balance; AP aging buckets match fixture.
    - backend/tests/vendor-minimums.test.js: order below minimum triggers warning; pallet rounding rounds up to next pallet; combined test.

10. Run tests. Fix failures.
11. Commit: `feat: expand purchasing and ap workflows`

FILES TO CREATE:
- supabase/migrations/<timestamp>_purchasing_ap_reports.sql
- backend/routes/ap.js
- backend/services/ap-ledger.js
- backend/tests/purchasing-reorder-advanced.test.js
- backend/tests/ap-ledger.test.js
- backend/tests/vendor-minimums.test.js

FILES TO MODIFY:
- backend/server.js
- backend/routes/ops/purchasing-planning-routes.js
- backend/routes/ops/purchasing-order-routes.js
- backend/routes/vendor-bills.js
- backend/routes/vendors.js
- frontend-v2/src/pages/PurchasingPage.tsx
- frontend-v2/src/pages/VendorsPage.tsx
```

---

## PROMPT 8 — Reporting Scheduler, Exports, Alerts, Analytics

```
You are implementing Phase 8 of the NodeRoute Enterprise ERP plan.
Working directory: /Users/ryan/NodeRoute Systems/NodeRoute
Prerequisite: Phase 7 is committed.

GOAL: Add a named report definition system, a scheduler that sends reports on daily/weekly/monthly cadences, export adapters for CSV/text/PDF/Excel, low-stock and credit-limit alerts, and analytics report packs (chain store, commodity, gross profit, invoice register, tonnage, comparative sales, price exceptions, weekly projections).

CONSTRAINTS:
- Report scheduler must be idempotent: use run_key = (report_schedule_id + period_start) to prevent duplicate sends.
- Export adapters: CSV/text first, PDF through existing pdfkit service, Excel via a server-side library (choose exceljs or similar — document your choice in a comment in the service file).
- Alert jobs check every 15 minutes; send at most one alert per (rule, entity) per 24 hours.
- All new tables: RLS + company_id/location_id scope.
- Mocked mailer must be used in tests (do not send real emails in test environment).

STEPS:
1. Create supabase/migrations/<timestamp>_report_scheduler_alerts.sql:
   - report_definitions (id, company_id, name text, query_key text, parameters jsonb, is_system bool)
     - query_key maps to a function in report-exporter.js
   - report_schedules (id, company_id, report_definition_id, cadence text, cadence_config jsonb, delivery_targets jsonb, is_active bool, created_by uuid)
     - cadence: 'daily' | 'weekly' | 'monthly'
     - cadence_config: { time, day_of_week?, day_of_month? }
   - report_runs (id, company_id, report_schedule_id, run_key text UNIQUE, period_start date, status text, delivered_at timestamptz, error text, created_at)
   - report_delivery_targets (id, report_schedule_id, target_type text, address text)
     - target_type: 'email' | 'download'
   - inventory_alert_rules (id, company_id, product_id nullable, category_id nullable, rule_type text, threshold numeric, is_active bool)
     - rule_type: 'low_stock' | 'out_of_stock'
   - credit_alert_rules (id, company_id, customer_id nullable, rule_type text, threshold_pct numeric, is_active bool)
     - rule_type: 'approaching_limit' | 'over_limit'
   - alert_sends (id, company_id, rule_id uuid, entity_id uuid, alert_type text, sent_at timestamptz)
   Enable RLS with company_id scope on all.

2. Create backend/services/report-exporter.js:
   Implement named query functions (each returns rows[]):
   - chainStoreReport(companyId, params)
   - commodityReport(companyId, params)
   - grossProfitReport(companyId, params)
   - invoiceRegisterReport(companyId, params)
   - tonnageReport(companyId, params)
   - comparativeSalesReport(companyId, params)
   - priceExceptionsReport(companyId, params)
   - weeklyProjectionsReport(companyId, params)

   Implement export adapters:
   - toCSV(rows, columns): returns Buffer
   - toText(rows, columns, widths): returns Buffer (fixed-width)
   - toPDF(rows, columns, title): returns Buffer (via existing pdfkit service)
   - toExcel(rows, columns, title): returns Buffer (use exceljs; install if not present)

3. Create backend/services/report-alerts.js:
   - checkInventoryAlerts(companyId): query on-hand vs rules; for violations, check alert_sends for 24h cooldown; send email and insert alert_sends row.
   - checkCreditAlerts(companyId): query AR balances vs credit limits; same send + cooldown pattern.
   Both use the existing email service. In test env, mailer is mocked.

4. Create backend/routes/report-schedules.js:
   - CRUD /api/report-schedules
   - GET  /api/report-schedules/:id/runs    → list runs with status
   - POST /api/report-schedules/:id/run-now → trigger immediate run (bypass cadence check)
   Register in backend/server.js.

5. Modify backend/routes/reporting.js:
   - Refactor existing rollup queries into named report_definition records (seeded via migration).
   - Add GET /api/reports/run?queryKey=&format=&...params → call report-exporter function + adapter; return file with correct Content-Type.

6. Modify backend/lib/scheduler.js:
   - Register 'report-scheduler' job (runs every 5 minutes): query active schedules, determine which are due (next_run_at <= now()), generate run_key, skip if exists, execute and deliver.
   - Register 'alert-checker' job (runs every 15 minutes): call checkInventoryAlerts and checkCreditAlerts for each active company.

7. Modify frontend-v2/src/pages/ReportsPage.tsx:
   - List named report definitions grouped by category.
   - Each report has: "Run Now" (downloads in selected format), "Schedule" (opens schedule form).
   - Schedule form: cadence selector, time, email delivery targets.

8. Modify frontend-v2/src/pages/AnalyticsPage.tsx (create if missing):
   - Analytics packs: Gross Profit Trend, Comparative Sales, Price Exceptions, Weekly Projections — rendered as charts using existing chart components.

9. Add tests:
    - backend/tests/report-schedules.test.js: run_key uniqueness prevents duplicate runs; inactive schedule not triggered; run-now inserts run record.
    - backend/tests/report-exporter.test.js: CSV output has correct column headers and row count; PDF returns buffer with content-type check; Excel workbook has correct sheet name.
    - backend/tests/report-alerts.test.js: low-stock alert fires for matching rule; 24h cooldown prevents second alert; credit alert fires when balance > threshold.
    - frontend-v2/src/pages/ReportsPage.test.tsx: report list renders; schedule form submits correctly.

10. Run tests. Fix failures.
11. Commit: `feat: add report scheduling exports and alerts`

FILES TO CREATE:
- supabase/migrations/<timestamp>_report_scheduler_alerts.sql
- backend/routes/report-schedules.js
- backend/services/report-exporter.js
- backend/services/report-alerts.js
- backend/tests/report-schedules.test.js
- backend/tests/report-exporter.test.js
- backend/tests/report-alerts.test.js
- frontend-v2/src/pages/ReportsPage.test.tsx

FILES TO MODIFY:
- backend/server.js
- backend/routes/reporting.js
- backend/lib/scheduler.js
- frontend-v2/src/pages/ReportsPage.tsx
- frontend-v2/src/pages/AnalyticsPage.tsx
```

---

## PROMPT 9 — Final Integration & Release

```
You are implementing Phase 9 of the NodeRoute Enterprise ERP plan — the final integration and release verification pass.
Working directory: /Users/ryan/NodeRoute Systems/NodeRoute
Prerequisite: All phases 0–8 are committed.

GOAL: Run all tests, verify RLS coverage across every new table, update the feature matrix, and produce a release checklist with env var and migration documentation.

STEPS:
1. Run all backend focused tests:
   npm run test --workspace=backend
   Fix any failures introduced by phase interactions (e.g., pricing engine called from order entry, AR ledger called from invoice route).

2. Run all frontend tests:
   npm run test --workspace=noderoute-frontend-v2
   Fix failures.

3. Run Playwright smoke tests for critical workflows:
   - Navigation customization (Phase 1)
   - Product image display in search (Phase 1)
   - Dashboard layout persistence (Phase 1)
   - Order entry with pricing enforcement (Phases 4+5)
   - Invoice add-on and return (Phase 5)
   - Cash receipt application (Phase 6)
   - Purchasing suggestion with vendor minimum (Phase 7)
   - Report run and download (Phase 8)
   - Route map visualization (Phase 2, if Maps key is configured)
   For each: document pass/fail in docs/erp-feature-matrix.md.

4. Run Supabase migration list:
   supabase migration list
   Confirm all phase migrations appear in order. If not, investigate and document.

5. Run Supabase advisors if available:
   supabase inspect db unused-indexes
   supabase inspect db bloat
   Document findings in docs/erp-feature-matrix.md under a "DB Health" section.

6. Re-check RLS across all new routes:
   - For each new route file created in Phases 1–8, verify every SELECT/INSERT/UPDATE/DELETE calls scopeQueryByContext or filterRowsByContext or insertRecordWithOptionalScope.
   - Search: rg -n "supabase.from\|\.from(" backend/routes/ | grep -v "scope\|filter\|insert"
   - Manually review any hits that look like raw queries without tenant scope.
   - Fix any unscoped queries found.

7. Re-check service role exposure:
   rg -n "service_role\|SUPABASE_SERVICE" backend/routes/ frontend-v2/src/
   Service role references must only appear in backend/services/ and backend/lib/. Any hit in routes/ or frontend/ is a bug — fix it.

8. Update docs/erp-feature-matrix.md:
   - Mark each feature row as "Implemented", "Partial", or "Deferred".
   - Add a "Known Deferred Integrations" section for anything explicitly excluded (e.g., fax, RTF export, specific ERP connectors).

9. Create docs/release-notes/enterprise-erp-features.md with:
   - Required new env vars and where to set them:
     * GOOGLE_MAPS_API_KEY (server-side only)
     * VITE_GOOGLE_MAPS_PUBLIC_KEY (browser, HTTP referrer restricted)
     * ALLOWED_IMAGE_HOSTS (comma-separated, default list)
   - Google Maps setup checklist: enable Geocoding API, Distance Matrix API, Directions API; set billing budget alert.
   - Report scheduler setup: confirm scheduler.js is running as a background process; set report email from-address env var.
   - Migration notes: list each migration in order with a one-line description of what it adds.
   - Breaking changes: any API endpoints renamed or request/response shapes changed from the pre-ERP baseline.
   - Rollback notes: which phases are independently reversible (schema drop + route removal) vs. which have irreversible data changes (ledger entries).

10. Final commit: `docs: document enterprise erp rollout`

FILES TO MODIFY:
- docs/erp-feature-matrix.md
- README.md (add link to release notes and migration instructions)

FILES TO CREATE:
- docs/release-notes/enterprise-erp-features.md
```

---

## Quick Reference — Phase Sequence & Dependencies

| Phase | Name | Depends On |
|-------|------|------------|
| 0 | Baseline & RLS Readiness | — |
| 1 | Shell, Nav, Images, Dashboards | 0 |
| 2 | Google Maps & Route Viz | 1 (can parallel 3) |
| 3 | Inventory Control Expansion | 1 |
| 4 | Pricing & Promotions | 3 |
| 5 | Order Entry & Invoicing | 4 |
| 6 | Accounts Receivable | 5 (requires Stripe worktree committed) |
| 7 | Purchasing & AP | 6 |
| 8 | Reporting & Alerts | 7 |
| 9 | Integration & Release | 0–8 |

> **Before Phase 2:** Confirm Google Maps API key restrictions and billing budget.
> **Before Phase 6:** Ensure existing Stripe/payment worktree changes are committed.
