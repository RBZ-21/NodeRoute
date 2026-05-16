const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..', '..');

// The old monolith HTML files (index.html, driver.html, etc.) were replaced by the
// React frontend-v2. Verify that the key React entry points exist and are non-empty.
const frontendV2Src = path.join(repoRoot, 'frontend-v2', 'src');

for (const relPath of [
  'main.tsx',
  'App.tsx',
  'lib/nav.ts',
  'pages/OrdersPage.tsx',
  'pages/InvoicesPage.tsx',
]) {
  test(`frontend-v2 ${relPath} exists and is non-empty`, () => {
    const fullPath = path.join(frontendV2Src, relPath);
    assert.ok(fs.existsSync(fullPath), `${relPath} must exist`);
    const content = fs.readFileSync(fullPath, 'utf8');
    assert.ok(content.length > 0, `${relPath} must be non-empty`);
  });
}
