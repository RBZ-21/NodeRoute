# NodeRoute Systems — Inventory & Purchase Order Workflow QA Report
**Date:** 2026-05-10  
**Agent:** Automated QA Run (noderoute-po--inventory-agent)  
**Scope:** Database schema audit + data analysis (Supabase project: lmdnwtbtmhpbxhvzmkkg)  
**Note:** Application source code was not accessible (workspace folder empty). All testing is based on the live database schema, constraints, triggers, and row counts.

---

## TIER 1 — VENDOR LOOKUP & PO CREATION

| # | Test | Result | Notes |
|---|------|--------|-------|
| 1 | Search vendor by name — correct record loads with contact + catalog | **[NEEDS REVIEW]** | `vendors` table exists with name, contact, email, phone. However, it contains **0 rows** and has no FK linking vendors to a product catalog. Vendor-to-product relationship is not modeled. |
| 2 | New PO can be created from vendor record | **[FAIL]** | `purchase_orders.vendor_id` is `uuid` type, but `vendors.id` is `bigint`. Type mismatch — no FK constraint enforced between the two tables. PO-to-vendor relationship is broken at the DB level. |
| 3 | Line items added with product name, unit, qty/weight | **[NEEDS REVIEW]** | `purchase_orders.items` is a `JSONB` array — no relational line item table. Required fields (product name, unit, qty/weight) are not schema-enforced; any structure or omission is accepted silently. |
| 4 | Multiple line items can be added to a single PO | **[PASS]** | JSONB array on `purchase_orders.items` supports multiple entries. |
| 5 | PO saved with unique PO number and creation timestamp | **[NEEDS REVIEW]** | `created_at` has `DEFAULT now()` ✓. However, `po_number` is **nullable** with **no UNIQUE constraint** — duplicate or missing PO numbers are possible with no DB-level protection. |
| 6 | PO is printable/viewable in a PO list screen | **[NEEDS REVIEW]** | Cannot verify from schema alone; UI testing required. `purchase_orders` has 0 rows — no live data to confirm rendering. |

**Tier 1 Flag:** Vendor table has 0 rows (no vendors set up). `vendor_id` on POs is a broken type-mismatched reference. `po_number` has no uniqueness guarantee.

---

## TIER 2 — ORDER RECEIVING & PO COMPARISON

| # | Test | Result | Notes |
|---|------|--------|-------|
| 7 | Open PO retrievable from receiving screen | **[NEEDS REVIEW]** | `purchase_orders.status` field exists, but the **default value is `'confirmed'`** — there is no `'open'` or `'pending'` status defined. A receiving workflow that filters for "open" POs may return nothing or require non-standard status values. |
| 8 | Received quantities/weights entered line by line | **[FAIL]** | No dedicated receiving table exists. Received quantities would be tracked back in the same `items` JSONB blob, with no structured audit trail, timestamps, or user attribution per line item. |
| 9 | System auto-compares received vs. PO quantities in real time | **[FAIL]** | No DB trigger, stored procedure, or view found that computes received vs. ordered variance. Only 3 triggers exist (updated_at housekeeping only). |
| 10 | Discrepancy auto-flagged and logged (item, expected, received, variance) | **[FAIL]** | No `discrepancy_log` or equivalent table exists in the schema. |
| 11 | Discrepancy log viewable in admin dashboard | **[FAIL]** | Follows from #10 — no table to surface. |
| 12 | PO status auto-updates to "Received" when all line items entered | **[NEEDS REVIEW]** | No DB trigger to auto-update PO status. Application code would need to handle this explicitly. |

**Tier 2 Flag:** The entire receiving comparison layer (steps 8–11) is missing at the DB level. This is the most critical gap in the workflow.

---

## TIER 3 — INVOICE PHOTO SCAN & AUTO-DRAFT

| # | Test | Result | Notes |
|---|------|--------|-------|
| 13 | Camera/upload accessible from receiving screen | **[NEEDS REVIEW]** | UI-dependent; cannot verify from schema. No storage bucket reference or scan-image record table found for PO invoice images. |
| 14 | Vendor invoice can be captured/uploaded | **[NEEDS REVIEW]** | `purchase_orders.scanned_at` timestamp exists, suggesting scan intent was planned. However, no image URL, file path, or storage reference column exists — photo storage is not modeled. |
| 15 | System parses invoice → auto-generates draft against PO line items | **[FAIL]** | No OCR result table, no draft PO staging table, no parsing log. No infrastructure for invoice parsing exists in the schema. |
| 16 | Weighted items populate weight fields for review before saving | **[PASS]** | `seafood_inventory.is_catch_weight` boolean flag exists and supports distinguishing weighted items. |
| 17 | Count/unit items prompt approval → auto-add to inventory | **[FAIL]** | No approval queue or workflow table found. No mechanism to stage count-item receipts pending user confirmation. |
| 18 | Parsed data accuracy is reasonable | **[FAIL]** | Feature is not implemented at the schema level — cannot assess accuracy. |

**Tier 3 Flag:** Invoice scanning/parsing is a planned feature (`scanned_at` field present) but not yet implemented in the data layer.

---

## TIER 4 — MOLLUSK LOT NUMBER TRACKING

| # | Test | Result | Notes |
|---|------|--------|-------|
| 19 | Mollusk items trigger lot number entry field | **[NEEDS REVIEW]** | `seafood_inventory.lot_item` (text) flags lot-tracked items. No DB-level enforcement requiring lot entry for mollusk categories — relies entirely on application logic. |
| 20 | Lot number linked to vendor, PO number, product, received date, quantity | **[FAIL]** | Two lot tables exist (`inventory_lots` and `lot_codes`), creating redundancy confusion. **Neither table has a `purchase_order_id` or `po_number` field** — lot numbers are not traceable back to the originating PO. `inventory_lots.supplier_name` is a text field (not an FK to `vendors`). |
| 21 | Lot number visible on inventory record | **[NEEDS REVIEW]** | `seafood_inventory.lot_item` is a plain text field — not a FK to `inventory_lots` or `lot_codes`. No relational integrity between inventory items and their lots. |
| 22 | Lot number forwardable to customer (invoice or standalone notice) | **[PASS]** | `invoices.lot_numbers` (JSONB, with per-line-item structure) and `stops.shipped_lots` (JSONB) both support lot forwarding. Comment on `lot_numbers` confirms expected structure. |
| 23 | Lot number history searchable by product, vendor, date range | **[PASS]** | Both `inventory_lots` and `lot_codes` support queries by product/item, supplier/vendor, and received date. |

**Tier 4 Flag:** Two lot tables with overlapping purposes (`inventory_lots` vs `lot_codes`) creates ambiguity. No PO linkage on either. `lot_item` on inventory is not a relational FK.

---

## TIER 5 — LEAD TIME TRACKING & AI ESTIMATION

| # | Test | Result | Notes |
|---|------|--------|-------|
| 24 | PO creation timestamp recorded automatically | **[PASS]** | `purchase_orders.created_at` with `DEFAULT now()` ✓ |
| 25 | PO received/closed timestamp recorded automatically | **[FAIL]** | No `received_at`, `closed_at`, or `fulfilled_at` column on `purchase_orders`. Only `scanned_at` and `created_at` exist — no way to record when a PO was completed. |
| 26 | Time delta (creation → receipt) calculated and stored per vendor/product | **[FAIL]** | Cannot calculate without a received/closed timestamp (see #25). No computed lead time column or table found. |
| 27 | Lead time estimates surfaced after sufficient data points | **[FAIL]** | No `vendor_lead_times` table, no lead time view, no materialized average exists in schema. |
| 28 | Lead time estimates visible when creating new PO for that vendor | **[FAIL]** | Follows from #27 — feature not implemented. |

**Tier 5 Flag:** The entire lead time tracking feature is absent. A single `received_at` timestamp column on `purchase_orders` is the minimum required first step.

---

## FINAL SUMMARY

### Failures (13 items)

| Tier | # | Item | Recommended Fix |
|------|---|------|-----------------|
| 1 | 2 | `vendor_id` on `purchase_orders` is UUID but `vendors.id` is bigint — no FK enforced | Change `vendors.id` to UUID or change `purchase_orders.vendor_id` to bigint; add FK constraint |
| 2 | 8 | No dedicated receiving table — received quantities have no audit trail | Create a `po_receiving_lines` table (po_id, item_ref, expected_qty, received_qty, received_by, received_at) |
| 2 | 9 | No real-time comparison mechanism between received and PO quantities | Add DB trigger on `po_receiving_lines` INSERT to compute variance and write to a discrepancy log |
| 2 | 10 | No discrepancy log table | Create `po_discrepancy_log` table (po_id, item_ref, expected, received, variance, flagged_at) |
| 2 | 11 | Discrepancy log not viewable in admin dashboard | Follows from creating `po_discrepancy_log` — expose via admin query/view |
| 3 | 15 | No invoice parsing infrastructure | Create `po_invoice_scans` table (po_id, image_url, parsed_at, parsed_items JSONB, status) and implement OCR pipeline |
| 3 | 17 | No approval queue for count/unit items | Add `receiving_approval_queue` table or `status = 'pending_approval'` workflow on receiving lines |
| 3 | 18 | Invoice parsing not implemented | Implement OCR/AI parsing after `po_invoice_scans` table is in place |
| 4 | 20 | Lot numbers not linked to originating PO | Add `purchase_order_id UUID` FK column to `inventory_lots` and `lot_codes` |
| 5 | 25 | No received/closed timestamp on POs | Add `received_at TIMESTAMPTZ` and `closed_at TIMESTAMPTZ` columns to `purchase_orders` |
| 5 | 26 | Lead time delta cannot be calculated | Compute `closed_at - created_at` once `received_at` is added; store in `vendor_lead_time_log` |
| 5 | 27 | No lead time estimation table or view | Create `vendor_lead_times` view or table (vendor_id, product, avg_days, sample_count, last_updated) |
| 5 | 28 | Lead time not visible at PO creation | Surface `vendor_lead_times` data in the PO creation UI once table exists |

### Needs Review (11 items)

| Tier | # | Item | Recommended Fix |
|------|---|------|-----------------|
| 1 | 1 | `vendors` table has 0 rows; no vendor-to-product catalog linkage | Seed vendor data; create `vendor_products` junction table linking vendors to `seafood_inventory` items |
| 1 | 3 | PO line items stored as JSONB with no schema enforcement | Add validation in application layer or migrate to a structured `po_line_items` relational table |
| 1 | 5 | `po_number` is nullable with no UNIQUE constraint | Add `NOT NULL` and `UNIQUE` constraints to `purchase_orders.po_number`; auto-generate on insert |
| 1 | 6 | PO list/print UI unverifiable | Requires live UI testing with a real PO record |
| 2 | 7 | PO default status is `'confirmed'` — no `'open'` status for receiving workflow | Add `'open'` and `'received'` to the PO status lifecycle; update default to `'open'` for new POs |
| 2 | 12 | No trigger to auto-set PO status to `'received'` | Add application logic or DB trigger to close PO when all receiving lines are confirmed |
| 3 | 13 | Camera/upload UI not verifiable from schema | Requires live UI testing |
| 3 | 14 | `scanned_at` exists but no image URL/storage reference on POs | Add `invoice_image_url TEXT` to `purchase_orders` |
| 4 | 19 | No DB-level enforcement requiring lot entry for mollusk items | Add CHECK or trigger on `seafood_inventory` category to require `lot_item` for mollusk categories |
| 4 | 21 | `seafood_inventory.lot_item` is plain text, not FK to lot tables | Replace `lot_item` text field with `lot_id UUID` FK referencing `inventory_lots.id` |
| 4 | — | Two lot tables (`inventory_lots` vs `lot_codes`) with overlapping purposes | Consolidate into a single canonical lot table; deprecate the redundant one |

---

*All issues above are schema-level findings. UI and application-layer behaviors require live end-to-end testing once the data model gaps are addressed.*

---

## Repair Pass Update — 2026-05-10

This branch now includes a code-side remediation for the main schema gaps called out above.

### Prepared in Branch

- Added [20260510_purchasing_receiving_schema.sql](/D:/DeliveryApp/supabase/migrations/20260510_purchasing_receiving_schema.sql) to:
  - normalize `vendors.id` to UUID where needed
  - extend `purchase_orders` with `vendor_id`, workflow/state fields, `received_at`, `closed_at`, `receipt_rules`, and receipt history support
  - add `po_invoice_scans`, `po_receipts`, `po_receiving_lines`, `po_discrepancy_log`, and `po_receiving_approval_queue`
  - add `purchase_order_id` linkage onto `inventory_lots` and `lot_codes`
  - add `vendor_lead_times` view
- Updated backend purchasing flows so vendor PO create/update/receive now mirror into Supabase-backed purchasing tables/columns while preserving the existing local fallback path.
- Updated PO scan flows so scans create durable `po_invoice_scans` records and return `scan_id` through the frontend confirm/receive path.
- Updated vendor scoring and vendor active-PO counting so they read the mirrored vendor-order records instead of the older narrow PO slice.

### Important Live-DB Note

This QA report was generated against the live Supabase project before the new migration above was applied there. From this session, I **did not apply** `20260510_purchasing_receiving_schema.sql` live in Supabase.

That means:

- the branch now contains the repair work
- local tests/builds can verify the code paths
- a DB-only audit against the current live project will still show the older failures until the migration is actually applied to that project

### Verified Locally After the Repair

- Backend syntax checks passed for:
  - `backend/services/purchase-order-workflows.js`
  - `backend/routes/ops/purchasing-order-routes.js`
  - `backend/routes/purchase-orders.js`
  - `backend/routes/ai.js`
- Backend tests passed:
  - `backend/tests/purchasing-schema-sync.test.js`
  - `backend/tests/ops-workflows.test.js`
  - `backend/tests/vendor-po-receiving-lots.test.js`
  - `backend/tests/vendor-catalog.test.js`
  - `backend/tests/purchase-order-numbering.test.js`
  - `backend/tests/purchase-order-scan-review.test.js`
  - `backend/tests/purchasing-lead-times.test.js`
- Frontend tests passed:
  - `frontend-v2/src/pages/PurchasingPage.test.tsx`
  - `frontend-v2/src/pages/VendorsPage.test.tsx`
- `frontend-v2` production build passed.

### Still Requires Live Validation

- Applying the prepared migration to the live Supabase project
- Re-running the schema audit after migration apply
- End-to-end receiving / scan / approval checks against real live data
