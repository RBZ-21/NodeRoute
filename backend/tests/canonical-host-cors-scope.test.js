'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { canonicalHostRedirect } = require('../middleware/canonicalHost');
const { corsAllowlist } = require('../middleware/cors');

function makeReq({ method = 'GET', path: reqPath = '/', headers = {}, originalUrl } = {}) {
  return { method, path: reqPath, headers, originalUrl: originalUrl || reqPath };
}

function makeRes() {
  const res = {
    statusCode: null,
    redirectedTo: null,
    jsonBody: null,
    sentStatus: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.jsonBody = body; return this; },
    redirect(code, url) { this.statusCode = code; this.redirectedTo = url; return this; },
    sendStatus(code) { this.sentStatus = code; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
  return res;
}

// ---------------------------------------------------------------------------
// canonicalHostRedirect
// ---------------------------------------------------------------------------

test('www host 301-redirects to apex, preserving path and query', () => {
  const mw = canonicalHostRedirect('noderoutesystems.com');
  const req = makeReq({
    path: '/assets/index.js',
    originalUrl: '/assets/index.js?v=1',
    headers: { host: 'www.noderoutesystems.com' },
  });
  const res = makeRes();
  let nextCalled = false;
  mw(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 301);
  assert.equal(res.redirectedTo, 'https://noderoutesystems.com/assets/index.js?v=1');
});

test('non-GET methods redirect with 308 to preserve method and body', () => {
  const mw = canonicalHostRedirect('noderoutesystems.com');
  const req = makeReq({
    method: 'POST',
    path: '/api/waitlist',
    headers: { host: 'www.noderoutesystems.com' },
  });
  const res = makeRes();
  mw(req, res, () => {});
  assert.equal(res.statusCode, 308);
  assert.equal(res.redirectedTo, 'https://noderoutesystems.com/api/waitlist');
});

test('apex host and unrelated hosts pass through untouched', () => {
  const mw = canonicalHostRedirect('noderoutesystems.com');
  for (const host of ['noderoutesystems.com', 'app.example.com', 'localhost:3001']) {
    const res = makeRes();
    let nextCalled = false;
    mw(makeReq({ headers: { host } }), res, () => { nextCalled = true; });
    assert.equal(nextCalled, true, `expected pass-through for host ${host}`);
    assert.equal(res.redirectedTo, null);
  }
});

test('respects x-forwarded-host (proxy) and strips ports and casing', () => {
  const mw = canonicalHostRedirect('noderoutesystems.com');
  const req = makeReq({
    path: '/',
    headers: { 'x-forwarded-host': 'WWW.NodeRouteSystems.com:443', host: 'internal.railway.app' },
  });
  const res = makeRes();
  mw(req, res, () => {});
  assert.equal(res.statusCode, 301);
  assert.equal(res.redirectedTo, 'https://noderoutesystems.com/');
});

test('empty canonical host is a no-op', () => {
  const mw = canonicalHostRedirect('');
  const res = makeRes();
  let nextCalled = false;
  mw(makeReq({ headers: { host: 'www.noderoutesystems.com' } }), res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(res.redirectedTo, null);
});

// ---------------------------------------------------------------------------
// corsAllowlist
// ---------------------------------------------------------------------------

const ALLOWED = ['https://noderoutesystems.com', 'https://app.noderoutesystems.com'];

test('static asset requests are never Origin-gated', () => {
  const mw = corsAllowlist({ allowedOrigins: ALLOWED });
  for (const reqPath of ['/', '/assets/index-XIhoXTLW.js', '/dashboard-v2/main.js', '/noderoute-logo.png']) {
    const res = makeRes();
    let nextCalled = false;
    mw(makeReq({ path: reqPath, headers: { origin: 'https://www.noderoutesystems.com' } }), res, () => { nextCalled = true; });
    assert.equal(nextCalled, true, `expected pass-through for ${reqPath}`);
    assert.equal(res.statusCode, null);
    assert.deepEqual(res.headers, {}, 'no CORS headers on static paths');
  }
});

test('unknown origin on the API surface still gets 403', () => {
  const mw = corsAllowlist({ allowedOrigins: ALLOWED });
  for (const reqPath of ['/api/waitlist', '/auth/login']) {
    const res = makeRes();
    mw(makeReq({ path: reqPath, headers: { origin: 'https://evil.example' } }), res, () => {
      assert.fail('next() must not be called for disallowed origins');
    });
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.jsonBody, { error: 'CORS origin not allowed' });
  }
});

test('allowed origin on the API surface is echoed with credentials enabled', () => {
  const mw = corsAllowlist({ allowedOrigins: ALLOWED });
  const res = makeRes();
  let nextCalled = false;
  mw(makeReq({ path: '/api/orders', headers: { origin: ALLOWED[0] } }), res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(res.headers['Access-Control-Allow-Origin'], ALLOWED[0]);
  assert.equal(res.headers['Vary'], 'Origin');
  assert.equal(res.headers['Access-Control-Allow-Credentials'], 'true');
});

test('OPTIONS preflight on the API surface short-circuits with 204', () => {
  const mw = corsAllowlist({ allowedOrigins: ALLOWED });
  const res = makeRes();
  mw(makeReq({ method: 'OPTIONS', path: '/api/orders', headers: { origin: ALLOWED[1] } }), res, () => {
    assert.fail('next() must not be called for preflight');
  });
  assert.equal(res.sentStatus, 204);
});

test('API request without an Origin header passes with response headers set', () => {
  const mw = corsAllowlist({ allowedOrigins: ALLOWED });
  const res = makeRes();
  let nextCalled = false;
  mw(makeReq({ path: '/api/track/abc' }), res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(res.headers['Access-Control-Allow-Methods'], 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
});

// ---------------------------------------------------------------------------
// server.js wiring
// ---------------------------------------------------------------------------

test('server.js wires the canonical-host redirect and scoped CORS, not a global gate', () => {
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(serverSource, /canonicalHostRedirect\(config\.CANONICAL_HOST\)/);
  assert.match(serverSource, /corsAllowlist\(\{ allowedOrigins: config\.CORS_ORIGINS \}\)/);
  assert.doesNotMatch(
    serverSource,
    /CORS origin not allowed/,
    'the inline global CORS gate should be gone from server.js'
  );
});
