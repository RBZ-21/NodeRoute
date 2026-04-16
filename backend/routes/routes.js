const express = require('express');
const { supabase, dbQuery } = require('../services/supabase');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// ── ROUTES (Supabase) ───────────────────────────────────
router.get('/', authenticateToken, async (req, res) => {
  const data = await dbQuery(supabase.from('routes').select('*').order('created_at', { ascending: true }), res);
  if (!data) return;
  res.json(data);
});

router.post('/', authenticateToken, async (req, res) => {
  const { name, stopIds, driver, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Route name required' });
  const data = await dbQuery(supabase.from('routes').insert([{ name, stop_ids: stopIds||[], driver: driver||'', notes: notes||'' }]).select().single(), res);
  if (!data) return;
  res.json(data);
});

router.patch('/:id', authenticateToken, async (req, res) => {
  const payload = { ...req.body };
  if (payload.stopIds !== undefined) { payload.stop_ids = payload.stopIds; delete payload.stopIds; }
  const data = await dbQuery(supabase.from('routes').update(payload).eq('id', req.params.id).select().single(), res);
  if (!data) return;
  res.json(data);
});

router.delete('/:id', authenticateToken, async (req, res) => {
  const data = await dbQuery(supabase.from('routes').delete().eq('id', req.params.id), res);
  if (data === null) return;
  res.json({ message: 'Deleted' });
});

module.exports = router;
