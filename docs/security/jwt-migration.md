# JWT Storage Migration Plan

## Current State

Browser JWT access tokens are stored only in HttpOnly cookies with a 15-minute lifetime. A separate HttpOnly refresh cookie lasts 7 days and is rotated through the uth_refresh_sessions table on /auth/refresh; reused, revoked, expired, or mismatched refresh tokens are rejected and cookies are cleared. localStorage stores only the non-authoritative user profile used for role-aware UI rendering.

Driver native/API clients still use bearer access and refresh tokens because they are not browser-cookie clients; those access tokens are also 15 minutes and refresh tokens are 7 days.

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

## Migration Path

Steps 1-3 are complete for the browser app: the server issues HttpOnly cookies, reads cookie credentials, the frontend no longer stores JWTs in localStorage, and the frontend refreshes sessions through /auth/refresh before redirecting to login. Step 4 remains intentionally deferred for mobile/driver bearer-token compatibility.

## CSRF Considerations

With `SameSite=Strict`, CSRF is largely mitigated for same-site requests.
For cross-origin API consumers (e.g. mobile apps), keep a separate API-key
or short-lived token mechanism — do not extend the cookie auth to them.

## Timeline

This migration is non-breaking if done in order. Steps 1–2 can ship together;
Step 3 requires a coordinated frontend release; Step 4 is cleanup.
