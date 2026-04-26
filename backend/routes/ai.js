const express = require('express');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { generateWalkthrough, generateOrderIntakeDraft, generateChatReply, checkChatRateLimit } = require('../services/ai');

const router = express.Router();

router.post('/walkthrough', authenticateToken, async (req, res) => {
  const feature = String(req.body.feature || '').trim();
  const question = String(req.body.question || '').trim();

  if (!feature) {
    return res.status(400).json({ error: 'Feature is required' });
  }

  try {
    const walkthrough = await generateWalkthrough(feature, question);
    res.json(walkthrough);
  } catch (err) {
    if (String(err.message || '').includes('OPENAI_API_KEY')) {
      return res.status(503).json({ error: err.message });
    }
    res.status(500).json({ error: 'AI walkthrough failed: ' + err.message });
  }
});

router.post('/order-intake', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const message = String(req.body.message || '').trim();

  if (!message) {
    return res.status(400).json({ error: 'Order intake message is required' });
  }

  try {
    const draft = await generateOrderIntakeDraft(message);
    res.json(draft);
  } catch (err) {
    res.status(500).json({ error: 'Order intake parsing failed: ' + err.message });
  }
});

router.post('/chat', authenticateToken, async (req, res) => {
  const message = String(req.body.message || '').trim();
  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  const userId = req.user?.id || req.user?.email || 'unknown';
  if (!checkChatRateLimit(userId)) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment before sending another message.' });
  }

  const userName = req.user?.name || req.user?.email || 'User';
  const userRole = req.user?.role || 'user';
  const history = Array.isArray(req.body.history) ? req.body.history : [];

  try {
    const reply = await generateChatReply(userName, userRole, message, history);
    res.json({ reply });
  } catch (err) {
    if (String(err.message || '').includes('OPENAI_API_KEY')) {
      return res.status(503).json({ error: 'AI service is not configured.' });
    }
    res.status(502).json({ error: 'AI chat failed. Please try again.' });
  }
});

module.exports = router;
