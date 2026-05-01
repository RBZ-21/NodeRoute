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
} = require('../services/operating-context');
const { validateBody } = require('../lib/zod-validate');

const router = express.Router();

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

router.patch('/location', authenticateToken, requireRole('driver', 'manager', 'admin'), validateBody(driverLocationBodySchema), async (req, res) => {
  const { lat, lng, heading, speed_mph: speedMph } = req.validated.body;

  const payload = {
    ...buildScopeFields(req.context),
    driver_name: req.user.name,
    lat,
    lng,
    heading: Number.isFinite(Number(heading)) ? Number(heading) : 0,
    speed_mph: Number.isFinite(Number(speedMph)) ? Number(speedMph) : 0,
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
