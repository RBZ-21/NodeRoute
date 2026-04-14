const express = require('express');
const supabase = require('../services/supabase');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// ── CUSTOMERS (Supabase: "250 restaurants") ─────────────
router.get('/', authenticateToken, async (req, res) => {
  const { data, error } = await supabase
    .from('250 restaurants')
    .select('*')
    .order('Rank', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/', authenticateToken, async (req, res) => {
  const { Restaurant, Address, Phone, Area, Cuisine, Rank } = req.body;
  if (!Restaurant) return res.status(400).json({ error: 'Restaurant name required' });
  const { data, error } = await supabase
    .from('250 restaurants')
    .insert([{ Restaurant, Address: Address||'', Phone: Phone||'', Area: Area||'', Cuisine: Cuisine||'', Rank: Rank||null }])
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.patch('/:rank', authenticateToken, async (req, res) => {
  const { data, error } = await supabase
    .from('250 restaurants')
    .update(req.body)
    .eq('Rank', req.params.rank)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/:rank', authenticateToken, async (req, res) => {
  const { error } = await supabase
    .from('250 restaurants')
    .delete()
    .eq('Rank', req.params.rank);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Deleted' });
});

module.exports = router;
