# JWT Storage Migration Plan

## Current State

JWTs are stored in `localStorage`. This is functional but exposes tokens to
XSS attacks — any injected script on the page can read and exfiltrate them.

## Headers Shipped (this PR)

The following headers reduce XSS surface area in the meantime:

| Header | Value |
|--------|-------|
| `Content-Security-Policy` | Restricts script/style/connect sources |
| `X-Frame-Options` | `DENY` — prevents clickjacking |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Permissions-Policy` | Disables camera, mic, geo, payment |
| `Strict-Transport-Security` | HSTS in production (2-year max-age) |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `same-origin` |

## Migration Path (future)

### Step 1 — Dual-write
Issue JWTs as both `Authorization: Bearer` (existing) and `Set-Cookie: token=...; HttpOnly; Secure; SameSite=Strict`.
Frontend continues using localStorage; cookie is ignored by the server for now.

### Step 2 — Server reads cookie first
Server middleware checks for the HttpOnly cookie before falling back to the
`Authorization` header. Both paths stay active.

### Step 3 — Frontend stops writing to localStorage
Remove `localStorage.setItem('token', ...)` from `api.ts`. All auth is now
cookie-based. Add CSRF token (double-submit cookie or synchronizer token pattern).

### Step 4 — Remove header fallback
Drop the `Authorization` header read path from `authenticateToken` middleware.
Cookie + CSRF is the only auth mechanism.

## CSRF Considerations

With `SameSite=Strict`, CSRF is largely mitigated for same-site requests.
For cross-origin API consumers (e.g. mobile apps), keep a separate API-key
or short-lived token mechanism — do not extend the cookie auth to them.

## Timeline

This migration is non-breaking if done in order. Steps 1–2 can ship together;
Step 3 requires a coordinated frontend release; Step 4 is cleanup.
