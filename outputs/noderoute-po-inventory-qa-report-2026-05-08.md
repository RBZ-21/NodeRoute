# NodeRoute Systems — Inventory & PO Workflow QA Report
**Date:** 2026-05-08<br>
**Agent:** Automated QA (noderoute-po--inventory-agent)<br>
**Method:** Static code analysis — backend routes, frontend pages, DB migrations, service layer<br>
**Note:** Live UI interaction was unavailable (no user present to approve desktop access). All findings are based on code-level inspection. UI-level findings should be re-verified with a live session.

---

## TIER 1 — VENDOR LOOKUP & PO CREATION

| # | Test | Result |
|---|------|--------|
| 1 | Search vendor by name — record loads with contact and product catalog info | [PASS] |
| 2 | New PO can be created from the vendor record | [PASS] |
| 3 | Line items addable with product name, unit, and expected qty/weight | [PASS] |
| 4 | Multiple line items can be added to a single PO | [PASS] |
| 5 | PO saved with unique PO number and creation timestamp | [NEEDS REVIEW] |
| 6 | PO is printable and/or viewable in a PO list screen | [NEEDS REVIEW] |

**Notes:**

- **Test 1:** `GET /api/vendors` returns name, contact, email, phone, category, status, and active PO count. VendorsPage supports status and category filtering. ✓
- **Test 2:** VendorsPage navigates to `/purchasing?vendor=<name>`, which pre-filters the PurchasingPage. ✓
- **Test 3–4:** PurchasingPage form table includes description, item_number, quantity, unit_price, unit, category, lot_number, expiration_date. `addLine()` supports multiple rows. ✓
- **Test 5 — NEEDS REVIEW:** In the `/api/purchase-orders/confirm` route, `po_number` is optional (`z.any().optional()`). If the user leaves it blank, the PO is saved with `po_number: null`. No auto-generation fallback exists in this flow (unlike the ops `vendor-purchase-orders` endpoint which calls `genPoNumber()`). POs without a number are displayed by truncated `id` in the list table — not a true PO number.
- **Test 6 — NEEDS REVIEW:** The historical PO list is visible on PurchasingPage, but no **print button** exists for individual POs. The `/api/print/` route only handles delivery order slips, not purchase orders.

---

## TIER 2 — ORDER RECEIVING & PO COMPARISON

| # | Test | Result |
|---|------|--------|
| 7 | Open PO retrievable from receiving screen | [FAIL] |
| 8 | Received quantities entered line by line against the PO | [FAIL] |
| 9 | System auto-compares received vs PO quantities in real time | [FAIL] |
| 10 | Discrepancies flagged and logged with item, expected, received, variance | [NEEDS REVIEW] |
| 11 | Discrepancy log viewable in admin dashboard | [FAIL] |
| 12 | PO status updates to "Received" when all line items entered | [PASS] |

**Notes:**

- **Tests 7–9 — FAIL:** The backend (`POST /api/ops/vendor-purchase-orders/:id/receive`) fully implements line-by-line receiving with real-time variance calculation (`remainingBefore`, `varianceQty`, `variance_type`). However, **no dedicated frontend Receiving Screen exists**. The Dashboard "Purchasing Command Center" links only to `/purchasing`, which is the scan-and-confirm page — not an open-PO receiving workflow. There is no route or page component in `AppShell`/`nav.ts` that maps to a receiving UI.
- **Test 10 — NEEDS REVIEW:** The backend stores a `variance_audit` object per receipt event (total requested, accepted, rejected, over-receipt qty, backordered qty, line-level `variance_type`). Data is captured correctly. However, this data is buried inside the `receipts[]` array on the ops vendor PO JSON object and has no dedicated display surface.
- **Test 11 — FAIL:** The admin Dashboard shows `Open Vendor POs` and `Backordered POs` counts only. There is no discrepancy or variance log panel visible to admins.
- **Test 12 — PASS:** `summarizeVendorPo()` auto-derives status as `'received'` when all lines have `received_qty >= ordered_qty` or backorder is waived. ✓

---

## TIER 3 — INVOICE PHOTO SCAN & AUTO-DRAFT

| # | Test | Result |
|---|------|--------|
| 13 | Camera/upload accessible from receiving screen | [PASS] |
| 14 | Invoice photo can be captured or uploaded | [PASS] |
| 15 | System parses invoice and auto-generates draft mapped to open PO | [PASS] |
| 16 | Weighted items: draft populates weight fields for review before saving | [PASS] |
| 17 | Count/unit items: approval prompt automatically adds to inventory | [NEEDS REVIEW] |
| 18 | Parsed data accuracy — consistent misreads or missing field mapping | [NEEDS REVIEW] |

**Notes:**

- **Tests 13–14:** PurchasingPage has `📁 Upload Image` (file picker) and `📷 Take Photo` (`capture="environment"`) buttons. Both feed `POST /api/purchase-orders/scan`. ✓
- **Test 15:** AI scan (`parsePurchaseOrderImage` via OpenAI) extracts vendor, PO number, date, items. Result populates the form draft via `applyScanResult()`. ✓
- **Test 16:** Quantity fields are pre-filled and editable before the user clicks "Confirm PO". ✓
- **Test 17 — NEEDS REVIEW:** There is **no distinction** between weighted items (e.g., fresh fish) and count/unit items (e.g., caviar, packaged goods). All items go through the same confirm-button flow. No separate approval prompt exists for count vs. weight types. The task spec calls for different handling (weight items → review first; count items → prompt then auto-add).
- **Test 18 — NEEDS REVIEW:** The scan endpoint defaults all items to `unit: 'lb'` and `category: 'Other'` when the AI doesn't provide them. **Lot numbers are never populated from the scan** — the `lot_number` field is always left empty in `applyScanResult()`, requiring 100% manual entry even when a lot number appears on the physical invoice image.

---

## TIER 4 — MOLLUSK LOT NUMBER TRACKING

| # | Test | Result |
|---|------|--------|
| 19 | Mollusk items trigger a lot number entry field during receiving | [NEEDS REVIEW] |
| 20 | Lot number saved and linked to vendor, PO number, product, date, qty | [NEEDS REVIEW] |
| 21 | Lot number visible on the inventory record for that item | [NEEDS REVIEW] |
| 22 | Lot number forwardable to customer via invoice or standalone notice | [FAIL] |
| 23 | Lot number history searchable by product, vendor, or date range | [PASS] |

**Notes:**

- **Test 19 — NEEDS REVIEW:** The backend correctly marks `lot_item: 'Y'` for items whose description matches `/\b(mussel|clam|oyster)s?\b/i` when creating new inventory from a PO confirm. However, the **frontend does not enforce mandatory lot entry for mollusks**. The "Lot Number (FSMA)" column is optional and equally visible for all product types. No conditional prompt or validation fires specifically for clams, mussels, or oysters.
- **Test 20 — NEEDS REVIEW:** The `lot_codes` table stores `lot_number`, `product_id`, `vendor_id`, `quantity_received`, `unit_of_measure`, `received_date`, `received_by`. However, **there is no `po_number` or `purchase_order_id` FK column** in the `lot_codes` schema (`create_lot_codes.sql`). The PO reference is embedded in the `notes` text field only (e.g., `"Auto-created from PO confirm · PO-XXX"`), which is not queryable.
- **Test 21 — NEEDS REVIEW:** The `seafood_inventory` table has a `lot_item` flag (`'Y'/'N'`) but does **not store the actual lot number on the inventory row**. Lot records live in the separate `lot_codes` table linked via `product_id`. The InventoryPage would need a separate join/query to show active lots for an item — no evidence this display exists in `InventoryPage.tsx`.
- **Test 22 — FAIL:** The `invoice-email.js` template **does not include lot numbers** in the email body or attached PDF. The `order-print.js` and `print-template.js` services also contain no lot number references. The TraceabilityPage (`/admin/traceability`) is admin-only and not customer-facing. There is no standalone lot traceability notice mechanism to send to customers.
- **Test 23 — PASS:** `GET /api/lots/traceability/report` filters by `lot`, `product_id`, `date_from`, `date_to` with pagination. TraceabilityPage provides this UI. Full trace per lot (`GET /api/lots/:lotNumber/trace`) reconstructs the supply chain through orders and stops. ✓

---

## TIER 5 — LEAD TIME TRACKING & AI ESTIMATION

| # | Test | Result |
|---|------|--------|
| 24 | PO creation timestamp recorded automatically | [PASS] |
| 25 | PO received/closed timestamp recorded automatically | [NEEDS REVIEW] |
| 26 | Time delta between creation and receipt calculated and stored | [FAIL] |
| 27 | System surfaces estimated lead time after sufficient data points | [FAIL] |
| 28 | Lead time estimates visible when creating a new PO for that vendor | [FAIL] |

**Notes:**

- **Test 24 — PASS:** `created_at: new Date().toISOString()` is set on PO creation in `ops-vendor-pos.js`. ✓
- **Test 25 — NEEDS REVIEW:** Each individual receipt event has `received_at: new Date().toISOString()` inside the `receipts[]` array. PO status auto-transitions to `'received'`, but there is **no dedicated `closed_at` or `completed_at` timestamp on the PO document itself**. Computing actual lead time requires finding the last receipt's timestamp — no convenience field exists for this.
- **Test 26 — FAIL:** No code exists anywhere in the codebase that calculates the elapsed days between PO `created_at` and final receipt, or stores this delta per vendor/product. The data exists in two fields but is never aggregated.
- **Test 27 — FAIL:** `buildPurchasingSuggestions()` uses a `leadTimeDays` parameter (default: 5) that is passed in at request time by the user/caller. This is a **static manual input**, not derived from historical PO-to-receipt data. No function exists that aggregates past PO completion times to estimate vendor-specific lead times.
- **Test 28 — FAIL:** The ops vendor admin route allows setting a manual `lead_time_days` field on a vendor record, but this is user-entered, not auto-calculated. When creating a new PO for a vendor on PurchasingPage or the ops PO creation flow, no lead time estimate from history is surfaced.

---

## FINAL SUMMARY — FAILURES & ITEMS NEEDING REVIEW

### [FAIL] Items — Grouped by Tier

| Tier | Test # | Issue | Recommended Fix |
|------|--------|-------|-----------------|
| 2 | 7–8 | No receiving screen UI — open PO retrieval and line-by-line entry have no frontend page | Create a `/receiving` route with a VendorPO selector and per-line quantity entry form calling `POST /api/ops/vendor-purchase-orders/:id/receive` |
| 2 | 9 | Real-time PO comparison has no UI surface | Add inline variance display to the receiving form (ordered vs. entered, delta highlighted) |
| 2 | 11 | Discrepancy log not visible in admin dashboard | Add a "Receipt Variances" panel to Dashboard or Purchasing page pulling `variance_audit` from receipts |
| 4 | 22 | Lot numbers not forwarded to customers on invoice or notice | Add lot numbers to the `invoice-email.js` template and `pdf.js` builder; optionally add a "Send Lot Notice" action on the TraceabilityPage |
| 5 | 26 | No time delta calculation between PO creation and receipt | Add a `lead_time_days_actual` field to PO; compute on status → `received` transition |
| 5 | 27 | Lead time estimation uses static user input, not historical data | Aggregate `actual_lead_time_days` per vendor/product from closed POs to compute rolling average |
| 5 | 28 | No lead time estimate shown when creating a PO for a vendor | Surface avg historical lead time on vendor record and show it in the PO creation form header |

### [NEEDS REVIEW] Items — Grouped by Tier

| Tier | Test # | Issue | Recommended Fix |
|------|--------|-------|-----------------|
| 1 | 5 | PO number is optional; saved as null if not entered | Auto-generate PO number (`genPoNumber()`) in `/api/purchase-orders/confirm` when `po_number` is blank |
| 1 | 6 | No print button for individual POs | Add a PO print/export route (`/api/print/purchase-order/:id`) and a Print button on PurchasingPage |
| 2 | 10 | Variance data captured in backend but not displayed | Display `variance_type` and quantities on PO detail view once receiving screen is built |
| 3 | 17 | No distinction between weighted vs. count items in scan confirm flow | Add item-type detection; show weight-confirmation step for `unit: lb` items and count-approval for unit/each items |
| 3 | 18 | Lot numbers never extracted from scanned invoices | Update `parsePurchaseOrderImage` AI prompt to extract lot numbers when visible on invoice image |
| 4 | 19 | Mollusk items don't trigger mandatory lot number prompt in UI | Add client-side validation: if description matches mollusk pattern, mark lot_number field required before confirm |
| 4 | 20 | No `po_number` FK column in `lot_codes` table | Add `po_number TEXT` and `purchase_order_id` reference columns to `lot_codes` migration |
| 4 | 21 | Lot number not visible on inventory record — separate table only | Add lot lookup display to InventoryPage item detail, fetching from `GET /api/lots?product_id=` |
| 5 | 25 | No dedicated `closed_at` timestamp on PO document | Add `closed_at` field set when PO status transitions to `received` in `summarizeVendorPo()` |

---

*Total: 5 [FAIL] · 9 [NEEDS REVIEW] · 14 [PASS]*
