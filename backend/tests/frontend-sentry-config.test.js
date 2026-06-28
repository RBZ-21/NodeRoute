const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..', '..');
const viteConfig = fs.readFileSync(path.join(repoRoot, 'frontend-v2', 'vite.config.ts'), 'utf8');
const envExample = fs.readFileSync(path.join(repoRoot, 'frontend-v2', '.env.example'), 'utf8');

test('frontend Sentry source-map upload requires CI and explicit upload flag', () => {
  assert.ok(viteConfig.includes("env.CI === 'true'"), 'Sentry upload must require CI=true');
  assert.ok(viteConfig.includes("env.SENTRY_UPLOAD_SOURCEMAPS === 'true'"), 'Sentry upload must require SENTRY_UPLOAD_SOURCEMAPS=true');
  assert.ok(viteConfig.includes('...(shouldUploadSentrySourcemaps'), 'Sentry Vite plugin must be gated by shouldUploadSentrySourcemaps');
  assert.ok(!viteConfig.includes('...(hasSentryReleaseConfig'), 'Sentry Vite plugin must not run from credentials alone');
  assert.ok(viteConfig.includes('errorHandler'), 'Sentry sourcemap upload failures must not block Railway builds');
  assert.ok(envExample.includes('SENTRY_UPLOAD_SOURCEMAPS=false'), 'frontend env example should document the upload flag');
});
