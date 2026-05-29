const express = require('express');
const router = express.Router();
const { supabase } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { sendInvoiceEmail } = require('../services/invoice-email');
const deliveryNotifications = require('../services/delivery-notifications');
const { invalidateDashboardCache } = require('./deliveries');
const {
  buildScopeFields,
  executeWithOptionalScope,
  insertRecordWithOptionalScope,
  rowMatchesContext,
  scopeQueryByContext,
} = require('../services/operating-context');
const {
  extractOrderNumberFromStopNotes,
  mergeInvoiceNotesWithDriverNotes,
  statusAfterDeliveryCompletion,
} = require('../services/invoice-delivery');
const { syncRouteMutation } = require('../services/route-stop-sync');

const STOP_FIELDS = [
  'route_id', 'customer_id', 'address', 'status', 'name',
  'scheduled_date', 'scheduled_time', 'notes', 'driver_id',
  'driver_notes', 'door_code',
  'signature_data', 'signature_captured_at', 'signature_captured_by',
  'weight_lbs', 'weight_captured_at', 'weight_captured_by',
];

// Fields a driver is allowed to self-update on their own stops
const DRIVER_ALLOWED_FIELDS = ['driver_notes', 'door_code', 'status'];

function appendDropOffDriverNote(existingNotes) {
  const marker = 'Delivery method: drop off (no signature captured).';
  const normalized = String(existingNotes || '').trim();
  if (normalized.toLowerCase().includes(marker.toLowerCase())) return normalized || marker;
  return [normalized, marker].filter(Boolean).join('\n');
}

function isRouteAssignedToUser(route, user) {
  if (!route || !user) return false;
  if (route.driver_id && String(route.driver_id) === String(user.id)) return true;
  if (route.driver && String(route.driver).toLowerCase().trim() === String(user.name || '').toLowerCase().trim()) return true;
  return false;
}

async function loadLinkedInvoiceForStop(stop, context) {
  if (!stop) return null;

  if (stop.invoice_id) {
    const { data: invoice } = await scopeQueryByContext(supabase.from('invoices').select('*'), context).eq('id', stop.invoice_id).single();
    if (invoice && rowMatchesContext(invoice, context)) return invoice;
  }

  const orderNumber = extractOrderNumberFromStopNotes(stop.notes);
  if (!orderNumber) return null;

  const { data: orders, error: orderError } = await scopeQueryByContext(
    supabase.from('orders').select('id, invoice_id, order_number, company_id, location_id'),
    context
  )
    .eq('order_number', orderNumber)
    .limit(1);
  if (orderError || !Array.isArray(orders) || !orders.length) return null;

  const order = orders.find((candidate) => rowMatchesContext(candidate, context));
  if (!order) return null;

  if (order.invoice_id) {
    const { data: invoice } = await scopeQueryByContext(supabase.from('invoices').select('*'), context).eq('id', order.invoice_id).single();
    if (invoice && rowMatchesContext(invoice, context)) return invoice;
  }

  const { data: invoices, error: invoiceError } = await scopeQueryByContext(
    supabase.from('invoices').select('*'),
    context
  )
    .eq('order_id', order.id)
    .limit(1);
  if (invoiceError || !Array.isArray(invoices) || !invoices.length) return null;
  return invoices.find((candidate) => rowMatchesContext(candidate, context)) || null;
}

async function syncLinkedInvoiceForStop(stop, context, { markDelivered = false, syncDriverNotes = false } = {}) {
  const linkedInvoice = await loadLinkedInvoiceForStop(stop, context);
  if (!linkedInvoice) return null;

  const updates = {};

  if (syncDriverNotes && stop.driver_notes !== undefined) {
    const nextNotes = mergeInvoiceNotesWithDriverNotes(linkedInvoice.notes, stop.driver_notes);
    if (nextNotes !== (linkedInvoice.notes || null)) {
      updates.notes = nextNotes;
    }
  }

  if (markDelivered) {
    const nextStatus = statusAfterDeliveryCompletion(linkedInvoice.status);
    if (nextStatus && nextStatus !== String(linkedInvoice.status || '').trim().toLowerCase()) {
      updates.status = nextStatus;
    }
  }

  if (!Object.keys(updates).length) return linkedInvoice;

  const { data, error } = await scopeQueryByContext(
    supabase.from('invoices').update(updates),
    context
  )
    .eq('id', linkedInvoice.id)
    .select()
    .single();
  if (error) throw error;
  return data || { ...linkedInvoice, ...updates };
}

async function linkOrderToStop(stop, body = {}, context = {}) {
  const orderId = body.order_id || body.orderId || null;
  const orderNumber = body.order_number || body.orderNumber || null;
  if (!stop?.id || (!orderId && !orderNumber)) return;

  const result = await executeWithOptionalScope((candidate) => {
    let scopedQuery = scopeQueryByContext(supabase.from('orders').update(candidate), context);
    scopedQuery = orderId ? scopedQuery.eq('id', orderId) : scopedQuery.eq('order_number', orderNumber);
    return scopedQuery;
  }, { stop_id: stop.id });

  if (result.error) throw result.error;
}

async function authorizeDwellEvent(req, res, stopId) {
  const { data: stop, error: stopErr } = await scopeQueryByContext(supabase.from('stops').select('*'), req.context).eq('id', stopId).single();
  if (stopErr || !stop) {
    res.status(404).json({ error: 'Stop not found' });
    return { ok: false };
  }

  if (!stop.route_id) {
    res.status(400).json({ error: 'Stop is not assigned to a route' });
    return { ok: false };
  }

  const { data: route, error: routeErr } = await supabase
    .from('routes').select('*').eq('id', stop.route_id).single();
  if (routeErr || !route) {
    res.status(404).json({ error: 'Route not found' });
    return { ok: false };
  }

  if (req.user.role === 'driver' && !isRouteAssignedToUser(route, req.user)) {
    res.status(403).json({ error: 'Route is not assigned to this driver' });
    return { ok: false };
  }

  const activeIds = Array.isArray(route.active_stop_ids) && route.active_stop_ids.length
    ? route.active_stop_ids
    : (Array.isArray(route.stop_ids) ? route.stop_ids : []);
  if (activeIds.length && !activeIds.includes(stopId)) {
    res.status(400).json({ error: 'Stop is not part of this route' });
    return { ok: false };
  }

  return { ok: true, route, stop };
}

// GET /api/stops
router.get('/', authenticateToken, async (req, res) => {
  try {
    let query = scopeQueryByContext(supabase.from('stops').select('*'), req.context);
    if (req.query.route_id) query = query.eq('route_id', req.query.route_id);
    if (req.query.driver_id) query = query.eq('driver_id', req.query.driver_id);
    if (req.query.status)   query = query.eq('status', req.query.status);
    if (req.user.role === 'driver') query = query.eq('driver_id', req.user.id);
    query = query.order('created_at', { ascending: true });
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stops/:id
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('stops').select('*').eq('id', req.params.id).single();
    if (error) return res.status(404).json({ error: 'Stop not found' });
    if (req.user.role === 'driver' && String(data.driver_id) !== String(req.user.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/stops
router.post('/', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const payload = {};
    for (const field of STOP_FIELDS) {
      if (req.body[field] !== undefined) payload[field] = req.body[field];
    }
    const result = await insertRecordWithOptionalScope(supabase, 'stops', payload, req.context);
    if (result.error) return res.status(500).json({ error: result.error.message });
    try {
      await linkOrderToStop(result.data, req.body, req.context);
    } catch (linkError) {
      console.error('[stops] order stop_id sync failed:', linkError.message);
    }
    res.status(201).json(result.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/stops/:id
router.patch('/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.role === 'driver') {
      const { data: existing, error: fetchErr } = await scopeQueryByContext(supabase.from('stops').select('driver_id, company_id, location_id'), req.context).eq('id', req.params.id).single();
      if (fetchErr) return res.status(404).json({ error: 'Stop not found' });
      if (String(existing.driver_id) !== String(req.user.id)) {
        return res.status(403).json({ error: 'Access denied' });
      }
      const update = {};
      for (const field of DRIVER_ALLOWED_FIELDS) {
        if (req.body[field] !== undefined) update[field] = req.body[field];
      }
      if (!Object.keys(update).length) return res.status(400).json({ error: 'No valid fields provided' });
      const { data, error } = await supabase
        .from('stops').update(update).eq('id', req.params.id).select().single();
      if (error) return res.status(500).json({ error: error.message });
      invalidateDashboardCache(req.context);
      if (update.driver_notes !== undefined) {
        try {
          await syncLinkedInvoiceForStop(data, req.context, { syncDriverNotes: true });
        } catch (invoiceSyncError) {
          // Driver notes on the stop remain the source of truth; invoice sync is best-effort.
          console.error('[stops] invoice driver-notes sync failed:', invoiceSyncError.message);
        }
      }
      return res.json(data);
    }

    const { data: existing, error: fetchErr } = await scopeQueryByContext(supabase.from('stops').select('*'), req.context).eq('id', req.params.id).single();
    if (fetchErr) return res.status(404).json({ error: 'Stop not found' });
    if (!rowMatchesContext(existing, req.context)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const update = {};
    for (const field of STOP_FIELDS) {
      if (req.body[field] !== undefined) update[field] = req.body[field];
    }
    if (!Object.keys(update).length) return res.status(400).json({ error: 'No valid fields provided' });

    // State machine — prevent stop status regression.
    if (update.status !== undefined) {
      const currentStatus = String(existing.status || 'pending').toLowerCase();
      const nextStatus    = String(update.status).toLowerCase();
      const stopTransitions = {
        pending:   ['arrived', 'completed', 'deferred'],
        arrived:   ['completed', 'deferred'],
        completed: [],
        deferred:  ['pending', 'arrived'],
      };
      const allowedNext = stopTransitions[currentStatus];
      if (!allowedNext) {
        return res.status(400).json({ error: `Unknown current stop status: '${currentStatus}'` });
      }
      if (!allowedNext.includes(nextStatus)) {
        return res.status(400).json({
          error: `Cannot change stop status from '${currentStatus}' to '${nextStatus}'`,
        });
      }
      update.status = nextStatus;
    }

    const { data, error } = await supabase
      .from('stops').update(update).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    invalidateDashboardCache(req.context);
    if (update.driver_notes !== undefined) {
      try {
        await syncLinkedInvoiceForStop(data, req.context, { syncDriverNotes: true });
      } catch (invoiceSyncError) {
        console.error('[stops] invoice driver-notes sync failed:', invoiceSyncError.message);
      }
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/stops/:id/arrive — driver marks arrival, inserts a dwell_record
router.post('/:id/arrive', authenticateToken, async (req, res) => {
  try {
    const auth = await authorizeDwellEvent(req, res, req.params.id);
    if (!auth.ok) return;
    const { route } = auth;

    const { data: existing } = await supabase
      .from('dwell_records')
      .select('*')
      .eq('stop_id', req.params.id)
      .eq('route_id', route.id)
      .is('departed_at', null)
      .limit(1);
    if (existing && existing[0]) return res.json(existing[0]);

    await scopeQueryByContext(supabase.from('stops').update({ status: 'arrived', arrived_at: new Date().toISOString() }), req.context).eq('id', req.params.id);

    const arrivedAt = new Date().toISOString();
    const { data: record, error: insertErr } = await supabase
      .from('dwell_records')
      .insert([{
        stop_id:    req.params.id,
        route_id:   route.id,
        driver_id:  req.user.id,
        arrived_at: arrivedAt,
        departed_at: null,
        dwell_ms:   null,
        ...buildScopeFields(req.context),
      }])
      .select()
      .single();
    if (insertErr) return res.status(500).json({ error: insertErr.message });
    invalidateDashboardCache(req.context);
    deliveryNotifications.notifyDriverArriving(supabase, req.params.id, route.id).catch(() => {});
    res.json(record);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/stops/:id/depart — driver marks departure, updates the open dwell record
router.post('/:id/depart', authenticateToken, async (req, res) => {
  try {
    const auth = await authorizeDwellEvent(req, res, req.params.id);
    if (!auth.ok) return;
    const { route, stop } = auth;
    const completionType = String(req.body?.completion_type || '').trim().toLowerCase();
    const driverNotes = completionType === 'drop_off'
      ? appendDropOffDriverNote(stop?.driver_notes)
      : stop?.driver_notes;

    const { data: openRecords, error: findErr } = await supabase
      .from('dwell_records')
      .select('*')
      .eq('stop_id', req.params.id)
      .eq('route_id', route.id)
      .is('departed_at', null)
      .limit(1);
    if (findErr) return res.status(500).json({ error: findErr.message });
    if (!openRecords || !openRecords[0]) {
      return res.status(404).json({ error: 'No open dwell record found — call /arrive first' });
    }

    const openRecord = openRecords[0];
    const departedAt = new Date().toISOString();
    const dwell_ms = new Date(departedAt).getTime() - new Date(openRecord.arrived_at).getTime();

    const { data: updated, error: updateErr } = await supabase
      .from('dwell_records')
      .update({ departed_at: departedAt, dwell_ms })
      .eq('id', openRecord.id)
      .select()
      .single();
    if (updateErr) return res.status(500).json({ error: updateErr.message });

    await scopeQueryByContext(supabase.from('stops').update({
      status: 'completed',
      ...(driverNotes ? { driver_notes: driverNotes } : {}),
    }), req.context).eq('id', req.params.id);
    invalidateDashboardCache(req.context);
    deliveryNotifications.notifyDeliveryCompleted(supabase, req.params.id, stop.invoice_id || null).catch(() => {});
    deliveryNotifications.notifyUpcomingStops(supabase, route.id, req.params.id, req.context).catch(() => {});

    // Fire delivery confirmation email non-fatally using the invoice already linked to this stop
    try {
      const invoice = await syncLinkedInvoiceForStop(
        { ...stop, status: 'completed', driver_notes: driverNotes },
        req.context,
        { markDelivered: true, syncDriverNotes: true }
      );
      const email = invoice?.customer_email || invoice?.contact_email || invoice?.billing_email;
      if (invoice && email) await sendInvoiceEmail(invoice, 'Invoice');
    } catch { /* email failure must never block the depart response */ }

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST: move a stop to the end of its queue (existing)
router.post('/:id/move-to-end', authenticateToken, requireRole('admin', 'manager', 'driver'), async (req, res) => {
  const stopId = req.params.id;
  const queueIdOverride = req.body.queueId ?? req.query.queueId ?? null;
  // If a driver is performing this action, validate route ownership if possible
  try {
    const user = req.user || {};
    const isDriver = String(user?.role || '').toLowerCase() === 'driver';
    if (isDriver) {
      const { data: stopRec } = await scopeQueryByContext(supabase.from('stops').select('queue_id, company_id, location_id'), req.context).eq('id', stopId).single();
      const targetQueue = queueIdOverride ?? stopRec?.queue_id ?? null;
      if (targetQueue) {
        const { data: route } = await scopeQueryByContext(supabase.from('routes').select('driver_id, company_id, location_id'), req.context).eq('id', targetQueue).single();
        const assignedDriver = route?.driver_id;
        if (assignedDriver && String(assignedDriver) !== String(user?.id)) {
          return res.status(403).json({ ok: false, error: 'Not authorized for this route' });
        }
      }
    }
  } catch (authErr) {
    // If anything goes wrong, fall back to allowing the operation but log for audit
    // eslint-disable-next-line no-console
    console.error('[stops] driver-authorization-fallback', authErr?.message || authErr);
  }
  try {
    const { data: stop, error: stopErr } = await scopeQueryByContext(supabase.from('stops').select('route_id, driver_id, status, company_id, location_id'), req.context).eq('id', req.params.id).single();
    if (stopErr || !stop) return res.status(404).json({ error: 'Stop not found' });
    if (req.user.role === 'driver' && String(stop.driver_id) !== String(req.user.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (stop.status === 'completed') return res.status(400).json({ error: 'Cannot skip a completed stop' });
    if (!stop.route_id) return res.status(400).json({ error: 'Stop is not assigned to a route' });

    const { data: route, error: routeErr } = await scopeQueryByContext(supabase.from('routes').select('stop_ids, active_stop_ids, company_id, location_id'), req.context).eq('id', stop.route_id).single();
    if (routeErr || !route) return res.status(404).json({ error: 'Route not found' });

    const current = Array.isArray(route.active_stop_ids) ? route.active_stop_ids : [];
    const reordered = [...current.filter((id) => id !== req.params.id), req.params.id];

    const { error: updateErr } = await scopeQueryByContext(supabase.from('routes').update({ active_stop_ids: reordered }), req.context).eq('id', stop.route_id);
    if (updateErr) return res.status(500).json({ error: updateErr.message });

    const syncResult = await syncRouteMutation(supabase, {
      routeId: stop.route_id,
      stopIds: Array.isArray(route.stop_ids) ? route.stop_ids : reordered,
      activeStopIds: reordered,
      action: 'move_to_end',
      actor: req.user,
      context: req.context,
      metadata: {
        stopId,
        requestedByRole: req.user.role,
      },
    });
    if (syncResult.error) return res.status(500).json({ error: syncResult.error.message });

    res.json({ ok: true, new_position: reordered.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/stops/:id/defer — move stop to end of active queue (with idempotency check)
router.post('/:id/defer', authenticateToken, async (req, res) => {
  try {
    const { data: stop, error: stopErr } = await scopeQueryByContext(supabase.from('stops').select('*'), req.context).eq('id', req.params.id).single();
    if (stopErr || !stop) return res.status(404).json({ error: 'Stop not found' });
    if (!stop.route_id) return res.status(400).json({ error: 'Stop is not assigned to a route' });

    const { data: route, error: routeErr } = await scopeQueryByContext(supabase.from('routes').select('*'), req.context).eq('id', stop.route_id).single();
    if (routeErr || !route) return res.status(404).json({ error: 'Route not found' });

    if (req.user.role === 'driver') {
      if (!isRouteAssignedToUser(route, req.user)) {
        return res.status(403).json({ error: 'Route is not assigned to this driver' });
      }
      if (String(stop.driver_id) !== String(req.user.id)) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const activeIds = Array.isArray(route.active_stop_ids) && route.active_stop_ids.length
      ? [...route.active_stop_ids]
      : (Array.isArray(route.stop_ids) ? [...route.stop_ids] : []);

    const stopId = req.params.id;
    const currentIndex = activeIds.indexOf(stopId);

    if (currentIndex === -1) {
      return res.status(400).json({ error: 'Stop is not in the active queue for this route' });
    }
    if (currentIndex === activeIds.length - 1) {
      return res.json({
        route_id: route.id,
        active_stop_ids: activeIds,
        deferred: false,
        reason: 'Stop is already last in queue',
      });
    }

    activeIds.splice(currentIndex, 1);
    activeIds.push(stopId);

    const { error: updateErr } = await scopeQueryByContext(supabase.from('routes').update({ active_stop_ids: activeIds }), req.context).eq('id', route.id);
    if (updateErr) return res.status(500).json({ error: updateErr.message });

    const syncResult = await syncRouteMutation(supabase, {
      routeId: route.id,
      stopIds: Array.isArray(route.stop_ids) ? route.stop_ids : activeIds,
      activeStopIds: activeIds,
      action: 'defer',
      actor: req.user,
      context: req.context,
      metadata: {
        stopId,
        requestedByRole: req.user.role,
      },
    });
    if (syncResult.error) return res.status(500).json({ error: syncResult.error.message });

    res.json({
      route_id: route.id,
      active_stop_ids: activeIds,
      deferred: true,
      deferred_stop_id: stopId,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/stops/:id/signature — save a delivery signature
router.post('/:id/signature', authenticateToken, async (req, res) => {
  try {
    if (req.user.role === 'driver') {
      const { data: existing, error: fetchErr } = await scopeQueryByContext(supabase.from('stops').select('driver_id, company_id, location_id'), req.context).eq('id', req.params.id).single();
      if (fetchErr) return res.status(404).json({ error: 'Stop not found' });
      if (String(existing.driver_id) !== String(req.user.id)) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }
    const { signature_data, signer_name } = req.body;
    if (!signature_data) return res.status(400).json({ error: 'signature_data is required' });
    const { data, error } = await scopeQueryByContext(supabase.from('stops').update({
        signature_data,
        signature_captured_at: new Date().toISOString(),
        signature_captured_by: signer_name || req.user.name || req.user.email,
      }), req.context)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/stops/:id/weight — save captured weight at delivery
router.post('/:id/weight', authenticateToken, async (req, res) => {
  try {
    if (req.user.role === 'driver') {
      const { data: existing, error: fetchErr } = await scopeQueryByContext(supabase.from('stops').select('driver_id, company_id, location_id'), req.context).eq('id', req.params.id).single();
      if (fetchErr) return res.status(404).json({ error: 'Stop not found' });
      if (String(existing.driver_id) !== String(req.user.id)) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }
    const { weight_lbs } = req.body;
    if (weight_lbs === undefined || weight_lbs === null) {
      return res.status(400).json({ error: 'weight_lbs is required' });
    }
    const { data, error } = await scopeQueryByContext(supabase.from('stops').update({
        weight_lbs: Number(weight_lbs),
        weight_captured_at: new Date().toISOString(),
        weight_captured_by: req.user.name || req.user.email,
      }), req.context)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/stops/:id
router.delete('/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { data: existing, error: fetchErr } = await scopeQueryByContext(supabase.from('stops').select('*'), req.context).eq('id', req.params.id).single();
    if (fetchErr) return res.status(404).json({ error: 'Stop not found' });
    if (!rowMatchesContext(existing, req.context)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { error } = await scopeQueryByContext(supabase.from('stops').delete(), req.context).eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
  });

// POST: add notes to a stop (driver/ops can annotate delivery instructions)
router.post('/:id/notes', authenticateToken, requireRole('admin', 'manager', 'driver'), async (req, res) => {
  const stopId = req.params.id;
  const { notes } = req.body;
  if (typeof notes !== 'string') {
    return res.status(400).json({ ok: false, error: 'notes must be a string' });
  }
  try {
    const { data: updated, error } = await scopeQueryByContext(supabase.from('stops').update({ notes }), req.context).eq('id', stopId).select('*').single();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    res.json({ ok: true, stop: updated });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || 'Could not update notes' });
  }
});

module.exports = router;
module.exports.isRouteAssignedToUser = isRouteAssignedToUser;
