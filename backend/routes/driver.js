const express = require('express');
const { z } = require('zod');
const { supabase } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { loadDriverInvoiceScope, stopMatchesInvoice } = require('../services/driver-invoice-access');
const {
  buildScopeFields,
  executeWithOptionalScope,
  filterRowsByContext,
  insertRecordWithOptionalScope,
  scopeQueryByContext,
} = require('../services/operating-context');
const { validateBody } = require('../lib/zod-validate');

const router = express.Router();
const STALE_THRESHOLD_SECONDS = 120;
const LOCATION_UPDATE_MIN_INTERVAL_MS = 5000;

const driverLocationBodySchema = z.object({
  lat: z.coerce.number(),
  lng: z.coerce.number(),
  heading: z.any().optional(),
  speed_mph: z.any().optional(),
}).superRefine((body, ctx) => {
  if (!Number.isFinite(body.lat) || body.lat < -90 || body.lat > 90 || !Number.isFinite(body.lng) || body.lng < -180 || body.lng > 180) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Valid lat and lng are required' });
  }
});

function routeStopIdsForToday(route) {
  const templateIds = Array.isArray(route?.stop_ids) ? route.stop_ids : [];
  if (!Array.isArray(route?.active_stop_ids)) return templateIds;
  const activeSet = new Set(route.active_stop_ids.map(id => String(id)));
  return templateIds.filter(id => activeSet.has(String(id)));
}

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function isRouteAssignedToUser(route, user) {
  return (
    String(route.driver_id || '') === String(user.id || '') ||
    normalize(route.driver_email) === normalize(user.email) ||
    normalize(route.driver) === normalize(user.name)
  );
}

// GET /api/driver/routes — this driver's routes with hydrated stops (incl. door_code)
router.get('/routes', authenticateToken, requireRole('driver'), async (req, res) => {
  const { data: routes, error: rErr } = await scopeQueryByContext(
    supabase.from('routes').select('*'),
    req.context
  ).order('created_at', { ascending: false });

  if (rErr) return res.status(500).json({ error: rErr.message });
  const assignedRoutes = filterRowsByContext(routes || [], req.context)
    .filter(route => isRouteAssignedToUser(route, req.user));
  if (!assignedRoutes.length) return res.json([]);

  const allIds = [...new Set(assignedRoutes.flatMap(routeStopIdsForToday))];
  if (!allIds.length) return res.json(assignedRoutes.map(r => ({ ...r, stops: [] })));

  const { data: stops, error: sErr } = await scopeQueryByContext(
    supabase.from('stops').select('*'),
    req.context
  ).in('id', allIds);

  if (sErr) return res.status(500).json({ error: sErr.message });
  const scopedStops = filterRowsByContext(stops || [], req.context);

  let invoiceScope;
  try {
    invoiceScope = await loadDriverInvoiceScope(supabase, req.user, req.context);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
  const scopedInvoices = invoiceScope.invoices || [];

  // For stops without a door code, try to match via portal_contacts by name
  const namesToLookup = scopedStops
    .filter(s => !s.door_code && s.name)
    .map(s => s.name);

  let contactCodeMap = {};
  if (namesToLookup.length) {
    const { data: contacts, error: cErr } = await scopeQueryByContext(
      supabase.from('portal_contacts').select('*'),
      req.context
    ).not('door_code', 'is', null);
    if (cErr) return res.status(500).json({ error: cErr.message });
    const scopedContacts = filterRowsByContext(contacts || [], req.context);
    scopedContacts.forEach(c => {
      if (c.name) contactCodeMap[c.name.toLowerCase().trim()] = c.door_code;
    });
  }

  const stopMap = {};
  scopedStops.forEach(s => {
    const code = s.door_code || contactCodeMap[(s.name || '').toLowerCase().trim()] || null;
    const invoice = scopedInvoices.find((candidate) => stopMatchesInvoice(s, candidate)) || null;
    stopMap[s.id] = {
      ...s,
      door_code: code,
      invoice_id: invoice?.id || null,
      invoice_number: invoice?.invoice_number || null,
      invoice_status: invoice?.status || null,
      invoice_signed_at: invoice?.signed_at || null,
      invoice_has_signature: !!(invoice?.signature_data || s.signature_data),
      invoice_has_proof_of_delivery: !!invoice?.proof_of_delivery_image_data,
      invoice_proof_of_delivery_uploaded_at: invoice?.proof_of_delivery_uploaded_at || null,
    };
  });

  return res.json(assignedRoutes.map(r => ({
    ...r,
    stops: routeStopIdsForToday(r)
      .map((id, i) => stopMap[id] ? { ...stopMap[id], position: i + 1 } : null)
      .filter(Boolean),
  })));
});

router.get('/location', authenticateToken, async (req, res) => {
  const lookupQuery = scopeQueryByContext(
    req.user.id
      ? supabase.from('driver_locations').select('*').eq('user_id', req.user.id)
      : supabase.from('driver_locations').select('*').ilike('driver_name', req.user.name),
    req.context
  );
  const { data, error } = await lookupQuery
    .order('updated_at', { ascending: false })
    .limit(10);

  if (error) return res.status(500).json({ error: error.message });
  const scopedLocations = filterRowsByContext(data || [], req.context);
  res.json(scopedLocations[0] || null);
});

async function loadCurrentDriverLocation(req) {
  if (!req.user.id) return null;
  const { data, error } = await scopeQueryByContext(
    supabase.from('driver_locations').select('*').eq('user_id', req.user.id),
    req.context
  ).order('updated_at', { ascending: false })
    .limit(10);
  if (error) throw error;
  const scopedLocations = filterRowsByContext(data || [], req.context);
  return scopedLocations[0] || null;
}

// POST /api/driver/heartbeat
// Lightweight ping that updates updated_at on the driver's location record
// without requiring a full lat/lng payload. Used to keep the location record
// fresh when the driver is stationary (e.g., at a long stop).
router.post('/heartbeat', authenticateToken, requireRole('driver', 'manager', 'admin'), async (req, res) => {
  try {
    const location = await loadCurrentDriverLocation(req);
    if (!location?.id) return res.status(204).end();

    const updatedAt = new Date().toISOString();
    const { data, error } = await supabase
      .from('driver_locations')
      .update({ updated_at: updatedAt })
      .eq('id', location.id)
      .select('updated_at')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true, updatedAt: data?.updated_at || updatedAt });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// Returns whether the current driver's location record is fresh or stale.
// Used by the driver app to show a self-diagnostic warning if the app
// detects it hasn't updated recently.
router.get('/location-status', authenticateToken, requireRole('driver', 'manager', 'admin'), async (req, res) => {
  try {
    const location = await loadCurrentDriverLocation(req);
    const lastUpdatedSecondsAgo = location?.updated_at
      ? Math.round((Date.now() - new Date(location.updated_at).getTime()) / 1000)
      : null;
    return res.json({
      hasLocation: !!location,
      lastUpdatedSecondsAgo,
      isStale: lastUpdatedSecondsAgo === null || lastUpdatedSecondsAgo > STALE_THRESHOLD_SECONDS,
      staleThresholdSeconds: STALE_THRESHOLD_SECONDS,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/invoices', authenticateToken, requireRole('driver', 'manager', 'admin'), async (req, res) => {
  try {
    const scope = await loadDriverInvoiceScope(supabase, req.user, req.context);
    res.json(scope.invoices);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.patch('/location', authenticateToken, requireRole('driver', 'manager', 'admin'), validateBody(driverLocationBodySchema), async (req, res) => {
  const { lat, lng, heading, speed_mph: speedMph } = req.validated.body;

  const payload = {
    ...buildScopeFields(req.context),
    user_id: req.user.id || null,
    driver_name: req.user.name,
    lat,
    lng,
    heading: Number.isFinite(Number(heading)) ? Number(heading) : 0,
    speed_mph: Number.isFinite(Number(speedMph)) ? Number(speedMph) : 0,
    updated_at: new Date().toISOString(),
  };

  // Prefer user_id lookup; fall back to driver_name for legacy records
  const lookupQuery = scopeQueryByContext(
    req.user.id
      ? supabase.from('driver_locations').select('*').eq('user_id', req.user.id)
      : supabase.from('driver_locations').select('*').ilike('driver_name', req.user.name),
    req.context
  );
  const { data: existingRows, error: existingError } = await lookupQuery
    .order('updated_at', { ascending: false })
    .limit(10);

  if (existingError) return res.status(500).json({ error: existingError.message });

  const scopedExisting = filterRowsByContext(existingRows || [], req.context);
  const lastUpdatedAt = scopedExisting[0]?.updated_at ? new Date(scopedExisting[0].updated_at).getTime() : 0;
  if (lastUpdatedAt && Date.now() - lastUpdatedAt < LOCATION_UPDATE_MIN_INTERVAL_MS) {
    res.setHeader('Retry-After', '5');
    return res.status(429).json({ error: 'Driver location updates are limited to once every 5 seconds' });
  }

  let result;
  if (scopedExisting[0]?.id) {
    result = await executeWithOptionalScope(
      (candidate) => supabase
        .from('driver_locations')
        .update(candidate)
        .eq('id', scopedExisting[0].id)
        .select('*')
        .single(),
      payload
    );
  } else {
    result = await insertRecordWithOptionalScope(supabase, 'driver_locations', payload, req.context);
  }

  if (result.error) return res.status(500).json({ error: result.error.message });
  res.json(result.data);
});

router.get('/summary', authenticateToken, requireRole('driver'), async (req, res) => {
  const { data: routes, error: routesErr } = await scopeQueryByContext(
    supabase.from('routes').select('*'),
    req.context
  ).order('created_at', { ascending: false });
  if (routesErr) return res.status(500).json({ error: routesErr.message });

  const assignedRoutes = filterRowsByContext(routes || [], req.context)
    .filter(route => isRouteAssignedToUser(route, req.user));
  const totalStopsAssigned = assignedRoutes.reduce((sum, route) => sum + routeStopIdsForToday(route).length, 0);

  return res.json({
    driver: {
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
    },
    summary: {
      routesAssigned: assignedRoutes.length,
      totalStopsAssigned,
      assignedRouteNames: assignedRoutes.map(route => route.name).filter(Boolean),
    },
  });
});

module.exports = router;
module.exports.routeStopIdsForToday = routeStopIdsForToday;
module.exports.STALE_THRESHOLD_SECONDS = STALE_THRESHOLD_SECONDS;
module.exports.LOCATION_UPDATE_MIN_INTERVAL_MS = LOCATION_UPDATE_MIN_INTERVAL_MS;
