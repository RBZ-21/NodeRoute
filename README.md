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
- `OPENAI_API_KEY` for AI walkthroughs, purchase order scanning, inventory health checks, reorder-message drafting, and demand forecasting
- Optional OpenAI model overrides: `OPENAI_MODEL`, `OPENAI_VISION_MODEL`

For production deploys, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `JWT_SECRET`, and `BASE_URL` should all be set in the runtime environment. The app will only fall back to local in-memory demo data when Supabase is missing in non-production runs.

## OpenAI Setup

Set `OPENAI_API_KEY` in the same runtime environment as the backend process, not in the browser. On Railway, add it under the service Variables tab and redeploy/restart the service. Locally, put it in `.env` at the repository root.

The automated tests intentionally run without `OPENAI_API_KEY` and verify that walkthroughs fall back to safe heuristic guidance, so the test warning is expected. Production AI features require the variable to be present.

## Tests

Run the backend test suite (Node built-in runner, no extra dependencies):

```
npm --prefix backend test
```

## Current Cleanup Notes

- The customer portal auth flow should be hardened before production use.
