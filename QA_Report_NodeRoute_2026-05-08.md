# NodeRoute Systems — QA Workflow Report
**Date:** 2026-05-08<br>
**Scope:** Full order-to-delivery workflow (Tiers 1–4)<br>
**Method:** Static code analysis of frontend (`frontend-v2/src/`) and backend (`backend/routes/`, `backend/services/`)

---

## TIER 1 — ORDER INTAKE

**Step 1 — Customer search loads correct record** `[PASS]`<br>
`OrderFormCard.tsx` uses a Combobox backed by the customers query. Selecting a customer auto-hydrates company name, email, phone, and delivery address. If no address is stored, a secondary lookup fires against `/api/customers/address-lookup`. All fields populate in a single selection.

**Step 2 — Product selection with weight/quantity** `[PASS]`<br>
Product Combobox populates item number, description, unit price, and unit (lb/each). Catch-weight toggle and quantity field are present per line. Lot code selection is also supported.

**Step 3 — Order created and print job triggered** `[PASS]`<br>
`submitOrder(true)` in `OrdersPage.tsx` creates the order, sends it to processing via `sendOrderMutation`, then calls `openPrintWindow()` and `printOrderSlip()`. A print popup is opened before the API call resolves to avoid popup blockers.

**Step 4 — Printed document includes required fields** `[PASS]`<br>
`printOrderSlip()` renders: customer name, customer address, order number, item name, quantity + unit, price per unit, and a `new Date().toLocaleString()` timestamp. All required fields are present.

**Flag:** Timestamp on the print slip is the *print time*, not the order's `created_at`. For orders printed after the fact, this will be inaccurate.

---

## TIER 2 — WEIGHT CONFIRMATION & INVOICING

**Step 5 — Open order and enter final confirmed weight** `[PASS]`<br>
`WeightCaptureCard` and `WeightStationPanel` components provide per-item actual-weight inputs. Weight is saved via `PATCH /api/orders/:id/items/:index/weight`.

**Step 6 — Order status updates after weight saved** `[PASS]`<br>
The weight-capture backend endpoint explicitly sets order status to `'processed'` when all catch-weight items have actual weights captured, or keeps `'in_process'` while weights are still pending (`orderStatus = allWeightsCaptured(updatedItems) ? 'processed' : 'in_process'`).

**Step 7 — Invoice generates automatically with required fields** `[PASS]`<br>
`invoicePayloadForOrder()` is called immediately on weight save and populates: `customer_name`, `customer_email`, `customer_address`, items (description, qty, weight, price, line total), tax, totals, and `order_id`. Order date is derived from `created_at` (auto-set by Supabase) and displayed as "Issued" in the InvoicesPage.

**Step 8 — Invoice is printable from the UI** `[PASS]`<br>
`printInvoiceSummary()` in `InvoicesPage.tsx` opens a full-detail print window with invoice summary cards, lot table, notes, and a browser `print()` call.

**Flag:** An invoice is created with status `'pending'` and notes `'Awaiting final weights'` as soon as the *first* weight is saved — before all items are confirmed. If a user prints the invoice at this intermediate state, the totals will be incomplete. No guard prevents printing an `estimated_weight_pending: true` invoice.

---

## TIER 3 — ROUTE & DRIVER ASSIGNMENT

**Step 9 — Invoice assigned to a delivery route** `[PASS]`<br>
Orders are added as stops via batch selector in `RoutesPage.tsx`. Each stop carries `invoice_id`. The driver-invoice lookup in `driver-invoice-access.js` scopes invoice access to the assigned route.

**Step 10 — Route assigned to a specific driver** `[PASS]`<br>
Driver Combobox is present on both route creation and route edit panels. An AI "Suggest Assignments" feature also exists for bulk driver-to-route matching.

**Step 11 — Multiple invoices optimize stop order by geography** `[NEEDS REVIEW]`<br>
`/api/ai/optimize-route` fetches stops with `id, address, customer_id, status` and passes them to the AI optimizer. However, **no GPS coordinates (lat/lng) are fetched or passed** — the optimizer works from address strings only, which means actual geographic sequencing depends entirely on the AI model's ability to reason about text addresses. No true geo-sort (Haversine, OSRM, etc.) is used. Results may be suboptimal for dense local routes.

**Step 12 — Optimized route and stop details visible in driver view** `[PASS]`<br>
`DriverRouteTab.tsx` renders all stops in `active_stop_ids` order with name, address, invoice badge, door code, notes, and status actions.

**Step 13 — Dispatch status updates when route marked as departed** `[PASS]`<br>
`handleDispatchRoute()` patches `{ status: 'active', dispatched_at: new Date().toISOString() }`. Notice message confirms: *"Customer ETA and live tracking can now begin."*

**Flag:** The `driver` field on a route is stored as a plain name string, not a foreign-key link to a user record. "Suggest Assignments" produces recommendations but does **not** apply them — an admin must manually type the driver name. There is no validation that the assigned driver name matches an actual user account.

---

## TIER 4 — DRIVER DELIVERY & PROOF OF DELIVERY

**Step 14 — Driver can open any assigned invoice from route view** `[PASS]`<br>
The `invoices` tab in `DriverPage.tsx` lists all invoices scoped to the driver's route with an "Open PDF" button fetching `/api/invoices/:id/pdf`. Completed stops in `DriverRouteTab` also show a "Download Invoice" button inline.

**Step 15 — Driver can add notes to an invoice** `[NEEDS REVIEW]`<br>
Drivers can add `driver_notes` to a **stop** (PATCH `/api/stops/:id`) — not to the invoice record itself. Notes entered here (door codes, special instructions) live on the stop and are visible in the driver's Notes tab, but they do not appear on the invoice document or in the InvoicesPage. The QA requirement specifies notes *on an invoice*; this gap means delivery notes are not surfaced to admin/billing staff via the invoice view.

**Step 16 — Driver can skip/reorder a stop — moves to end of route queue** `[PASS]`<br>
`skipStop()` calls POST `/api/stops/:id/skip`, which removes the stop ID from `active_stop_ids` and appends it to the end. Confirmed in backend stops.js. Button label is "Skip — move to end." ✓

**Step 17 — Driver captures POD via digital signature OR photo upload** `[PASS]`<br>
Both paths are fully implemented. `SignatureModal` captures a canvas signature and POSTs to `/api/stops/:id/signature`. Photo upload accepts PNG/JPG up to 3 MB, reads via `FileReader`, and POSTs base64 to `/api/invoices/:id/proof-of-delivery`. Migration `add_proof_of_delivery_to_invoices.sql` adds the required columns with `IF NOT EXISTS` guards.

**Step 18 — Customer receives emailed invoice after delivery confirmation** `[FAIL]`<br>
The `depart` handler in `stops.js` fires `sendInvoiceEmail` non-fatally, but with two critical bugs:

1. **Email only fires `if (stop.customer_id)`** — stops created from orders via the batch-add flow or created without an explicit customer link will have no `customer_id`, silently skipping the email.
2. **Wrong invoice may be selected** — the lookup fetches the most recent order for that `customer_id`, not the invoice tied to *this specific stop*. A customer with multiple open orders will receive the invoice for the wrong order.

**Step 19 — Admin dashboard updates invoice status to "Delivered" without manual refresh** `[NEEDS REVIEW]`<br>
Two separate issues:

- **Auto-refresh:** `useDashboard.ts` sets `refetchInterval: 15_000` on deliveries, routes, drivers, and stats queries. The dashboard will reflect state changes within ~15 seconds without any manual action. ✓
- **"Delivered" status:** The `depart` handler marks the *stop* as `completed` but **does not update the invoice status**. The deliveries route maps `delivered → invoiced` on orders, not invoices. No code path transitions an invoice status to `"Delivered"` after a stop is departed. The invoice will remain in its pre-delivery status (`pending`, `sent`, etc.) indefinitely.

**Flag (>2 taps from driver view):** Proof-of-delivery photo upload requires: tap "Upload Delivery Photo" → file picker opens (camera) → capture/select → confirm. This is 3–4 taps depending on OS camera flow, exceeding the 2-tap threshold flagged in the QA spec.

---

## FINAL SUMMARY

### FAIL Items

| # | Step | Issue | Recommended Fix |
|---|------|-------|-----------------|
| 18a | Email on delivery — silent skip | Email fires only when `stop.customer_id` is set; stops without it never trigger email | Fallback: look up invoice via `stop.invoice_id` directly instead of traversing `customer_id → order → invoice` |
| 18b | Email on delivery — wrong invoice | Fetches most-recent order for customer, not the stop's linked invoice | Replace query with `supabase.from('invoices').select('*').eq('id', stop.invoice_id)` |

### NEEDS REVIEW Items

| # | Step | Issue | Recommended Fix |
|---|------|-------|-----------------|
| T2-Flag | Invoice printable before weights finalized | Invoice created at first weight save with `estimated_weight_pending: true`; printable immediately | Disable / warn on print action when `estimated_weight_pending` is true |
| 11 | Route optimization — no GPS coordinates | Optimizer receives text addresses only; no lat/lng used for true geo-sequencing | Geocode stop addresses (e.g., Google Maps API) before passing to optimizer, or sort by zip code as fallback |
| T3-Flag | Driver assignment not linked to user accounts | `driver` field is a free-text string; no FK to users; "Suggest Assignments" doesn't auto-apply | Add `driver_user_id` FK column; wire Suggest Assignments to apply assignments with one click |
| 15 | Driver notes go on stops, not invoices | `driver_notes` saved to stops table only; not visible on invoice in admin/billing views | Sync `driver_notes` from stop to linked invoice `notes` field on save, or add driver-notes field to invoice |
| 19b | Invoice status never reaches "Delivered" | No code path updates invoice status to "Delivered" after stop departure | In the `depart` handler, after stop is completed, patch linked invoice status to `'delivered'` |
| T4-Flag | POD photo upload exceeds 2-tap threshold | 3–4 taps required to complete photo POD capture | Pre-open camera picker on "Mark Arrived" for stops with `invoice_id`; or combine "Depart" and "Upload Photo" into one action |

---

*Report generated by automated QA agent — 2026-05-08*
