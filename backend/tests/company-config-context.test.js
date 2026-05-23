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
      key.includes(`${path.sep}backend${path.sep}services${path.sep}supabase.js`) ||
      key.includes(`${path.sep}backend${path.sep}middleware${path.sep}auth.js`) ||
      key.includes(`${path.sep}backend${path.sep}routes${path.sep}company-config.js`)
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

test('company-config features uses active company context for onboarding gate', async () => {
  const previousBackupPath = process.env.NODEROUTE_BACKUP_PATH;
  const previousForceDemoMode = process.env.NODEROUTE_FORCE_DEMO_MODE;
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-company-config-'));

  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  clearBackendModuleCache();

  let server;
  try {
    const { supabase } = require('../services/supabase');
    const router = require('../routes/company-config');
    const jwtSecret = process.env.JWT_SECRET || 'noderoute-dev-secret-change-in-production';

    await supabase.from('users').insert({
      id: 'tenant-admin-001',
      name: 'Tenant Admin',
      email: 'tenant.admin@noderoute.test',
      role: 'admin',
      status: 'active',
      company_id: 'company-config-a',
      location_id: 'location-config-a',
      accessible_company_ids: ['company-config-a'],
      accessible_location_ids: ['location-config-a'],
    });

    await supabase.from('company_config').insert({
      company_id: 'company-config-a',
      business_types: ['seafood'],
      enabled_units: ['lb', 'case'],
      feat_catch_weight: true,
      feat_fsma_lot_tracking: true,
      feat_cold_chain_notes: false,
      feat_alcohol_compliance: false,
      feat_deposit_tracking: false,
      feat_case_to_each: true,
      catalog_template: 'seafood',
      onboarding_completed: false,
    });

    const app = express();
    app.use(express.json());
    app.use('/api/company-config', router);
    server = await listen(app);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const token = jwt.sign({ userId: 'tenant-admin-001' }, jwtSecret, { expiresIn: '1h' });

    const fullResponse = await fetch(`${baseUrl}/api/company-config`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(fullResponse.status, 200);
    const fullConfig = await fullResponse.json();
    assert.equal(fullConfig.company_id, 'company-config-a');
    assert.equal(fullConfig.catalog_template, 'seafood');

    const featuresResponse = await fetch(`${baseUrl}/api/company-config/features`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(featuresResponse.status, 200);
    const features = await featuresResponse.json();
    assert.deepEqual(features.business_types, ['seafood']);
    assert.deepEqual(features.enabled_units, ['lb', 'case']);
    assert.equal(features.feat_catch_weight, true);
    assert.equal(features.onboarding_completed, false);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (previousBackupPath === undefined) delete process.env.NODEROUTE_BACKUP_PATH;
    else process.env.NODEROUTE_BACKUP_PATH = previousBackupPath;
    if (previousForceDemoMode === undefined) delete process.env.NODEROUTE_FORCE_DEMO_MODE;
    else process.env.NODEROUTE_FORCE_DEMO_MODE = previousForceDemoMode;
    clearBackendModuleCache();
    fs.rmSync(backupPath, { recursive: true, force: true });
  }
});
