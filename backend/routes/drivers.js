// Admin/manager route: /api/drivers
// Provides the driver roster list used by DriversPage.tsx
// Separate from /api/driver (driver-self-service routes in driver.js)
const express = require('express');
const { supabase, dbQuery } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const {
  filterRowsByContext,
  rowMatchesContext,
} = require('../services/operating-context');

const router = express.Router();

const DRIVER_FIELDS = [
  'name',
  'email',
  'phone',
  'status',
  'vehicle',
  'license_number',
  'notes',
];

function driverPayload(source) {
  const payload = {};
  DRIVER_FIELDS.forEach(field => {
    if (source[field] !== undefined) payload[field] = source[field] ?? null;
  });
  return payload;
}

// GET /api/drivers — admin/manager roster view
router.get('/', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  // Pull from users table where role = 'driver'
  const data = await dbQuery(
    supabase
      .from('users')
      .select('id, name, email, phone, status, role, created_at')
      .eq('role', 'driver')
      .order('name', { ascending: true }),
    res
  );
  if (!data) return;

  const scoped = filterRowsByContext(data, req.context);

  // Enrich with latest location
  const driverNames = scoped.map(d => d.name).filter(Boolean);
  let locationMap = {};
  if (driverNames.length) {
    const { data: locs } = await supabase
      .from('driver_locations')
      .select('driver_name, lat, lng, updated_at')
      .in('driver_name', driverNames);
    (locs || []).forEach(loc => {
      // Keep the most recent location per driver
      if (!locationMap[loc.driver_name] || loc.updated_at > locationMap[loc.driver_name].updated_at) {
        locationMap[loc.driver_name] = loc;
      }
    });
  }

  // Enrich with assigned route from routes table
  const { data: routes } = await supabase
    .from('routes')
    .select('id, name, driver_id, driver, driver_email')
    .order('created_at', { ascending: false });
  const scopedRoutes = filterRowsByContext(routes || [], req.context);

  const enriched = scoped.map(driver => {
    const loc = locationMap[driver.name];
    const assignedRoute = scopedRoutes.find(r =>
      String(r.driver_id || '') === String(driver.id || '') ||
      String(r.driver_email || '').toLowerCase() === String(driver.email || '').toLowerCase()
    );
    return {
      ...driver,
      driverId: driver.id,
      fullName: driver.name,
      vehicle: driver.vehicle || null,
      assignedRoute: assignedRoute?.name || assignedRoute?.id || null,
      routeId: assignedRoute?.id || null,
      lastLocation: loc ? `${Number(loc.lat).toFixed(5)}, ${Number(loc.lng).toFixed(5)}` : null,
      lat: loc?.lat ?? null,
      lng: loc?.lng ?? null,
    };
  });

  res.json(enriched);
});

// PATCH /api/drivers/:id — update driver profile fields
router.patch('/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const existing = await dbQuery(
    supabase.from('users').select('*').eq('id', req.params.id).single(),
    res
  );
  if (!existing) return res.status(404).json({ error: 'Driver not found' });
  if (existing.role !== 'driver') return res.status(400).json({ error: 'User is not a driver' });
  if (!rowMatchesContext(existing, req.context)) return res.status(403).json({ error: 'Forbidden' });

  const payload = driverPayload(req.body);
  if (!Object.keys(payload).length) return res.status(400).json({ error: 'No valid fields provided' });

  const data = await dbQuery(
    supabase.from('users').update(payload).eq('id', req.params.id).select().single(),
    res
  );
  if (!data) return;
  res.json(data);
});

module.exports = router;
