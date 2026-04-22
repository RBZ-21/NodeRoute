const express = require('express');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { generateWalkthrough, generateOrderIntakeDraft } = require('../services/ai');

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

module.exports = router;
