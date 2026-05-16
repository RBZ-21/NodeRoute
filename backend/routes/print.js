const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { supabase } = require('../services/supabase');
const { renderOrderSlip } = require('../services/print-template');

const router = express.Router();

// Minimal template route: render an order slip for a given order id
router.get('/order-slip/:orderId', authenticateToken, async (req, res) => {
  const { orderId } = req.params;
  if (!orderId) return res.status(400).json({ error: 'orderId required' });
  const { data, error } = await supabase.from('orders').select('*').eq('id', orderId).single();
  if (error || !data) return res.status(404).json({ error: 'Order not found' });
  const html = `<pre>${renderOrderSlip({ ...data, items: data.items || [] })}</pre>`;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

module.exports = router;
