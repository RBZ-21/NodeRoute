const express = require('express');
const { supabase, dbQuery } = require('../services/supabase');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// ── CUSTOMERS (Supabase: "250 restaurants") ─────────────
router.get('/', authenticateToken, async (req, res) => {
  const data = await dbQuery(supabase.from('250 restaurants').select('*').order('Rank', { ascending: true }), res);
  if (!data) return;
  res.json(data);
});

router.post('/', authenticateToken, async (req, res) => {
  const { Restaurant, Address, Phone, Area, Cuisine, Rank } = req.body;
  if (!Restaurant) return res.status(400).json({ error: 'Restaurant name required' });
  const data = await dbQuery(supabase.from('250 restaurants').insert([{ Restaurant, Address: Address||'', Phone: Phone||'', Area: Area||'', Cuisine: Cuisine||'', Rank: Rank||null }]).select().single(), res);
  if (!data) return;
  res.json(data);
});

router.patch('/:rank', authenticateToken, async (req, res) => {
  const data = await dbQuery(supabase.from('250 restaurants').update(req.body).eq('Rank', req.params.rank).select().single(), res);
  if (!data) return;
  res.json(data);
});

router.delete('/:rank', authenticateToken, async (req, res) => {
  const data = await dbQuery(supabase.from('250 restaurants').delete().eq('Rank', req.params.rank), res);
  if (data === null) return;
  res.json({ message: 'Deleted' });
});

module.exports = router;
