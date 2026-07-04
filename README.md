# NodeRoute

NodeRoute is an all-in-one delivery operations platform and ERP built for food distributors and route-based businesses. It covers the full order-to-cash cycle — order intake (including AI voice phone orders), pricing and promotions, route planning and live driver tracking, inventory and warehouse control, purchasing and AP, accounts receivable and credit management, compliance/traceability, scheduled reporting, and a self-service customer portal — all from one place.

No coding knowledge is needed to use NodeRoute. This document is for anyone setting it up or deploying it for the first time.

---

## What NodeRoute Does

The admin dashboard is organized into the same groups you'll see in the sidebar:

### Dispatch
- **Orders** — Create, edit, and track orders from intake to fulfillment. Out-of-stock items can still be added during order building, and weight-managed lines flow directly into the processing queue. Includes a workbench/board view, CSV import, and barcode scan-to-add.
- **Routes** — Build delivery routes, assign drivers, manage stops, and reorder them on the fly, including route-mutation auditing.
- **Map** — See where your drivers are in real time, with ETA/tracking held until an outing has actually left the shop. Backed by a server-side Google Maps proxy (geocoding, drive-time, directions) that caches results to control API spend.

### Inventory & Purchasing
- **Inventory** — Track stock levels, lot numbers, catch weights, and costs. Restock, adjust, transfer, spoilage, and count-sheet flows are all in the main admin UI, with availability projections and unit-of-measure conversions.
- **Kits** — Build kit/bundle recipes and process kit runs that consume component inventory.
- **Purchasing** — Scan vendor paperwork with AI, confirm purchase orders, receive vendor POs line-by-line into inventory, and track vendor PO history with variance/backorder visibility, purchasing suggestions, and vendor minimums (order value, pallet/layer quantities).
- **Warehouse** — Manage warehouse locations and bin assignments, cycle counts, barcode events, and returns.
- **Traceability** — Lot/batch genealogy and food-safety compliance reporting, including critical-tracking-event completeness and gap detection.

### Customers & Sales
- **Customers** — Customer records, order/invoice history, and messaging preferences.
- **Vendors** — Vendor records and performance tracking.
- **Sales Rep** — A rep-facing book of assigned customers, visit logging, upsell alerts, and order history.
- **Phone Orders** — AI voice ordering: calls are answered and transcribed by a voice agent, parsed into a draft order, and queued here for staff to review, edit, and confirm (with an SMS alert to staff when a new draft arrives).

### Financials
- **Financials / AR** — Accounts receivable ledger, cash receipts and application, account inquiry, aging reports, and finance charges.
- **Pricing** — A pricing engine with price levels, customer-specific special pricing, minimum-sell rules, promotions, rebates, bill-backs, quotes, and scheduled price-update batches, enforced automatically at order entry.
- **Invoices** — Generate and send invoices, bulk-import from spreadsheets, print/save PDF-friendly invoice views, add invoice add-ons/credit memos, and track payment status.
- **Credit Hold** — Put customers on hold, release or override holds, configure per-customer credit settings, and view hold history.
- **AP** — Vendor bill review/approval, AP ledger, payment batches, bank accounts, bank reconciliation, and cash-requirements snapshots (purchasing area's accounts-payable counterpart).

### Insights
- **Analytics** — Rollup dashboards for revenue, deliveries, fulfillment rates, and inventory value.
- **Dashboard Builder** — Configure per-user/role dashboard layouts.
- **DSR** — Daily sales/ops rollup: revenue by driver and route, top customers, receiving activity, and short-ship exceptions for a given day.
- **Forecasting** — AI-powered demand projections to help you order the right amount each week.
- **Reports** — On-demand reporting plus a scheduler that emails recurring reports (CSV, TXT, PDF, or XLSX) and dispatches credit/inventory alert rules on a cron.
- **AI Help** — In-app AI walkthroughs and assistance.

### Admin / Platform
- **Users** — User management, invites, and roles.
- **Settings** — Company configuration, order cutoff times, and feature toggles.
- **Integrations** — Third-party integration configuration (EDI job registry, accounting connector slugs, etc.).
- **Compliance** — Company-wide food-safety/traceability compliance summary and gap reporting.
- **Planning** — Configure automation rules (e.g. reorder policies) that drive downstream suggestions and alerts.
- **Audit Log** — Full customer-activity audit trail, including an overrides-only view.
- **Superadmin / Companies** *(platform-level, superadmin role only)* — Manage tenant companies, the public waitlist, and subscription billing for the platform itself.

### For your drivers
- **Driver app** — A dedicated mobile-ready web app (installable as a PWA on any phone) where drivers see their route, mark stops as arrived or departed, capture proof-of-delivery photos and signatures, log temperatures for cold-chain compliance, and access delivery invoices. Includes an offline queue that syncs actions once connectivity returns.
- **Native iOS driver app** — A SwiftUI starter lives alongside the web app for teams that want an App Store/TestFlight version while keeping the browser-based driver experience available.

### For your customers
- **Customer portal** — Customers log in with just their email (no password to remember). They can view their orders, invoices, and inventory on hand, and pay outstanding balances online via Stripe (including saved payment methods and autopay).
- **Order tracking** — Share a tracking link with any customer. No login required — they see scheduled-vs-live delivery state correctly, and the map/ETA only activate after dispatch actually starts.
- **Daily product blast** — Automatically send customers an SMS each morning with available inventory so they can place orders before cutoff.

### Built-in security
- Each user only ever sees their own company and location data — users with no assigned locations cannot browse other tenants' records.
- CORS is locked to your configured allowed origins — no wildcard open access.
- Error details are hidden from customers in production so internal system information is never exposed.
- Rate limiting protects login, portal auth, and all AI endpoints.
- JWT signing is required — the server refuses to start if no secret is configured.
- Optional Sentry error monitoring on both the backend and admin frontend.

---

## Project Layout

```
backend/          API server, business logic, and automated tests
frontend-v2/      Main admin dashboard (React) — routes like /dashboard, /orders, /routes, /purchasing
landing-v2/       Public landing/marketing page — served at /
driver-app/       Driver mobile app (React PWA) — served at /driver-app
ios-driver-app/   Native SwiftUI driver app starter — generated with XcodeGen
supabase/         Database migrations and SQL helpers
docs/             Internal documentation and changelogs
```

---

## Enterprise ERP

The Enterprise ERP feature set — Phase 1 (customizable shell, dashboards, product
media), Phase 2 (maps), Phase 3 (advanced inventory control), Phase 4 (pricing
engine, promotions, quotes), Phase 5 (order-entry workflows), Phase 6 (accounts
receivable), Phase 7 (purchasing/AP and reorder planning), and Phase 8 (report
scheduler & alerts) — has shipped and passed its Phase 9 verification pass. It's
documented here:

- **[Release notes & rollout checklist](docs/release-notes/enterprise-erp-features.md)** —
  required env vars (`GOOGLE_MAPS_API_KEY`, `VITE_GOOGLE_MAPS_PUBLIC_KEY`,
  `ALLOWED_IMAGE_HOSTS`, `EMAIL_FROM`), Google Maps & report-scheduler setup,
  migration ordering, breaking changes, and rollback notes.
- **[Feature matrix](docs/erp-feature-matrix.md)** — per-feature implementation
  status, RLS/service-role verification, DB-health findings, test results, and
  deferred items (RTF export, fax transmission, live EDI trading-partner
  exchange, and two-way QuickBooks/NetSuite/SAP sync are explicitly deferred).

### Applying migrations

Database migrations live in `supabase/migrations/` and apply in version order.
With the [Supabase CLI](https://supabase.com/docs/guides/local-development):

```bash
supabase link --project-ref <your-project-ref>
supabase migration list      # confirm local vs remote are in sync
supabase db push             # apply pending migrations to the linked project
```

Every new ERP table ships with row-level security enabled and a tenant policy in
the same migration. See the release notes for the ordered list of ERP migrations
and what each one adds.

---

## Getting Started

### 1. Install dependencies

```
npm run install:all
```

This installs dependencies for the backend, dashboard, landing page, and driver app.

### 2. Set your environment variables

Copy the table in the **Environment Variables** section below into a `.env` file at the project root and fill in your values.

### 3. Build the frontend apps

```
npm run build
```

This compiles the dashboard, landing page, and driver app. The server will not start without these build outputs.

### 4. Start the server

```
npm start
```

The server listens on port `3001` by default (or the `PORT` you set). Open your browser to `http://localhost:3001`.

Useful local URLs after boot:

- `http://localhost:3001/login` — admin login
- `http://localhost:3001/dashboard` — main admin dashboard
- `http://localhost:3001/map` — internal live map
- `http://localhost:3001/track?t=...` — public delivery tracking link

### Running tests

```
npm test
```

This runs the backend test suite and frontend component tests.

Additional frontend verification commands:

```
npm --prefix frontend-v2 run test:e2e
npm --prefix frontend-v2 run test:smoke
npm --prefix frontend-v2 run build
```

- `test:e2e` runs the shared Playwright suite under `frontend-v2/e2e`
- `test:smoke` runs the local full-workflow admin smoke tests under `frontend-v2/tests`
- `build` compiles the production admin app bundle

Most unit/integration tests run in demo/offline mode by default. Playwright tests require the app to be running and valid test credentials.

---

## Environment Variables

### Required

| Variable | What it does |
|---|---|
| `SUPABASE_URL` | URL of your Supabase project |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (keep this secret). `SUPABASE_SERVICE_KEY` is still accepted as a legacy alias. |
| `JWT_SECRET` | Secret used to sign login tokens — must be set in production |
| `BASE_URL` | The public URL of your deployment (e.g. `https://yourdomain.com`). Missing values warn because invite links and redirects degrade. |

### Email — at least one provider required for customer portal login

| Variable | What it does |
|---|---|
| `RESEND_API_KEY` | API key for the Resend email service |
| `EMAIL_FROM` | The "from" address on outgoing emails, and on scheduled report/alert deliveries |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | SMTP credentials as an alternative to Resend |
| `SMTP_SECURE` | Set to `true` if your SMTP server uses port 465 TLS |
| `EMAIL_PROVIDER` | Force `resend` or `smtp`; defaults to auto-detect |

### Recommended production hardening

| Variable | What it does |
|---|---|
| `SUPERADMIN_EMAIL` | Email address allowed through the superadmin gate. If unset, superadmin routes fail closed. |
| `SESSION_SECRET` or `CSRF_SECRET` | Separate secret used for session/CSRF protection. If unset, the backend derives it from `JWT_SECRET` and logs a warning. |
| `PORTAL_JWT_SECRET` | Secret used for customer portal JWTs. Set before enabling portal auth. |
| `ADMIN_PASSWORD` | Bootstrap admin password. Use 12+ characters with uppercase, lowercase, a digit, and a special character. |
| `SENTRY_DSN` / `VITE_SENTRY_DSN` | Optional error monitoring for the backend and admin frontend. `VITE_SENTRY_ENVIRONMENT` labels the frontend environment. |

### Online payments (optional — enables pay-now in the customer portal)

| Variable | What it does |
|---|---|
| `PORTAL_PAYMENT_ENABLED` | Set to `true` to turn on online payments |
| `PORTAL_PAYMENT_PROVIDER` | `stripe`, `stub` (for testing), or `manual` (default) |
| `STRIPE_SECRET_KEY` | Your Stripe secret key |
| `STRIPE_PUBLISHABLE_KEY` | Your Stripe publishable key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `PORTAL_PAYMENT_CURRENCY` | Currency code, e.g. `usd` (default: `usd`) |
| `PORTAL_PAYMENT_SUPPORT_EMAIL` | Support email shown to customers on payment errors |

### AI features (optional — all features degrade gracefully without this)

| Variable | What it does |
|---|---|
| `OPENAI_API_KEY` | Enables PO scanning, inventory health analysis, reorder drafting, demand forecasting, and AI walkthroughs |
| `OPENAI_MODEL` | Override the default chat model |
| `OPENAI_VISION_MODEL` | Override the default vision model used for document scanning |
| `ANTHROPIC_API_KEY` | Enables Claude-based parsing of AI phone-order call transcripts into structured draft orders |

### AI phone orders / voice ordering (optional)

| Variable | What it does |
|---|---|
| `BLAND_WEBHOOK_SECRET` | Shared secret validating inbound webhooks from the voice provider (single-tenant setups) |
| `BLAND_COMPANY_SECRETS` | JSON map of per-company webhook secrets to company IDs for multi-tenant voice webhook auth, e.g. `{"<secret>":"<company-id>"}` |
| `BLAND_INVENTORY_KEY` | API key required in the `x-api-key` header for the public inventory feed the voice agent reads from |
| `BLAND_COMPANY_ID` | Fallback company ID for the public inventory feed when not resolved from `BLAND_COMPANY_SECRETS` |
| `STAFF_PHONE` | Phone number that receives an SMS alert when a new AI phone order is drafted |

### Printing (optional)

| Variable | What it does |
|---|---|
| `PRINTER_SERVICE_URL` / `PRINTER_URL` | External print service endpoint for order slips, pick/pull/cut lists, and labels. Falls back to a local queue if unset. |
| `PRINTER_QUEUE_ENABLED` | Enables the local fallback print queue |

### Platform billing (superadmin — optional, only needed if you sell NodeRoute as a hosted subscription)

| Variable | What it does |
|---|---|
| `NODEROUTE_STRIPE_PRICE_ID` | Stripe Price ID used for the platform subscription checkout |
| `NODEROUTE_BILLING_PRICE_LABEL` | Display label for the price shown at checkout |
| `NODEROUTE_BILLING_PRODUCT_NAME` | Display name for the product shown at checkout |
| `NODEROUTE_BILLING_SUPPORT_EMAIL` | Support email shown on billing pages |

### SMS / Daily product blast (optional)

| Variable | What it does |
|---|---|
| `TWILIO_ACCOUNT_SID` | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_FROM_NUMBER` | Phone number to send SMS from |
| `COMPANY_NAME` | Your company name, included in the SMS message |
| `DAILY_BLAST_CRON` | Cron schedule for the blast (default: `30 6 * * 1-6` — 6:30 AM Mon–Sat) |

### Scheduled jobs (optional — all have sane defaults)

| Variable | What it does |
|---|---|
| `REPORT_SCHEDULER_CRON` | How often due report schedules are checked and dispatched (default: `*/5 * * * *`) |
| `ALERT_CHECKER_CRON` | How often credit/inventory alert rules are evaluated (default: `*/15 * * * *`) |
| `REORDER_CHECK_CRON`, `REORDER_USAGE_CRON`, `REORDER_DIGEST_CRON` | Cron schedules for reorder-suggestion generation, usage tracking, and digest emails |
| `AR_AGING_DIGEST_CRON` | Cron schedule for the AR aging digest |
| `CREDIT_CHECK_CRON` | Cron schedule for automated credit-hold evaluation |
| `AI_INSIGHTS_CRON` | Cron schedule for the proactive AI insights job |
| `RECURRING_ORDERS_CRON` | Cron schedule for generating standing/recurring orders |

### Other optional

| Variable | What it does |
|---|---|
| `PORT` | HTTP port (default: `3001`) |
| `CORS_ORIGINS` | Comma-separated list of allowed browser origins |
| `GOOGLE_MAPS_API_KEY` | Canonical server-side Google Maps key for Geocoding, Distance Matrix, and Directions proxy calls. Keep this server-only. |
| `GOOGLE_MAPS_KEY` | Legacy server-side Google Maps key alias; prefer `GOOGLE_MAPS_API_KEY`. |
| `VITE_GOOGLE_MAPS_PUBLIC_KEY` | Canonical browser-side Google Maps key for the admin live map and public tracking map. Restrict this key by HTTP referrer. |
| `VITE_GOOGLE_MAPS_KEY` | Legacy browser-side maps key alias; prefer `VITE_GOOGLE_MAPS_PUBLIC_KEY`. |
| `VITE_MAP_API_KEY` | Legacy browser-side maps key alias; prefer `VITE_GOOGLE_MAPS_PUBLIC_KEY`. |
| `ALLOWED_IMAGE_HOSTS` | Comma-separated allowlist for URL-based product images. Leave empty to reject remote image URLs by default. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Credentials for the auto-created admin account on first boot |
| `PORTAL_CODE_TTL_MS` | How long a portal login code stays valid (default: 10 minutes) |
| `PORTAL_AUTH_RATE_LIMIT` | Max login attempts per window (default: 5) |
| `VITE_STATUSPAGE_EMBED_SCRIPT_URL` | Optional status-page widget embedded in the admin UI |
| `DEFAULT_COMPANY_ID` / `DEFAULT_LOCATION_ID` | Fallback company and location IDs for single-tenant deployments |

---

## API Reference (for developers)

<details>
<summary>Backend routes</summary>

| Path | File | Purpose |
|---|---|---|
| `/auth` | `auth.js` | Login, accept invite, set up password |
| `/api/users` | `users.js` | User management, invites, roles |
| `/api/orders` | `orders.js` | Order lifecycle |
| `/api/invoices` | `invoices.js` | Invoice CRUD, bulk import, add-ons/credit memos |
| `/api/print` | `print.js` | Printable order slips, loading sheets, cut/pick/pull lists, picking labels |
| `/api/inventory` | `inventory.js`, `inventory-projections.js` | Stock, ledger movements, lot/weight tracking, availability projections |
| `/api/kits` | `kits.js` | Kit/bundle recipes and kit-processing runs |
| `/api/cycle-counts` | `cycle-counts.js` | Inventory cycle counts — create, record items, commit |
| `/api/lots` | `lots.js` | Lot/batch traceability |
| `/api/catch-weight` | `catch-weight.js` | Catch-weight entry, approval, and variance reporting |
| `/api/purchase-orders` | `purchase-orders.js` | PO scanning and confirmation |
| `/api/ops` | `ops.js` + `ops/admin-routes.js`, `ops-purchasing.js`, `ops/purchasing-planning-routes.js`, `ops/purchasing-order-routes.js` | UOM rules, warehouses, vendors, cycle counts, returns, barcode events, EDI, purchasing suggestions, PO drafts, vendor PO creation, and vendor receiving |
| `/api/vendors` | `vendors.js` | Vendor records |
| `/api/vendor-bills` | `vendor-bills.js` | Vendor bill review and approval (AP) |
| `/api/ap` | `ap.js` | AP ledger, payment batches, bank accounts, bank reconciliation, cash requirements |
| `/api/pricing` | `pricing.js` | Price levels, customer special pricing, minimum-sell rules, quotes |
| `/api/promotions` | `promotions.js` | Promotions, rebates, and bill-backs |
| `/api/order-guides` | `order-guides.js` | Per-customer standing order guides |
| `/api/customer-messages` | `customer-messages.js` | Customer hot messages/instructions shown at order entry |
| `/api/recurring-orders` | `recurring-orders.js` | Standing/recurring order CRUD |
| `/api/ar` | `ar.js`, `ar-hub.js` | AR ledger, cash receipts, account inquiry, aging, finance charges, collections queue |
| `/api/credit`, `/api/credit-hold` | `credit-hold.js` | Customer credit hold status, holds, releases, overrides, history |
| `/api/reorder` | `reorder.js` | Reorder suggestions dashboard and product reorder settings |
| `/api/forecast` | `forecast.js` | AI demand forecasting |
| `/api/ai` | `ai.js` | Walkthroughs, order intake scanning, inventory health, reorder drafting |
| `/api/ai-insights` | `ai-insights.js` | Proactive AI-generated insights (read/acknowledge/re-run) |
| `/api/phone-orders` | `phone-orders.js` | Review/confirm AI voice phone orders |
| `/api/webhooks/bland` | `webhooks/bland.js` | Voice-provider webhook — parses call transcripts into draft phone orders |
| `/api/public/inventory` | `public/inventory.js` | API-key-protected public inventory feed for the voice ordering agent |
| `/api/sales-reps` | `sales-reps.js` | Sales rep customer book, visit logs, upsell alerts, order history |
| `/api/portal` | `portal.js`, `portal-customer.js`, `portal-ordering.js`, `portal-payments.js`, `portal/*` | Customer portal — email login, orders, invoices, inventory, payments, saved payment methods, autopay |
| `/api/driver` | `driver.js` | Driver route, location updates, invoice access |
| `/api/drivers` | `drivers.js` | Driver roster management (admin/manager) |
| `/api/deliveries` | `deliveries.js` | Delivery stats and driver tracking |
| `/api/stops` | `stops.js` | Stop management |
| `/api/dwell` | `dwell.js` | Stop dwell-time records |
| `/api/routes` | `routes.js` | Route CRUD and assignment |
| `/api/maps` | `maps.js` | Server-side Google Maps proxy — geocoding, drive-time, route overlays |
| `/api/customers` | `customers.js` | Customer records |
| `/api/track` | `tracking.js` | Public shipment tracking (no login required) |
| `/api/settings` | `settings.js` | Company configuration, order cutoff times |
| `/api/company-config` | `company-config.js` | Per-company configuration and feature flags |
| `/api/onboarding` | `onboarding.js` | New-company setup wizard |
| `/api/user-preferences`, `/api/dashboard-layouts` | `user-preferences.js` | Per-user nav order and dashboard layout preferences |
| `/api/product-media` | `product-media.js` | Product image library management |
| `/api/temperature-logs` | `temperature-logs.js` | Temperature sensor data |
| `/api/reporting`, `/api/reports` | `reporting.js` | Rollup analytics |
| `/api/report-schedules` | `report-schedules.js` | Scheduled report definitions, delivery targets, and run history |
| `/api/compliance` | `compliance.js` | Traceability compliance summary and critical-tracking-event gap reporting |
| `/api/audit-log` | `audit-log.js` | Customer activity audit log and overrides report |
| `/api/warehouse/locations` | `warehouse-locations.js` | Warehouse bin/slot assignment and putaway lookup |
| `/api/warehouse` | `warehouse.js` | Warehouse location management |
| `/api/search` | `search.js` | Global Cmd/Ctrl+K search across orders, customers, invoices, SKUs, and lots |
| `/api/integrations` | `integrations.js` | Third-party integration configuration |
| `/api/billing` | `billing.js` | NodeRoute platform subscription billing (Stripe checkout) |
| `/api/superadmin` | `superadmin.js` | Platform-level company management |
| `/api/waitlist` | `waitlist.js` | Waitlist signups from the landing page |
| `/api/webhooks/stripe` | `stripe-webhooks.js` | Stripe payment event handling |

</details>

<details>
<summary>Backend services</summary>

| File | Purpose |
|---|---|
| `supabase.js` | Database client with demo-mode fallback |
| `email.js` | Multi-provider email (Resend or SMTP) with retry |
| `stripe.js` | Stripe customers, payment methods, checkout sessions, webhook verification |
| `sms.js` | Twilio SMS delivery (daily blast, alerts) |
| `daily-fish-blast.js` | Builds and sends the daily inventory SMS blast |
| `pdf.js`, `purchase-order-pdf.js` | Invoice and purchase order PDF generation |
| `print-template.js`, `printer.js` | Printable document templates and external/local printer dispatch |
| `ai.js` | OpenAI integration — forecasting, inventory analysis, reorder alerts, walkthroughs |
| `ai-insights.js`, `ai-errors.js` | Scheduled proactive AI insight generation and AI error tracking |
| `inventory-ledger.js` | Unified inventory quantity and weighted-cost posting |
| `inventory-projections.js` | Inventory availability projection calculations |
| `lot-depletion.js`, `lot-traceability-notice.js`, `invoice-lots.js` | Lot/FIFO depletion, traceability/recall notices, lot info on invoices |
| `pricing-engine.js` | Price level, special-price, and promotion resolution |
| `order-entry-engine.js` | Order guides, substitutions, backorders, deposits, and fuel-surcharge logic |
| `recurring-orders.js` | Standing/recurring order generation |
| `reorderEngine.js` | Reorder suggestion generation from usage and thresholds |
| `creditEngine.js` | Credit hold evaluation |
| `ar-ledger.js`, `finance-charges.js` | AR ledger posting, cash receipt application, finance charges |
| `ap-ledger.js` | AP ledger posting, payment batches, bank reconciliation |
| `purchase-order-numbers.js`, `purchase-order-workflows.js` | PO numbering and approval workflow |
| `cost-price-scheduler.js` | Scheduled cost/price update batch processing |
| `google-maps.js` | Google Maps geocode/drive-time proxy with caching |
| `route-stop-sync.js` | Route/stop state synchronization |
| `dwell-stats.js` | Dwell-time aggregation |
| `delivery-notifications.js`, `invoice-delivery.js`, `invoice-email.js` | Delivery and invoice notification/delivery emails |
| `report-scheduler.js`, `report-exporter.js`, `report-alerts.js` | Scheduled report dispatch, CSV/TXT/PDF/XLSX export, and alert rule evaluation |
| `order-documents.js` | Order document generation (slips, sheets, labels) |
| `operating-context.js` | Multi-company/location context enforcement and row-level scoping |
| `driver-invoice-access.js` | Driver authorization for invoice access |
| `plan-limits.js` | Subscription/plan limit enforcement |
| `company-settings.js` | Company settings helpers |
| `waitlist-email.js` | Waitlist confirmation emails |
| `logger.js` | Structured application logging |

</details>

---

## Current Workflow Notes

- The admin app has been updated so order item selection uses stable product identifiers and no longer crashes if legacy inventory rows have missing `item_number` values.
- Order entry intentionally allows out-of-stock products to be added to orders. Inventory availability is informational during order build, not a hard block.
- Route/live ETA tracking is gated by actual dispatch state, so customers are not shown "driver is on the way" before an outing starts.
- Purchasing now includes a receiving workflow for open vendor POs, with ordered-vs-received comparison, over-receipt policy handling, backorder policy handling, and receipt posting into inventory.
- Pricing, promotions, order guides, AR, AP, credit holds, and the report scheduler (Enterprise ERP Phases 1–8) are implemented and verified — see the [feature matrix](docs/erp-feature-matrix.md) for per-feature status and test coverage.
- The frontend supports two Playwright tracks:
  - `frontend-v2/e2e` for the shared app-level suite
  - `frontend-v2/tests` for local smoke/UAT-style workflow coverage
- The Vite e2e suite is mounted under `/dashboard-v2/*`. The local smoke suite
  requires a running backend plus `TEST_EMAIL` and `TEST_PASSWORD`.
