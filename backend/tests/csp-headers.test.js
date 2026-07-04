'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('production CSP omits unsafe-eval and unsafe-inline from script-src', () => {
  assert.match(serverSource, /buildContentSecurityPolicy/);
  assert.match(serverSource, /config\.NODE_ENV !== 'production'/);
  assert.doesNotMatch(
    serverSource,
    /script-src 'self' 'unsafe-inline' 'unsafe-eval'/
  );
  assert.match(serverSource, /"style-src 'self' https:\/\/fonts\.googleapis\.com"/);
  assert.match(serverSource, /"style-src-attr 'unsafe-inline'"/);
  assert.doesNotMatch(serverSource, /"style-src 'self' 'unsafe-inline'/);
  assert.match(serverSource, /upgrade-insecure-requests/);
});
