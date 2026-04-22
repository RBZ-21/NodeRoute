const express = require('express');
const { supabase } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { loadDriverInvoiceScope, stopMatchesInvoice } = require('../services/driver-invoice-access');
const {
  buildScopeFields,
  executeWithOptionalScope,
  filterRowsByContext,
  insertRecordWithOptionalScope,
} = require('../services/operating-context');

const router = express.Router();

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
  const { data: routes, error: rErr } = await supabase
    .from('routes')
    .select('*')
    .order('created_at', { ascending: false });

  if (rErr) return res.status(500).json({ error: rErr.message });
  const assignedRoutes = filterRowsByContext(routes || [], req.context)
    .filter(route => isRouteAssignedToUser(route, req.user));
  if (!assignedRoutes.length) return res.json([]);

  const allIds = [...new Set(assignedRoutes.flatMap(routeStopIdsForToday))];
  if (!allIds.length) return res.json(assignedRoutes.map(r => ({ ...r, stops: [] })));

  const { data: stops, error: sErr } = await supabase
    .from('stops')
    .select('*')
    .in('id', allIds);

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
    const { data: contacts, error: cErr } = await supabase
      .from('portal_contacts')
      .select('*')
      .not('door_code', 'is', null);
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
      invoice_has_signature: !!invoice?.signature_data,
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
  const { data, error } = await supabase
    .from('driver_locations')
    .select('*')
    .ilike('driver_name', req.user.name)
    .order('updated_at', { ascending: false })
    .limit(10);

  if (error) return res.status(500).json({ error: error.message });
  const scopedLocations = filterRowsByContext(data || [], req.context);
  res.json(scopedLocations[0] || null);
});

router.get('/invoices', authenticateToken, requireRole('driver', 'manager', 'admin'), async (req, res) => {
  try {
    const scope = await loadDriverInvoiceScope(supabase, req.user, req.context);
    res.json(scope.invoices);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.patch('/location', authenticateToken, requireRole('driver', 'manager', 'admin'), async (req, res) => {
  const lat = Number(req.body.lat);
  const lng = Number(req.body.lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return res.status(400).json({ error: 'Valid lat and lng are required' });
  }

  const payload = {
    ...buildScopeFields(req.context),
    driver_name: req.user.name,
    lat,
    lng,
    heading: Number.isFinite(Number(req.body.heading)) ? Number(req.body.heading) : 0,
    speed_mph: Number.isFinite(Number(req.body.speed_mph)) ? Number(req.body.speed_mph) : 0,
    updated_at: new Date().toISOString(),
  };

  const { data: existingRows, error: existingError } = await supabase
    .from('driver_locations')
    .select('*')
    .ilike('driver_name', req.user.name)
    .order('updated_at', { ascending: false })
    .limit(10);

  if (existingError) return res.status(500).json({ error: existingError.message });

  const scopedExisting = filterRowsByContext(existingRows || [], req.context);

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
  const { data: routes, error: routesErr } = await supabase
    .from('routes')
    .select('*')
    .order('created_at', { ascending: false });
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
