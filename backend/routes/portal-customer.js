const express = require('express');
const { supabase } = require('../services/supabase');
const { buildInvoicePDF } = require('../services/pdf');
const {
  buildScopeFields,
  executeWithOptionalScope,
  filterRowsByContext,
  insertRecordWithOptionalScope,
} = require('../services/operating-context');

module.exports = function buildCustomerRouter({ authenticatePortalToken }) {
  const router = express.Router();

  // GET /api/portal/orders
  router.get('/orders', authenticatePortalToken, async (req, res) => {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .ilike('customer_email', req.customerEmail)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    const scopedOrders = filterRowsByContext(data || [], req.portalContext);
    res.json(scopedOrders.map((order) => ({
      id: order.id,
      order_number: order.order_number,
      customer_name: order.customer_name,
      customer_address: order.customer_address,
      items: order.items,
      status: order.status,
      notes: order.notes,
      created_at: order.created_at,
      driver_name: order.driver_name,
    })));
  });

  // GET /api/portal/invoices
  router.get('/invoices', authenticatePortalToken, async (req, res) => {
    const { data, error } = await supabase
      .from('invoices')
      .select('*')
      .ilike('customer_email', req.customerEmail)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    const scopedInvoices = filterRowsByContext(data || [], req.portalContext);
    res.json(scopedInvoices.map((invoice) => ({
      id: invoice.id,
      invoice_number: invoice.invoice_number,
      customer_name: invoice.customer_name,
      customer_address: invoice.customer_address,
      items: invoice.items,
      subtotal: invoice.subtotal,
      tax: invoice.tax,
      total: invoice.total,
      status: invoice.status,
      driver_name: invoice.driver_name,
      created_at: invoice.created_at,
      signed_at: invoice.signed_at,
      sent_at: invoice.sent_at,
    })));
  });

  // GET /api/portal/invoices/:id/pdf
  router.get('/invoices/:id/pdf', authenticatePortalToken, async (req, res) => {
    const { data: inv, error } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', req.params.id)
      .ilike('customer_email', req.customerEmail)
      .single();
    if (error || !inv) return res.status(404).json({ error: 'Invoice not found' });
    if (!filterRowsByContext([inv], req.portalContext).length) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    const pdfBuffer = await buildInvoicePDF(inv);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${inv.invoice_number || inv.id.slice(0, 8)}.pdf"`);
    res.send(pdfBuffer);
  });

  // GET /api/portal/contact
  router.get('/contact', authenticatePortalToken, async (req, res) => {
    const { data: saved, error: savedError } = await supabase
      .from('portal_contacts')
      .select('*')
      .eq('email', req.customerEmail)
      .order('updated_at', { ascending: false })
      .limit(10);

    if (savedError) return res.status(500).json({ error: savedError.message });

    const savedContact = filterRowsByContext(saved || [], req.portalContext)[0];

    if (savedContact) {
      return res.json({
        email: savedContact.email,
        name: savedContact.name,
        phone: savedContact.phone,
        address: savedContact.address,
        company: savedContact.company,
        door_code: savedContact.door_code,
        updated_at: savedContact.updated_at,
      });
    }

    // Fall back to most recent invoice data
    const { data: inv } = await supabase
      .from('invoices')
      .select('*')
      .ilike('customer_email', req.customerEmail)
      .order('created_at', { ascending: false })
      .limit(10);

    const scopedInvoices = filterRowsByContext(inv || [], req.portalContext);
    const latestInvoice = scopedInvoices[0] || null;

    res.json({
      email: req.customerEmail,
      name: latestInvoice ? latestInvoice.customer_name : req.customerName,
      address: latestInvoice ? latestInvoice.customer_address : null,
      phone: null,
      company: null,
    });
  });

  // PATCH /api/portal/contact
  router.patch('/contact', authenticatePortalToken, async (req, res) => {
    const { name, phone, address, company } = req.body;
    const { data: existingRows, error: existingError } = await supabase
      .from('portal_contacts')
      .select('*')
      .eq('email', req.customerEmail)
      .order('updated_at', { ascending: false })
      .limit(10);
    if (existingError) return res.status(500).json({ error: existingError.message });

    const payload = {
      ...buildScopeFields(req.portalContext),
      email: req.customerEmail,
      name: name || req.customerName,
      phone: phone || null,
      address: address || null,
      company: company || null,
      updated_at: new Date().toISOString(),
    };
    const scopedExisting = filterRowsByContext(existingRows || [], req.portalContext);

    const result = scopedExisting[0]?.id
      ? await executeWithOptionalScope(
          (candidate) => supabase.from('portal_contacts').update(candidate).eq('id', scopedExisting[0].id).select('*').single(),
          payload
        )
      : await insertRecordWithOptionalScope(supabase, 'portal_contacts', payload, req.portalContext);

    if (result.error) return res.status(500).json({ error: result.error.message });
    res.json({ message: 'Contact information saved' });
  });

  // PATCH /api/portal/doorcode
  router.patch('/doorcode', authenticatePortalToken, async (req, res) => {
    const { door_code } = req.body;
    const code = (door_code || '').trim() || null;

    // Update portal_contacts — preserve existing fields
    const { data: existingRows, error: existingError } = await supabase
      .from('portal_contacts')
      .select('*')
      .eq('email', req.customerEmail)
      .order('updated_at', { ascending: false })
      .limit(10);
    if (existingError) return res.status(500).json({ error: existingError.message });

    const existing = filterRowsByContext(existingRows || [], req.portalContext)[0] || null;

    let contactWrite;
    if (existing) {
      contactWrite = await executeWithOptionalScope(
        (candidate) => supabase.from('portal_contacts').update(candidate).eq('id', existing.id).select('*').single(),
        {
          ...buildScopeFields(req.portalContext),
          door_code: code,
          updated_at: new Date().toISOString(),
        }
      );
    } else {
      contactWrite = await insertRecordWithOptionalScope(
        supabase,
        'portal_contacts',
        {
          email: req.customerEmail,
          name: req.customerName,
          door_code: code,
          updated_at: new Date().toISOString(),
        },
        req.portalContext
      );
    }
    if (contactWrite.error) return res.status(500).json({ error: contactWrite.error.message });

    // Best-effort: sync to matching stop row by name
    const lookupName = (existing && existing.name) || req.customerName;
    if (lookupName) {
      const { data: candidateStops } = await supabase
        .from('stops')
        .select('*')
        .ilike('name', lookupName);
      const scopedStops = filterRowsByContext(candidateStops || [], req.portalContext);
      for (const stop of scopedStops) {
        await supabase
        .from('stops')
        .update({ door_code: code })
        .eq('id', stop.id);
      }
    }

    res.json({ message: 'Door code saved' });
  });

  // GET /api/portal/inventory
  router.get('/inventory', authenticatePortalToken, async (req, res) => {
    const { data, error } = await supabase
      .from('seafood_inventory')
      .select('description, category, unit, on_hand_qty, on_hand_weight, cost, updated_at, created_at')
      .gt('on_hand_qty', 0)
      .order('updated_at', { ascending: false, nullsFirst: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  });

  return router;
};
