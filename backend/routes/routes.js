const express = require('express');
const { supabase, dbQuery } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const {
  executeWithOptionalScope,
  filterRowsByContext,
  insertRecordWithOptionalScope,
  rowMatchesContext,
  scopeQueryByContext,
} = require('../services/operating-context');
const {
  logRouteMutation,
  syncRouteMutation,
} = require('../services/route-stop-sync');
const deliveryNotifications = require('../services/delivery-notifications');
const { buildTrackingUrl } = require('../lib/tracking-url');

const router = express.Router();

function normalizeStopIds(value) {
  if (Array.isArray(value)) return value.map(id => String(id || '').trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map(id => id.trim()).filter(Boolean);
  return [];
}

function hasAssignedDriverId(value) {
  return String(value || '').trim().length > 0;
}

/**
 * Haversine distance in miles between two lat/lng points.
 */
function haversineMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Nearest-neighbor geo-sort for a list of stop IDs.
 * Fetches lat/lng for each stop from the stops table and returns a
 * re-ordered array. Falls back to original order if coordinates are
 * unavailable or fewer than 2 stops have valid coords.
 *
 * @param {string[]} stopIds
 * @param {{ lat?: number, lng?: number }} origin  - warehouse / depot origin
 * @returns {Promise<string[]>}
 */
async function geoSortStopIds(stopIds, origin = { lat: 0, lng: 0 }) {
  if (!stopIds || stopIds.length < 2) return stopIds || [];

  const { data: stops, error } = await supabase
    .from('stops')
    .select('id, lat, lng')
    .in('id', stopIds);

  if (error || !stops || !stops.length) return stopIds;

  // Build id → coords map; skip stops with no valid coordinates
  const coordMap = {};
  for (const s of stops) {
    const lat = parseFloat(s.lat);
    const lng = parseFloat(s.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
      coordMap[s.id] = { lat, lng };
    }
  }

  const sortable = stopIds.filter((id) => coordMap[id]);
  if (sortable.length < 2) return stopIds; // not enough coords to re-order

  // Greedy nearest-neighbor pass starting from origin
  const remaining = [...sortable];
  const sorted   = [];
  let curLat = parseFloat(origin.lat) || 0;
  let curLng = parseFloat(origin.lng) || 0;

  while (remaining.length) {
    let nearest     = null;
    let nearestDist = Infinity;
    for (const id of remaining) {
      const { lat, lng } = coordMap[id];
      const dist = haversineMiles(curLat, curLng, lat, lng);
      if (dist < nearestDist) { nearestDist = dist; nearest = id; }
    }
    sorted.push(nearest);
    curLat = coordMap[nearest].lat;
    curLng = coordMap[nearest].lng;
    remaining.splice(remaining.indexOf(nearest), 1);
  }

  // Append stops with no coords at the end in their original relative order
  const unsortable = stopIds.filter((id) => !coordMap[id]);
  return [...sorted, ...unsortable];
}

// ── ROUTES (Supabase) ───────────────────────────────────
router.get('/', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const data = await dbQuery(scopeQueryByContext(supabase.from('routes').select('*'), req.context).order('created_at', { ascending: true }), res);
  if (!data) return;
  res.json(filterRowsByContext(data, req.context));
});

router.get('/:id', authenticateToken, async (req, res) => {
  const route = await dbQuery(scopeQueryByContext(supabase.from('routes').select('*'), req.context).eq('id', req.params.id).single(), res);
  if (!route) return res.status(404).json({ error: 'Route not found' });

  if (req.user.role === 'driver') {
    const assigned = String(route.driver_id || '') === String(req.user.id || '')
      || String(route.driver_email || '').toLowerCase() === String(req.user.email || '').toLowerCase()
      || String(route.driver || '').trim().toLowerCase() === String(req.user.name || '').trim().toLowerCase();
    if (!assigned) return res.status(403).json({ error: 'Forbidden' });
    return res.json(route);
  }

  if (req.user.role !== 'superadmin' && !['admin', 'manager'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (!rowMatchesContext(route, req.context)) return res.status(403).json({ error: 'Forbidden' });
  res.json(route);
});

router.post('/', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { name, stopIds, activeStopIds, driver, driverId, driverName, notes, originLat, originLng } = req.body;
  const templateStopIds = normalizeStopIds(stopIds);
  const routeName = String(name || '').trim();
  if (!routeName) return res.status(400).json({ error: 'Route name required' });
  const assignedDriverName = driverName || driver || '';

  // QA Step 11: auto-sort stop_ids by nearest-neighbor geography on route creation
  const origin = { lat: originLat || 0, lng: originLng || 0 };
  const sortedStopIds = await geoSortStopIds(templateStopIds, origin);
  const sortedActiveStopIds = activeStopIds !== undefined
    ? await geoSortStopIds(normalizeStopIds(activeStopIds), origin)
    : sortedStopIds;

  const payload = {
    name: routeName,
    stop_ids: sortedStopIds,
    active_stop_ids: sortedActiveStopIds,
    driver: assignedDriverName,
    notes: notes || '',
  };
  if (driverId) payload.driver_id = driverId;
  const insertResult = await insertRecordWithOptionalScope(supabase, 'routes', payload, req.context);
  if (insertResult.error) return res.status(500).json({ error: insertResult.error.message });
  const route = insertResult.data;
  const syncResult = await syncRouteMutation(supabase, {
    routeId: route.id,
    stopIds: sortedStopIds,
    activeStopIds: sortedActiveStopIds,
    action: 'create',
    actor: req.user,
    context: req.context,
    metadata: {
      routeName,
      driverId: driverId || null,
      driverName: assignedDriverName || null,
    },
  });
  if (syncResult.error) return res.status(500).json({ error: syncResult.error.message });
  const data = syncResult.data || route;
  if (!data) return;
  res.json(data);
});

router.patch('/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const existing = await dbQuery(scopeQueryByContext(supabase.from('routes').select('*'), req.context).eq('id', req.params.id).single(), res);
  if (!existing) return res.status(404).json({ error: 'Route not found' });
  if (!rowMatchesContext(existing, req.context)) return res.status(403).json({ error: 'Forbidden' });
  const payload = {};
  if (req.body.name !== undefined) payload.name = String(req.body.name || '').trim();

  // QA Step 11: geo-sort any updated stop lists on PATCH as well
  const origin = { lat: req.body.originLat || 0, lng: req.body.originLng || 0 };

  if (req.body.stopIds !== undefined) {
    payload.stop_ids = await geoSortStopIds(normalizeStopIds(req.body.stopIds), origin);
    if (req.body.activeStopIds === undefined && req.body.active_stop_ids === undefined) {
      payload.active_stop_ids = payload.stop_ids;
    }
  }
  if (req.body.stop_ids !== undefined) {
    payload.stop_ids = await geoSortStopIds(normalizeStopIds(req.body.stop_ids), origin);
    if (req.body.activeStopIds === undefined && req.body.active_stop_ids === undefined) {
      payload.active_stop_ids = payload.stop_ids;
    }
  }
  if (req.body.activeStopIds !== undefined) {
    payload.active_stop_ids = await geoSortStopIds(normalizeStopIds(req.body.activeStopIds), origin);
  }
  if (req.body.active_stop_ids !== undefined) {
    payload.active_stop_ids = await geoSortStopIds(normalizeStopIds(req.body.active_stop_ids), origin);
  }
  if (req.body.driverName !== undefined) payload.driver = req.body.driverName || '';
  if (req.body.driver !== undefined) payload.driver = req.body.driver || '';
  if (req.body.driverId !== undefined) payload.driver_id = req.body.driverId || null;
  if (req.body.driver_id !== undefined) payload.driver_id = req.body.driver_id || null;
  if (req.body.notes !== undefined) payload.notes = req.body.notes || '';
  if (req.body.status !== undefined) payload.status = String(req.body.status || 'pending');
  if (req.body.dispatched_at !== undefined) payload.dispatched_at = req.body.dispatched_at || null;
  if (!Object.keys(payload).length) return res.status(400).json({ error: 'No valid route fields provided' });
  if (payload.name === '') return res.status(400).json({ error: 'Route name required' });
  const dispatchRequested =
    (payload.status !== undefined
      && String(payload.status || '').toLowerCase() === 'active'
      && String(existing.status || '').toLowerCase() !== 'active')
    || (payload.dispatched_at !== undefined && !!payload.dispatched_at && !existing.dispatched_at);
  const nextDriverId = payload.driver_id !== undefined ? payload.driver_id : existing.driver_id;
  if (dispatchRequested && !hasAssignedDriverId(nextDriverId)) {
    return res.status(400).json({
      code: 'ROUTE_DRIVER_REQUIRED',
      error: 'Assign a driver before dispatching this route.',
    });
  }
  const requestedActiveStopsUpdate = payload.active_stop_ids !== undefined;
  const updateResult = await executeWithOptionalScope(
    (candidate) => {
      if (!Object.keys(candidate).length) return Promise.resolve({ data: [], error: null });
      return scopeQueryByContext(supabase.from('routes').update(candidate), req.context).eq('id', req.params.id).select();
    },
    payload
  );
  if (updateResult.error) return res.status(500).json({ error: updateResult.error.message });
  if (requestedActiveStopsUpdate && updateResult.appliedRecord?.active_stop_ids === undefined) {
    return res.status(500).json({
      error: 'Routes table is missing active_stop_ids. Run supabase-routes-active-stops-migration.sql so today\'s active stop selections can be saved.',
    });
  }
  const rows = Array.isArray(updateResult.data) ? updateResult.data : (updateResult.data ? [updateResult.data] : []);
  const updatedRoute = rows[0];
  if (!updatedRoute) return res.status(404).json({ error: 'Route not found or no route fields were updated' });
  const becameDispatched =
    (!!updatedRoute.dispatched_at && !existing.dispatched_at) ||
    (String(updatedRoute.status || '').toLowerCase() === 'active' && String(existing.status || '').toLowerCase() !== 'active');

  const changedRouteLists = payload.stop_ids !== undefined || payload.active_stop_ids !== undefined;
  if (changedRouteLists) {
    const syncResult = await syncRouteMutation(supabase, {
      routeId: req.params.id,
      stopIds: payload.stop_ids !== undefined ? payload.stop_ids : updatedRoute.stop_ids,
      activeStopIds: payload.active_stop_ids !== undefined ? payload.active_stop_ids : updatedRoute.active_stop_ids,
      action: 'update',
      actor: req.user,
      context: req.context,
      metadata: {
        changedFields: Object.keys(payload),
      },
    });
    if (syncResult.error) return res.status(500).json({ error: syncResult.error.message });
    if (becameDispatched) {
      deliveryNotifications.notifyRouteDispatched(supabase, req.params.id, buildTrackingUrl(req, '')).catch(() => {});
    }
    return res.json(syncResult.data || updatedRoute);
  }

  const auditResult = await logRouteMutation(supabase, {
    routeId: req.params.id,
    action: 'update',
    actor: req.user,
    context: req.context,
    beforeStopIds: existing.stop_ids,
    afterStopIds: updatedRoute.stop_ids,
    beforeActiveStopIds: existing.active_stop_ids,
    afterActiveStopIds: updatedRoute.active_stop_ids,
    metadata: {
      changedFields: Object.keys(payload),
    },
  });
  if (auditResult.error) return res.status(500).json({ error: auditResult.error.message });
  if (becameDispatched) {
    deliveryNotifications.notifyRouteDispatched(supabase, req.params.id, buildTrackingUrl(req, '')).catch(() => {});
  }

  res.json(updatedRoute);
});

router.delete('/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const existing = await dbQuery(scopeQueryByContext(supabase.from('routes').select('*'), req.context).eq('id', req.params.id).single(), res);
  if (!existing) return res.status(404).json({ error: 'Route not found' });
  if (!rowMatchesContext(existing, req.context)) return res.status(403).json({ error: 'Forbidden' });
  const syncResult = await syncRouteMutation(supabase, {
    routeId: req.params.id,
    stopIds: [],
    activeStopIds: [],
    action: 'delete',
    actor: req.user,
    context: req.context,
    metadata: {
      deleted: true,
      routeName: existing.name || null,
    },
  });
  if (syncResult.error) return res.status(500).json({ error: syncResult.error.message });
  const { error: deleteError } = await scopeQueryByContext(supabase.from('routes').delete(), req.context).eq('id', req.params.id);
  if (deleteError) return res.status(500).json({ error: deleteError.message });
  res.json({ message: 'Deleted' });
});

module.exports = router;
module.exports.normalizeStopIds = normalizeStopIds;
module.exports.geoSortStopIds = geoSortStopIds;
