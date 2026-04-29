const express = require('express');
const crypto = require('crypto');
const { supabase } = require('../../services/supabase');
const {
  PORTAL_CODE_TTL_MS,
  PORTAL_MAX_VERIFY_ATTEMPTS,
  PORTAL_RESEND_COOLDOWN_MS,
  authenticatePortalToken,
  canRequestCode,
  codesMatch,
  generateVerificationCode,
  hashCode,
  normalizeEmail,
  pruneExpiredChallenges,
  resolvePortalCustomer,
  sendPortalCodeEmail,
  signPortalJWT,
  touchRateLimitBucket,
} = require('./shared');

module.exports = function buildPortalAuthRouter() {
  const router = express.Router();

  router.post('/auth', async (req, res) => {
    await pruneExpiredChallenges();

    const normalized = normalizeEmail(req.body?.email);
    if (!normalized) return res.status(400).json({ error: 'Email required' });
    if (!(await canRequestCode(normalized))) {
      return res.status(429).json({ error: 'Too many portal login attempts. Please wait a few minutes and try again.' });
    }

    try {
      const customer = await resolvePortalCustomer(normalized);
      if (!customer) {
        await touchRateLimitBucket(normalized);
        return res.status(404).json({ error: 'No account found for that email. Contact your NodeRoute representative.' });
      }

      const nowIso = new Date().toISOString();
      const { data: existingRows } = await supabase.from('portal_challenges')
        .select('*').eq('email', normalized).gte('expires_at', nowIso).limit(1);
      const existing = existingRows?.[0] || null;

      if (existing) {
        const lastSentMs = new Date(existing.last_sent_at).getTime();
        if (Date.now() - lastSentMs < PORTAL_RESEND_COOLDOWN_MS) {
          const retryAfterSeconds = Math.ceil((PORTAL_RESEND_COOLDOWN_MS - (Date.now() - lastSentMs)) / 1000);
          return res.status(429).json({
            error: 'A verification code was just sent. Please wait a moment before requesting another one.',
            retryAfterSeconds,
          });
        }
      }

      const challengeId = crypto.randomBytes(24).toString('hex');
      const code = generateVerificationCode();

      if (existing) await supabase.from('portal_challenges').delete().eq('id', existing.id);
      await sendPortalCodeEmail({ email: customer.email, name: customer.name, code });
      await supabase.from('portal_challenges').insert({
        id: challengeId,
        email: customer.email,
        name: customer.name,
        code_hash: hashCode(challengeId, code),
        expires_at: new Date(Date.now() + PORTAL_CODE_TTL_MS).toISOString(),
        attempts_left: PORTAL_MAX_VERIFY_ATTEMPTS,
        last_sent_at: new Date().toISOString(),
        company_id: customer.companyId || null,
        location_id: customer.locationId || null,
      });
      await touchRateLimitBucket(normalized);

      return res.json({
        challengeId,
        maskedEmail: customer.email.replace(/(^.).*(@.*$)/, '$1***$2'),
        name: customer.name,
        expiresInSeconds: Math.floor(PORTAL_CODE_TTL_MS / 1000),
      });
    } catch (error) {
      console.error('portal/auth:', error.message);
      return res.status(500).json({ error: error.message || 'Could not start customer portal sign-in' });
    }
  });

  router.post('/verify', async (req, res) => {
    await pruneExpiredChallenges();

    const challengeId = String(req.body?.challengeId || '').trim();
    const code = String(req.body?.code || '').trim();
    if (!challengeId || !code) return res.status(400).json({ error: 'Challenge ID and verification code are required' });

    const { data: challengeRows } = await supabase.from('portal_challenges')
      .select('*').eq('id', challengeId).limit(1);
    const challenge = challengeRows?.[0] || null;

    if (!challenge || new Date(challenge.expires_at).getTime() <= Date.now()) {
      if (challenge) await supabase.from('portal_challenges').delete().eq('id', challengeId);
      return res.status(401).json({ error: 'This verification code has expired. Please request a new one.' });
    }

    if (!codesMatch(challenge.code_hash, hashCode(challengeId, code))) {
      const attemptsLeft = challenge.attempts_left - 1;
      if (attemptsLeft <= 0) {
        await supabase.from('portal_challenges').delete().eq('id', challengeId);
        return res.status(401).json({ error: 'Too many incorrect attempts. Please request a new verification code.' });
      }
      await supabase.from('portal_challenges').update({ attempts_left: attemptsLeft }).eq('id', challengeId);
      return res.status(401).json({ error: `Incorrect code. ${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} remaining.` });
    }

    await supabase.from('portal_challenges').delete().eq('id', challengeId);
    return res.json({
      token: signPortalJWT(challenge.email, challenge.name, {
        companyId: challenge.company_id,
        locationId: challenge.location_id,
      }),
      name: challenge.name,
      email: challenge.email,
    });
  });

  router.get('/me', authenticatePortalToken, (req, res) => {
    res.json({ email: req.customerEmail, name: req.customerName });
  });

  return router;
};
