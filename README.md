# NodeRoute

NodeRoute is an all-in-one delivery operations platform built for food distributors and route-based businesses. It helps you manage every part of your operation — from taking orders and planning routes to tracking drivers in real time, sending invoices, receiving vendor POs into inventory, and letting customers pay online — all from one place.

No coding knowledge is needed to use NodeRoute. This document is for anyone setting it up or deploying it for the first time.

---

## What NodeRoute Does

### For your operations team
- **Orders** — Create, edit, and track orders from intake to fulfillment. Out-of-stock items can still be added during order building, and weight-managed lines flow directly into the processing queue.
- **Route planning** — Build delivery routes, assign drivers, manage stops, and reorder them on the fly.
- **Live map** — See where your drivers are in real time, with ETA/tracking held until an outing has actually left the shop.
- **Inventory** — Track stock levels, lot numbers, weights, and costs. Restock, adjust, transfer, spoilage, and count-sheet flows are all in the main admin UI.
- **Purchasing** — Scan vendor paperwork with AI, confirm purchase orders, receive vendor POs line-by-line into inventory, and track vendor PO history with variance/backorder visibility.
- **Warehousing** — Manage warehouse locations, cycle counts, barcode events, and returns.
- **Invoicing** — Generate and send invoices, bulk-import from spreadsheets, print/save PDF-friendly invoice views, and track payment status.
- **Reporting & analytics** — Rollup dashboards for revenue, deliveries, fulfillment rates, and inventory value.
- **Demand forecasting** — AI-powered projections to help you order the right amount each week.

### For your drivers
- **Driver app** — A dedicated mobile-ready web app (installable as a PWA on any phone) where drivers see their route, mark stops as arrived or departed, capture proof-of-delivery photos, and access delivery invoices.
- **Native iOS driver app** — A SwiftUI starter lives alongside the web app for teams that want an App Store/TestFlight version while keeping the browser-based driver experience available.

### For your customers
- **Customer portal** — Customers log in with just their email (no password to remember). They can view their orders, invoices, and inventory on hand, and pay outstanding balances online via Stripe.
- **Order tracking** — Share a tracking link with any customer. No login required — they see scheduled-vs-live delivery state correctly, and the map/ETA only activate after dispatch actually starts.
- **Daily product blast** — Automatically send customers an SMS each morning with available inventory so they can place orders before cutoff.

### Built-in security
- Each user only ever sees their own company and location data — users with no assigned locations cannot browse other tenants' records.
- CORS is locked to your configured allowed origins — no wildcard open access.
- Error details are hidden from customers in production so internal system information is never exposed.
- Rate limiting protects login, portal auth, and all AI endpoints.
- JWT signing is required — the server refuses to start if no secret is configured.

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
| `SUPABASE_SERVICE_KEY` | Supabase service role key (keep this secret) |
| `JWT_SECRET` | Secret used to sign login tokens — must be set in production |
| `BASE_URL` | The public URL of your deployment (e.g. `https://yourdomain.com`) |

### Email — at least one provider required for customer portal login

| Variable | What it does |
|---|---|
| `RESEND_API_KEY` | API key for the Resend email service |
| `EMAIL_FROM` | The "from" address on outgoing emails |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | SMTP credentials as an alternative to Resend |
| `SMTP_SECURE` | Set to `true` if your SMTP server uses port 465 TLS |
| `EMAIL_PROVIDER` | Force `resend` or `smtp`; defaults to auto-detect |

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

### SMS / Daily product blast (optional)

| Variable | What it does |
|---|---|
| `TWILIO_ACCOUNT_SID` | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_FROM_NUMBER` | Phone number to send SMS from |
| `COMPANY_NAME` | Your company name, included in the SMS message |
| `DAILY_BLAST_CRON` | Cron schedule for the blast (default: `30 6 * * 1-6` — 6:30 AM Mon–Sat) |

### Other optional

| Variable | What it does |
|---|---|
| `PORT` | HTTP port (default: `3001`) |
| `CORS_ORIGINS` | Comma-separated list of allowed browser origins |
| `GOOGLE_MAPS_KEY` | Server-side Google Maps API key for address lookup and backend-assisted map features |
| `VITE_MAP_API_KEY` | Browser-side Google Maps key for the admin live map and public tracking map |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Credentials for the auto-created admin account on first boot |
| `PORTAL_CODE_TTL_MS` | How long a portal login code stays valid (default: 10 minutes) |
| `PORTAL_AUTH_RATE_LIMIT` | Max login attempts per window (default: 5) |
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
| `/api/invoices` | `invoices.js` | Invoice CRUD, bulk import |
| `/api/inventory` | `inventory.js` | Stock, ledger movements, lot/weight tracking |
| `/api/lots` | `lots.js` | Lot/batch traceability |
| `/api/purchase-orders` | `purchase-orders.js` | PO scanning and confirmation |
| `/api/ops` | `ops.js` + sub-files | UOM rules, warehouses, vendors, cycle counts, returns, barcode events, EDI, projections, purchasing suggestions, PO drafts, vendor PO creation, and vendor receiving |
| `/api/forecast` | `forecast.js` | AI demand forecasting |
| `/api/ai` | `ai.js` | Walkthroughs, order intake scanning, inventory health, reorder drafting |
| `/api/portal` | `portal*.js` | Customer portal — email login, orders, invoices, inventory, payments, autopay |
| `/api/driver` | `driver.js` | Driver route, location updates, invoice access |
| `/api/deliveries` | `deliveries.js` | Delivery stats and driver tracking |
| `/api/stops` | `stops.js` | Stop management and dwell time tracking |
| `/api/routes` | `routes.js` | Route CRUD and assignment |
| `/api/customers` | `customers.js` | Customer records |
| `/api/track` | `tracking.js` | Public shipment tracking (no login required) |
| `/api/settings` | `settings.js` | Company configuration, order cutoff times |
| `/api/temperature-logs` | `temperature-logs.js` | Temperature sensor data |
| `/api/reporting` | `reporting.js` | Rollup analytics |
| `/api/vendors` | `vendors.js` | Vendor records |
| `/api/warehouse` | `warehouse.js` | Warehouse location management |
| `/api/integrations` | `integrations.js` | Third-party integration configuration |
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
| `pdf.js` | Invoice PDF generation |
| `ai.js` | OpenAI integration — forecasting, inventory analysis, reorder alerts, walkthroughs |
| `inventory-ledger.js` | Unified inventory quantity and weighted-cost posting |
| `operating-context.js` | Multi-company/location context enforcement and row-level scoping |
| `driver-invoice-access.js` | Driver authorization for invoice access |

</details>

---

## Current Workflow Notes

- The admin app has been updated so order item selection uses stable product identifiers and no longer crashes if legacy inventory rows have missing `item_number` values.
- Order entry intentionally allows out-of-stock products to be added to orders. Inventory availability is informational during order build, not a hard block.
- Route/live ETA tracking is gated by actual dispatch state, so customers are not shown “driver is on the way” before an outing starts.
- Purchasing now includes a receiving workflow for open vendor POs, with ordered-vs-received comparison, over-receipt policy handling, backorder policy handling, and receipt posting into inventory.
- The frontend supports two Playwright tracks:
  - `frontend-v2/e2e` for the shared app-level suite
  - `frontend-v2/tests` for local smoke/UAT-style workflow coverage
