'use strict';
const express = require('express');
const { z } = require('zod');
const { supabase } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { validateBody } = require('../lib/zod-validate');
const {
  buildScopeFields,
  filterRowsByContext,
  rowMatchesContext,
} = require('../services/operating-context');

const router = express.Router();
const WAREHOUSE_ROLES = ['admin', 'manager', 'warehouse'];

const assignBodySchema = z.object({
  item_number:      z.string().trim().min(1, 'item_number is required'),
  qty_at_location:  z.coerce.number().min(0, 'qty_at_location must be >= 0'),
  notes:            z.string().optional(),
});

function scopeQuery(query, context) {
  const scopeFields = buildScopeFields(context || {});
  if (scopeFields.company_id) query = query.eq('company_id', scopeFields.company_id);
  if (scopeFields.location_id) query = query.eq('location_id', scopeFields.location_id);
  return query;
}

async function getScopedWarehouseLocation(locationId, context) {
  const { data: location, error } = await supabase
    .from('warehouse_locations')
    .select('*')
    .eq('id', locationId)
    .single();

  if (error || !location) return { status: 404, error: 'Location not found' };
  if (!rowMatchesContext(location, context)) return { status: 403, error: 'Forbidden' };
  return { location };
}

// GET /api/warehouse/locations — list all active warehouse locations
router.get('/', authenticateToken, requireRole(...WAREHOUSE_ROLES), async (req, res) => {
  const query = scopeQuery(supabase
    .from('warehouse_locations')
    .select('*')
    .eq('status', 'active'), req.context)
    .order('name', { ascending: true });
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(filterRowsByContext(data || [], req.context));
});

// GET /api/warehouse/locations/:id/inventory — all items assigned to a location
router.get('/:id/inventory', authenticateToken, requireRole(...WAREHOUSE_ROLES), async (req, res) => {
  const locationCheck = await getScopedWarehouseLocation(req.params.id, req.context);
  if (!locationCheck.location) return res.status(locationCheck.status).json({ error: locationCheck.error });

  const { data: assignments, error } = await supabase
    .from('inventory_location_assignments')
    .select('*, products(item_number, name, category, unit, on_hand_qty)')
    .eq('location_id', req.params.id)
    .order('updated_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(assignments || []);
});

// POST /api/warehouse/locations/:id/assign — assign or update an item's qty at this location
// NOTE: qty_at_location is a physical placement record (where is it on the floor),
// NOT a stock level. It is managed independently from products.on_hand_qty.
router.post('/:id/assign', authenticateToken, requireRole(...WAREHOUSE_ROLES),
  validateBody(assignBodySchema), async (req, res) => {
  const { item_number, qty_at_location, notes } = req.validated.body;

  const locationCheck = await getScopedWarehouseLocation(req.params.id, req.context);
  if (!locationCheck.location) return res.status(locationCheck.status).json({ error: locationCheck.error });
  const { location } = locationCheck;

  // Verify the product exists
  const productQuery = scopeQuery(supabase
    .from('products')
    .select('item_number, name')
    .eq('item_number', item_number), req.context)
    .single();
  const { data: product, error: prodErr } = await productQuery;
  if (prodErr || !product) return res.status(404).json({ error: 'Product not found' });

  const { data, error } = await supabase
    .from('inventory_location_assignments')
    .upsert(
      {
        item_number,
        location_id:     req.params.id,
        qty_at_location,
        notes:           notes || null,
        assigned_by:     req.user.name || req.user.email,
      },
      { onConflict: 'item_number,location_id' }
    )
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ...data, product_name: product.name, location_name: location.name });
});

// DELETE /api/warehouse/locations/:locationId/items/:itemNumber — remove item from location
router.delete('/:locationId/items/:itemNumber', authenticateToken, requireRole(...WAREHOUSE_ROLES),
  async (req, res) => {
  const locationCheck = await getScopedWarehouseLocation(req.params.locationId, req.context);
  if (!locationCheck.location) return res.status(locationCheck.status).json({ error: locationCheck.error });

  const { error } = await supabase
    .from('inventory_location_assignments')
    .delete()
    .eq('location_id', req.params.locationId)
    .eq('item_number', req.params.itemNumber);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// GET /api/warehouse/locations/item/:itemNumber — find all locations holding a given item
router.get('/item/:itemNumber', authenticateToken, requireRole(...WAREHOUSE_ROLES), async (req, res) => {
  const locationsQuery = scopeQuery(supabase
    .from('warehouse_locations')
    .select('*')
    .eq('status', 'active'), req.context);
  const { data: locations, error: locationsError } = await locationsQuery;
  if (locationsError) return res.status(500).json({ error: locationsError.message });

  const allowedLocationIds = filterRowsByContext(locations || [], req.context).map((location) => location.id);
  if (!allowedLocationIds.length) return res.json([]);

  const { data, error } = await supabase
    .from('inventory_location_assignments')
    .select('*, warehouse_locations(id, name, type, status)')
    .eq('item_number', req.params.itemNumber)
    .in('location_id', allowedLocationIds)
    .order('qty_at_location', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

module.exports = router;
