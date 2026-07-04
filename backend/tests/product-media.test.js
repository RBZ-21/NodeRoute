'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');

function clearBackendModuleCache() {
  for (const key of Object.keys(require.cache)) {
    if (
      key.includes(`${path.sep}backend${path.sep}lib${path.sep}config.js`) ||
      key.includes(`${path.sep}backend${path.sep}services${path.sep}supabase.js`) ||
      key.includes(`${path.sep}backend${path.sep}middleware${path.sep}auth.js`) ||
      key.includes(`${path.sep}backend${path.sep}routes${path.sep}product-media.js`)
    ) {
      delete require.cache[key];
    }
  }
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function withProductMediaApp(fn) {
  const previousBackupPath = process.env.NODEROUTE_BACKUP_PATH;
  const previousForceDemoMode = process.env.NODEROUTE_FORCE_DEMO_MODE;
  const previousAllowedHosts = process.env.ALLOWED_IMAGE_HOSTS;
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-product-media-'));

  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  process.env.ALLOWED_IMAGE_HOSTS = 'images.noderoute.test,cdn.example.com';
  clearBackendModuleCache();

  let server;
  try {
    const { supabase } = require('../services/supabase');
    const router = require('../routes/product-media');
    const jwtSecret = process.env.JWT_SECRET || 'noderoute-dev-secret-change-in-production';

    await supabase.from('users').insert([
      {
        id: 'media-admin-a',
        name: 'Media Admin A',
        email: 'media-a@noderoute.test',
        role: 'admin',
        status: 'active',
        company_id: 'company-media-a',
        location_id: 'location-media-a',
      },
      {
        id: 'media-admin-b',
        name: 'Media Admin B',
        email: 'media-b@noderoute.test',
        role: 'admin',
        status: 'active',
        company_id: 'company-media-b',
        location_id: 'location-media-b',
      },
    ]);

    await supabase.from('products').insert([
      {
        id: '11111111-1111-4111-8111-111111111111',
        company_id: 'company-media-a',
        location_id: 'location-media-a',
        item_number: 'FISH-A',
        description: 'Tenant A Fish',
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        company_id: 'company-media-b',
        location_id: 'location-media-b',
        item_number: 'FISH-B',
        description: 'Tenant B Fish',
      },
    ]);

    const app = express();
    app.use(express.json());
    app.use('/api/product-media', router);
    server = await listen(app);

    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const tokenFor = (userId) => jwt.sign({ userId }, jwtSecret, { expiresIn: '1h' });
    await fn({ baseUrl, supabase, tokenFor });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (previousBackupPath === undefined) delete process.env.NODEROUTE_BACKUP_PATH;
    else process.env.NODEROUTE_BACKUP_PATH = previousBackupPath;
    if (previousForceDemoMode === undefined) delete process.env.NODEROUTE_FORCE_DEMO_MODE;
    else process.env.NODEROUTE_FORCE_DEMO_MODE = previousForceDemoMode;
    if (previousAllowedHosts === undefined) delete process.env.ALLOWED_IMAGE_HOSTS;
    else process.env.ALLOWED_IMAGE_HOSTS = previousAllowedHosts;
    clearBackendModuleCache();
    fs.rmSync(backupPath, { recursive: true, force: true });
  }
}

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

const PRODUCT_A = '11111111-1111-4111-8111-111111111111';

test('product media URL validator rejects local and private IP hosts even when allowlisted', () => {
  const previousAllowedHosts = process.env.ALLOWED_IMAGE_HOSTS;
  process.env.ALLOWED_IMAGE_HOSTS = [
    'cdn.example.com',
    'localhost',
    '127.0.0.1',
    '10.0.0.5',
    '172.16.0.10',
    '192.168.1.8',
    '169.254.169.254',
    '[::1]',
  ].join(',');
  clearBackendModuleCache();

  try {
    const router = require('../routes/product-media');

    assert.equal(router.isAllowedImageUrl('https://cdn.example.com/fish.png'), true);
    for (const url of [
      'http://cdn.example.com/fish.png',
      'https://localhost/fish.png',
      'https://127.0.0.1/fish.png',
      'https://10.0.0.5/fish.png',
      'https://172.16.0.10/fish.png',
      'https://192.168.1.8/fish.png',
      'https://169.254.169.254/latest/meta-data',
      'https://[::1]/fish.png',
    ]) {
      assert.equal(router.isAllowedImageUrl(url), false, `${url} should be rejected`);
    }
  } finally {
    if (previousAllowedHosts === undefined) delete process.env.ALLOWED_IMAGE_HOSTS;
    else process.env.ALLOWED_IMAGE_HOSTS = previousAllowedHosts;
    clearBackendModuleCache();
  }
});

test('product media rejects image URLs from hosts outside the allowlist', async () => {
  await withProductMediaApp(async ({ baseUrl, tokenFor }) => {
    const response = await fetch(`${baseUrl}/api/product-media`, {
      method: 'POST',
      headers: authHeaders(tokenFor('media-admin-a')),
      body: JSON.stringify({
        product_id: PRODUCT_A,
        media_type: 'image',
        url: 'https://evil.example.net/fish.png',
        label: 'Bad host',
      }),
    });

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(body.error, /image host is not allowed/i);
  });
});

test('product media enforces a maximum of ten active images per product', async () => {
  await withProductMediaApp(async ({ baseUrl, supabase, tokenFor }) => {
    await supabase.from('product_media').insert(
      Array.from({ length: 10 }, (_, index) => ({
        id: `media-${index}`,
        company_id: 'company-media-a',
        product_id: PRODUCT_A,
        media_type: 'image',
        url: `https://images.noderoute.test/fish-${index}.png`,
        label: `Fish ${index}`,
        sort_order: index,
        deleted_at: null,
      }))
    );

    const response = await fetch(`${baseUrl}/api/product-media`, {
      method: 'POST',
      headers: authHeaders(tokenFor('media-admin-a')),
      body: JSON.stringify({
        product_id: PRODUCT_A,
        media_type: 'image',
        url: 'https://images.noderoute.test/overflow.png',
        label: 'Overflow',
      }),
    });

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(body.error, /maximum of 10/i);
  });
});

test('product media list is scoped to the authenticated company', async () => {
  await withProductMediaApp(async ({ baseUrl, supabase, tokenFor }) => {
    await supabase.from('product_media').insert({
      id: 'tenant-a-media',
      company_id: 'company-media-a',
      product_id: PRODUCT_A,
      media_type: 'image',
      url: 'https://images.noderoute.test/fish.png',
      label: 'Tenant A Fish',
      sort_order: 1,
      deleted_at: null,
    });

    const response = await fetch(`${baseUrl}/api/product-media?productId=${encodeURIComponent(PRODUCT_A)}`, {
      headers: authHeaders(tokenFor('media-admin-b')),
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.media, []);
  });
});
