const express = require('express');
const { supabase } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { loadDriverInvoiceScope } = require('../services/driver-invoice-access');
const {
  buildScopeFields,
  executeWithOptionalScope,
  filterRowsByContext,
  insertRecordWithOptionalScope,
} = require('../services/operating-context');

const router = express.Router();

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function stopMatchesInvoice(stop, invoice) {
  const stopName = normalize(stop?.name);
  const stopAddress = normalize(stop?.address);
  const invoiceName = normalize(invoice?.customer_name);
  const invoiceAddress = normalize(invoice?.customer_address);

  return (
    (!!stopName && !!invoiceName && stopName === invoiceName) ||
    (!!stopAddress && !!invoiceAddress && stopAddress === invoiceAddress) ||
    (!!stopName && !!invoiceName && (stopName.includes(invoiceName) || invoiceName.includes(stopName))) ||
    (!!stopAddress && !!invoiceAddress && (stopAddress.includes(invoiceAddress) || invoiceAddress.includes(stopAddress)))
  );
}

// GET /api/driver/routes — this driver's routes with hydrated stops (incl. door_code)
router.get('/routes', authenticateToken, async (req, res) => {
  const { data: routes, error: rErr } = await supabase
    .from('routes')
    .select('*')
    .ilike('driver', req.user.name)
    .order('created_at', { ascending: false });

  if (rErr) return res.status(500).json({ error: rErr.message });
  const scopedRoutes = filterRowsByContext(routes || [], req.context);
  if (!scopedRoutes.length) return res.json([]);

  const allIds = [...new Set(scopedRoutes.flatMap(r => r.stop_ids || []))];
  if (!allIds.length) return res.json(scopedRoutes.map(r => ({ ...r, stops: [] })));

  const { data: stops, error: sErr } = await supabase
    .from('stops')
    .select('*')
    .in('id', allIds);

  if (sErr) return res.status(500).json({ error: sErr.message });
  const scopedStops = filterRowsByContext(stops || [], req.context);

  const { data: invoices, error: iErr } = await supabase
    .from('invoices')
    .select('*')
    .ilike('driver_name', req.user.name)
    .order('created_at', { ascending: false });

  if (iErr) return res.status(500).json({ error: iErr.message });
  const scopedInvoices = filterRowsByContext(invoices || [], req.context);

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

  return res.json(scopedRoutes.map(r => ({
    ...r,
    stops: (r.stop_ids || [])
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
  const payload = {
    ...buildScopeFields(req.context),
    driver_name: req.user.name,
    lat: Number(req.body.lat),
    lng: Number(req.body.lng),
    heading: Number.isFinite(Number(req.body.heading)) ? Number(req.body.heading) : 0,
    speed_mph: Number.isFinite(Number(req.body.speed_mph)) ? Number(req.body.speed_mph) : 0,
    updated_at: new Date().toISOString(),
  };

  if (!Number.isFinite(payload.lat) || !Number.isFinite(payload.lng)) {
    return res.status(400).json({ error: 'Valid lat and lng are required' });
  }

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

module.exports = router;
