/**
 * SuperAdmin routes — accessible only to users with role 'superadmin'.
 * These routes give the NodeRoute platform owner cross-tenant visibility.
 *
 * Endpoints:
 *   GET  /api/superadmin/companies                       List all tenant companies (includes config tags)
 *   GET  /api/superadmin/companies/:id                   Get one company's detail + users + config
 *   POST /api/superadmin/companies/:id/impersonate       Issue a short-lived token scoped to that company's admin
 *   POST /api/superadmin/companies/:id/status            Set company status (active | suspended | trial)
 *   PATCH /api/superadmin/companies/:id/config           Override any company_config field
 *   GET  /api/superadmin/analytics/verticals             Break down companies by business type + feature flags
 */
const express = require('express');
const jwt     = require('jsonwebtoken');
const { supabase } = require('../services/supabase');
const { JWT_SECRET } = require('../lib/config');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// All superadmin routes require authentication + the 'superadmin' role.
router.use(authenticateToken);
router.use(requireRole('superadmin'));

// ── Helpers ───────────────────────────────────────────────────────────────────
function extractRows(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.data)) return result.data;
  return [];
}

// ── GET /api/superadmin/companies ─────────────────────────────────────────────
// Returns a summary row per company, enriched with company_config tags.
router.get('/companies', async (req, res) => {
  try {
    const companiesResult = await supabase.from('companies').select('*');
    const companiesError  = companiesResult?.error;

    if (!companiesError && Array.isArray(companiesResult?.data) && companiesResult.data.length > 0) {
      const [usersResult, configResult] = await Promise.all([
        supabase.from('users').select('id, company_id, role, email, created_at'),
        supabase.from('company_config').select('company_id, business_types, enabled_units, feat_catch_weight, feat_fsma_lot_tracking, feat_cold_chain_notes, feat_alcohol_compliance, feat_deposit_tracking, feat_case_to_each, catalog_template, onboarding_completed'),
      ]);
      const users   = extractRows(usersResult);
      const configs = extractRows(configResult);

      const enriched = companiesResult.data.map((company) => {
        const companyUsers  = users.filter((u) => String(u.company_id) === String(company.id));
        const adminUser     = companyUsers.find((u) => u.role === 'admin');
        const lastActivity  = companyUsers.map((u) => u.created_at).filter(Boolean).sort().pop();
        const cfg           = configs.find((c) => String(c.company_id) === String(company.id)) ?? null;

        return {
          id:                   String(company.id),
          name:                 company.name || company.company_name || `Company ${company.id}`,
          slug:                 company.slug || null,
          plan:                 company.plan || null,
          status:               company.status || 'active',
          admin_email:          adminUser?.email || company.admin_email || null,
          user_count:           companyUsers.length,
          created_at:           company.created_at || null,
          last_activity:        lastActivity || null,
          // company_config summary
          business_types:       cfg?.business_types       ?? [],
          enabled_units:        cfg?.enabled_units         ?? [],
          feat_catch_weight:    cfg?.feat_catch_weight     ?? false,
          feat_fsma:            cfg?.feat_fsma_lot_tracking ?? false,
          feat_cold_chain:      cfg?.feat_cold_chain_notes  ?? false,
          feat_alcohol:         cfg?.feat_alcohol_compliance ?? false,
          feat_deposits:        cfg?.feat_deposit_tracking  ?? false,
          feat_case_to_each:    cfg?.feat_case_to_each      ?? false,
          catalog_template:     cfg?.catalog_template       ?? null,
          onboarding_completed: cfg?.onboarding_completed   ?? false,
        };
      });

      return res.json(enriched);
    }

    // Fallback: infer companies from the users table
    const usersResult = await supabase.from('users').select('*');
    const allUsers    = extractRows(usersResult);
    if (!allUsers.length) return res.json([]);

    const map = new Map();
    for (const user of allUsers) {
      const key = String(user.company_id || user.id);
      if (!map.has(key)) {
        map.set(key, {
          id:            key,
          name:          user.company_name || user.name || `Company ${key}`,
          slug:          user.company_slug || null,
          plan:          user.plan || null,
          status:        user.company_status || 'active',
          admin_email:   user.role === 'admin' ? user.email : null,
          user_count:    0,
          created_at:    user.created_at || null,
          last_activity: user.created_at || null,
          business_types: [], enabled_units: [], onboarding_completed: false,
          _users: [],
        });
      }
      const entry = map.get(key);
      entry.user_count += 1;
      entry._users.push(user);
      if (!entry.admin_email && user.role === 'admin') entry.admin_email = user.email;
      if ((user.created_at || '') > (entry.last_activity || '')) entry.last_activity = user.created_at;
    }

    const companies = [...map.values()].map(({ _users, ...c }) => c);
    return res.json(companies);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/superadmin/companies/:id ────────────────────────────────────────
router.get('/companies/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [usersResult, companyResult, configResult] = await Promise.all([
      supabase.from('users').select('*'),
      supabase.from('companies').select('*').eq('id', id).single(),
      supabase.from('company_config').select('*').eq('company_id', id).single(),
    ]);
    const allUsers     = extractRows(usersResult);
    const companyUsers = allUsers.filter((u) => String(u.company_id || u.id) === id);
    res.json({
      id,
      company: companyResult?.data ?? null,
      users:   companyUsers,
      config:  configResult?.data  ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/superadmin/companies/:id/impersonate ───────────────────────────
// Issues a short-lived JWT (1 h) for the company's admin user so the SuperAdmin
// can inspect their context without knowing their password.
router.post('/companies/:id/impersonate', async (req, res) => {
  try {
    const { id } = req.params;
    const usersResult = await supabase.from('users').select('*');
    const allUsers = extractRows(usersResult);

    // Find the admin user for this company
    const targetUser = allUsers.find(
      (u) =>
        (String(u.company_id || u.id) === id) &&
        (u.role === 'admin' || u.role === 'manager'),
    ) || allUsers.find((u) => String(u.company_id || u.id) === id);

    if (!targetUser) {
      return res.status(404).json({ error: 'No users found for this company.' });
    }

    const impersonationToken = jwt.sign(
      {
        userId: targetUser.id,
        email:  targetUser.email,
        role:   targetUser.role,
        // Mark so the backend can detect impersonation in audit logs if needed
        impersonated_by: req.user.id,
      },
      JWT_SECRET,
      { expiresIn: '1h' },
    );

    res.json({
      token: impersonationToken,
      user:  {
        id:    targetUser.id,
        name:  targetUser.name,
        email: targetUser.email,
        role:  targetUser.role,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/superadmin/companies/:id/status ────────────────────────────────
// Update a company's status field (active | suspended | trial).
// Assumes a `companies` table with a `status` column; falls back to a no-op.
router.post('/companies/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.query;
    const allowed = ['active', 'suspended', 'trial'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` });
    }

    const updateResult = await supabase
      .from('companies')
      .update({ status })
      .eq('id', id);

    if (updateResult?.error) {
      return res.status(500).json({ error: updateResult.error.message });
    }

    res.json({ ok: true, id, status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/superadmin/companies/:id/config ───────────────────────────────
// Allows superadmin to override any company_config field for any tenant.
router.patch('/companies/:id/config', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body, updated_at: new Date().toISOString() };

    // Remove id fields from body to avoid accidental PK changes
    delete updates.id;
    delete updates.company_id;

    const { data, error } = await supabase
      .from('company_config')
      .update(updates)
      .eq('company_id', id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, config: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/superadmin/analytics/verticals ───────────────────────────────────
// Returns vertical analytics: companies by business type, feature flag adoption,
// and any companies using features above their plan tier.
router.get('/analytics/verticals', async (req, res) => {
  try {
    const [companiesResult, configsResult] = await Promise.all([
      supabase.from('companies').select('id, name, plan, status'),
      supabase.from('company_config').select('*'),
    ]);

    const companies = extractRows(companiesResult);
    const configs   = extractRows(configsResult);

    // ── By vertical ───────────────────────────────────────────────────────────
    const verticalMap = {};
    for (const cfg of configs) {
      for (const type of (cfg.business_types ?? [])) {
        verticalMap[type] = (verticalMap[type] ?? 0) + 1;
      }
    }
    const byVertical = Object.entries(verticalMap)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);

    // ── Feature flag adoption ─────────────────────────────────────────────────
    const FLAGS = [
      'feat_catch_weight', 'feat_fsma_lot_tracking', 'feat_cold_chain_notes',
      'feat_alcohol_compliance', 'feat_deposit_tracking', 'feat_case_to_each',
    ];
    const featureAdoption = FLAGS.map((flag) => ({
      flag,
      count: configs.filter((c) => c[flag] === true).length,
      pct:   configs.length ? Math.round((configs.filter((c) => c[flag]).length / configs.length) * 100) : 0,
    })).sort((a, b) => b.count - a.count);

    // ── Onboarding funnel ─────────────────────────────────────────────────────
    const total      = companies.length;
    const completed  = configs.filter((c) => c.onboarding_completed).length;
    const incomplete = total - completed;

    // ── Plan tier flag violations (starter shouldn't use enterprise features) ─
    // Convention: FSMA lot tracking + alcohol compliance are enterprise-only.
    const enterpriseFlags  = ['feat_fsma_lot_tracking', 'feat_alcohol_compliance'];
    const tierViolations   = configs
      .filter((cfg) => {
        const company = companies.find((c) => String(c.id) === String(cfg.company_id));
        if (!company || company.plan === 'enterprise') return false;
        return enterpriseFlags.some((f) => cfg[f] === true);
      })
      .map((cfg) => {
        const company = companies.find((c) => String(c.id) === String(cfg.company_id));
        return {
          company_id:   cfg.company_id,
          company_name: company?.name ?? cfg.company_id,
          plan:         company?.plan ?? 'unknown',
          flags_enabled: enterpriseFlags.filter((f) => cfg[f]),
        };
      });

    res.json({
      total_companies:    total,
      onboarding_completed: completed,
      onboarding_incomplete: incomplete,
      by_vertical:        byVertical,
      feature_adoption:   featureAdoption,
      tier_violations:    tierViolations,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
