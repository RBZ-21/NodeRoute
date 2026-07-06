'use strict';

// LP-001 / LP-002 regression tests (Root Depth Scan, commit 904d7119).
// LP-001: landing-v2/index.html had no OG/Twitter Card/robots meta, favicon,
// or manifest — shares rendered bare links and crawlers got no directives.
// LP-002: WaitlistForm inputs were placeholder-only with no accessible name.
// (landing-v2 has no test runner; the backend suite already asserts on other
// packages' sources, so these checks live here.)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

test('landing page declares robots, Open Graph, and Twitter Card metadata', () => {
  const html = read('landing-v2/index.html');
  assert.match(html, /<meta name="robots" content="index, follow"/);
  for (const property of ['og:type', 'og:site_name', 'og:url', 'og:title', 'og:description', 'og:image']) {
    assert.ok(html.includes(`property="${property}"`), `missing ${property}`);
  }
  for (const name of ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image']) {
    assert.ok(html.includes(`name="${name}"`), `missing ${name}`);
  }
});

test('landing page links a favicon, apple-touch-icon, and web manifest', () => {
  const html = read('landing-v2/index.html');
  assert.match(html, /<link rel="icon"[^>]*noderoute-logo\.png/);
  assert.match(html, /<link rel="apple-touch-icon"/);
  assert.match(html, /<link rel="manifest" href="\/site\.webmanifest"/);

  const manifest = JSON.parse(read('landing-v2/public/site.webmanifest'));
  assert.equal(manifest.name, 'NodeRoute Systems');
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0, 'manifest needs at least one icon');
  // The referenced icon must actually exist in public/.
  const iconPath = manifest.icons[0].src.replace(/^\//, '');
  assert.ok(fs.existsSync(path.join(repoRoot, 'landing-v2', 'public', iconPath)), 'manifest icon file missing');
});

test('waitlist form inputs all have accessible names (LP-002)', () => {
  const source = read('landing-v2/src/components/WaitlistForm.tsx');
  const inputs = source.match(/<input[\s\S]*?\/>/g) || [];
  assert.ok(inputs.length >= 3, 'expected the three waitlist inputs');
  for (const input of inputs) {
    assert.ok(
      /aria-label=/.test(input) || /id=/.test(input),
      `input lacks an accessible name (aria-label or label/id pairing): ${input.slice(0, 80)}...`
    );
  }
});
