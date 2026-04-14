const express = require('express');
const supabase = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// ── SEAFOOD INVENTORY (Supabase table: seafood_inventory) ────────────────────
// Required Supabase table columns:
//   id uuid PK, name text NOT NULL, category text, sku text,
//   unit text, price_per_unit numeric, stock_qty numeric,
//   low_stock_threshold numeric DEFAULT 10, description text,
//   created_at timestamptz DEFAULT now()

router.get('/', authenticateToken, async (req, res) => {
  const { data, error } = await supabase
    .from('seafood_inventory')
    .select('*')
    .order('category', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { name, category, sku, unit, price_per_unit, stock_qty, low_stock_threshold, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Product name required' });
  const { data, error } = await supabase
    .from('seafood_inventory')
    .insert([{
      name,
      category: category || 'Other',
      sku: sku || '',
      unit: unit || 'lb',
      price_per_unit: parseFloat(price_per_unit) || 0,
      stock_qty: parseFloat(stock_qty) || 0,
      low_stock_threshold: parseFloat(low_stock_threshold) || 10,
      description: description || ''
    }])
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.patch('/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const allowed = ['name','category','sku','unit','price_per_unit','stock_qty','low_stock_threshold','description'];
  const fields = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) fields[k] = req.body[k]; });
  const { data, error } = await supabase
    .from('seafood_inventory')
    .update(fields)
    .eq('id', req.params.id)
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { error } = await supabase.from('seafood_inventory').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Deleted' });
});

module.exports = router;
