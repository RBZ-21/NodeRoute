'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const crypto = require('node:crypto');

function addressHash(value) {
  return crypto.createHash('sha256').update(String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()).digest('hex');
}

function clearBackendModuleCache() {
  for (const key of Object.keys(require.cache)) {
    if (
      key.includes(`${path.sep}backend${path.sep}services${path.sep}supabase.js`) ||
      key.includes(`${path.sep}backend${path.sep}middleware${path.sep}auth.js`) ||
      key.includes(`${path.sep}backend${path.sep}routes${path.sep}maps.js`) ||
      key.includes(`${path.sep}backend${path.sep}services${path.sep}google-maps.js`)
    ) {
      delete require.cache[key];
    }
  }
}

function installGoogleMapsServiceMock(mockExports) {
  const servicePath = path.resolve(__dirname, '../services/google-maps.js');
  require.cache[servicePath] = {
    id: servicePath,
    filename: servicePath,
    loaded: true,
    exports: mockExports,
  };
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function withMapsApp(fn) {
  const previousBackupPath = process.env.NODEROUTE_BACKUP_PATH;
  const previousForceDemoMode = process.env.NODEROUTE_FORCE_DEMO_MODE;
  const previousMapsKey = process.env.GOOGLE_MAPS_API_KEY;
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-maps-'));

  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  process.env.GOOGLE_MAPS_API_KEY = 'server-only-test-key';
  clearBackendModuleCache();

  const calls = { geocode: 0, distance: 0, directions: 0 };
  installGoogleMapsServiceMock({
    geocodeAddress: async () => {
      calls.geocode += 1;
      return { lat: 32.781, lng: -79.931, formatted_address: '1 Dock St, Charleston, SC' };
    },
    getDistanceMatrix: async () => {
      calls.distance += 1;
      return {
        rows: [{
          elements: [{
            status: 'OK',
            duration: { value: 720 },
            distance: { value: 6437 },
          }],
        }],
      };
    },
    getDirections: async (_routeId, waypointLatLngs) => {
      calls.directions += 1;
      return {
        encoded_polyline: 'encoded-route',
        legs: waypointLatLngs.slice(1).map((point, index) => ({
          stop_id: point.stop_id,
          sequence: index + 1,
          duration_seconds: 300 + index,
        })),
      };
    },
    buildRouteWaypointLatLngs: (route, stops) => {
      const byId = new Map(stops.map((stop) => [String(stop.id), stop]));
      return (route.active_stop_ids || route.stop_ids || [])
        .map((id) => byId.get(String(id)))
        .filter((stop) => Number.isFinite(Number(stop?.lat)) && Number.isFinite(Number(stop?.lng)))
        .map((stop, index) => ({
          stop_id: String(stop.id),
          sequence: index + 1,
          lat: Number(stop.lat),
          lng: Number(stop.lng),
          name: stop.name,
          address: stop.address,
        }));
    },
  });

  let server;
  try {
    const { supabase } = require('../services/supabase');
    const mapsRouter = require('../routes/maps');
    const jwtSecret = process.env.JWT_SECRET || 'noderoute-dev-secret-change-in-production';

    await supabase.from('users').insert([
      {
        id: 'maps-admin-a',
        name: 'Maps Admin A',
        email: 'maps-a@noderoute.test',
        role: 'admin',
        status: 'active',
        company_id: 'company-maps-a',
        location_id: 'location-maps-a',
      },
      {
        id: 'maps-admin-b',
        name: 'Maps Admin B',
        email: 'maps-b@noderoute.test',
        role: 'admin',
        status: 'active',
        company_id: 'company-maps-b',
        location_id: 'location-maps-b',
      },
    ]);

    await supabase.from('locations').insert([
      {
        id: 'warehouse-a',
        company_id: 'company-maps-a',
        name: 'Warehouse A',
        address: '10 Wharf St',
        city: 'Charleston',
        state: 'SC',
        postal_code: '29401',
      },
      {
        id: 'warehouse-b',
        company_id: 'company-maps-b',
        name: 'Warehouse B',
        address: '99 Other St',
      },
    ]);

    await supabase.from('Customers').insert([
      {
        id: 'customer-a',
        company_id: 'company-maps-a',
        location_id: 'location-maps-a',
        company_name: 'Blue Fin',
        address: '1 Dock St',
      },
      {
        id: 'customer-b',
        company_id: 'company-maps-b',
        location_id: 'location-maps-b',
        company_name: 'Red Crab',
        address: '2 Pier Ave',
      },
    ]);

    const app = express();
    app.use(express.json());
    app.use('/api/maps', mapsRouter);
    server = await listen(app);

    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const tokenFor = (userId) => jwt.sign({ userId }, jwtSecret, { expiresIn: '1h' });
    await fn({ baseUrl, supabase, tokenFor, calls });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (previousBackupPath === undefined) delete process.env.NODEROUTE_BACKUP_PATH;
    else process.env.NODEROUTE_BACKUP_PATH = previousBackupPath;
    if (previousForceDemoMode === undefined) delete process.env.NODEROUTE_FORCE_DEMO_MODE;
    else process.env.NODEROUTE_FORCE_DEMO_MODE = previousForceDemoMode;
    if (previousMapsKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = previousMapsKey;
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

test('maps customer geocoding writes cache and cache hits skip Google geocoding', async () => {
  await withMapsApp(async ({ baseUrl, supabase, tokenFor, calls }) => {
    const token = tokenFor('maps-admin-a');

    const first = await fetch(`${baseUrl}/api/maps/geocode-customer/customer-a`, {
      method: 'POST',
      headers: authHeaders(token),
    });
    assert.equal(first.status, 200);
    assert.equal(calls.geocode, 1);
    assert.deepEqual(await first.json(), {
      customer_id: 'customer-a',
      lat: 32.781,
      lng: -79.931,
      formatted_address: '1 Dock St, Charleston, SC',
      cached: false,
    });

    const { data: cachedRows } = await supabase
      .from('customer_geocodes')
      .select('*')
      .eq('customer_id', 'customer-a');
    assert.equal(cachedRows.length, 1);
    assert.equal(cachedRows[0].company_id, 'company-maps-a');

    const second = await fetch(`${baseUrl}/api/maps/geocode-customer/customer-a`, {
      method: 'POST',
      headers: authHeaders(token),
    });
    assert.equal(second.status, 200);
    assert.equal(calls.geocode, 1);
    const secondBody = await second.json();
    assert.equal(secondBody.cached, true);
    assert.equal(secondBody.lat, 32.781);
  });
});

test('maps drive-time cache hit skips Google Distance Matrix call', async () => {
  await withMapsApp(async ({ baseUrl, supabase, tokenFor, calls }) => {
    const warehouseHash = addressHash('10 Wharf St, Charleston, SC, 29401');
    const customerHash = addressHash('1 Dock St');
    await supabase.from('warehouse_geocodes').insert({
      id: 'warehouse-cache-a',
      company_id: 'company-maps-a',
      location_id: 'warehouse-a',
      address_hash: warehouseHash,
      lat: 32.79,
      lng: -79.94,
      geocoded_at: '2026-06-28T00:00:00.000Z',
    });
    await supabase.from('customer_geocodes').insert({
      id: 'customer-cache-a',
      company_id: 'company-maps-a',
      customer_id: 'customer-a',
      address_hash: customerHash,
      lat: 32.781,
      lng: -79.931,
      geocoded_at: '2026-06-28T00:00:00.000Z',
    });
    await supabase.from('route_drive_time_cache').insert({
      id: 'drive-cache-a',
      company_id: 'company-maps-a',
      location_id: 'location-maps-a',
      origin_hash: warehouseHash,
      destination_hash: customerHash,
      travel_mode: 'driving',
      day_bucket: new Date().toISOString().slice(0, 10),
      duration_seconds: 615,
      distance_meters: 4828,
      cached_at: '2026-06-28T00:00:00.000Z',
    });

    const response = await fetch(`${baseUrl}/api/maps/drive-time?from=warehouse-a&to=customer-a&mode=driving`, {
      headers: authHeaders(tokenFor('maps-admin-a')),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      duration_seconds: 615,
      distance_meters: 4828,
      cached: true,
    });
    assert.equal(calls.distance, 0);
  });
});

test('maps endpoints do not expose another tenant customer', async () => {
  await withMapsApp(async ({ baseUrl, tokenFor, calls }) => {
    const response = await fetch(`${baseUrl}/api/maps/geocode-customer/customer-a`, {
      method: 'POST',
      headers: authHeaders(tokenFor('maps-admin-b')),
    });

    assert.equal(response.status, 404);
    assert.match((await response.json()).error, /customer not found/i);
    assert.equal(calls.geocode, 0);
  });
});
