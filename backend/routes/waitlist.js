const express = require('express');
const { supabase } = require('../services/supabase');
const { authenticateToken, requireSuperadmin } = require('../middleware/auth');
const { waitlistLimiter } = require('../middleware/rateLimiter');
const { sendWaitlistConfirmationEmail } = require('../services/waitlist-email');

const router = express.Router();

// POST /api/waitlist — public, no auth
router.post('/', waitlistLimiter, async (req, res) => {
  const email   = String(req.body?.email   || '').trim().toLowerCase();
  const name    = String(req.body?.name    || '').trim() || null;
  const company = String(req.body?.company || '').trim() || null;
  const source  = String(req.body?.source  || 'landing').trim();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'A valid email address is required' });
  }

  const { error } = await supabase
    .from('waitlist')
    .insert({ email, name, company, source });

  if (error) {
    if (error.code === '23505') {
      return res.status(200).json({ status: 'duplicate', message: "You're already on the list" });
    }
    console.error('[waitlist] insert error:', error.message);
    return res.status(500).json({ error: 'Failed to save your request. Please try again.' });
  }

  sendWaitlistConfirmationEmail({ email, name }).catch((err) =>
    console.error('[waitlist] confirmation email failed:', err.message)
  );

  return res.status(201).json({ status: 'ok', message: "You're on the list" });
});

// GET /api/waitlist — superadmin only (role + SUPERADMIN_EMAIL pin, matching /api/superadmin/*)
router.get('/', authenticateToken, requireSuperadmin, async (req, res) => {
  const { data, error } = await supabase
    .from('waitlist')
    .select('id, email, name, company, source, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[waitlist] list error:', error.message);
    return res.status(500).json({ error: 'Failed to load waitlist' });
  }
  res.json(data || []);
});

module.exports = router;
