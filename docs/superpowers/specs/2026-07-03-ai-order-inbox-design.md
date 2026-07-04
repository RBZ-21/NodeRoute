# AI Order Inbox — Design Spec

**Date:** 2026-07-03
**Status:** Approved (brainstorming session)
**Fast-follow:** Margin-Leak Report (separate spec after this ships)

## Goal

Make NodeRoute stand out to small distributors (vertical-agnostic) by eliminating
their biggest daily time-sink: manual order re-keying. Customers keep ordering the
way they always have — texting, calling, replying to the daily inventory blast —
and NodeRoute turns each message into a priced, review-ready draft order.

Flagship user story: a customer replies to the morning SMS blast with
"send 2 cs salmon and a box of shrimp, also need lemons." When the distributor
opens NodeRoute, a draft order is waiting in the Order Inbox: lines matched to
that customer's order guide, customer-specific pricing applied by the pricing
engine, "lemons" flagged as unmatched, one click to confirm. The customer gets an
automatic acknowledgment text.

## Scope (v1)

**In:**
- Inbound SMS channel (Twilio webhook) → AI-parsed draft orders.
- Context-aware parsing engine (order guides + inventory + pricing engine).
- Unified Order Inbox UI covering `sms` (new), `phone` (existing Bland voice
  webhook), and `paste` (existing OrderIntakeModal, rewired to the new engine).
- Templated auto-reply SMS on receipt and on confirm.
- New `order_intake_messages` table with tenant RLS.

**Out (deferred):**
- Email-in channel, MMS/photo parsing.
- Auto-confirm without human review.
- AI-generated free-text replies to customers.
- Customer portal changes.

## Architecture

### 1. Inbound SMS webhook — `backend/routes/webhooks/twilio-sms.js`

- Mounted alongside the existing Bland webhook (`backend/routes/webhooks/`).
- **Auth:** validate `X-Twilio-Signature` against the request; fail closed
  (mirror the Bland webhook's shared-secret posture).
- **Tenant resolution:** the Twilio `To` number (per-company number already used
  by the daily blast) maps to `company_id`. The `From` number is matched against
  `Customers` phone fields for that company.
- **Unknown senders:** still stored and shown in the inbox flagged
  "unknown sender" — never silently dropped.
- **Opt-out:** STOP/UNSUBSCRIBE keywords route to existing SMS opt-out handling,
  bypassing the parser.

### 2. Storage — `order_intake_messages`

New table (Supabase migration, RLS enabled + tenant policy in the same
migration, per Phase 1–8 convention):

- `id`, `company_id`, `location_id`, `channel` (`sms` | `phone` | `paste`),
  `from_address`, `to_address`, `body`, `matched_customer_id` (nullable),
  `parse_status` (`pending` | `parsed` | `failed` | `opt_out` | `unknown_sender`),
  `draft_order_id` (nullable FK to `orders`), timestamps.
- Automatically covered by the multi-tenant penetration test suite.

### 3. Parsing engine — `backend/services/order-intake-engine.js`

Replaces the generic `generateOrderIntakeDraft` path for all intake channels:

1. Load matched customer's active order guides (`loadGuides`), recent order
   history, and live company inventory.
2. AI call (existing `callAI` + JSON-schema pattern) receives the message plus
   catalog context; must return line items referencing **real product IDs** from
   the guide/catalog, per-line confidence (`high`/`medium`/`low`), and an
   `unmatched` bucket for unmappable requests.
3. Product IDs proposed by the AI are validated server-side against the scoped
   catalog; pricing is computed by the existing **pricing engine** (never the
   AI); stock levels checked and shortfalls flagged.
4. Draft saved as an `orders` row: `source: 'sms'` (or channel), `status:
   'draft'` — same shape the Bland phone flow produces today.
5. Heuristic fallback when no AI key is configured, so messages are still
   captured and listed.

**Untrusted-input posture:** message bodies are untrusted. Output is
schema-constrained; the AI can only propose catalog IDs that are re-validated
server-side; nothing ships without human confirmation in v1.

### 4. Order Inbox UI — `frontend-v2/src/pages/OrderInboxPage.tsx`

Generalizes `PhoneOrdersPage`:

- Draft list across all sources with channel badge, customer, message preview,
  per-line confidence coloring, stock warnings.
- Raw message text always displayed beside parsed lines (trust through
  transparency; also the demo moment).
- Inline line editing (existing PATCH endpoint already accepts `items` /
  `line_items`), **Confirm** (routes through the existing order-entry engine so
  substitutions, backorders, and hot messages apply) or **Reject** with reason.
- Existing draft-count nav badge extends to all sources.
- Existing OrderIntakeModal rewired to the new engine (`channel: 'paste'`).

### 5. Auto-replies

Two templated outbound SMS via the existing `sms.js` service:

- On receipt: "Got it — reviewing your order now."
- On confirm: line summary + delivery day.
- Per-company toggle in Settings. No AI free text.

## Error handling

- Signature-invalid webhook calls → 403, logged, nothing stored.
- AI parse failure → `parse_status: 'failed'`, message still visible in inbox
  for manual entry; no draft order created.
- Unknown sender → inbox entry without draft; operator can link a customer and
  re-parse.
- Twilio outbound failures on auto-reply are logged, never block draft creation.

## Testing

Backend integration tests (existing patterns):
- Webhook signature accept/reject; tenant mapping from `To` number.
- Customer matching by phone; unknown-sender path; opt-out routing.
- Parse → validate → price → draft flow with mocked AI, including invalid
  product-ID proposals being rejected.
- `order_intake_messages` tenant scoping (plus automatic penetration-suite
  coverage).
- Confirm/reject transitions and auto-reply triggers.

Frontend unit tests for `OrderInboxPage` mirroring current `PhoneOrdersPage`
coverage.

## Fast-follow: Margin-Leak Report (scoped only)

Weekly owner-facing report of dollars lost to spoilage, case breakage, unbilled
returns, below-minimum-sell sales, and credit-hold shipments — assembled from
the existing inventory ledger, pricing engine, and AR ledger, delivered via the
existing report scheduler. Own spec after the Order Inbox ships.
