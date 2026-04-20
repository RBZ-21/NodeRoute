# NodeRoute

NodeRoute is a Node/Express delivery operations app with static frontend pages for:

- admin and manager operations
- driver routes and stop notes
- customer portal access
- inventory, invoices, and forecasting

## Structure

- `backend/`: Express API, auth, email, PDF generation, and Supabase access
- `frontend/`: static HTML pages served directly by the backend
- `supabase/`: migrations and SQL helpers

## Runtime

- The backend entrypoint is `backend/server.js`.
- The root package starts the backend with `npm start`.
- The frontend is not built from the checked-in Create React App scaffold under `frontend/src`; the live app is the static HTML pages in `frontend/`.

## Important Environment Variables

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `JWT_SECRET`
- `BASE_URL`
- `EMAIL_FROM`
- `RESEND_API_KEY` or SMTP settings (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`)
- `OPENAI_API_KEY` for forecasting features

For production deploys, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `JWT_SECRET`, and `BASE_URL` should all be set in the runtime environment. The app will only fall back to local in-memory demo data when Supabase is missing in non-production runs.

## Current Cleanup Notes

- Delivery stats and driver analytics still rely on hard-coded demo data in `backend/routes/deliveries.js`.
- Public order tracking is not implemented end to end.
- The customer portal auth flow should be hardened before production use.
- Backend automated tests have not been added yet.
