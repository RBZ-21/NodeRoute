# Credit Hold — Frontend Spec (frontend-v2 + driver-app)

This document tells a frontend implementer exactly what to build on top of the
new `/api/credit/*` endpoints. Backend is live; copy/wire only.

## Shared API client

Add a typed helper at `frontend-v2/src/api/credit.ts`:

```ts
export type CreditStatus = {
  customer_id: number;
  company_name: string;
  credit_limit: number | null;        // null = unlimited
  current_balance: number;
  available_credit: number | null;
  credit_status: 'good' | 'warning' | 'hold' | 'suspended' | 'prepay_only';
  on_hold: boolean;
  hold_reason: string | null;
  hold_placed_at: string | null;
  hold_notes: string | null;
  auto_hold_enabled: boolean;
  warning_threshold_pct: number;
  credit_terms: string;
  avg_days_to_pay: number;
  last_payment_date: string | null;
  last_payment_amount: number | null;
  oldest_unpaid_invoice_date: string | null;
  days_past_due: number;
  days_until_next_invoice_due: number | null;
  should_be_on_hold: boolean;
};

export const creditApi = {
  status: (id: number) => http.get<CreditStatus>(`/api/credit/customer/${id}/status`),
  history: (id: number, limit = 50, offset = 0) =>
    http.get(`/api/credit/customer/${id}/history?limit=${limit}&offset=${offset}`),
  placeHold: (id: number, body: { reason: string; notes?: string }) =>
    http.post(`/api/credit/customer/${id}/hold`, body),
  releaseHold: (id: number, body: { notes: string }) =>
    http.post(`/api/credit/customer/${id}/release`, body),
  override: (id: number, body: { order_id: string; reason: string; expires_at?: string }) =>
    http.post(`/api/credit/customer/${id}/override`, body),
  updateSettings: (id: number, body: Partial<{
    credit_limit: number | null;
    credit_terms: string;
    warning_threshold_pct: number;
    auto_hold_enabled: boolean;
  }>) => http.patch(`/api/credit/customer/${id}/settings`, body),
  activeHolds: () => http.get(`/api/credit/holds/active`),
  dashboard: () => http.get(`/api/credit/dashboard`),
  overrides: () => http.get(`/api/credit/overrides`),
  runCheck: () => http.post(`/api/credit/run-check`, {}),
};
```

The order-creation flow already returns `credit_warning` / `credit_message` /
`available_credit` on the POST `/api/orders` response (200). When the order is
blocked the response is HTTP **402** with shape:
```
{ success: false, error: 'credit_hold', code: 'CUSTOMER_CREDIT_HOLD',
  message, details: { customer_id, customer_name, reason, hold_reason,
    current_balance, order_total, projected_balance, credit_limit,
    over_by, oldest_past_due_days, contact } }
```
The frontend axios/fetch wrapper must NOT throw on 402 — surface it as a
domain error so the order-entry screen can render the blocking banner.

---

## 7A. Order Entry — Live Credit Banner

**File:** `frontend-v2/src/features/orders/OrderEntryCreditBanner.tsx`

**Mount:** above the order line-items table in the order-create / order-edit
screens. Recomputes on customer change and on item add/remove (debounce 400 ms).

**State:** `useQuery(['credit-status', customerId], …)` — refetch on focus.

**Three visual states (color-coded, accessible — never color-only):**

| state    | bg/border          | icon | header                 | sub-text                                          |
|----------|--------------------|------|------------------------|---------------------------------------------------|
| good     | green-50 / green-200 | ✓   | Good Standing          | `$${available_credit} available credit`           |
| warning  | amber-50 / amber-300 | ⚠   | Near Credit Limit      | `Only $${available_credit} remaining of $${limit}` |
| hold     | rose-50  / rose-400  | ⛔  | ON CREDIT HOLD         | `Order cannot be placed. ${hold_reason}.`         |

**Manager affordance:** when `user.role` is `admin`|`manager` and state is
`hold`, render `<button>Override Hold</button>` that opens
`<OverrideHoldModal/>` (below).

**Tiny enhancement worth doing:** project the running order total against
`available_credit` and switch from green → amber when `subtotal > 0.8 * available`.
The same `estimateOrderTotal` math the backend uses applies here too.

---

## OverrideHoldModal

**File:** `frontend-v2/src/features/credit/OverrideHoldModal.tsx`

Fields (all required where noted):
- `reason` — `<textarea>`, **required**, min 10 chars, max 500. Helper text:
  "Required for audit. Why is this order being allowed?"
- `expires_at` — optional `<input type="datetime-local">`. Helper text:
  "Leave blank for one-time override on this order only."
- Read-only summary: customer name, current balance, credit limit, over-by.

Submit calls `creditApi.override(customerId, { order_id, reason, expires_at })`.
The order-create form then **re-submits the order** — the second POST sees the
fresh override and lands as a normal order. On the success toast: "Override
recorded. Order placed."

**Empty-reason guard:** submit is disabled until reason has ≥10 non-whitespace
chars. The server also rejects empty strings (defense in depth).

---

## 7B. Customer Profile — Credit Tab

**File:** `frontend-v2/src/features/customers/CustomerCreditTab.tsx`

Layout (two columns on `md+`, stacked on `sm`):

**Left column — Snapshot**
- Status pill (good/warning/hold) — same color spec as banner
- `<EditableMoney>` Credit Limit (calls `updateSettings` on commit)
- Current Balance (read-only)
- Available Credit (computed)
- `<TermsDropdown>` `COD | NET7 | NET14 | NET21 | NET30 | NET45 | NET60 | NET90 | PREPAY`
- `<Slider min=50 max=100 step=5>` Warning threshold % (calls `updateSettings`)
- `<Switch>` Auto-hold enabled
- Stat card: "Avg days to pay: N"
- Stat card: "Last payment: $X on YYYY-MM-DD"

**Right column — Actions + Timeline**
- If `on_hold`: `<button variant=primary>Release Hold</button>` → modal requiring `notes`
- If `!on_hold`: `<button variant=secondary>Place on Hold</button>` → modal with `reason` dropdown + `notes`
- `<CreditHistoryTimeline events={history.events} />` — virtualized list, newest first.
  Each row: icon (placed/released/override/warning/limit_changed), event label,
  who, when (relative + absolute on hover), notes.

Roles: a sales rep sees the tab **read-only** — buttons and inputs disabled,
no calls to mutating endpoints.

---

## 7C. AR Dashboard (`/ar`)

**File:** `frontend-v2/src/pages/ArDashboard.tsx`. Route already added to
the SPA list in server.js.

Sections, top to bottom:

1. **Stat cards (4 across, wraps to 2 on sm):** consume `creditApi.dashboard()`:
   - Customers on Hold
   - Customers in Warning
   - Total Past Due
   - Active Overrides (red badge if `overrides_pending_review > 0`)

2. **AR Aging Buckets** — bar chart over `/api/reporting/ar-aging.buckets`.
   Recharts or Chart.js, doesn't matter. Buckets: Current, 1-30, 31-60, 61-90, 90+.
   Each bar clickable → filters the table below.

3. **Active Holds Table** from `creditApi.activeHolds()`:
   columns: Company, Balance, Limit, Over by, Days on Hold, Reason, Sales Rep, Actions
   actions per row: [View], [Release] (manager only). Sort by `over_by desc` then `days_on_hold desc`.
   Export CSV button: `GET /api/reporting/ar-aging?format=csv`.

4. **Recent Overrides** (collapsed by default): rows from `creditApi.overrides()`,
   highlight rows where `is_stale = true`. Tooltip: "Older than 7 days — re-confirm or document outcome."

5. **Admin-only banner row at the top of the page** when any of these are true:
   `customers_on_hold > 25` OR `overrides_pending_review > 0`. Yellow background,
   no dismiss button — it goes away when the underlying number normalizes.

---

## 7D. Driver App — Delivery Screen Warning

**File:** `driver-app/src/screens/DeliveryStop.tsx` (or wherever the active-stop card lives)

When the driver opens a stop, the screen already loads the invoice. Add a
single fetch to `/api/credit/customer/${invoice.customer_id}/status` with a
short timeout (it MUST not block rendering — show the stop, layer the warning).

If `on_hold === true`:

- **Red sticky banner** at the top of the stop card:
  > ⚠️ CREDIT HOLD — Do not leave product without manager authorization.

- A blocking modal must appear before the driver can mark the stop delivered:
  > This customer is on credit hold (${hold_reason}). Confirm one of:
  > - [ ] Spoke to manager — authorized to deliver
  > - [ ] Product not delivered — leaving site
  > - [ ] Photo of refused delivery (camera input)
  >
  > `<input type=tel>` Manager contacted: (phone)
  > `<textarea>` Notes (required)
  >
  > [Submit] [Cancel]

  On submit, POST a note + photo to the existing `/api/invoices/:id/proof-of-delivery`
  with an extra `notes` field. Then continue the existing delivery flow.

- The Mark Delivered button stays disabled until that modal is acknowledged.

---

## Banner copy reference

| Reason             | Banner text                                                     |
|--------------------|------------------------------------------------------------------|
| `over_limit`       | "Account balance exceeds credit limit. Contact AR."             |
| `past_due`         | "Invoice past due. Customer must pay before next delivery."     |
| `manual`           | "Manually placed on hold by manager."                           |
| `new_account`      | "New account — credit not yet established."                     |
| `bounced_check`    | "Payment returned. Awaiting good funds."                        |
| `disputed_invoice` | "Disputed invoice on file. Resolve before next delivery."       |
| `would_exceed_limit` | "This order would exceed the customer's credit limit."        |

---

## Accessibility checklist

- All status colors are paired with a text label and an icon. Never color-alone.
- Banners use `role="status"` (warning) or `role="alert"` (hold).
- The override modal traps focus and closes on Esc.
- The credit history timeline is keyboard-navigable (rows are `<button>` or have `tabIndex=0`).
- Form errors announce via `aria-describedby`, not toast-only.
