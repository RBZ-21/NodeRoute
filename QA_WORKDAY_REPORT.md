# NodeRoute — Simulated Daily Workflow QA Report

**Tester:** Claude (senior QA / UX audit, simulated dispatcher workday)
**Target:** https://noderoutesystems.com (live production)
**Account:** SUPERADMIN (admin@noderoutesystems.com)
**Date of run:** 2026-06-09
**Method:** Browser automation (Chrome MCP), real actions authorized by owner.

Legend: ✅ Pass | ⚠️ Warning | ❌ Fail

---

## EXECUTIVE SUMMARY

Ran a full simulated dispatcher workday against the live app as SUPERADMIN. The **core happy path works**: creating orders, editing them, building a route, adding/removing stops, AI route optimization, dispatching, and PDF generation are all functional and the UX is mostly sensible. However, several **production-blocking defects** surface the moment you go past the happy path — most of them share one root pattern: **an API returns an error (usually HTTP 500) and the UI silently swallows it, leaving the on-screen state inconsistent with the database.**

### 🚩 Production blockers (fix before real use)
1. **Emailing invoices is broken.** `POST /api/invoices/{id}/resend` → **500**; **no email is delivered** (confirmed empty inbox) and **no error is shown** to the user. Likely a mailer credential/exception (handler would return 503 if simply unconfigured). [Phase 8]
2. **Order delete is broken-looking and inconsistent.** `DELETE /api/orders/{id}` is slow/returns **500**, shows **no feedback**, and **the list never refreshes** — yet the row **is hard-deleted in the DB**. UI state diverges from reality; no undo/trash. Probable FK issue in stop teardown ([orders.js:644](backend/routes/orders.js:644)). [Phase 3]
3. **No duplicate-order detection.** Identical orders are accepted silently. [Phase 2]
4. **Invoice ↔ Order status desync.** Marking an invoice "Delivered" leaves the order `in_process`. [Phase 7]

### ⚠️ High-impact gaps / UX issues
- **Silent-failure pattern everywhere:** 500s on delete/resend produce no toast; stale lists don't refresh. Users can't tell success from failure.
- **No notification/alert center** on the dashboard; **misleading empty-state KPIs** (0% on-time in red, driver at 100% with 0 activity). [Phase 1]
- **Order form missing core fields:** no priority/rush, no heavy/freight flag, **no scheduled date / delivery window** at all. Everything goes into free-text Notes. [Phase 2]
- **Route "Map" button is broken** — opens Google Maps searching the route *name*, not the stops. In-app map is live-GPS-only. [Phase 5]
- **No manual stop reordering** (no drag-drop, no editable stop numbers) — reordering is only via AI Optimize. **No vehicle assignment**, **no route date**. [Phase 5]
- **In-process orders can't be added to a route** (batch list is pending-only). [Phase 5]
- **No bulk remove** of stops; **"Apply Bulk Status"** appears to fire nothing. [Phase 3/6]
- **Native `confirm()` dialogs** used for destructive actions (delete/remove) — jarring and they froze automated tooling. Recommend in-app modals. [Phase 3/6]
- **Printing/branding:** no printer config (relies on OS print + server PDF — reasonable), but **Business Name/logo unset**, so invoice branding is likely blank. [Phase 4/8]

### ✅ What works well
- Order create + inline field validation (clear, verbatim required-field messages); live KPI counters; numeric inputs reject letters.
- Edit/save/cancel with verified persistence; weight-based ("Catch Weight") order handling with auto "Weight Pending" + "Enter Weights".
- Route creation, driver assignment, batch-add with dynamic "Add N Stops" button, clean stop removal, empty routes persist.
- **AI features** are genuinely useful: AI route optimization with natural-language rationale, AI driver assignment, pricing-anomaly + AR-risk scanners.
- Server-side **PDF generation** (verified 81 KB valid PDF); CSRF protection working; token auto-refresh (401→refresh→retry) working.

### Couldn't fully verify (environment/account limits)
- Driver-facing view & real-time GPS sync (needs a driver login + device GPS; superadmin is redirected from `/driver`).
- Whether dispatch actually sent a driver notification (server-side Twilio, not observable; errors swallowed).
- Visual inspection of the invoice PDF layout (downloads rather than rendering inline).

### Test data cleanup (live system)
Cleaned up at end of run:
- ✅ Deleted route **"Test Route - Morning QA"** (route deletion works cleanly, unlike order deletion).
- ✅ Deleted orders **ORD-845203, ORD-889744** (and earlier ORD-014544, ORD-054105) — confirmed removed server-side.
- ⚠️ **Left in place: ORD-701482 (Test Company A) + invoice INV-885592 (delivered, $75).** Kept intentionally because deleting the order would orphan a delivered invoice. **Recommend the owner void INV-885592 then remove ORD-701482** if full cleanup is desired — I avoided voiding a billing record without explicit per-action confirmation.
- Note: customer email on ORD-701482/INV-885592 was changed to ryandb21@gmail.com during the Phase 8 email test.

---

## PHASE 1 — Login & Daily Setup

| # | Action | Result | Notes |
|---|--------|--------|-------|
| 1 | Log in as superadmin | ⚠️ | A session was **already persisted**. Clicking "Login" on the marketing site went **straight into the dashboard** as SUPERADMIN — **no email/password form was presented**, so the credential-entry/login-validation flow could not be exercised this run. Security note: a persisted superadmin session means anyone with this browser profile lands in full admin with no re-auth. |
| 2 | Note dashboard landing state | ✅ | Dashboard renders KPI cards (Total Deliveries, On-Time Rate, Active Drivers, Failed), Operational Snapshot, Driver Leaderboard, Weight Entry Queue, and quick-action buttons (Refresh Dashboard, Orders Queue, Route Workspace). |
| 3 | Check daily summary / alerts | ❌ (missing) | **No notification center / bell icon / unread-alert UI in the header.** Header contains only: theme toggle, "SUPERADMIN" label, Logout. No daily summary notifications surface anywhere on landing. |
| 4 | Is landing useful for starting a workday? | ✅ w/ caveats | Layout is sensible and gives an at-a-glance ops view. Caveats below. |

### Landing state details (empty / early-stage account)
- Total Deliveries **0**, On-Time Rate **0%** (shown in red), Active Drivers **0 / 1**, Failed Deliveries **0**.
- Operational Snapshot: Avg Stop Duration 0.0 min, Avg Speed **2.6 mph**, Completed Today 0, Open Deliveries 0.
- Fleet Summary: Fleet miles 0.0, Completed stops 0, Active vehicles **0 of 1**, Routes in motion 0.
- Driver Leaderboard: **#1 Ryan — 100.0%** (0.0 stops/hr · 2.6 mph · 0.0 min avg stop).
- Weight Entry Queue: empty ("No weight queue yet").
- ✅ Confirms **1 driver (Ryan)** and **1 vehicle** already exist in the system — useful for Phase 5 route assignment.

### Warnings
- ⚠️ "Loading dashboard…" banner displayed for several seconds on first paint before resolving; perceived as slow.
- ⚠️ **Misleading empty-state metrics:** On-Time Rate shows **0%** (red, looks like a failure) when there is simply *no data*. Driver Leaderboard shows Ryan at **100.0%** on-time despite **0 stops/0 activity** — internally inconsistent with the 0% on-time KPI.
- ⚠️ No "daily summary" or unread-alert concept exists; a dispatcher starting the day has no surfaced to-do/exceptions feed.

---

## PHASE 2 — Create 5 Mock Orders

**Form structure note (important):** The order form is **seafood/wholesale-oriented**. Fields: Customer Name, Delivery Type (Delivery/Pickup), Assign to Route, Customer Email, Customer Address (single field), Notes, Tax Enabled/Rate, Fuel %, Service %/Min $, and catch-weight line items (Product, Item #, Unit lb/each, CW toggle, Qty/Est. Wt, Unit Price/$/lb, Line Total, Notes, Lot). It supports FSMA-204 lot assignment for FTL-flagged products.

**Missing order-form capabilities (affect Orders 2–4):**
- ❌ **No priority / rush flag.**
- ❌ **No heavy / freight / large flag.**
- ❌ **No scheduled date or delivery-window field of any kind** — orders cannot be scheduled for a date/time; "deliver by X" can only go in free-text Notes.
- ❌ **No phone field** and **no dedicated ZIP field** (address is one free-text line, no format validation/autocomplete).

| Order | What | Order # | Result | Notes |
|-------|------|---------|--------|-------|
| 1 | Standard — Test Company A, 3× Standard Box @ $25 | **ORD-701482** | ✅ | "Order created." confirmation; appears in list instantly; total $75.00. |
| 2 | Large/Heavy — Test Company B, Frozen Tuna Pallet 500 lb @ $8/lb; heavy noted in Notes | **ORD-845203** | ✅ ⚠️ | $4,000.00. Auto-flagged **"⚠️ Weight Pending"** with an **"Enter Weights"** action (nice). Heavy/freight only expressible via Notes. |
| 3 | Rush/Priority — Test Company C, 2× Express Cooler @ $40 | **ORD-889744** | ✅ | $80.00. Rush/window only expressible via Notes (no field). |
| 4 | Edge case (invalid) → then valid — Test Company D | **ORD-014544** | ✅ | See validation results below; saved a valid version ($60.00). |
| 5 | Duplicate of Order 1 — Test Company A identical | **ORD-054105** | ⚠️ | Created with **no duplicate warning** — identical customer/address/items to ORD-701482 accepted silently. |

### Per-order checks
- **Save confirmation:** ✅ Every successful create shows a green **"Order created."** banner.
- **Appears in list immediately:** ✅ Each order appears at top of Orders Workbench instantly; KPI counters (Orders / Pending / Total Pipeline Value) update live.
- **Autofill / address validation / smart suggestions:** ❌ None. Address is free text, no autocomplete, no geocoding/validation at entry. (A "Browse Inventory" picker exists for products, and a "Pricing Anomaly Detection" scan exists — but no address intelligence.)

### Edge-case (Order 4) validation results
- **Blank required fields:** ✅ Submitting empty form blocked creation and showed inline messages, verbatim:
  - Banner: **"Fix the highlighted fields before saving."**
  - **"Customer name is required."**
  - **"Customer email is required."**
  - **"Customer address is required for delivery orders."**
  - **"Add at least one order item with quantity greater than 0."**
- **Letters in numeric fields:** ✅ Typing `abc12x` into the Qty field resulted in `12` — `type=number` inputs silently strip non-digits (native browser behavior; no explicit error shown).
- **Past date in scheduling field:** N/A — ❌ there is **no date/scheduling field** to test.

### Phase 2 warnings
- ⚠️ **No duplicate detection** (Order 5). Two identical Test Company A orders coexist.
- ⚠️ Line priced as **"lb"** with no Est. Wt silently yields **$0.00 line total** with no warning (caught during Order 1; switching to "each" fixed it).
- ⚠️ Heavy/freight, rush/priority, and delivery scheduling all collapse into a single free-text Notes field — not queryable/sortable.

---

## PHASE 3 — Order Management

### View & Edit — ✅ PASS
- "Edit Order" loads the order **in place** into the top form; header changes to "Editing ORD-XXXXXX"; buttons become **Update Draft Order / Update + Send to Processing / Cancel Edit**.
- Edited 2 fields on **ORD-701482**: address `145 Market Street…` → `999 Updated Pier Avenue, Charleston, SC 29412`; notes `Leave at dock door` → `EDITED: Leave at side gate, call on arrival`.
- ✅ "Order updated." confirmation shown. ✅ **Persistence verified** by re-opening the order (both new values present).
- ✅ Clear edit/save/cancel flow. Minor ⚠️: edit form is the same panel at the top of the page, so on a long list you may not notice you're in edit mode unless you scroll up.

### Delete Orders — ❌ FAIL (deletes the record, but the request errors and the UI never updates)
This one is subtle and was confirmed by inspecting the server, not just the UI.
- **Confirmation:** ✅ A confirmation step exists, but it's a **native browser `window.confirm()`** dialog, text **"Delete this order?"** (verbatim). Native dialogs are unstyled and actually **hung the test automation** — recommend an in-app modal.
- **What the user sees:** ❌ After confirming, **nothing visibly happens** — the order stays in the list, there is **no success or error toast**, and the list does **not auto-refresh**. A dispatcher would reasonably think the delete failed and may click again.
- **What actually happens (verified):** The record **IS hard-deleted server-side.** A direct `GET /api/orders` after the action returned **3 orders, with the "deleted" order absent** — while the on-screen list still showed it. So **UI state is stale / inconsistent with the database.**
- **The request itself misbehaves:** `DELETE /api/orders/{id}` is **very slow** (observed hanging "pending" for 10s+) and on two runs returned **HTTP 500** (after a correct 401→`/auth/refresh`→retry token cycle). So the backend deletes the row but the response is slow and/or errors.
- **Net effect:** Data loss happens correctly, but the client is told it failed (500 / no success), the list isn't refreshed, and there is **no trash/archive/undo** — deletion is a **hard, irreversible delete**.
- Reproduced on **ORD-054105** (Order 5) and **ORD-014544** (Order 4); both confirmed gone from the DB. Remaining orders: ORD-889744, ORD-845203, ORD-701482.

**Probable root cause (from repo):** the DELETE handler [orders.js:1185](backend/routes/orders.js:1185) calls `syncOrderStop(existing, req, true)` ([orders.js:644](backend/routes/orders.js:644)) which **deletes the linked delivery stop ([line 653](backend/routes/orders.js:653)) while `orders.stop_id` still references it**, then deletes the order. A FK/constraint interaction here is the likely source of both the latency and the 500 even though the row ends up deleted. (Hypothesis from code read; recommend nulling `orders.stop_id` before deleting the stop, or `ON DELETE SET NULL`, and returning a proper success/refresh to the client.)
- Note: a custom-header CSRF guard is present and working — a hand-rolled `fetch` DELETE without the app's CSRF token correctly returns **403 `{"error":"Invalid CSRF token"}`**. ✅
- Environment note: heavy automation against the live tab intermittently wedged the Chrome tab (assets stuck "pending") while the server stayed healthy (direct `curl` of the same URLs returned 200 in <1s). Recovered by opening a fresh tab. Not an app defect.

### Process / Status Transitions — ⚠️ PARTIAL
- **Status model:** the actual order statuses are **Pending → In Process → Delivered → Invoiced**, plus **Cancelled**. ❌ The workflow steps named in the test plan — **"Confirmed", "In Progress/Dispatched", "Complete"** — **do not exist** as discrete order statuses. "Dispatch" is a *route* concept (Phase 7), not an order status.
- **Advance via row action:** ✅ "Send to Processing" on ORD-701482 moved Pending → In Process (`POST /api/orders/{id}/send` → **200**). After it, the row's actions change to **Edit Order / Resend Invoice Email / Quick Fulfill / Delete Order**, i.e. an **invoice draft is auto-created** and a tracking token is generated (confirmed in backend code).
- **Triggers fire on transition:** ✅ Send-to-Processing creates/updates a processing invoice + tracking URL; Mark-as-Delivered triggers a delivery/invoice email (exercised in Phases 7–8).
- **Skip steps / reverse a step:** The **bulk-status control** (per-row checkbox + Pending/In Process/Delivered/Invoiced/Cancelled dropdown + "Apply Bulk Status") is the only UI for arbitrary transitions. In testing, with "1 selected" and the dropdown set to Pending, **clicking "Apply Bulk Status" fired no network request and did not change the status** (verified server-side: still `in_process`). ⚠️ **Bulk status appears non-functional / has a selection-state bug** — recommend manual verification. (Row-level actions are the working path.)
- **Timestamps / audit trail:** ❌ Status changes are **not surfaced with timestamps** in the Orders view — only the order **Created** date is shown. No visible per-order status history/audit log for the dispatcher.
- ❌ A jarring UX detail: the per-row **checkbox does not respond to a normal click** in testing (only a synthetic DOM click registered) — worth a manual check that selection works for real users.

---

## PHASE 4 — Printer Connection / Print Flow

**Headline:** There is **no printer concept in the product.** Printing is the browser's job (`window.print()`) plus **server-generated PDFs**. This is fine for a web app, but it means several test-plan items (connect printer, test print, printer types) **do not apply**.

| Step | Result | Notes |
|------|--------|-------|
| Locate printer configuration | ❌ none | Settings (`/settings`) has Profile, Security, Company Controls (business name, **invoice logo**, order cutoff, driver-signature, POD photo) — **no printer section**. Integrations (`/integrations`) is **gated to `admin` role and redirected the superadmin to the dashboard**; per code its only integrations are Stripe, QuickBooks, Supabase, Email (SMTP), PDF Service — **no printer integration**. |
| Printer types supported (network/USB/thermal/Wi-Fi) | ❌ N/A | None. Whatever printers exist are whatever the **OS print dialog** exposes. No thermal/label-printer awareness. |
| Connect / configure a printer | ❌ N/A | No such feature. |
| Test print option | ❌ none | No test-print anywhere. |
| Print Order summary / packing slip | ✅ | Orders and the Weight-Entry modal build an HTML doc and call **`window.print()`** (native OS print dialog → choose printer **or** "Save as PDF"). |
| Print Delivery label | ❌ missing | No dedicated delivery-label print found in the app. |
| Print Route sheet | ❌ missing | No dedicated route-sheet print found. |
| Print invoice → PDF | ✅ | Invoice drawer "**Print / Save PDF**" triggers `window.print()`. Server PDF endpoint verified: `GET /api/invoices/{id}/pdf` → **HTTP 200, `application/pdf`, 81,454 bytes** for INV-885592. PO PDFs via `/api/purchase-orders/{id}/pdf`. |
| "No printer connected" error/fallback | N/A | There is no in-app printer status; the OS dialog is the only surface. |
| Print-to-PDF alternative | ✅ | Built in — the same OS dialog's "Save as PDF", plus the server PDF endpoint. |

### Phase 4 notes
- ✅ Good safeguard: invoice **Print is locked while weight-based items are still estimated** ("Finish final weight entry before creating a customer-facing PDF").
- ⚠️ `window.print()` opens a **blocking native dialog** (it actually froze the automation). For humans it's normal, but there's no in-app print preview — output styling depends entirely on print CSS.
- ❌ No first-time print setup guidance (nothing to set up).

---

## PHASE 5 — Add Orders to a Route

| Step | Result | Notes |
|------|--------|-------|
| Create route | ✅ | Created **"Test Route - Morning QA"** (the plan's "Test Route - Morning" already existed). Banner: "…created." |
| Route Name | ✅ | Accepted. |
| Date = today | ❌ N/A | **Route creation has NO date field.** Routes are templates (Name + Driver + Notes only). |
| Assign driver | ✅ | Driver is a free-text typeahead; entered "Ryan" → saved, shown as **"Linked to user account: ryandb21@gmail.com."** AI Driver Assignments ("Suggest Assignments") also available. |
| Assign vehicle | ❌ N/A | **No vehicle assignment exists** on routes (despite the dashboard tracking "Active vehicles 0 of 1"). |
| Add Orders 1, 2, 3 | ⚠️ partial | Used **"Batch Add from Pending Orders"** → added Orders 2 (ORD-845203) & 3 (ORD-889744): "2 stops added." ✅ **Order 1 (ORD-701482) could NOT be added** — the batch list shows **only *pending* orders**, and Order 1 is `in_process`, so it's silently excluded. ❌ No way in the route editor to add an in-process order to a route. |
| Drag-and-drop stop reorder | ❌ missing | No draggable stop rows (`draggable` count = 0). |
| Manual stop-number editing | ❌ missing | No editable stop-number inputs. The "#" column is static. |
| Optimize the route | ✅ | "❆ Optimize" → `POST /api/ai/optimize-route` → **200**. Returns an **AI "Optimized Stop Order"** with a natural-language rationale ("…Charleston (King Street) is generally on the way to Mount Pleasant… Estimated efficiency gain: Minimal…"). Reordering is **only** possible via this AI optimize — there is no manual reordering at all. |
| Save & confirm stops | ✅ | Stops persist immediately on add; route row shows **"2 stops"**; editor shows both stops with addresses + linked Order #. |

### Map rendering — ❌/⚠️
- Per-route **"Map" button** ❌ opens **Google Maps searching for the literal route *name*** (`google.com/maps/search/Test+Route+-+Morning+QA`) — it does **not** plot the stop addresses. Effectively broken for visualizing a route.
- In-app **/map** ⚠️ is a **live-tracking-only** view ("Live map waiting on route movement… No dispatched drivers are live right now"). It does not render *planned* stops; needs a dispatched driver sending GPS. (Re-checked in Phase 7.) It does report "Stops with coordinates: 43" system-wide.

### Phase 5 questions answered
- **Is adding orders to a route intuitive?** Mostly — the batch-add with a live "Add N Stops to Route" button is good. But the **pending-only filter is a trap** (you can't route an order you've already sent to processing).
- **Can you add the same order to two routes? Does the system prevent it?** Within the **same** route, an order already represented is **hidden** from the batch list (prevents duplicates on that route ✅). Across **two different** routes, the batch list is per-route, so the same order could appear on another route's list — **no global guard observed** (couldn't fully exercise because the only add path excludes non-pending orders). ⚠️ worth a dedicated test.
- **Does the map render correctly with all stops?** ❌ No — see Map rendering above.

---

## PHASE 6 — Remove Orders from a Route

| Step | Result | Notes |
|------|--------|-------|
| Remove Order 3 (ORD-889744) | ✅ | Native confirm with a **descriptive message**: `Remove stop "Test Company C" from route "Test Route - Morning QA"?`. After accept, stop count went 2 → 1. |
| Order still exists as unassigned | ✅ | ORD-889744 remained a **pending** order and reappeared in the route's "Batch Add from Pending Orders" list. Clean removal, no orphaned order. |
| Bulk remove all at once | ❌ missing | **No bulk-remove control.** Only an individual "Remove" per stop. Must remove stops one at a time. |
| Empty-route behavior | ✅ | Removed the last stop → route shows **"0 stop(s)"** and **still exists** (status pending). Empty routes are **not auto-deleted**; they persist (route is a reusable template). |
| Re-add Order 3 to restore | ✅ | Selected ORD-889744 in batch list → "Add 1 Stop to Route" → "1 stop added." Restored. |
| Clean removal / orphans / map artifacts | ✅ | Stop counts update correctly and the underlying order is preserved (not deleted). No orphaned records observed. (Map artifacts N/A — the map doesn't render planned stops anyway.) |

**Net:** Removal is clean and reversible at the route level (unlike order *deletion*). Native `confirm()` again (consistent pattern — recommend in-app modals). Missing **bulk remove**.

---

## PHASE 7 — Dispatch & Driver Notifications

| Step | Result | Notes |
|------|--------|-------|
| Mark route dispatched | ✅ | "Dispatch Route" on Test Route - Morning QA → `PATCH /api/routes/{id}` → **200**; row flips to "Cancel Dispatch". |
| Driver notification sent? | ⚠️ unverifiable / silent | Backend **does** call `deliveryNotifications.notifyRouteDispatched(...)` on dispatch ([routes.js:257](backend/routes/routes.js:257)), but errors are **swallowed** (`.catch(()=>{})`) and there is **no in-app confirmation** ("driver notified") and no client-side call to observe. Can't confirm a notification actually went out. |
| No-driver dispatch guard | ✅ (in code) | Backend blocks dispatch without a driver: **"Assign a driver before dispatching this route."** ([routes.js:215](backend/routes/routes.js:215)). ⚠️ Note: existing route "Front Side" shows **Active/dispatched while Unassigned**, which contradicts the guard (possibly dispatched before the guard, or guard only fires on transition). |
| Driver-facing view | ❌ not viewable from this account | Driver workspace is at **`/driver`** (`DriverPage`, uses `/api/driver/routes`, GPS via `PATCH /api/driver/location`). Navigating there as the **superadmin redirects to the dashboard** — it's gated to the driver user. The route's driver "Ryan" is linked to **ryandb21@gmail.com**, a different account, so I could not verify the driver perspective without logging in as the driver. |
| Verify route/stops from driver perspective | ❌ blocked | Same reason as above. |
| Simulate stop completion / mark delivered | ⚠️ partial | Marked the invoice **Delivered** (`PATCH /api/invoices/{id}` → 200; invoice status → `delivered`). **BUT the linked order ORD-701482 stayed `in_process`** — invoice and order statuses are **out of sync**. ❌ Marking an invoice delivered does **not** propagate to the order/stop. |
| Real-time dispatcher↔driver sync | ⚠️ unverifiable | Architecture supports it (driver GPS `PATCH /api/driver/location` → Live Map). With no live driver session/GPS, the Live Map stayed "waiting on route movement"; "Routes in motion: 0" even after dispatch. Couldn't exercise real-time sync from the dispatcher account. |

### Phase 7 answers
- **Real-time sync between driver and dispatcher?** Designed-for (GPS sharing + Live Map) but **not demonstrable** without a driver login + device GPS; nothing live appeared after dispatch.
- **What happens if no driver assigned when dispatching?** Backend rejects it with **"Assign a driver before dispatching this route."** (good) — though the "Front Side" route's Unassigned+Active state is a possible inconsistency to investigate.

---

## PHASE 8 — Email Invoice

| Step | Result | Notes |
|------|--------|-------|
| Invoice auto-generated after send-to-processing | ✅ | **INV-885592** created automatically when Order 1 was sent to processing (status Pending → Delivered after the Phase 7 action). |
| Manually generate invoice | N/A | Auto-generated; no manual step needed. |
| Set recipient to ryandb21@gmail.com | ⚠️ indirect | **No email-entry field exists** in the send flow. I changed it by **editing Order 1's customer email** to ryandb21@gmail.com; this **propagated to the invoice** (`invoice.customer_email = ryandb21@gmail.com`, verified). |
| Send / email the invoice | ❌ **FAIL** | "Resend Email" → `POST /api/invoices/{id}/resend` → **500 Internal Server Error**. **No email was delivered** — verified by checking the ryandb21@gmail.com inbox (Gmail): **no NodeRoute/invoice message arrived** today. |
| Success/failure message | ❌ none | The 500 produced **no error toast** in the UI — silent failure (consistent pattern across the app). |
| SMTP/email configured? | ⚠️ partial | The resend handler returns **503 "Email not configured"** when no mailer exists, but we got a **500 (thrown exception)** → a mailer **is** configured (SMTP or Resend) but the send **throws** (credential rejection / unhandled error). Email service: [services/email.js](backend/services/email.js), handler [invoices.js:394](backend/routes/invoices.js:394). |
| Email preview before sending | ❌ none | No preview UI — "Resend Email" fires immediately. |
| Resend a previously sent invoice | ❌ fails the same way | "Resend Email" is exactly what 500'd. |
| Download invoice as PDF | ✅ | `GET /api/invoices/{id}/pdf` → **200, application/pdf, 81,454 bytes**. "Print / Save PDF" works (native print dialog). |
| Sent-invoice history / status | ✅ partial | Invoices carry a **status** (Pending / Sent / Delivered / Paid / Overdue / Voided) and a "Delivered Invoices" archive section — so there's a coarse sent/lifecycle trail, but **no per-send log** (timestamps of each email attempt, success/bounce). |

### Invoice layout / branding
- ⚠️ The PDF is substantial (81 KB) so the document renders, but **company branding looks unset**: Settings → Company Controls **Business Name was empty** ("—") and no invoice logo, and the dashboard Company shows "—". Invoices/emails that key off "Business Name shown at the top of invoices" likely show **placeholder/blank branding**. (Could not visually inspect the PDF — it downloads rather than rendering inline.)

### Phase 8 bottom line
**Emailing invoices is broken** (HTTP 500, nothing delivered, no error surfaced). PDF generation/download works. This is arguably the most important production blocker found, alongside the delete UX.
