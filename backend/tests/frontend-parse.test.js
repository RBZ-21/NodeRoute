const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..', '..');

for (const fileName of ['index.html', 'driver.html', 'customer-portal.html', 'track.html', 'landing.html']) {
  test(`${fileName} inline scripts parse`, () => {
    const htmlPath = path.join(repoRoot, 'frontend', fileName);
    const html = fs.readFileSync(htmlPath, 'utf8');
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];

    for (const [index, match] of scripts.entries()) {
      assert.doesNotThrow(() => new Function(match[1]), `${fileName} script ${index} should parse`);
    }
  });
}
