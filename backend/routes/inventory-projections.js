'use strict';

const express = require('express');
const { z } = require('zod');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { validateQuery } = require('../lib/zod-validate');
const { buildInventoryProjection } = require('../services/inventory-projections');

const router = express.Router();

const projectionQuerySchema = z.object({
  productId: z.string().trim().min(1),
  days: z.coerce.number().int().min(1).max(90).optional().default(30),
});

router.get('/projections', authenticateToken, requireRole('admin', 'manager'), validateQuery(projectionQuerySchema), async (req, res) => {
  try {
    const rows = await buildInventoryProjection({
      productId: req.validated.query.productId,
      days: req.validated.query.days,
      context: req.context,
    });
    res.json(rows);
  } catch (error) {
    res.status(Number(error.status) || 500).json({ error: error.message || 'Failed to build inventory projection' });
  }
});

module.exports = router;
