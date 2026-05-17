const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..', '..');
const viteConfigSource = fs.readFileSync(path.join(repoRoot, 'frontend-v2', 'vite.config.ts'), 'utf8');
const frontendEnvExample = fs.readFileSync(path.join(repoRoot, 'frontend-v2', '.env.example'), 'utf8');

test('frontend build only enables Sentry source-map upload when explicitly opted in', () => {
  for (const marker of [
    "const sentryUploadEnabled = String(env.SENTRY_UPLOAD_SOURCEMAPS || '').toLowerCase() === 'true';",
    'const hasSentryReleaseConfig = sentryUploadEnabled && !!(env.SENTRY_AUTH_TOKEN && env.SENTRY_ORG && env.SENTRY_PROJECT);',
    'telemetry: false,',
  ]) {
    assert.ok(viteConfigSource.includes(marker), `vite config missing marker ${marker}`);
  }
});

test('frontend env example documents the explicit Sentry upload toggle', () => {
  assert.ok(frontendEnvExample.includes('SENTRY_UPLOAD_SOURCEMAPS=false'), 'frontend env example should document Sentry upload opt-in');
});
