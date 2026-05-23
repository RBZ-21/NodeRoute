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
      key.includes(`${path.sep}backend${path.sep}routes${path.sep}warehouse-locations.js`)
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

test('warehouse locations reject cross-tenant list, assignment, and delete access', async () => {
  const previousBackupPath = process.env.NODEROUTE_BACKUP_PATH;
  const previousForceDemoMode = process.env.NODEROUTE_FORCE_DEMO_MODE;
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-warehouse-scope-'));

  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  clearBackendModuleCache();

  let server;
  try {
    const { supabase } = require('../services/supabase');
    const router = require('../routes/warehouse-locations');
    const jwtSecret = process.env.JWT_SECRET || 'noderoute-dev-secret-change-in-production';

    await supabase.from('users').insert([
      {
        id: 'warehouse-admin-a',
        name: 'Warehouse Admin A',
        email: 'warehouse.a@noderoute.test',
        role: 'admin',
        status: 'active',
        company_id: 'company-warehouse-a',
        location_id: 'ops-location-a',
        accessible_company_ids: ['company-warehouse-a'],
        accessible_location_ids: ['ops-location-a'],
      },
      {
        id: 'warehouse-admin-b',
        name: 'Warehouse Admin B',
        email: 'warehouse.b@noderoute.test',
        role: 'admin',
        status: 'active',
        company_id: 'company-warehouse-b',
        location_id: 'ops-location-b',
        accessible_company_ids: ['company-warehouse-b'],
        accessible_location_ids: ['ops-location-b'],
      },
    ]);

    await supabase.from('warehouse_locations').insert([
      {
        id: 'warehouse-location-a',
        company_id: 'company-warehouse-a',
        location_id: 'ops-location-a',
        name: 'Tenant A Cooler',
        type: 'cooler',
        status: 'active',
      },
      {
        id: 'warehouse-location-b',
        company_id: 'company-warehouse-b',
        location_id: 'ops-location-b',
        name: 'Tenant B Dry Storage',
        type: 'dry',
        status: 'active',
      },
    ]);

    await supabase.from('products').insert([
      {
        id: 'warehouse-product-a',
        item_number: 'ITEM-A',
        name: 'Tenant A Product',
        company_id: 'company-warehouse-a',
        location_id: 'ops-location-a',
      },
      {
        id: 'warehouse-product-b',
        item_number: 'ITEM-B',
        name: 'Tenant B Product',
        company_id: 'company-warehouse-b',
        location_id: 'ops-location-b',
      },
    ]);

    await supabase.from('inventory_location_assignments').insert({
      id: 'assignment-a',
      item_number: 'ITEM-A',
      location_id: 'warehouse-location-a',
      qty_at_location: 4,
      notes: 'Tenant A stock',
    });

    const app = express();
    app.use(express.json());
    app.use('/api/warehouse/locations', router);
    server = await listen(app);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const tenantBToken = jwt.sign({ userId: 'warehouse-admin-b' }, jwtSecret, { expiresIn: '1h' });
    const tenantBHeaders = {
      Authorization: `Bearer ${tenantBToken}`,
      'Content-Type': 'application/json',
    };

    const listResponse = await fetch(`${baseUrl}/api/warehouse/locations`, {
      headers: tenantBHeaders,
    });
    assert.equal(listResponse.status, 200);
    const locations = await listResponse.json();
    assert.deepEqual(locations.map((location) => location.id), ['warehouse-location-b']);

    const inventoryResponse = await fetch(`${baseUrl}/api/warehouse/locations/warehouse-location-a/inventory`, {
      headers: tenantBHeaders,
    });
    assert.equal(inventoryResponse.status, 403);

    const assignResponse = await fetch(`${baseUrl}/api/warehouse/locations/warehouse-location-a/assign`, {
      method: 'POST',
      headers: tenantBHeaders,
      body: JSON.stringify({ item_number: 'ITEM-B', qty_at_location: 2 }),
    });
    assert.equal(assignResponse.status, 403);

    const deleteResponse = await fetch(`${baseUrl}/api/warehouse/locations/warehouse-location-a/items/ITEM-A`, {
      method: 'DELETE',
      headers: tenantBHeaders,
    });
    assert.equal(deleteResponse.status, 403);

    const { data: tenantAAssignments } = await supabase
      .from('inventory_location_assignments')
      .select('*')
      .eq('location_id', 'warehouse-location-a');
    assert.equal(tenantAAssignments.length, 1);
    assert.equal(tenantAAssignments[0].item_number, 'ITEM-A');
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
