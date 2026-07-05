'use strict';

/**
 * Origin allowlist for the API surface only.
 *
 * Static assets (the landing page, dashboard, and driver-app bundles) are
 * exempt on purpose: browsers send an `Origin` header on same-origin
 * module-script loads (`<script type="module" crossorigin>`), so gating
 * static files on the allowlist can blank an entire site for any host that
 * is missing from CORS_ORIGINS — which is exactly what happened on
 * www.noderoutesystems.com. Cross-origin reads of public static assets are
 * harmless; the allowlist exists to protect credentialed API calls, so it is
 * enforced only where credentials flow.
 *
 * The allowlist semantics for scoped paths are unchanged from the previous
 * global middleware: unknown origins get 403, allowed origins are echoed
 * back with Vary: Origin, credentials stay enabled, and OPTIONS preflights
 * short-circuit with 204.
 */
const DEFAULT_SCOPED_PREFIXES = ['/api', '/auth'];

function corsAllowlist({ allowedOrigins, scopedPrefixes = DEFAULT_SCOPED_PREFIXES }) {
  const origins = Array.isArray(allowedOrigins) ? allowedOrigins : [];
  const prefixes = Array.isArray(scopedPrefixes) ? scopedPrefixes : DEFAULT_SCOPED_PREFIXES;

  return function corsMiddleware(req, res, next) {
    const scoped = prefixes.some(
      (p) => req.path === p || req.path.startsWith(`${p}/`)
    );
    if (!scoped) return next();

    const origin = req.headers.origin || '';
    if (origin) {
      if (!origins.includes(origin)) {
        return res.status(403).json({ error: 'CORS origin not allowed' });
      }
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-CSRF-Token,sentry-trace,baggage');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  };
}

module.exports = { corsAllowlist, DEFAULT_SCOPED_PREFIXES };
