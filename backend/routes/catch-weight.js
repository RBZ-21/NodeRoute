/**
 * /api/catch-weight
 *
 * Catch-weight item management — tracks items sold/purchased by both
 * count and actual weight (e.g. whole fish, live shellfish).
 */

const express = require('express');
const router  = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const db = require('../lib/db');

router.use(authenticateToken);

// GET /api/catch-weight — list all catch-weight records for the tenant
router.get('/', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    const { rows } = await db.query(
      `SELECT * FROM catch_weight_items
       WHERE tenant_id = $1
       ORDER BY created_at DESC`,
      [tenantId]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/catch-weight/:id
router.get('/:id', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    const { rows } = await db.query(
      `SELECT * FROM catch_weight_items
       WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, tenantId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /api/catch-weight — create a catch-weight record
router.post('/', requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    const {
      lot_number, item_number, description,
      nominal_weight, actual_weight, unit_count,
      order_id, notes,
    } = req.body;

    const { rows } = await db.query(
      `INSERT INTO catch_weight_items
         (tenant_id, lot_number, item_number, description,
          nominal_weight, actual_weight, unit_count, order_id, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [tenantId, lot_number, item_number, description,
       nominal_weight, actual_weight, unit_count, order_id, notes]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/catch-weight/:id — update fields
router.patch('/:id', requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    const allowed = [
      'lot_number', 'item_number', 'description',
      'nominal_weight', 'actual_weight', 'unit_count',
      'order_id', 'notes',
    ];
    const fields = Object.keys(req.body).filter((k) => allowed.includes(k));
    if (!fields.length) return res.status(400).json({ error: 'No valid fields to update' });

    const setClauses = fields.map((f, i) => `${f} = $${i + 3}`).join(', ');
    const values     = fields.map((f) => req.body[f]);

    const { rows } = await db.query(
      `UPDATE catch_weight_items
       SET ${setClauses}, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2
       RETURNING *`,
      [req.params.id, tenantId, ...values]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/catch-weight/:id
router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    const { rowCount } = await db.query(
      `DELETE FROM catch_weight_items WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, tenantId]
    );
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
