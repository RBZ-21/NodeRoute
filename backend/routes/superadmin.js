/**
 * SuperAdmin routes — accessible only to users with role 'superadmin'.
 * These routes give the NodeRoute platform owner cross-tenant visibility.
 *
 * Endpoints:
 *   GET  /api/superadmin/companies              List all tenant companies
 *   GET  /api/superadmin/companies/:id          Get one company's detail + users
 *   POST /api/superadmin/companies/:id/impersonate  Issue a short-lived token scoped to that company's admin
 *   POST /api/superadmin/companies/:id/status   Set company status (active | suspended | trial)
 */
const express = require('express');
const jwt     = require('jsonwebtoken');
const { supabase } = require('../services/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'noderoute-dev-secret-change-in-production';

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
// Returns a summary row per company.
// If you have a dedicated `companies` table, query it here.
// If companies are inferred from `users`, we group by company_id/company_name.
router.get('/companies', async (req, res) => {
  try {
    // Primary: try a dedicated companies table first
    const companiesResult = await supabase.from('companies').select('*');
    const companiesError = companiesResult?.error;

    if (!companiesError && Array.isArray(companiesResult?.data) && companiesResult.data.length > 0) {
      // Enrich with per-company user counts
      const usersResult = await supabase.from('users').select('id, company_id, role, email, created_at');
      const users = extractRows(usersResult);

      const enriched = companiesResult.data.map((company) => {
        const companyUsers = users.filter((u) => String(u.company_id) === String(company.id));
        const adminUser = companyUsers.find((u) => u.role === 'admin');
        const lastActivity = companyUsers
          .map((u) => u.created_at)
          .filter(Boolean)
          .sort()
          .pop();
        return {
          id:            String(company.id),
          name:          company.name || company.company_name || `Company ${company.id}`,
          slug:          company.slug || null,
          plan:          company.plan || company.plan_name || null,
          status:        company.status || 'active',
          admin_email:   adminUser?.email || company.admin_email || null,
          user_count:    companyUsers.length,
          created_at:    company.created_at || null,
          last_activity: lastActivity || null,
        };
      });

      return res.json(enriched);
    }

    // Fallback: infer companies from the users table (single-tenant rows share company_id)
    const usersResult = await supabase.from('users').select('*');
    const allUsers = extractRows(usersResult);
    if (!allUsers.length) return res.json([]);

    // Group by company_id; if no company_id column exists treat each admin as a company
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
          _users:        [],
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
    const usersResult = await supabase.from('users').select('*');
    const allUsers = extractRows(usersResult);
    const companyUsers = allUsers.filter(
      (u) => String(u.company_id || u.id) === id,
    );
    res.json({ id, users: companyUsers });
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

module.exports = router;
