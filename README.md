# NodeRoute

NodeRoute is a Node/Express delivery operations platform with a React v2 dashboard, static legacy frontend pages, and a customer-facing portal. It covers delivery routing, driver management, inventory, invoicing, purchasing, and online customer payments.

## Structure

```
backend/          Express API, middleware, services, and tests
frontend/         Static HTML pages (legacy dashboard, driver app, customer portal)
frontend-v2/      React + Vite + Tailwind dashboard (v2 — served at /dashboard-v2 and spa routes)
landing-v2/       React + Vite landing page (replaces landing.html when built)
supabase/         Migrations and SQL helpers
```

### Backend routes

| Mount | File | Purpose |
|---|---|---|
| `/auth` | `auth.js` | Login, invite accept, setup-password |
| `/api/users` | `users.js` | User CRUD, invites, role management |
| `/api/orders` | `orders.js` | Order lifecycle |
| `/api/invoices` | `invoices.js` | Invoice CRUD, bulk import |
| `/api/inventory` | `inventory.js` | Stock management, ledger, lot/weight tracking |
| `/api/lots` | `lots.js` | Lot/batch control and traceability |
| `/api/purchase-orders` | `purchase-orders.js` | PO scanning and confirmation |
| `/api/ops` | `ops.js` + `ops-purchasing.js` | UOM rules, warehouses, vendors, cycle counts, returns, barcode events, EDI jobs, inventory projections, purchasing suggestions, PO drafts, vendor PO receiving |
| `/api/forecast` | `forecast.js` | AI demand forecasting |
| `/api/ai` | `ai.js` | AI walkthroughs, order intake scanning, inventory health, reorder drafting |
| `/api/portal` | `portal.js` + `portal-payments.js` + `portal-customer.js` | Customer portal auth (email/code), payment methods, autopay, Stripe checkout, orders/invoices/contact/inventory |
| `/api/driver` | `driver.js` | Driver routes, location updates, invoice access |
| `/api/deliveries` | `deliveries.js` | Delivery stats and driver tracking |
| `/api/stops` | `stops.js` | Stop management and dwell tracking |
| `/api/routes` | `routes.js` | Route CRUD and assignment |
| `/api/customers` | `customers.js` | Customer records |
| `/api/track` | `tracking.js` | Public shipment tracking by token |
| `/api/settings` | `settings.js` | Company configuration |
| `/api/temperature-logs` | `temperature-logs.js` | Temperature sensor data |
| `/api/reporting` | `reporting.js` | Rollup analytics |
| `/api/webhooks/stripe` | `stripe-webhooks.js` | Stripe webhook handlers |

### Backend services

| File | Purpose |
|---|---|
| `supabase.js` | Database client and demo-mode fallback |
| `email.js` | Multi-provider email (Resend or SMTP) with retry |
| `stripe.js` | Stripe customers, setup intents, payment intents, checkout sessions, webhook verification |
| `pdf.js` | Invoice PDF generation |
| `ai.js` | OpenAI integration — forecasting, inventory analysis, reorder alerts, walkthroughs |
| `inventory-ledger.js` | Shared inventory quantity and weighted-cost posting |
| `operating-context.js` | Multi-company/location context resolution and row scoping |
| `driver-invoice-access.js` | Driver authorization logic for invoice access |

## Runtime

- Backend entrypoint: `backend/server.js`
- Start: `npm start` (runs the backend)
- The live dashboard is the React v2 app in `frontend-v2/`. Build it with:
  ```
  npm --prefix frontend-v2 run build
  ```
  Once built, `/dashboard-v2` and all SPA routes (`/orders`, `/deliveries`, `/inventory`, etc.) are served from it. Without a build, those routes fall back to the legacy `frontend/index.html`.
- The landing page is the React v2 app in `landing-v2/`. Build it with:
  ```
  npm --prefix landing-v2 run build
  ```
  Without a build, `/landing` falls back to the static `frontend/landing.html`.

## Environment Variables

### Required

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase service role key |
| `JWT_SECRET` | Signs auth and portal session tokens |
| `BASE_URL` | Public base URL (used in email links and Stripe redirect URLs) |

### Email (at least one provider required for portal auth)

| Variable | Purpose |
|---|---|
| `RESEND_API_KEY` | Resend email provider API key |
| `EMAIL_FROM` | Sender address |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | SMTP fallback |
| `SMTP_SECURE` | `true` for port 465 TLS |
| `EMAIL_PROVIDER` | Force `resend` or `smtp` |

### Payments (all optional — enable online payments in the customer portal)

| Variable | Purpose |
|---|---|
| `PORTAL_PAYMENT_ENABLED` | Set to `true` to enable online payments |
| `PORTAL_PAYMENT_PROVIDER` | `stripe`, `stub`, or `manual` (default: `manual`) |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_PUBLISHABLE_KEY` | Stripe publishable key (sent to browser) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `PORTAL_PAYMENT_CURRENCY` | ISO currency code (default: `usd`) |
| `PORTAL_PAYMENT_SUPPORT_EMAIL` | Support email shown in payment error messages |
| `PORTAL_PAYMENT_STUB_CHECKOUT_URL` | Redirect URL for stub/test checkout |

### AI (optional)

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | Enables AI walkthroughs, PO scanning, inventory health, reorder drafting, demand forecasting |
| `OPENAI_MODEL` | Override default chat model |
| `OPENAI_VISION_MODEL` | Override default vision model |

### Other optional

| Variable | Purpose |
|---|---|
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Seed admin account credentials |
| `PORT` | HTTP port (default: 3001) |
| `PORTAL_PREVIEW_EMAILS` | Comma-separated emails allowed portal preview access |
| `PORTAL_CODE_TTL_MS` | Verification code lifetime (default: 10 min) |
| `PORTAL_AUTH_RATE_LIMIT` | Max login attempts per window (default: 5) |
| `DEFAULT_COMPANY_ID` / `DEFAULT_LOCATION_ID` | Fallback tenant context |

## Tests

Run the backend test suite (uses Node's built-in test runner — no extra dependencies):

```
npm --prefix backend test
```

The suite covers auth, multi-company access, route hardening, inventory ledger workflows, ops purchasing workflows, portal payment endpoints, Stripe webhook handling, dwell persistence, driver invoice access, AI walkthroughs, and public tracking routes.

Tests run without `OPENAI_API_KEY` or Supabase credentials; AI tests verify safe heuristic fallback, and database tests use the built-in demo-query stub.
