'use strict';
const express = require('express');
const { z } = require('zod');
const { supabase } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { validateBody } = require('../lib/zod-validate');

const router = express.Router();
const WAREHOUSE_ROLES = ['admin', 'manager', 'warehouse'];

const assignBodySchema = z.object({
  item_number:      z.string().trim().min(1, 'item_number is required'),
  qty_at_location:  z.coerce.number().min(0, 'qty_at_location must be >= 0'),
  notes:            z.string().optional(),
});

// GET /api/warehouse/locations — list all active warehouse locations
router.get('/', authenticateToken, requireRole(...WAREHOUSE_ROLES), async (req, res) => {
  const { data, error } = await supabase
    .from('warehouse_locations')
    .select('*')
    .eq('status', 'active')
    .order('name', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// GET /api/warehouse/locations/:id/inventory — all items assigned to a location
router.get('/:id/inventory', authenticateToken, requireRole(...WAREHOUSE_ROLES), async (req, res) => {
  const { data: assignments, error } = await supabase
    .from('inventory_location_assignments')
    .select('*, products(item_number, name, category, unit, on_hand_qty)')
    .eq('location_id', req.params.id)
    .order('updated_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || assignments || []);
});

// POST /api/warehouse/locations/:id/assign — assign or update an item's qty at this location
// NOTE: qty_at_location is a physical placement record (where is it on the floor),
// NOT a stock level. It is managed independently from products.on_hand_qty.
router.post('/:id/assign', authenticateToken, requireRole(...WAREHOUSE_ROLES),
  validateBody(assignBodySchema), async (req, res) => {
  const { item_number, qty_at_location, notes } = req.validated.body;

  // Verify the product exists
  const { data: product, error: prodErr } = await supabase
    .from('products')
    .select('item_number, name')
    .eq('item_number', item_number)
    .single();
  if (prodErr || !product) return res.status(404).json({ error: 'Product not found' });

  // Verify the location exists
  const { data: location, error: locErr } = await supabase
    .from('warehouse_locations')
    .select('id, name')
    .eq('id', req.params.id)
    .single();
  if (locErr || !location) return res.status(404).json({ error: 'Location not found' });

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
  const { data, error } = await supabase
    .from('inventory_location_assignments')
    .select('*, warehouse_locations(id, name, type, status)')
    .eq('item_number', req.params.itemNumber)
    .order('qty_at_location', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

module.exports = router;
