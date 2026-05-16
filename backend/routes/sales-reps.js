'use strict';

const express = require('express');
const { supabase } = require('../services/supabase');
const { authenticateToken } = require('../middleware/auth');
const { filterRowsByContext, buildScopeFields } = require('../services/operating-context');

const router = express.Router();

// GET /api/sales-reps/customers
router.get('/customers', authenticateToken, async (req, res) => {
  try {
    let query = supabase.from('Customers').select('*').order('company_name', { ascending: true });
    if (!['admin', 'manager'].includes(req.user.role)) {
      query = query.eq('sales_rep_id', req.user.id);
    }
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json(filterRowsByContext(data || [], req.context));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sales-reps/visit-logs
router.get('/visit-logs', authenticateToken, async (req, res) => {
  try {
    let query = supabase
      .from('customer_visit_logs')
      .select('*')
      .order('visited_at', { ascending: false })
      .limit(500);
    if (!['admin', 'manager'].includes(req.user.role)) {
      query = query.eq('sales_rep_id', req.user.id);
    }
    if (req.query.customer_id) query = query.eq('customer_id', req.query.customer_id);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sales-reps/visit-logs
router.post('/visit-logs', authenticateToken, async (req, res) => {
  const { customer_id, customer_name, notes, outcome } = req.body || {};
  if (!customer_id) return res.status(400).json({ error: 'customer_id is required' });
  const record = {
    customer_id: String(customer_id),
    customer_name: String(customer_name || '').trim() || null,
    sales_rep_id: req.user.id,
    sales_rep_name: req.user.name || req.user.email || null,
    notes: String(notes || '').trim() || null,
    outcome: String(outcome || '').trim() || null,
    visited_at: new Date().toISOString(),
    ...buildScopeFields(req.context),
  };
  const { data, error } = await supabase.from('customer_visit_logs').insert([record]).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// GET /api/sales-reps/upsell-alerts
// Cross-references AI forecast demand with customer order history.
router.get('/upsell-alerts', authenticateToken, async (req, res) => {
  try {
    const [forecastResult, ordersResult, customersResult] = await Promise.all([
      supabase
        .from('forecast_items')
        .select('species,projected_demand,unit')
        .order('projected_demand', { ascending: false })
        .limit(20),
      supabase
        .from('orders')
        .select('customer_id,customer_name,items,created_at')
        .gte('created_at', new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()),
      supabase
        .from('Customers')
        .select('id,company_name,email,sales_rep_id')
        .eq('status', 'active'),
    ]);

    const forecasts = forecastResult.data || [];
    const orders = ordersResult.data || [];
    const customers = filterRowsByContext(customersResult.data || [], req.context);
    const myCustomers = ['admin', 'manager'].includes(req.user.role)
      ? customers
      : customers.filter((c) => c.sales_rep_id === req.user.id);

    const recentPurchases = new Set();
    for (const order of orders) {
      const items = Array.isArray(order.items) ? order.items : [];
      for (const item of items) {
        const species = String(item.description || item.species || item.name || '').toLowerCase().trim();
        if (species) recentPurchases.add(`${order.customer_id}::${species}`);
      }
    }

    const topSpecies = forecasts
      .slice(0, 5)
      .map((f) => String(f.species || '').toLowerCase().trim())
      .filter(Boolean);

    const alerts = [];
    for (const customer of myCustomers) {
      const missing = topSpecies.filter((s) => !recentPurchases.has(`${customer.id}::${s}`));
      if (missing.length) {
        alerts.push({
          customer_id: customer.id,
          customer_name: customer.company_name,
          customer_email: customer.email,
          missing_items: missing,
          alert: `${customer.company_name} hasn't ordered ${missing.slice(0, 2).join(', ')} in 60 days — forecasted high demand`,
        });
      }
    }
    res.json(alerts.slice(0, 50));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sales-reps/order-history/:customerId
router.get('/order-history/:customerId', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('customer_id', req.params.customerId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
