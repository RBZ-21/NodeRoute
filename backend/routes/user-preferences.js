'use strict';

const express = require('express');
const { z } = require('zod');
const { supabase } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { validateBody, validateQuery } = require('../lib/zod-validate');
const {
  filterRowsByContext,
  insertRecordWithOptionalScope,
  scopeQueryByContext,
} = require('../services/operating-context');
const { isKnownNavItemId } = require('../lib/nav-item-ids');

const router = express.Router();
const dashboardLayoutsRouter = express.Router();
const preferenceRoles = requireRole('admin', 'manager', 'driver', 'rep');
const dashboardRoles = requireRole('admin', 'manager', 'rep');
const VIEW_TYPES = ['inventory', 'customer', 'vendor', 'salesperson', 'brand', 'class'];

const navigationBodySchema = z.object({
  nav_item_ids: z.array(z.string().trim().min(1)).max(100),
}).superRefine((value, ctx) => {
  const seen = new Set();
  for (const [index, navId] of value.nav_item_ids.entries()) {
    if (!isKnownNavItemId(navId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['nav_item_ids', index],
        message: `Unknown nav item id: ${navId}`,
      });
    }
    if (seen.has(navId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['nav_item_ids', index],
        message: `Duplicate nav item id: ${navId}`,
      });
    }
    seen.add(navId);
  }
});

const dashboardLayoutQuerySchema = z.object({
  viewType: z.enum(VIEW_TYPES).optional().default('inventory'),
});

const dashboardLayoutBodySchema = z.object({
  view_type: z.enum(VIEW_TYPES),
  layout: z.record(z.string(), z.unknown()),
});

function firstScopedRow(rows, context) {
  return filterRowsByContext(rows || [], context)[0] || null;
}

async function loadNavigationPreference(req) {
  const { data, error } = await scopeQueryByContext(
    supabase.from('user_menu_preferences').select('*'),
    req.context,
    { companyField: 'company_id' },
  )
    .eq('user_id', req.user.id)
    .limit(1);

  if (error) throw error;
  return firstScopedRow(data, req.context);
}

router.get('/navigation', authenticateToken, preferenceRoles, async (req, res) => {
  try {
    const preference = await loadNavigationPreference(req);
    res.json({
      nav_item_ids: Array.isArray(preference?.nav_item_ids) ? preference.nav_item_ids : [],
      updated_at: preference?.updated_at || null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to load navigation preferences' });
  }
});

router.put('/navigation', authenticateToken, preferenceRoles, validateBody(navigationBodySchema), async (req, res) => {
  try {
    const payload = {
      user_id: req.user.id,
      nav_item_ids: req.validated.body.nav_item_ids,
      updated_at: new Date().toISOString(),
    };
    const existing = await loadNavigationPreference(req);

    let result;
    if (existing) {
      result = await scopeQueryByContext(
        supabase.from('user_menu_preferences').update(payload),
        req.context,
        { companyField: 'company_id' },
      )
        .eq('id', existing.id)
        .select()
        .single();
    } else {
      result = await insertRecordWithOptionalScope(supabase, 'user_menu_preferences', payload, req.context);
    }

    if (result.error) throw result.error;
    const preference = result.data || { ...existing, ...payload };
    res.json({
      nav_item_ids: Array.isArray(preference.nav_item_ids) ? preference.nav_item_ids : payload.nav_item_ids,
      updated_at: preference.updated_at || payload.updated_at,
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to save navigation preferences' });
  }
});

async function loadDashboardLayout(req, viewType) {
  const { data, error } = await scopeQueryByContext(
    supabase.from('dashboard_layouts').select('*'),
    req.context,
    { companyField: 'company_id', includeLocation: true },
  )
    .eq('view_type', viewType)
    .eq('user_id', req.user.id)
    .limit(1);

  if (error) throw error;
  return firstScopedRow(data, req.context);
}

dashboardLayoutsRouter.get('/', authenticateToken, dashboardRoles, validateQuery(dashboardLayoutQuerySchema), async (req, res) => {
  try {
    const viewType = req.validated.query.viewType;
    const layout = await loadDashboardLayout(req, viewType);
    res.json({
      view_type: viewType,
      layout: layout?.layout || { widgets: {} },
      updated_at: layout?.updated_at || null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to load dashboard layout' });
  }
});

dashboardLayoutsRouter.put('/', authenticateToken, dashboardRoles, validateBody(dashboardLayoutBodySchema), async (req, res) => {
  try {
    const now = new Date().toISOString();
    const payload = {
      user_id: req.user.id,
      role: req.user.role || null,
      view_type: req.validated.body.view_type,
      layout: req.validated.body.layout,
      updated_at: now,
    };
    const existing = await loadDashboardLayout(req, payload.view_type);

    let result;
    if (existing) {
      result = await scopeQueryByContext(
        supabase.from('dashboard_layouts').update(payload),
        req.context,
        { companyField: 'company_id', includeLocation: true },
      )
        .eq('id', existing.id)
        .select()
        .single();
    } else {
      result = await insertRecordWithOptionalScope(supabase, 'dashboard_layouts', payload, req.context);
    }

    if (result.error) throw result.error;
    res.json(result.data || { ...existing, ...payload });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to save dashboard layout' });
  }
});

router.dashboardLayoutsRouter = dashboardLayoutsRouter;

module.exports = router;
