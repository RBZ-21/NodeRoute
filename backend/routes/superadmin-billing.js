'use strict';

const express = require('express');
const { supabase } = require('../services/supabase');
const {
  billingAnalytics,
  loadBillingCatalog,
  loadCompanyBilling,
  saveCompanyBilling,
} = require('../services/superadmin-billing');

const router = express.Router();

router.get('/catalog', async (_req, res) => {
  try {
    res.json(await loadBillingCatalog(supabase));
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not load billing catalog' });
  }
});

router.get('/analytics', async (_req, res) => {
  try {
    res.json(await billingAnalytics(supabase));
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not load billing analytics' });
  }
});

async function getCompanyBilling(req, res) {
  try {
    res.json(await loadCompanyBilling(supabase, req.params.id));
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not load company billing' });
  }
}

async function patchCompanyBilling(req, res) {
  try {
    res.json(await saveCompanyBilling(supabase, req.params.id, req.body, req.user));
  } catch (error) {
    const status = error.name === 'ZodError' ? 400 : 500;
    res.status(status).json({ error: error.message || 'Could not save company billing' });
  }
}

module.exports = {
  router,
  getCompanyBilling,
  patchCompanyBilling,
};
