'use strict';

/**
 * Canonical-host redirect: send `www.<canonical>` to the canonical apex host.
 *
 * Why this exists: the landing page's index.html loads its Vite assets with a
 * `crossorigin` attribute, which makes browsers send an `Origin` header even
 * for same-origin module-script requests. When the www subdomain was missing
 * from CORS_ORIGINS, every asset request from www 403'd ("CORS origin not
 * allowed") and visitors saw a blank black page. Serving exactly one
 * canonical host removes that failure class entirely (and the www/apex
 * duplicate-content SEO cost), instead of depending on the allowlist being
 * complete.
 *
 * Behavior:
 * - Only requests whose host is exactly `www.<canonicalHost>` are redirected.
 * - GET/HEAD redirect with 301 (permanent); other methods use 308 so the
 *   method and body are preserved.
 * - Path and query string are preserved.
 * - With no canonical host configured, the middleware is a no-op.
 */
function canonicalHostRedirect(canonicalHost) {
  const canonical = String(canonicalHost || '').trim().toLowerCase();
  const wwwHost = canonical ? `www.${canonical}` : null;

  return function canonicalHostMiddleware(req, res, next) {
    if (!wwwHost) return next();
    const rawHost = req.headers['x-forwarded-host'] || req.headers.host || '';
    const host = String(rawHost)
      .split(',')[0]
      .trim()
      .toLowerCase()
      .replace(/:\d+$/, '');
    if (host !== wwwHost) return next();
    const status = req.method === 'GET' || req.method === 'HEAD' ? 301 : 308;
    return res.redirect(status, `https://${canonical}${req.originalUrl}`);
  };
}

module.exports = { canonicalHostRedirect };
