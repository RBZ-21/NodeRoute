# NodeRoute Systems — QA Workflow Report
**Date:** 2026-05-09<br>
**Scope:** Full order-to-delivery workflow (Tiers 1–4) + Inventory & Purchase Order workflow (Tiers 1–5, automated QA run)
**Method:** Static code analysis of frontend (`frontend-v2/src/`), driver app (`driver-app/src/`), and backend (`backend/routes/`, `backend/services/`)<br>
**Delta:** Compared against QA_Report_NodeRoute_2026-05-08.md; today's HEAD commit is `82a8073` (Complete purchasing and traceability hardening, May 9 2026)

---

## Automated QA — Inventory & Purchase Order Workflow (Scheduled Run 2026-05-09)

**Files reviewed:** `PurchasingPage.tsx`, `VendorsPage.tsx`, `TraceabilityPage.tsx`, `InventoryPage.tsx`, `InvoicesPage.tsx`, `purchase-orders.js`, `ops-vendor-pos.js`, `purchasing-shared.js`, `ai.js`, `ops-utils.js`, and DB migrations.

### TIER 1 — Vendor Lookup & PO Creation

| # | Test | Result |
|---|------|--------|
| 1 | Search for a vendor by name — record loads with contact and product catalog info | [NEEDS REVIEW] |
| 2 | A new Purchase Order can be created from the vendor record | [PASS] |
| 3 | Line items can be added to the PO with product name, unit, and expected quantity/weight | [PASS] |
| 4 | Multiple line items can be added to a single PO | [PASS] |
| 5 | PO is saved and assigned a unique PO number with a creation timestamp | [PASS] |
| 6 | PO is printable and/or viewable in a PO list screen | [PASS] |

**Notes:**
- Step 2: `VendorsPage.newPO()` navigates to `/purchasing?vendor=<name>` and pre-populates the vendor field. ✓
- Step 3–4: PO form supports unlimited line rows via `addLine()` / `removeLine()`. Fields include description, item #, qty, unit price, unit, category, lot number, expiration date, and running total. ✓
- Step 5: `generatePurchaseOrderNumber()` emits `PO-YYYYMMDD-HHMMSS-XXX` (timestamp + 3-char random). DB records `created_at` automatically. ✓
- Step 6: "Open PDF" button calls `buildPurchaseOrderPDF()` and opens in a new tab. Historical PO list table is rendered below the form. ✓
- **Step 1 NEEDS REVIEW:** Vendor record surfaces name, contact, email, phone, category, status, address, notes, and payment terms — but there is **no vendor-specific product catalog**. The PO creation form draws from all inventory (`/api/inventory`), not a per-vendor catalog. If users need to see only products purchased from a given vendor, this is a gap.

---

### TIER 2 — Order Receiving & PO Comparison

| # | Test | Result |
|---|------|--------|
| 7 | An existing open PO can be retrieved from the receiving screen | [PASS] |
| 8 | Received quantities/weights can be entered line by line against the PO | [PASS] |
| 9 | System automatically compares received quantities to PO quantities in real time | [PASS] |
| 10 | Discrepancies are automatically flagged and logged with item name, expected, received, and variance | [PASS] |
| 11 | Discrepancy log is viewable in the admin dashboard | [NEEDS REVIEW] |
| 12 | PO status updates to "Received" once all line items are entered | [PASS] |

**Notes:**
- Step 9: `expectedVariance = receiveNow - remaining` is computed live per line. UI renders a badge: "Exact receipt" / "Over by X" / "Short by X" in real time. ✓
- Step 10: Backend stores `product_name`, `remaining_before_qty` (expected), `qty_received` (received), `quantity_variance_qty`, and `variance_type` (exact_receipt / short_receipt / over_receipt) per receipt line. ✓
- Step 12: `summarizeVendorPo()` automatically derives status as `'received'` when all lines satisfy `received >= ordered || (received + waived >= ordered)`. ✓
- **Step 11 NEEDS REVIEW:** The discrepancy log is embedded in `PurchasingPage` (shows receipts with variance, short/over qty totals, 6-entry activity feed), not a dedicated Admin Dashboard view. Consider promoting to the main Dashboard or a standalone Compliance module.

---

### TIER 3 — Invoice Photo Scan & Auto-Draft

| # | Test | Result |
|---|------|--------|
| 13 | Camera/upload function is accessible from the receiving screen | [FAIL] |
| 14 | A photo of a vendor invoice can be captured or uploaded | [PASS] |
| 15 | System parses the invoice and auto-generates a draft mapped to open PO line items | [NEEDS REVIEW] |
| 16 | Weighted items: draft populates weight fields for user review before saving | [PASS] |
| 17 | Count/unit items: system prompts user to approve quantities before adding to inventory | [NEEDS REVIEW] |
| 18 | Parsed data accuracy is reasonable | [NEEDS REVIEW] |

**Notes:**
- Step 14: Both `fileInputRef` (file picker, JPEG/PNG/WebP up to 15 MB) and `cameraInputRef` (`capture="environment"` for rear camera on mobile) are implemented. ✓
- Step 16: `item_type: 'weighted'` is inferred from unit keywords (`lb`, `lbs`, `oz`, `kg`, etc.). Weight fields are populated in the draft for user review before clicking "Confirm PO". ✓
- **Step 13 FAIL:** The "AI PO Scanner" panel and its camera/upload buttons are in the **"Confirm Purchase Order"** (PO creation) section only. They are **not** present in the **"Receive Vendor Purchase Orders"** panel. A user cannot scan a vendor invoice at the dock against an already-open vendor PO. Fix: move or duplicate the scanner UI into the vendor PO receiving panel and map parsed line items to the matching `receiveLines[].qty_received` fields.
- **Step 15 NEEDS REVIEW:** `applyScanResult()` maps parsed items to the creation form (new PO draft), not to the receive draft of an existing open vendor PO. To match a scanned invoice against an existing PO, users must cross-reference manually. Fix: wire scan result into `receiveLines` state when a vendor PO is open in the receiving panel.
- **Step 17 NEEDS REVIEW:** Both `weighted` and `count` items flow through the same single "Confirm PO" button. The spec calls for a distinct per-item approval prompt for count items. Currently the scan summary shows weighted/count counts in an info banner, but the user reviews both in the same table and approves all at once.
- **Step 18 NEEDS REVIEW:** AI scan prompt is well-structured (GPT-4 Vision, strict JSON schema, confidence levels for lot numbers, item_type classification, graceful fallback). Accuracy cannot be validated from static code review — live testing with real vendor invoices is required.

---

### TIER 4 — Mollusk Lot Number Tracking

| # | Test | Result |
|---|------|--------|
| 19 | Mollusk items during receiving trigger a lot number entry field | [FAIL] |
| 20 | Lot number is saved and linked to vendor, PO number, product, received date, and quantity | [PASS] |
| 21 | Lot number is visible on the inventory record for that item | [NEEDS REVIEW] |
| 22 | Lot number can be forwarded to the customer via invoice or standalone notice | [NEEDS REVIEW] |
| 23 | Lot number history is searchable by product, vendor, or date range | [NEEDS REVIEW] |

**Notes:**
- Step 20: `lot_codes` table includes `lot_number`, `product_id` (FK to `seafood_inventory`), `vendor_id`, `quantity_received`, `unit_of_measure`, `received_date`, `received_by`, and `source_po_number` (added in migration `20260508_lot_codes_source_po_number.sql`). All required linkage fields are present. ✓
- **Step 19 FAIL:** `lineRequiresLot()` regex (`/\b(mussel|clam|oyster)s?\b/i`) correctly fires warnings and blocks confirmation in the **Confirm PO** creation flow. However, the **"Receive Vendor Purchase Orders"** flow uses `ReceiveLineDraft` type (`{ line_no, qty_received, unit_cost }`) — no `lot_number` field, no `lineRequiresLot` check, and no lot column in the receive table. Mollusks received against an existing vendor PO are accepted without any lot number. Fix: add `lot_number` and `lot_required` to `ReceiveLineDraft`; add a lot column to the receiving table; enforce the mollusk regex on receipt submission.
- **Step 21 NEEDS REVIEW:** The main `InventoryPage` table does not display the actual lot number on the row. Only the `lot_item: 'Y'` flag and expiring-lot AI alerts reference lots contextually. To view linked lot numbers a user must navigate to `TraceabilityPage`. Fix: add a lots popover or link on inventory rows where `lot_item = 'Y'`.
- **Step 22 NEEDS REVIEW:** Lot numbers appear on invoice printouts (`InvoicesPage` renders a Lot Summary table with item number, description, lot #, qty, and weight when `lot_numbers` is populated). However, there is no standalone traceability notice — no "Send Lot Notice to Customer" action or email template. Fix: add a "Send Lot Notice" action on the TraceabilityPage lot detail panel.
- **Step 23 NEEDS REVIEW:** `TraceabilityPage` supports filtering by lot number (exact lookup), product ID, and date range. The results table shows a vendor column and vendor is included in CSV export. However, there is **no vendor filter input** in the report UI — users cannot filter the lot list by vendor directly. Fix: add a vendor filter input alongside the existing lot/product/date range filters.

---

### TIER 5 — Lead Time Tracking & AI Estimation

| # | Test | Result |
|---|------|--------|
| 24 | PO creation timestamp is recorded automatically | [PASS] |
| 25 | PO received/closed timestamp is recorded automatically | [PASS] |
| 26 | Time delta between creation and receipt is calculated and stored per vendor, per product | [NEEDS REVIEW] |
| 27 | Estimated lead time surfaces per vendor/product combination after sufficient data | [NEEDS REVIEW] |
| 28 | Lead time estimates are visible when creating a new PO for that vendor | [NEEDS REVIEW] |

**Notes:**
- Step 24: `created_at: new Date().toISOString()` is set at vendor PO creation. ✓
- Step 25: `received_at: new Date().toISOString()` is stored in each receipt. `calculateVendorPoLeadMetrics()` derives `first_received_at`, `latest_received_at`, `first_receipt_lead_time_days`, `first_receipt_lead_time_hours`, and `full_receipt_lead_time_days`. ✓
- **Step 26 NEEDS REVIEW:** Lead time delta is calculated at the **vendor PO level** — one number per PO (creation → first receipt). There is no per-product breakdown within a PO. If a PO contains 5 line items, all 5 share the same lead time. Fix: record receipt timestamps per line item and compute per-product lead times from line-level receipt history.
- **Step 27 NEEDS REVIEW:** `buildVendorLeadTimeStats()` aggregates by vendor name (average, median, min, max, latest). This is **vendor-level** estimation only — not per vendor+product combination. Fix: extend to group by `vendor + item_number` and surface per-product lead time estimates.
- **Step 28 NEEDS REVIEW:** Lead time stat cards (Historical Average, Median, Most Recent) are displayed in the "Receive Vendor Purchase Orders" section and are global across all vendors. When a user fills out the "Confirm Purchase Order" form and selects a specific vendor, no vendor-specific lead time estimate is shown alongside the form. Fix: fetch and display the selected vendor's historical average lead time in the PO creation form header when a vendor is chosen from the combobox.

---

### Final Summary — Automated PO/Inventory QA

**Total: 2 FAIL · 9 NEEDS REVIEW · 17 PASS**

#### [FAIL] — Must Fix

| Tier | Step | Issue | Recommended Fix |
|------|------|-------|-----------------|
| 3 | 13 | AI Scanner is on PO creation form only — not accessible from the receiving screen | Move/duplicate scanner into the receiving panel; map parsed line items to `receiveLines[].qty_received` |
| 4 | 19 | Mollusk lot number not prompted during vendor PO receiving flow | Add `lot_number` field to `ReceiveLineDraft`; add lot column to receive table; enforce `lineRequiresLot` on receipt submit |

#### [NEEDS REVIEW] — Should Fix

| Tier | Step | Issue | Recommended Fix |
|------|------|-------|-----------------|
| 1 | 1 | Vendor record has no product catalog | Build `vendor_products` table or add per-vendor catalog filter on the inventory combobox |
| 2 | 11 | Discrepancy log embedded in Purchasing page, not admin dashboard | Promote to Dashboard or a dedicated Compliance screen |
| 3 | 15 | Invoice scan populates new PO draft, not receive quantities for an existing vendor PO | Wire scan output to `receiveLines` state when a vendor PO is open |
| 3 | 17 | No distinct per-item-type approval for count vs. weighted items | Add a count-item approval step before final submission |
| 3 | 18 | AI parsing accuracy unverified | Run live tests with real vendor invoice images across multiple vendors |
| 4 | 21 | Lot number not visible directly on the inventory row | Add lots popover or link on inventory rows for `lot_item = 'Y'` items |
| 4 | 22 | No standalone lot traceability notice to customers | Add "Send Lot Notice" action on the Traceability detail panel |
| 4 | 23 | No vendor filter in lot history search UI | Add vendor filter input to TraceabilityPage report section |
| 5 | 26–28 | Lead time is vendor-level only; no per-product breakdown; not shown on PO creation form | Track receipt timestamps per line item; group lead time by vendor+product; show vendor-specific estimate on creation form |

*Automated QA run — no writes made to production data.*

---

## TIER 1 — ORDER INTAKE

**Step 1 — Customer search loads correct record** `[PASS]`<br>
`OrderFormCard.tsx` uses a Combobox backed by the customers query. Selecting a customer auto-hydrates company name, email, phone, and delivery address. A secondary address lookup fires against `/api/customers/address-lookup` if no address is stored. All fields populate in a single selection — under 3 clicks.

**Step 2 — Product selection with weight/quantity** `[PASS]`<br>
Product Combobox populates item number, description, unit price, and unit (lb/each). Catch-weight toggle and quantity field are present per line. Lot code selection supported. A browsable inventory panel is also available.

**Step 3 — Order created and print job triggered** `[PASS]`<br>
`submitOrder(true)` in `OrdersPage.tsx` creates the order, sends it to processing via `sendOrderMutation`, then calls `openPrintWindow()` and `printOrderSlip()`. The print popup is opened before the API call resolves to avoid popup blockers.

**Step 4 — Printed document includes required fields** `[PASS]`<br>
`printOrderSlip()` renders: customer name, customer address, order number, item name, quantity + unit, price per unit, and a timestamp.

**🚩 Flag:** The timestamp on the print slip is `new Date().toLocaleString()` (print time), not the order's `created_at`. For orders printed after the fact, the printed timestamp will be inaccurate.

---

## TIER 2 — WEIGHT CONFIRMATION & INVOICING

**Step 5 — Open order and enter final confirmed weight** `[PASS]`<br>
`WeightCaptureCard` and `WeightStationPanel` provide per-item actual-weight inputs accessible from the Orders page. Weight is saved via `PATCH /api/orders/:id/items/:index/weight`.

**Step 6 — Order status updates after weight saved** `[PASS]`<br>
The weight-capture backend endpoint sets order status to `'processed'` when all catch-weight items have actual weights captured, or `'in_process'` while weights are still pending.

**Step 7 — Invoice generates automatically with required fields** `[PASS]`<br>
`invoicePayloadForOrder()` populates: `customer_name`, `customer_email`, `customer_address`, items (description, qty, weight, price, line total), tax, totals, and `order_id`. Issued date derived from `created_at`.

**Step 8 — Invoice is printable from the UI** `[PASS]`<br>
`printInvoiceSummary()` in `InvoicesPage.tsx` opens a full-detail print window including summary cards, lot table, notes, and triggers `window.print()`.

**🚩 Flag (unchanged from 2026-05-08):** An invoice is created with status `'pending'` and notes `'Awaiting final weights'` as soon as the *first* weight is saved — before all items are confirmed. No guard prevents printing an invoice where `estimated_weight_pending: true`. A user printing at this intermediate state will get incomplete totals.

---

## TIER 3 — ROUTE & DRIVER ASSIGNMENT

**Step 9 — Invoice assigned to a delivery route** `[PASS]`<br>
Orders are added as stops via batch selector in `RoutesPage.tsx`. Each stop carries `invoice_id`. Driver-invoice access in the backend is scoped to the assigned route.

**Step 10 — Route assigned to a specific driver** `[PASS]`<br>
Driver Combobox is present on both route creation and route edit panels. An AI "Suggest Assignments" feature also exists for bulk driver-to-route matching.

**Step 11 — Multiple invoices optimize stop order by geography** `[NEEDS REVIEW]`<br>
`/api/ai/optimize-route` fetches stops with `id, address, customer_id, status` and passes them to the AI optimizer. No GPS coordinates (lat/lng) are fetched or passed — the optimizer works from address strings only. Results may be suboptimal for dense local routes. No change from prior report.

**Step 12 — Optimized route and stop details visible in driver view** `[PASS]`<br>
`DriverRouteTab.tsx` renders all stops in `active_stop_ids` order with name, address, invoice badge, door code, notes, and status actions.

**Step 13 — Dispatch status updates when route marked as departed** `[PASS]`<br>
`handleDispatchRoute()` patches `{ status: 'active', dispatched_at: new Date().toISOString() }`. Confirmation notice fires in the UI immediately.

**🚩 Flag (unchanged from 2026-05-08):** The `driver` field on a route is stored as a free-text name string, not a foreign key to a user record. "Suggest Assignments" produces recommendations but does not apply them automatically. No validation that the typed driver name matches an actual system user.

---

## TIER 4 — DRIVER DELIVERY & PROOF OF DELIVERY

**Step 14 — Driver can open any assigned invoice from route view** `[PASS]`<br>
The `invoices` tab lists all invoices scoped to the driver's route. Completed stops in `DriverRouteTab` also show an inline "Download Invoice" button fetching `/api/invoices/:id/pdf`.

**Step 15 — Driver can add notes to an invoice** `[NEEDS REVIEW]`<br>
Drivers can add `driver_notes` to a **stop** (`PATCH /api/stops/:id`) — not to the invoice record itself. Notes (door codes, special instructions) live on the stop and are not surfaced in `InvoicesPage` or on printed invoices. No change from prior report.

**Step 16 — Driver can skip/reorder a stop — moves to end of route queue** `[FAIL]`<br>
> ⚠️ **Regression vs. prior report (2026-05-08 marked PASS)**

The backend endpoints `POST /api/stops/:id/skip` and `POST /api/stops/:id/move-to-end` are fully implemented and now also call `syncRouteMutation` (new in commit `82a8073`). However, **the skip button does not exist in the driver-facing app** (`driver-app/src/pages/StopDetailPage.tsx`). The driver UI only exposes: Mark Arrived, Mark Delivered, Mark Failed. The "Skip — move to end" button is present exclusively in the **admin** `DriverRouteTab.tsx` (admin frontend). A driver on the road cannot skip or reorder stops themselves.

**Step 17 — Driver captures POD via digital signature OR photo upload** `[PASS]`<br>
Photo upload: `onCapturePhoto()` in `StopDetailPage.tsx` accepts camera or file input, reads via `FileReader`, stores as base64, and is submitted on delivery. Digital signature: `SignatureModal` (admin frontend) captures a canvas drawing and POSTs to `/api/stops/:id/signature`. Both paths are implemented.

**🚩 Flag (unchanged from 2026-05-08):** Photo upload requires 3–4 taps on the driver app (tap label → file picker → capture/select → confirm), exceeding the 2-tap threshold in the QA spec. Digital signature is admin-side only, not accessible in the driver app.

**Step 18 — Customer receives emailed invoice after delivery confirmation** `[FAIL]`<br>
The `depart` handler in `stops.js` fires `sendInvoiceEmail` non-fatally, but two critical bugs remain **unresolved since 2026-05-08**:

1. **Silent skip when `customer_id` is missing:** Email only fires inside `if (stop.customer_id)` — stops created via the batch-add order flow often carry no `customer_id`, silently skipping delivery email entirely.
2. **Wrong invoice selected:** The lookup fetches the most-recent order for that `customer_id`, not the invoice tied to *this specific stop*. A customer with multiple open orders will receive the wrong invoice.

The stop record contains `invoice_id` directly — neither bug is structurally difficult to fix.

**Step 19 — Admin dashboard updates invoice status to "Delivered" without manual refresh** `[NEEDS REVIEW]`<br>

- **Auto-refresh:** `useDashboard.ts` sets `refetchInterval: 15_000` on deliveries, routes, drivers, and stats queries. State changes are reflected within ~15 seconds without manual action. ✓<br>
- **Invoice status:** The `depart` handler marks the *stop* as `completed` but does not update the invoice status. No code path transitions an invoice to `"Delivered"` after stop departure. Invoices remain in pre-delivery status (`pending`, `sent`, etc.) indefinitely. No change from prior report.

---

## FINAL SUMMARY

### [FAIL] Items

| # | Step | Issue | Recommended Fix |
|---|------|-------|-----------------|
| 16 | Skip/reorder — driver app missing UI | Backend skip endpoint exists but no skip button in `StopDetailPage.tsx` driver app | Add "Skip — move to end" button to `StopDetailPage.tsx`, calling `POST /api/stops/:id/skip` |
| 18a | Email on delivery — silent skip | Email fires only when `stop.customer_id` is set; stops without it never send email | Look up invoice via `stop.invoice_id` directly: `supabase.from('invoices').select('*').eq('id', stop.invoice_id)` |
| 18b | Email on delivery — wrong invoice | Fetches most-recent order for customer, not the stop's linked invoice | Replace traversal query with direct `stop.invoice_id` lookup (same fix as 18a) |

### [NEEDS REVIEW] Items

| # | Step | Issue | Recommended Fix |
|---|------|-------|-----------------|
| T2-Flag | Invoice printable before weights finalized | Invoice created at first weight save with `estimated_weight_pending: true`; no print guard | Disable Print button or show warning when `estimated_weight_pending` is true |
| 11 | Route optimization — no GPS coordinates | Optimizer uses text addresses only; no lat/lng geo-sort | Geocode stop addresses before passing to optimizer, or sort by zip/region as fallback |
| T3-Flag | Driver assignment not linked to user accounts | `driver` field is free-text; no FK to users; Suggest Assignments doesn't auto-apply | Add `driver_user_id` FK; wire Suggest Assignments to apply in one click |
| 15 | Driver notes not surfaced on invoices | `driver_notes` saved to stops only; not visible in `InvoicesPage` or on printed invoices | Sync `driver_notes` from stop to linked invoice `notes` on save |
| 19b | Invoice status never reaches "Delivered" | No code path updates invoice status after stop departure | In `depart` handler: after stop completed, patch `invoices.status = 'delivered'` where `id = stop.invoice_id` |
| T4-Flag | POD photo exceeds 2-tap threshold | 3–4 taps required; digital signature is admin-only | Pre-open camera on "Mark Arrived" for stops with invoice, or combine Depart + Upload into one action |

### Compared to 2026-05-08

| Change | Detail |
|--------|--------|
| ✅ Improvement | `syncRouteMutation` now called from `/move-to-end` and `/defer` endpoints — route reorder is more reliably persisted |
| 🔴 New FAIL | Step 16 downgraded from PASS to FAIL — skip button confirmed absent from driver app UI |
| ⏸ Unchanged FAILs | Steps 18a and 18b email bugs not addressed |
| ⏸ Unchanged NEEDS REVIEW | Steps 11, 15, 19b, T2-Flag, T3-Flag, T4-Flag all unchanged |

---

*Report generated by automated QA agent — 2026-05-09*

---

## Repair Pass Update — 2026-05-10

This report was generated before the repair/hardening fixes that were completed on branch `Vega/repair-pass`. The items below reflect the current post-fix state verified from the workspace on **2026-05-10**.

### Status Update

- **Resolved from this report:** Purchasing Steps **1, 11, 13, 15, 17, 19, 21, 22, 23, 26, 27, 28**
- **Resolved from this report:** Delivery/route Steps **11, 15, 16, 18, 19**
- **Resolved flags:** `T2-Flag`, `T3-Flag`, `T4-Flag`
- **Still manual-only:** Purchasing Step **18** AI parsing accuracy with real vendor invoice images

### Verified Fixed Since Original Report

- **Purchasing Step 1:** Vendor records now maintain catalog item numbers and the PO creation combobox scopes product suggestions to the selected vendor catalog.
- **Purchasing Step 11:** Receiving discrepancy history is surfaced on the main dashboard in addition to the Purchasing page.
- **Purchasing Step 13:** The receiving panel now includes its own AI dock invoice scanner with camera and upload actions.
- **Purchasing Step 15:** Receiving scans now map parsed invoice lines into the open PO `receiveLines` draft, including quantity, unit cost, and lot number.
- **Purchasing Step 17:** Count items now require explicit approval before final PO confirmation.
- **Purchasing Step 19:** Mollusk receipts now require a lot number in the receiving flow and enforce that rule server-side.
- **Purchasing Steps 21–23:** Inventory rows now expose lot numbers directly, Traceability supports vendor filtering, and standalone customer lot notices can be sent from the lot detail workflow.
- **Purchasing Steps 26–28:** Lead-time history is now tracked at the PO-line level, aggregated by vendor + product, shown in PO creation, and used in planning/draft-generation logic.
- **Route Step 11:** Route optimization now consumes stop GPS coordinates and customer delivery windows, with a coordinate-aware fallback heuristic when AI is unavailable.
- **Route Step 15:** Driver notes now sync onto the linked invoice so they are visible with invoice records/printing.
- **Route Step 16:** The driver app now exposes a dedicated `Skip - move to end` action on the stop detail screen.
- **Route Step 18:** Delivery confirmation email lookup now uses `stop.invoice_id` directly instead of customer-order fallback logic.
- **Route Step 19:** Stop departure now promotes the linked invoice status to `delivered`, and the dashboard refresh path reflects the new state automatically.
- **Flag T2:** Intermediate-weight invoices marked `estimated_weight_pending` are now blocked from print/PDF actions until final weights are ready.
- **Flag T3:** Route assignment now persists a real `driver_id`, adds a prepared FK migration to `users.id`, and allows one-click AI suggestion apply.
- **Flag T4:** The driver proof-of-delivery path now opens camera capture directly from the deliver action so the required flow is down to the intended 2 taps.

### Remaining Manual Validation

Only one item from this report still requires external validation rather than more code changes:

- **Purchasing Step 18:** Validate AI vendor invoice parsing accuracy with real-world invoice images across multiple vendors. This cannot be fully closed from static review or local synthetic tests alone.

#### Manual Validation Checklist for Step 18

When real dock invoice images are available, validate at least:

1. A weighted seafood invoice with visible unit weights and totals.
2. A count-item invoice where count approvals are required before confirmation.
3. A mollusk invoice with visible lot numbers to confirm receiving-side lot carry-through.
4. At least two vendors with different invoice layouts.

For each sample, confirm:

- The receiving scanner is accessible from the open PO receipt panel.
- Parsed lines map onto the correct open PO lines.
- `qty_received`, `unit_cost`, and `lot_number` prefill correctly.
- Unmatched lines are surfaced clearly instead of silently mis-mapping.
- Count items still require explicit approval before final PO confirmation.
- Receiving submission succeeds only when required lot numbers are present.

### Verification Run Completed on 2026-05-10

- Backend regression suites covering invoice delivery, driver skip/email flow, lot notices, vendor catalog, receiving lots, PO numbering, PO scan review, purchasing lead times, route geo-optimization, and ops workflows all passed.
- Frontend regression suites covering invoices, purchasing, vendors, dashboard, inventory, traceability, routes, and financials all passed.
- `frontend-v2` production build passed.
- `driver-app` production build passed.
- No live Supabase migrations were applied from this session.
