const express = require('express');
const { supabase } = require('../services/supabase');
const { sendWaitlistConfirmationEmail } = require('../services/waitlist-email');

const router = express.Router();

// POST /api/waitlist
// Public — no auth required. Inserts a waitlist entry and sends a confirmation email.
router.post('/', async (req, res) => {
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
    // Unique violation — already on the list
    if (error.code === '23505') {
      return res.status(200).json({ status: 'duplicate', message: "You're already on the list" });
    }
    console.error('[waitlist] insert error:', error.message);
    return res.status(500).json({ error: 'Failed to save your request. Please try again.' });
  }

  // Fire confirmation email — don't block the response on it
  sendWaitlistConfirmationEmail({ email, name }).catch((err) =>
    console.error('[waitlist] confirmation email failed:', err.message)
  );

  return res.status(201).json({ status: 'ok', message: "You're on the list" });
});

module.exports = router;
