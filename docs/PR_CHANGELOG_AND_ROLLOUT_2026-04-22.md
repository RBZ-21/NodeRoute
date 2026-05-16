# PR Change Log and Rollout Notes (2026-04-22)

## PR Title
Operations foundation + founder-led landing refresh + repo cleanup + ops coverage tests

## Summary
This PR finalizes the new operations foundation across backend and frontend, refreshes the public landing page voice/design, removes stale scaffolding that is no longer used at runtime, and adds targeted regression tests for the new ops APIs and navigation flows.

## Included Commits
- `3737fc5` Refine operations UX layout and grouped workflow navigation
- `bbc7c5d` Rewrite landing page with founder-led early access messaging
- `d6a3672` Remove unused scaffold and vendored dependencies
- `c26f630` Shift landing background to midnight blue palette
- `c6750a9` Add ops API and navigation flow coverage tests

## Change Log

### 1. Operations foundation (backend + UI)
- Added/expanded ops backend endpoints under `/api/ops` for:
  - UOM/case-break rules
  - Warehouses
  - Cycle counts
  - Returns
  - Barcode events
  - EDI jobs
  - 30-day projections
  - Purchasing suggestions
  - Capabilities snapshot
- Added/organized operational navigation and views in the dashboard:
  - `Warehouse`
  - `Planning`
  - `Integrations`
- Improved operational UX and readability:
  - KPI summaries
  - clearer grouping
  - higher-signal status presentation
  - keyboard-friendly form submit patterns

### 2. Landing page rewrite + visual tuning
- Rewrote landing content to founder-led, early-stage messaging.
- Removed pricing-led / enterprise tone in favor of practical operator language.
- Updated root route behavior to land users on the marketing page.
- Tuned landing background palette from navy to a deeper midnight-blue profile.

### 3. Repository cleanup for maintainability
- Removed committed vendor dependencies under `backend/node_modules` (dependencies now installed via lockfile).
- Removed stale/unused frontend CRA scaffold artifacts:
  - `frontend/src/*`
  - `frontend/public/*`
  - `frontend/package.json`
  - `frontend/package-lock.json`
- Removed broken `deliveryapp` gitlink/submodule pointer.
- Kept runtime architecture explicit: backend + static HTML frontend.

### 4. Test coverage added
- Added `backend/tests/ops-workflows.test.js` to cover:
  - ops API surface presence
  - auth + role guards on ops write routes
  - bounded planning query controls
  - dashboard ops nav tab wiring
  - frontend-to-ops API flow mappings
  - keyboard submit hooks for ops workflows

## Validation Performed
- `npm test` from repo root
- Result: all tests passing (`29/29`) including stress smoke parse checks

## Risk Assessment

### Medium Risk
- Repo cleanup removed previously tracked scaffolding/vendor directories. Any undocumented local workflow depending on those paths may need adjustment.

### Low Risk
- Landing page copy/style changes are isolated to static frontend content.
- Ops tests are additive and non-invasive.

## Rollout Notes

### Pre-deploy checklist
- Confirm env vars are set in runtime:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_KEY`
  - `JWT_SECRET`
  - `BASE_URL`
  - email provider config (`RESEND_API_KEY` or SMTP vars)
- Ensure deployment pipeline runs `npm install` (or backend install step) before start.

### Deploy steps
1. Deploy `main` at commit `c6750a9` (or later).
2. Restart backend service.
3. Validate root page serves landing.
4. Smoke test dashboard ops tabs and key write flows.

### Post-deploy smoke checks
- Landing:
  - `GET /` returns rewritten founder-led landing page.
  - Visual: midnight-blue background present.
- Ops tabs in dashboard:
  - Warehouse tab loads warehouses/returns/barcode events.
  - Planning tab loads rules/projections/purchasing suggestions.
  - Integrations tab loads EDI queue/capabilities.
- Ops APIs (authorized user):
  - `GET /api/ops/warehouses`
  - `GET /api/ops/projections?days=30&lookbackDays=30`
  - `GET /api/ops/purchasing-suggestions?coverageDays=30&leadTimeDays=5&lookbackDays=30`

### Monitoring after rollout (first 24 hours)
- 4xx/5xx rates on `/api/ops/*`
- Auth failures on ops tabs
- Client console/API errors from dashboard ops views
- Time-to-render for ops tabs (Warehouse/Planning/Integrations)

## Rollback Plan

### Fast rollback option
- Revert this release’s commits in reverse order:
  1. `c6750a9`
  2. `c26f630`
  3. `d6a3672`
  4. `bbc7c5d`
  5. `3737fc5` (only if full ops UX rollback is needed)

### Targeted rollback option
- Landing-only issue: revert `c26f630` and/or `bbc7c5d`.
- Cleanup/workflow issue: revert `d6a3672`.
- Test-only issue: revert `c6750a9`.

## Suggested PR Description (copy/paste)
This PR ships the new operations foundation end-to-end (backend ops APIs + Warehouse/Planning/Integrations dashboard flows), refreshes the landing page with founder-led early-stage messaging, removes stale repository artifacts that were no longer part of runtime, and adds regression tests for ops API/nav wiring.

Primary outcomes:
- Ops API + UX workflows are in place and grouped for day-to-day operations.
- Landing is now aligned with practical founder/operator positioning.
- Repo is lighter and easier to reason about.
- New tests reduce regression risk for ops endpoints and nav wiring.
