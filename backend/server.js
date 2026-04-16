require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const JWT_SECRET = process.env.JWT_SECRET || 'noderoute-dev-secret-change-in-production';
const JWT_EXPIRY = '24h';

// Email transporter — configured via SMTP_* env vars
function createMailer() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

const app = express();
const PORT = process.env.PORT || 3001;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

app.use(express.json());

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const frontendDir = path.join(__dirname, '../frontend');
app.use(express.static(frontendDir, { index: false }));

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@noderoute.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@123';

const DEFAULT_COMPANY_ID = '00000000-0000-0000-0000-000000000001';

// Auto-create default company + admin on first run
async function ensureAdminExists() {
  // Ensure default company exists first
  const { data: existingCo } = await supabase.from('companies').select('id').eq('id', DEFAULT_COMPANY_ID).single();
  if (!existingCo) {
    const { error: coErr } = await supabase.from('companies').insert([{
      id: DEFAULT_COMPANY_ID,
      name: process.env.COMPANY_NAME || 'NodeRoute',
      slug: 'default',
      plan: 'starter',
    }]);
    if (coErr) console.error('Could not create default company:', coErr.message);
    else console.log('Default company created.');
  }

  const { data, error } = await supabase.from('users').select('id').limit(1);
  if (error) { console.error('Could not check users table:', error.message); return; }
  if (data && data.length === 0) {
    const passwordHash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
    const { error: insertErr } = await supabase.from('users').insert([{
      id: 'admin-001',
      name: 'Admin',
      email: ADMIN_EMAIL,
      password_hash: passwordHash,
      role: 'admin',
      company_id: DEFAULT_COMPANY_ID,
      status: 'active',
      invite_token: null,
      invite_expires: null,
      created_at: new Date().toISOString()
    }]);
    if (insertErr) console.error('Failed to create admin user:', insertErr.message);
    else console.log('Admin user created:', ADMIN_EMAIL);
  }
}

ensureAdminExists();

function hashPassword(pw) { return bcrypt.hashSync(pw, 10); }

// Auto-migrates legacy SHA256 hashes to bcrypt on login
function verifyPassword(pw, stored) {
  if (!stored) return { valid: false, migrate: false };
  if (!stored.startsWith('$2') && stored.length === 64) {
    const legacy = crypto.createHash('sha256').update(pw + 'noderoute-salt').digest('hex');
    return { valid: legacy === stored, migrate: true };
  }
  return { valid: bcrypt.compareSync(pw, stored), migrate: false };
}

function signJWT(user) {
  return jwt.sign(
    { userId: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
}

async function authenticateToken(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  const token = auth.slice(7);
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
  const { data: user, error } = await supabase.from('users').select('*').eq('id', payload.userId).single();
  if (error || !user) return res.status(401).json({ error: 'User not found' });
  req.user = user;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    // superadmin passes all role checks
    if (req.user.role === 'superadmin') return next();
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

// Returns the company_id for the current request.
// Superadmins may pass ?company_id=<uuid> to operate on any company.
function getCompanyId(req) {
  if (req.user.role === 'superadmin' && req.query.company_id) return req.query.company_id;
  return req.user.company_id || DEFAULT_COMPANY_ID;
}

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const { data: users, error } = await supabase
    .from('users')
    .select('*')
    .ilike('email', email)
    .limit(1);
  if (error) return res.status(500).json({ error: error.message });
  const u = users && users[0];
  if (!u || u.status !== 'active') return res.status(401).json({ error: 'Invalid credentials' });
  const { valid, migrate } = verifyPassword(password, u.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
  if (migrate) {
    await supabase.from('users').update({ password_hash: bcrypt.hashSync(password, 10) }).eq('id', u.id);
  }
  const token = signJWT(u);
  res.json({ token, user: { id: u.id, name: u.name, email: u.email, role: u.role } });
});

app.post('/auth/setup-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Token and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const { data: users, error } = await supabase
    .from('users')
    .select('*')
    .eq('invite_token', token)
    .limit(1);
  if (error) return res.status(500).json({ error: error.message });
  const u = users && users[0];
  if (!u) return res.status(400).json({ error: 'Invalid invite token' });
  if (new Date() > new Date(u.invite_expires)) return res.status(400).json({ error: 'Invite link expired' });
  await supabase.from('users').update({
    password_hash: hashPassword(password),
    status: 'active',
    invite_token: null,
    invite_expires: null
  }).eq('id', u.id);
  const sessionToken = signJWT(u);
  res.json({ token: sessionToken, user: { id: u.id, name: u.name, email: u.email, role: u.role } });
});

app.get('/auth/me', authenticateToken, (req, res) => {
  res.json({ id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role });
});

app.post('/auth/logout', authenticateToken, (req, res) => {
  // JWTs are stateless; logout is handled client-side by discarding the token
  res.json({ message: 'Logged out' });
});

app.post('/auth/change-password', authenticateToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  const { data: user, error } = await supabase.from('users').select('*').eq('id', req.user.id).single();
  if (error || !user) return res.status(404).json({ error: 'User not found' });
  const { valid } = verifyPassword(currentPassword, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
  await supabase.from('users').update({ password_hash: bcrypt.hashSync(newPassword, 10) }).eq('id', req.user.id);
  res.json({ message: 'Password updated' });
});

app.get('/api/users', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('id, name, email, role, status, created_at, company_id')
    .eq('company_id', getCompanyId(req))
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data.map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role, status: u.status, createdAt: u.created_at })));
});

app.post('/api/users/invite', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { name, email, role = 'driver' } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'Name and email required' });
  if (!['admin', 'manager', 'driver'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (role === 'admin' && req.user.role !== 'admin') return res.status(403).json({ error: 'Only admins can invite admins' });

  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .ilike('email', email)
    .limit(1);
  if (existing && existing.length > 0) return res.status(409).json({ error: 'Email already exists' });

  const inviteToken = crypto.randomBytes(32).toString('hex');
  const newUser = {
    id: 'user-' + Date.now(),
    name,
    email,
    password_hash: null,
    role,
    company_id: getCompanyId(req),
    status: 'pending',
    invite_token: inviteToken,
    invite_expires: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    created_at: new Date().toISOString()
  };
  const { error: insertErr } = await supabase.from('users').insert([newUser]);
  if (insertErr) return res.status(500).json({ error: insertErr.message });

  const inviteUrl = `${BASE_URL}/setup-password.html?token=${inviteToken}`;
  console.log(`\nINVITE for ${name} (${email}) as ${role}:\n${inviteUrl}\n`);
  // Send real email if SMTP configured
  try {
    const mailer = createMailer();
    if (mailer) {
      await mailer.sendMail({
        from: process.env.EMAIL_FROM || `NodeRoute Systems <${process.env.SMTP_USER}>`,
        to: email,
        subject: `You've been invited to NodeRoute`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
            <div style="background:#050d2a;padding:24px;border-radius:12px 12px 0 0;text-align:center">
              <h1 style="color:#3dba7f;margin:0;font-size:24px">NodeRoute Systems</h1>
            </div>
            <div style="background:#f8faff;padding:32px;border-radius:0 0 12px 12px">
              <h2 style="color:#0d1b3e;margin-bottom:8px">Hi ${name},</h2>
              <p style="color:#334;font-size:15px;line-height:1.6">
                You've been invited to join <strong>NodeRoute Delivery Systems</strong> as a <strong>${role}</strong>.
              </p>
              <div style="text-align:center;margin:32px 0">
                <a href="${inviteUrl}" style="background:#3dba7f;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:16px;font-weight:600;display:inline-block">
                  Set Up Your Account
                </a>
              </div>
              <p style="color:#667;font-size:13px">This link expires in 48 hours.</p>
              <p style="color:#667;font-size:13px">Or copy this URL: ${inviteUrl}</p>
            </div>
          </div>
        `
      });
    }
  } catch(emailErr) {
    console.error('Failed to send invite email:', emailErr.message);
  }
  res.json({ message: `Invite sent to ${email}`, userId: newUser.id, inviteUrl });
});

// keep old route as alias
app.post('/api/drivers/invite', authenticateToken, requireRole('admin', 'manager'), (req, res, next) => {
  req.body.role = req.body.role || 'driver'; next();
}, (req, res) => res.redirect(307, '/api/users/invite'));

// Any user can update their own name; admins can update anyone
app.patch('/api/users/:id', authenticateToken, async (req, res) => {
  if (req.user.id !== req.params.id && req.user.role !== 'admin')
    return res.status(403).json({ error: 'Forbidden' });
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
  const { data, error } = await supabase.from('users').update({ name: name.trim() }).eq('id', req.params.id).select('id,name').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/api/users/:id', authenticateToken, requireRole('admin'), async (req, res) => {
  const { data: users, error } = await supabase.from('users').select('id, role').eq('id', req.params.id).limit(1);
  if (error) return res.status(500).json({ error: error.message });
  const u = users && users[0];
  if (!u) return res.status(404).json({ error: 'User not found' });
  if (u.role === 'admin') return res.status(403).json({ error: 'Cannot delete admin' });
  const { error: delErr } = await supabase.from('users').delete().eq('id', req.params.id);
  if (delErr) return res.status(500).json({ error: delErr.message });
  res.json({ message: 'User deleted' });
});

app.patch('/api/users/:id/role', authenticateToken, requireRole('admin'), async (req, res) => {
  const { role } = req.body;
  if (!['admin', 'manager', 'driver'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const { data, error } = await supabase.from('users').update({ role }).eq('id', req.params.id).select('id').single();
  if (error || !data) return res.status(404).json({ error: 'User not found' });
  res.json({ message: 'Role updated' });
});

// ── COMPANY MANAGEMENT ────────────────────────────────────────────────────────

// GET /api/company — current user's company info
app.get('/api/company', authenticateToken, async (req, res) => {
  const cid = getCompanyId(req);
  const { data, error } = await supabase.from('companies').select('*').eq('id', cid).single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// PATCH /api/company — update company name/settings (admin only)
app.patch('/api/company', authenticateToken, requireRole('admin'), async (req, res) => {
  const cid = getCompanyId(req);
  const allowed = ['name', 'settings'];
  const updates = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' });
  const { data, error } = await supabase.from('companies').update(updates).eq('id', cid).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/companies — list all companies (superadmin only)
app.get('/api/companies', authenticateToken, requireRole('superadmin'), async (req, res) => {
  const { data: companies, error } = await supabase.from('companies').select('*').order('created_at');
  if (error) return res.status(500).json({ error: error.message });
  // Attach user count per company
  const { data: counts } = await supabase.from('users').select('company_id');
  const countMap = {};
  (counts || []).forEach(u => { countMap[u.company_id] = (countMap[u.company_id] || 0) + 1; });
  res.json(companies.map(c => ({ ...c, user_count: countMap[c.id] || 0 })));
});

// POST /api/companies — create a new company + invite its first admin (superadmin only)
app.post('/api/companies', authenticateToken, requireRole('superadmin'), async (req, res) => {
  const { name, slug, plan, admin_email, admin_name } = req.body;
  if (!name || !admin_email || !admin_name)
    return res.status(400).json({ error: 'name, admin_email, and admin_name are required' });

  const { data: company, error: cErr } = await supabase
    .from('companies')
    .insert([{ name, slug: slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), plan: plan || 'starter' }])
    .select().single();
  if (cErr) return res.status(500).json({ error: cErr.message });

  const inviteToken = crypto.randomBytes(32).toString('hex');
  const { error: uErr } = await supabase.from('users').insert([{
    id: 'user-' + Date.now(),
    name: admin_name,
    email: admin_email,
    password_hash: null,
    role: 'admin',
    company_id: company.id,
    status: 'pending',
    invite_token: inviteToken,
    invite_expires: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    created_at: new Date().toISOString(),
  }]);
  if (uErr) return res.status(500).json({ error: uErr.message });

  const inviteUrl = `${BASE_URL}/setup-password.html?token=${inviteToken}`;
  console.log(`\nNew company "${name}" — admin invite for ${admin_email}:\n${inviteUrl}\n`);

  // Send invite email if SMTP configured
  try {
    const mailer = createMailer();
    if (mailer) {
      await mailer.sendMail({
        from: process.env.EMAIL_FROM || process.env.SMTP_USER,
        to: admin_email,
        subject: `You've been set up as admin for ${name} on NodeRoute`,
        html: `<div style="font-family:Arial,sans-serif;max-width:600px">
          <h2 style="color:#3dba7f">NodeRoute Systems</h2>
          <p>Hi ${admin_name},</p>
          <p>A NodeRoute account has been created for <strong>${name}</strong>. You're the company admin.</p>
          <p><a href="${inviteUrl}" style="background:#3dba7f;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600">Set Up Your Account</a></p>
          <p style="color:#999;font-size:12px">Link expires in 48 hours. Reply to this email if you need help.</p>
        </div>`,
      });
    }
  } catch(e) { console.error('Invite email error:', e.message); }

  res.json({ company, inviteUrl });
});

// DELETE /api/companies/:id — remove a company (superadmin only, non-default)
app.delete('/api/companies/:id', authenticateToken, requireRole('superadmin'), async (req, res) => {
  if (req.params.id === DEFAULT_COMPANY_ID) return res.status(400).json({ error: 'Cannot delete the default company' });
  const { error } = await supabase.from('companies').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Company deleted' });
});

const deliveries = [
  { id: 1, restaurant: "Husk Restaurant", address: "76 Queen St, Charleston, SC 29401", driver: "Marcus Johnson", status: "delivered", time: "09:15", stopDuration: 12, distance: 2.3, onTime: true, lat: 32.7751, lng: -79.9352 },
  { id: 2, restaurant: "FIG Restaurant", address: "232 Meeting St, Charleston, SC 29401", driver: "Sarah Chen", status: "in-transit", time: "10:30", stopDuration: 8, distance: 1.8, onTime: true, lat: 32.7784, lng: -79.9378 },
  { id: 3, restaurant: "The Ordinary", address: "544 King St, Charleston, SC 29403", driver: "Marcus Johnson", status: "pending", time: "11:45", stopDuration: 15, distance: 3.1, onTime: false, lat: 32.7833, lng: -79.9441 },
  { id: 4, restaurant: "Hall's Chophouse", address: "434 King St, Charleston, SC 29403", driver: "Devon Williams", status: "delivered", time: "08:45", stopDuration: 10, distance: 2.7, onTime: true, lat: 32.7821, lng: -79.9432 },
  { id: 5, restaurant: "167 Raw", address: "289 E Bay St, Charleston, SC 29401", driver: "Sarah Chen", status: "delivered", time: "09:30", stopDuration: 7, distance: 1.5, onTime: true, lat: 32.7762, lng: -79.9319 },
  { id: 6, restaurant: "Circa 1886", address: "149 Wentworth St, Charleston, SC 29401", driver: "Jordan Martinez", status: "in-transit", time: "10:00", stopDuration: 11, distance: 2.0, onTime: true, lat: 32.7741, lng: -79.9398 },
  { id: 7, restaurant: "Chez Nous", address: "6 Payne Ct, Charleston, SC 29403", driver: "Devon Williams", status: "delivered", time: "08:00", stopDuration: 9, distance: 3.4, onTime: true, lat: 32.7798, lng: -79.9467 },
  { id: 8, restaurant: "Leon's Oyster Shop", address: "698 King St, Charleston, SC 29403", driver: "Marcus Johnson", status: "pending", time: "12:15", stopDuration: 14, distance: 3.8, onTime: false, lat: 32.7856, lng: -79.9468 },
  { id: 9, restaurant: "The Macintosh", address: "479 King St, Charleston, SC 29403", driver: "Jordan Martinez", status: "delivered", time: "09:45", stopDuration: 8, distance: 2.9, onTime: true, lat: 32.7825, lng: -79.9445 },
  { id: 10, restaurant: "Slightly North of Broad", address: "192 E Bay St, Charleston, SC 29401", driver: "Sarah Chen", status: "delivered", time: "10:15", stopDuration: 6, distance: 1.2, onTime: true, lat: 32.7748, lng: -79.9324 },
  { id: 11, restaurant: "Edmunds Oast", address: "1081 Morrison Dr, Charleston, SC 29403", driver: "Jordan Martinez", status: "pending", time: "13:00", stopDuration: 16, distance: 4.2, onTime: false, lat: 32.7912, lng: -79.9578 },
  { id: 12, restaurant: "The Darling Oyster Bar", address: "513 King St, Charleston, SC 29403", driver: "Devon Williams", status: "in-transit", time: "11:00", stopDuration: 10, distance: 3.3, onTime: true, lat: 32.7829, lng: -79.9447 }
];

const drivers = [
  { id: 1, name: "Marcus Johnson", vehicle: "Ford Transit", status: "active", phone: "(843) 555-0101", deliveries: 47, rating: 4.8 },
  { id: 2, name: "Sarah Chen", vehicle: "Sprinter Van", status: "active", phone: "(843) 555-0102", deliveries: 52, rating: 4.9 },
  { id: 3, name: "Devon Williams", vehicle: "Chevy Express", status: "active", phone: "(843) 555-0103", deliveries: 38, rating: 4.7 },
  { id: 4, name: "Jordan Martinez", vehicle: "Ford Transit", status: "active", phone: "(843) 555-0104", deliveries: 41, rating: 4.6 }
];

app.get('/api/stats', authenticateToken, (req, res) => {
  const completed = deliveries.filter(d => d.status === 'delivered');
  const onTimeRate = completed.length ? Math.round((completed.filter(d => d.onTime).length / completed.length) * 100) : 0;
  const activeDrivers = [...new Set(deliveries.filter(d => d.status === 'in-transit' || d.status === 'pending').map(d => d.driver))].length;
  res.json({
    totalDeliveries: deliveries.length,
    completedToday: completed.length,
    onTimeRate,
    activeDrivers,
    totalDrivers: drivers.length,
    failed: deliveries.filter(d => d.status === 'failed').length,
    pendingCount: deliveries.filter(d => d.status === 'pending').length,
    inTransitCount: deliveries.filter(d => d.status === 'in-transit').length,
    yesterday: { totalDeliveries: 10, completedToday: 8, onTimeRate: 82, activeDrivers: 3, totalDrivers: 4, failed: 1, pendingCount: 2 }
  });
});

app.get('/api/deliveries', authenticateToken, (req, res) => {
  if (req.user.role === 'driver') return res.json(deliveries.filter(d => d.driver === req.user.name));
  res.json(deliveries);
});

app.get('/api/drivers', authenticateToken, (req, res) => {
  const result = drivers.map(d => {
    const dd = deliveries.filter(del => del.driver === d.name);
    const completed = dd.filter(del => del.status === 'delivered');
    const onTimeRate = completed.length ? Math.round(completed.filter(del => del.onTime).length / completed.length * 100) : 100;
    const milesToday = parseFloat(dd.reduce((s, del) => s + del.distance, 0).toFixed(1));
    const avgStopMinutes = completed.length ? Math.round(completed.reduce((s, del) => s + del.stopDuration, 0) / completed.length) : 0;
    const avgSpeedMph = parseFloat((22 + (d.rating - 4.5) * 20).toFixed(1));
    const active = dd.find(del => del.status === 'in-transit') || dd[dd.length - 1];
    const isOnDuty = dd.some(del => del.status === 'in-transit' || del.status === 'pending');
    return {
      id: d.id, name: d.name, vehicleId: d.vehicle, phone: d.phone,
      status: isOnDuty ? 'on-duty' : 'off-duty',
      onTimeRate, totalStopsToday: completed.length, milesToday, avgStopMinutes, avgSpeedMph,
      lat: active ? active.lat : 32.7765, lng: active ? active.lng : -79.9311
    };
  });
  res.json(result);
});

app.get('/api/analytics', authenticateToken, requireRole('admin', 'manager'), (req, res) => {
  const completed = deliveries.filter(d => d.status === 'delivered');
  const avgStopTime = completed.reduce((s, d) => s + d.stopDuration, 0) / (completed.length || 1);
  const onTimeRate = (completed.filter(d => d.onTime).length / (completed.length || 1)) * 100;
  const peakHours = [
    { hour: '8am', count: 3 }, { hour: '9am', count: 4 }, { hour: '10am', count: 3 },
    { hour: '11am', count: 2 }, { hour: '12pm', count: 1 }, { hour: '1pm', count: 1 }
  ];
  const driverRankings = drivers.map(d => {
    const dd = deliveries.filter(del => del.driver === d.name);
    const comp = dd.filter(del => del.status === 'delivered');
    const onTime = comp.length ? parseFloat((comp.filter(del => del.onTime).length / comp.length * 100).toFixed(1)) : 100;
    const avgStop = comp.length ? parseFloat((comp.reduce((s, del) => s + del.stopDuration, 0) / comp.length).toFixed(1)) : 0;
    const miles = parseFloat(dd.reduce((s, del) => s + del.distance, 0).toFixed(1));
    return { name: d.name, stopsPerHour: parseFloat((comp.length / 8).toFixed(1)), avgStopMinutes: avgStop, avgSpeedMph: parseFloat((22 + (d.rating - 4.5) * 20).toFixed(1)), onTimeRate: onTime, milesToday: miles };
  }).sort((a, b) => b.onTimeRate - a.onTimeRate);
  res.json({ avgStopTime: avgStopTime.toFixed(1), onTimeRate: onTimeRate.toFixed(1), avgSpeed: 28.4, peakHours, driverRankings, totalDeliveries: deliveries.length, completedToday: completed.length });
});

app.patch('/api/deliveries/:id/status', authenticateToken, (req, res) => {
  const delivery = deliveries.find(d => d.id === parseInt(req.params.id));
  if (!delivery) return res.status(404).json({ error: 'Not found' });
  if (req.user.role === 'driver' && delivery.driver !== req.user.name) return res.status(403).json({ error: 'Forbidden' });
  delivery.status = req.body.status;
  res.json(delivery);
});

// ── STOPS (Supabase) ────────────────────────────────────
app.get('/api/stops', authenticateToken, async (req, res) => {
  const { data, error } = await supabase.from('stops').select('*')
    .eq('company_id', getCompanyId(req)).order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post('/api/stops', authenticateToken, async (req, res) => {
  const { name, address, lat, lng, notes } = req.body;
  if (!name || !address) return res.status(400).json({ error: 'Name and address required' });
  const { data, error } = await supabase
    .from('stops')
    .insert([{ name, address, lat: parseFloat(lat)||0, lng: parseFloat(lng)||0, notes: notes||'', company_id: getCompanyId(req) }])
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.patch('/api/stops/:id', authenticateToken, async (req, res) => {
  const { data, error } = await supabase.from('stops').update(req.body)
    .eq('id', req.params.id).eq('company_id', getCompanyId(req)).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.delete('/api/stops/:id', authenticateToken, async (req, res) => {
  const { error } = await supabase.from('stops').delete()
    .eq('id', req.params.id).eq('company_id', getCompanyId(req));
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Deleted' });
});

// ── ROUTES (Supabase) ───────────────────────────────────
app.get('/api/routes', authenticateToken, async (req, res) => {
  const { data, error } = await supabase.from('routes').select('*')
    .eq('company_id', getCompanyId(req)).order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post('/api/routes', authenticateToken, async (req, res) => {
  const { name, stopIds, driver, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Route name required' });
  const { data, error } = await supabase
    .from('routes')
    .insert([{ name, stop_ids: stopIds||[], driver: driver||'', notes: notes||'', company_id: getCompanyId(req) }])
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.patch('/api/routes/:id', authenticateToken, async (req, res) => {
  const payload = { ...req.body };
  if (payload.stopIds !== undefined) { payload.stop_ids = payload.stopIds; delete payload.stopIds; }
  const { data, error } = await supabase.from('routes').update(payload)
    .eq('id', req.params.id).eq('company_id', getCompanyId(req)).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.delete('/api/routes/:id', authenticateToken, async (req, res) => {
  const { error } = await supabase.from('routes').delete()
    .eq('id', req.params.id).eq('company_id', getCompanyId(req));
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Deleted' });
});

// ── CUSTOMERS (Supabase: "250 restaurants") ─────────────
app.get('/api/customers', authenticateToken, async (req, res) => {
  const { data, error } = await supabase
    .from('250 restaurants')
    .select('*')
    .eq('company_id', getCompanyId(req))
    .order('Rank', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post('/api/customers', authenticateToken, async (req, res) => {
  const { Restaurant, Address, Phone, Area, Cuisine, Rank } = req.body;
  if (!Restaurant) return res.status(400).json({ error: 'Restaurant name required' });
  const { data, error } = await supabase
    .from('250 restaurants')
    .insert([{ Restaurant, Address: Address||'', Phone: Phone||'', Area: Area||'', Cuisine: Cuisine||'', Rank: Rank||null, company_id: getCompanyId(req) }])
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.patch('/api/customers/:rank', authenticateToken, async (req, res) => {
  const { data, error } = await supabase
    .from('250 restaurants')
    .update(req.body)
    .eq('Rank', req.params.rank)
    .eq('company_id', getCompanyId(req))
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.delete('/api/customers/:rank', authenticateToken, async (req, res) => {
  const { error } = await supabase
    .from('250 restaurants')
    .delete()
    .eq('Rank', req.params.rank)
    .eq('company_id', getCompanyId(req));
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Deleted' });
});

// ── DWELL TIME (geofence check-in/out) ──────────────────
const dwellRecords = []; // { id, stopId, routeId, driverId, arrivedAt, departedAt, dwellMs }
app.post('/api/stops/:id/arrive', authenticateToken, (req, res) => {
  const { routeId } = req.body;
  const existing = dwellRecords.find(d => d.stopId === req.params.id && d.routeId === routeId && !d.departedAt);
  if (existing) return res.json(existing);
  const record = { id: 'dwell-' + Date.now(), stopId: req.params.id, routeId: routeId||'', driverId: req.user.id, arrivedAt: new Date().toISOString(), departedAt: null, dwellMs: null };
  dwellRecords.push(record);
  res.json(record);
});
app.post('/api/stops/:id/depart', authenticateToken, (req, res) => {
  const { routeId } = req.body;
  const record = dwellRecords.find(d => d.stopId === req.params.id && d.routeId === routeId && !d.departedAt);
  if (!record) return res.status(404).json({ error: 'No active arrival found' });
  record.departedAt = new Date().toISOString();
  record.dwellMs = new Date(record.departedAt) - new Date(record.arrivedAt);
  res.json(record);
});
app.get('/api/dwell', authenticateToken, (req, res) => res.json(dwellRecords));

app.get('/api/config/maps-key', authenticateToken, (req, res) => {
  res.json({ key: process.env.GOOGLE_MAPS_KEY || '' });
});

// ── SEAFOOD INVENTORY (Supabase table: seafood_inventory) ────────────────────
// Required Supabase table columns:
//   id uuid PK, name text NOT NULL, category text, sku text,
//   unit text, price_per_unit numeric, stock_qty numeric,
//   low_stock_threshold numeric DEFAULT 10, description text,
//   created_at timestamptz DEFAULT now()

app.get('/api/inventory', authenticateToken, async (req, res) => {
  const { data, error } = await supabase
    .from('seafood_inventory')
    .select('*')
    .eq('company_id', getCompanyId(req))
    .order('category', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/inventory', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { name, category, sku, unit, price_per_unit, stock_qty, low_stock_threshold, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Product name required' });
  const { data, error } = await supabase
    .from('seafood_inventory')
    .insert([{
      name,
      category: category || 'Other',
      sku: sku || '',
      unit: unit || 'lb',
      price_per_unit: parseFloat(price_per_unit) || 0,
      stock_qty: parseFloat(stock_qty) || 0,
      low_stock_threshold: parseFloat(low_stock_threshold) || 10,
      description: description || '',
      company_id: getCompanyId(req),
    }])
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.patch('/api/inventory/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const allowed = ['name','category','sku','unit','price_per_unit','stock_qty','low_stock_threshold','description'];
  const fields = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) fields[k] = req.body[k]; });
  const { data, error } = await supabase
    .from('seafood_inventory')
    .update(fields)
    .eq('id', req.params.id)
    .eq('company_id', getCompanyId(req))
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/api/inventory/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { error } = await supabase.from('seafood_inventory').delete()
    .eq('id', req.params.id).eq('company_id', getCompanyId(req));
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Deleted' });
});

// ── INVENTORY ANALYTICS & PREDICTIONS ────────────────────────────────────────
// Must be registered BEFORE /:id routes to avoid route shadowing.

// GET /api/inventory/analytics
// Returns per-product usage rate (last 30 days) and predicted restock date.
app.get('/api/inventory/analytics', authenticateToken, async (req, res) => {
  const WINDOW_DAYS = 30;
  const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString();
  const cid = getCompanyId(req);

  const { data: products, error: pErr } = await supabase
    .from('seafood_inventory')
    .select('id,name,category,unit,stock_qty,low_stock_threshold,avg_yield,yield_count')
    .eq('company_id', cid)
    .order('category');
  if (pErr) return res.status(500).json({ error: pErr.message });

  const { data: history, error: hErr } = await supabase
    .from('inventory_stock_history')
    .select('product_id,change_qty,created_at')
    .eq('company_id', cid)
    .lt('change_qty', 0)
    .gte('created_at', since);
  if (hErr) return res.status(500).json({ error: hErr.message });

  // Build usage map: productId → total units consumed in window
  const usageMap = {};
  (history || []).forEach(h => {
    usageMap[h.product_id] = (usageMap[h.product_id] || 0) + Math.abs(h.change_qty);
  });

  const today = new Date();
  const analytics = products.map(p => {
    const totalUsed    = usageMap[p.id] || 0;
    const dailyUsage   = parseFloat((totalUsed / WINDOW_DAYS).toFixed(4));
    const currentStock = parseFloat(p.stock_qty) || 0;
    let daysRemaining  = null;
    let predictedDate  = null;
    if (dailyUsage > 0 && currentStock > 0) {
      daysRemaining = parseFloat((currentStock / dailyUsage).toFixed(1));
      const d = new Date(today);
      d.setDate(d.getDate() + Math.round(daysRemaining));
      predictedDate = d.toISOString().split('T')[0];
    }
    return {
      ...p,
      daily_usage:    dailyUsage,
      total_used_30d: parseFloat(totalUsed.toFixed(2)),
      days_remaining: daysRemaining,
      predicted_restock_date: predictedDate,
      has_history: totalUsed > 0,
    };
  });

  res.json(analytics);
});

// POST /api/inventory/alerts/send
// Sends a low-stock / out-of-stock summary email to the configured SMTP address.
function buildInventoryAlertEmail(outOfStock, lowStock, analytics) {
  const rows = (items, label, color) =>
    items.map(i => {
      const pred = analytics.find(a => a.id === i.id);
      const daysInfo = pred?.days_remaining != null
        ? `<span style="color:#888;font-size:11px"> · Est. ${pred.days_remaining}d remaining</span>` : '';
      return `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #2a2a2a">${i.name}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #2a2a2a;color:#888">${i.category||'Other'}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #2a2a2a;color:${color};font-weight:600">${label}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #2a2a2a">${i.stock_qty != null ? i.stock_qty + ' ' + (i.unit||'') : '—'}${daysInfo}</td>
      </tr>`;
    }).join('');

  const allRows = rows(outOfStock, 'OUT OF STOCK', '#ef4444') + rows(lowStock, 'LOW STOCK', '#f59e0b');
  return `
<div style="font-family:sans-serif;background:#111;color:#e5e7eb;padding:24px;border-radius:8px;max-width:640px">
  <h2 style="color:#3dba7f;margin:0 0 4px">🐟 Inventory Alert</h2>
  <p style="color:#888;margin:0 0 20px;font-size:13px">Automated low-stock report — ${new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</p>
  <table style="width:100%;border-collapse:collapse;font-size:13px">
    <thead><tr style="background:#1a1a1a">
      <th style="padding:8px 10px;text-align:left;color:#aaa">Product</th>
      <th style="padding:8px 10px;text-align:left;color:#aaa">Category</th>
      <th style="padding:8px 10px;text-align:left;color:#aaa">Status</th>
      <th style="padding:8px 10px;text-align:left;color:#aaa">On Hand</th>
    </tr></thead>
    <tbody>${allRows}</tbody>
  </table>
  <p style="color:#555;font-size:11px;margin-top:16px">Sent by DeliveryApp Inventory Management</p>
</div>`;
}

app.post('/api/inventory/alerts/send', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const mailer = createMailer();
  if (!mailer) return res.status(503).json({ error: 'Email not configured (SMTP_HOST missing)' });
  const cid = getCompanyId(req);

  const { data: products, error } = await supabase.from('seafood_inventory').select('*').eq('company_id', cid);
  if (error) return res.status(500).json({ error: error.message });

  const outOfStock = products.filter(i => (i.stock_qty || 0) <= 0);
  const lowStock   = products.filter(i => (i.stock_qty || 0) > 0 && (i.stock_qty || 0) <= (i.low_stock_threshold || 10));

  if (!outOfStock.length && !lowStock.length)
    return res.json({ sent: false, message: 'All stock levels are healthy — no alert needed.' });

  // Fetch analytics for day estimates
  const WINDOW = 30;
  const since  = new Date(Date.now() - WINDOW * 86400000).toISOString();
  const { data: history } = await supabase
    .from('inventory_stock_history')
    .select('product_id,change_qty')
    .eq('company_id', cid)
    .lt('change_qty', 0)
    .gte('created_at', since);
  const usageMap = {};
  (history || []).forEach(h => { usageMap[h.product_id] = (usageMap[h.product_id] || 0) + Math.abs(h.change_qty); });
  const analytics = products.map(p => {
    const used = usageMap[p.id] || 0;
    const daily = used / WINDOW;
    const stock = parseFloat(p.stock_qty) || 0;
    return { id: p.id, days_remaining: daily > 0 && stock > 0 ? parseFloat((stock / daily).toFixed(1)) : null };
  });

  const html = buildInventoryAlertEmail(outOfStock, lowStock, analytics);
  const to   = req.body.email || process.env.SMTP_USER || process.env.EMAIL_FROM;
  try {
    await mailer.sendMail({
      from: process.env.EMAIL_FROM || process.env.SMTP_USER,
      to,
      subject: `⚠ Inventory Alert — ${outOfStock.length} out of stock, ${lowStock.length} low`,
      html,
    });
    // Stamp alert_sent_at on all affected products
    const affectedIds = [...outOfStock, ...lowStock].map(i => i.id);
    await supabase.from('seafood_inventory')
      .update({ alert_sent_at: new Date().toISOString() })
      .in('id', affectedIds)
      .eq('company_id', cid);
    res.json({ sent: true, to, out_of_stock: outOfStock.length, low_stock: lowStock.length });
  } catch (e) {
    res.status(500).json({ error: 'Email send failed: ' + e.message });
  }
});

// POST /api/inventory/:id/restock — add stock and log history
app.post('/api/inventory/:id/restock', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { qty, notes } = req.body;
  const addQty = parseFloat(qty);
  if (!addQty || addQty <= 0) return res.status(400).json({ error: 'qty must be > 0' });
  const cid = getCompanyId(req);

  const { data: item, error: fetchErr } = await supabase
    .from('seafood_inventory').select('stock_qty,name').eq('id', req.params.id).eq('company_id', cid).single();
  if (fetchErr) return res.status(404).json({ error: 'Product not found' });

  const newQty = (parseFloat(item.stock_qty) || 0) + addQty;
  const { data, error } = await supabase
    .from('seafood_inventory')
    .update({ stock_qty: newQty, updated_at: new Date().toISOString() })
    .eq('id', req.params.id).eq('company_id', cid).select().single();
  if (error) return res.status(500).json({ error: error.message });

  await supabase.from('inventory_stock_history').insert([{
    product_id: req.params.id, company_id: cid,
    change_qty: addQty, new_qty: newQty, change_type: 'restock',
    notes: notes || null, created_by: req.user.name || req.user.email,
  }]);

  res.json(data);
});

// POST /api/inventory/:id/adjust — manual depletion, waste, or correction
app.post('/api/inventory/:id/adjust', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { delta, change_type, notes } = req.body;
  const d = parseFloat(delta);
  if (d == null || isNaN(d)) return res.status(400).json({ error: 'delta (number) required' });
  const type = change_type || (d < 0 ? 'depletion' : 'adjustment');
  const cid = getCompanyId(req);

  const { data: item, error: fetchErr } = await supabase
    .from('seafood_inventory').select('stock_qty').eq('id', req.params.id).eq('company_id', cid).single();
  if (fetchErr) return res.status(404).json({ error: 'Product not found' });

  const newQty = parseFloat(((parseFloat(item.stock_qty) || 0) + d).toFixed(4));
  const { data, error } = await supabase
    .from('seafood_inventory')
    .update({ stock_qty: newQty, updated_at: new Date().toISOString() })
    .eq('id', req.params.id).eq('company_id', cid).select().single();
  if (error) return res.status(500).json({ error: error.message });

  await supabase.from('inventory_stock_history').insert([{
    product_id: req.params.id, company_id: cid,
    change_qty: d, new_qty: newQty, change_type: type,
    notes: notes || null, created_by: req.user.name || req.user.email,
  }]);

  res.json(data);
});

// GET /api/inventory/:id/history — stock movement log
app.get('/api/inventory/:id/history', authenticateToken, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const { data, error } = await supabase
    .from('inventory_stock_history')
    .select('*')
    .eq('product_id', req.params.id)
    .eq('company_id', getCompanyId(req))
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/inventory/:id/yield — log a cutting session, update running average
app.post('/api/inventory/:id/yield', authenticateToken, async (req, res) => {
  const { raw_weight, yield_weight, notes } = req.body;
  const raw     = parseFloat(raw_weight);
  const yielded = parseFloat(yield_weight);
  if (!raw || raw <= 0)         return res.status(400).json({ error: 'raw_weight must be > 0' });
  if (!yielded || yielded <= 0) return res.status(400).json({ error: 'yield_weight must be > 0' });
  if (yielded > raw)            return res.status(400).json({ error: 'yield_weight cannot exceed raw_weight' });
  const cid = getCompanyId(req);

  const yield_pct = parseFloat(((yielded / raw) * 100).toFixed(2));

  await supabase.from('inventory_yield_log').insert([{
    product_id: req.params.id, company_id: cid,
    raw_weight: raw, yield_weight: yielded, yield_pct,
    notes: notes || null, logged_by: req.user.name || req.user.email,
  }]);

  const { data: item, error: fetchErr } = await supabase
    .from('seafood_inventory')
    .select('avg_yield,yield_count')
    .eq('id', req.params.id).eq('company_id', cid).single();
  if (fetchErr) return res.status(404).json({ error: 'Product not found' });

  const n      = (item?.yield_count || 0) + 1;
  const newAvg = parseFloat((((item?.avg_yield || 0) * (n - 1) + yield_pct) / n).toFixed(2));

  const { data, error } = await supabase
    .from('seafood_inventory')
    .update({ avg_yield: newAvg, yield_count: n, updated_at: new Date().toISOString() })
    .eq('id', req.params.id).eq('company_id', cid).select().single();
  if (error) return res.status(500).json({ error: error.message });

  res.json({ ...data, yield_pct, sample_count: n });
});

// GET /api/inventory/:id/yield — yield history for a product
app.get('/api/inventory/:id/yield', authenticateToken, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const { data, error } = await supabase
    .from('inventory_yield_log')
    .select('*')
    .eq('product_id', req.params.id)
    .eq('company_id', getCompanyId(req))
    .order('logged_at', { ascending: false })
    .limit(limit);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── FORECAST ──────────────────────────────────────────────────────────────────
// GET /api/forecast/orders
// Returns per-customer order cadence and monthly volume data for the frontend
// forecasting dashboard.  All heavy computation is done client-side using the
// existing /api/orders and /api/customers responses; this endpoint provides a
// pre-aggregated view optimised for larger datasets.

app.get('/api/forecast/orders', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const MONTHS = 12;
  const since  = new Date(Date.now() - MONTHS * 31 * 86400000).toISOString();

  const { data: orders, error } = await supabase
    .from('orders')
    .select('id,customer,customer_name,description,item_name,date,created_at')
    .eq('company_id', getCompanyId(req))
    .gte('created_at', since)
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });

  // Monthly buckets
  const now = new Date();
  const monthly = [];
  for (let i = MONTHS - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    const count = (orders || []).filter(o => {
      const od = new Date(o.date || o.created_at);
      return od.getMonth() === d.getMonth() && od.getFullYear() === d.getFullYear();
    }).length;
    monthly.push({ label, count, year: d.getFullYear(), month: d.getMonth() + 1 });
  }

  // Customer cadence
  const byCustomer = {};
  (orders || []).forEach(o => {
    const name = o.customer || o.customer_name || 'Unknown';
    if (!byCustomer[name]) byCustomer[name] = [];
    byCustomer[name].push(new Date(o.date || o.created_at).toISOString());
  });
  const cadence = Object.entries(byCustomer).map(([customer, dates]) => {
    const sorted = dates.sort();
    const last   = sorted[sorted.length - 1];
    const daysSince = Math.round((Date.now() - new Date(last)) / 86400000);
    let avgCadence = null;
    if (sorted.length > 1) {
      const gaps = [];
      for (let i = 1; i < sorted.length; i++)
        gaps.push((new Date(sorted[i]) - new Date(sorted[i-1])) / 86400000);
      avgCadence = Math.round(gaps.reduce((s,g) => s+g, 0) / gaps.length);
    }
    return { customer, order_count: sorted.length, last_order: last, days_since: daysSince, avg_cadence_days: avgCadence,
      next_order_in_days: avgCadence ? Math.max(0, avgCadence - daysSince) : null };
  }).sort((a,b) => b.order_count - a.order_count);

  res.json({ monthly, cadence });
});

// ── INVOICES ──────────────────────────────────────────────────────────────────

app.get('/api/invoices', authenticateToken, async (req, res) => {
  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('company_id', getCompanyId(req))
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/invoices', authenticateToken, async (req, res) => {
  const { invoice_number, customer_name, customer_email, customer_address, items, subtotal, tax, total, driver_name, notes, entree_invoice_id } = req.body;
  if (!customer_name) return res.status(400).json({ error: 'Customer name required' });
  const { data, error } = await supabase
    .from('invoices')
    .insert([{ invoice_number, customer_name, customer_email, customer_address, items: items||[], subtotal: subtotal||0, tax: tax||0, total: total||0, status: 'pending', driver_name, notes, entree_invoice_id, company_id: getCompanyId(req) }])
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Entree import — accepts one or many invoices in Entree's export format
app.post('/api/invoices/import', authenticateToken, async (req, res) => {
  const cid = getCompanyId(req);
  const raw = Array.isArray(req.body) ? req.body : [req.body];
  const mapped = raw.map(e => ({
    invoice_number:   e.InvoiceNumber || e.invoice_number || null,
    customer_name:    e.CustomerName  || e.customer_name  || e.BillTo || '',
    customer_email:   e.Email         || e.customer_email || '',
    customer_address: e.Address       || e.customer_address || '',
    items: (e.Items || e.LineItems || e.items || []).map(i => ({
      description: i.Description || i.description || i.Item || '',
      quantity:    i.Quantity    || i.quantity    || 1,
      unit_price:  i.UnitPrice   || i.unit_price  || i.Price || 0,
      total:       i.Total       || i.total       || (i.Quantity * i.UnitPrice) || 0,
    })),
    subtotal:          e.Subtotal  || e.subtotal  || 0,
    tax:               e.Tax       || e.tax       || 0,
    total:             e.Total     || e.total     || e.InvoiceTotal || 0,
    driver_name:       e.Driver    || e.driver    || '',
    notes:             e.Notes     || e.notes     || '',
    entree_invoice_id: e.InvoiceNumber || e.InvoiceID || null,
    status: 'pending',
    company_id: cid,
  }));
  const { data, error } = await supabase.from('invoices').insert(mapped).select();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ imported: data.length, invoices: data });
});

// Save signature → generate PDF → email customer
app.post('/api/invoices/:id/sign', authenticateToken, async (req, res) => {
  const { signature_data } = req.body; // base64 PNG from canvas
  if (!signature_data) return res.status(400).json({ error: 'Signature data required' });

  const cid = getCompanyId(req);
  const { data: inv, error: fetchErr } = await supabase
    .from('invoices').select('*').eq('id', req.params.id).eq('company_id', cid).single();
  if (fetchErr || !inv) return res.status(404).json({ error: 'Invoice not found' });

  // Update invoice as signed
  const { data: updated, error: updateErr } = await supabase
    .from('invoices')
    .update({ signature_data, status: 'signed', signed_at: new Date().toISOString() })
    .eq('id', req.params.id).eq('company_id', cid).select().single();
  if (updateErr) return res.status(500).json({ error: updateErr.message });

  // Generate PDF
  const pdfBuffer = await buildInvoicePDF({ ...updated });

  // Send email if customer has one
  let emailSent = false;
  if (inv.customer_email) {
    try {
      const mailer = createMailer();
      if (mailer) {
        await mailer.sendMail({
          from: process.env.EMAIL_FROM || `NodeRoute Systems <${process.env.SMTP_USER}>`,
          to: inv.customer_email,
          subject: `Your Invoice ${inv.invoice_number || inv.id.slice(0,8).toUpperCase()} from NodeRoute`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px">
              <h2 style="color:#ff6b35">NodeRoute Systems</h2>
              <p>Hi ${inv.customer_name},</p>
              <p>Thank you for your order. Please find your signed invoice attached.</p>
              <table style="width:100%;border-collapse:collapse;margin:16px 0">
                <tr style="background:#f5f5f5"><th style="padding:8px;text-align:left">Item</th><th style="padding:8px;text-align:right">Qty</th><th style="padding:8px;text-align:right">Price</th><th style="padding:8px;text-align:right">Total</th></tr>
                ${(inv.items||[]).map(i=>`<tr><td style="padding:8px;border-bottom:1px solid #eee">${i.description}</td><td style="padding:8px;text-align:right;border-bottom:1px solid #eee">${i.quantity}</td><td style="padding:8px;text-align:right;border-bottom:1px solid #eee">$${parseFloat(i.unit_price).toFixed(2)}</td><td style="padding:8px;text-align:right;border-bottom:1px solid #eee">$${parseFloat(i.total).toFixed(2)}</td></tr>`).join('')}
              </table>
              <p style="text-align:right"><strong>Total: $${parseFloat(inv.total).toFixed(2)}</strong></p>
              <p style="color:#888;font-size:12px">Signed on ${new Date().toLocaleString()}</p>
            </div>`,
          attachments: [{ filename: `invoice-${inv.invoice_number || inv.id.slice(0,8)}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }],
        });
        emailSent = true;
        await supabase.from('invoices').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', req.params.id).eq('company_id', cid);
      }
    } catch (e) {
      console.error('Email error:', e.message);
    }
  }

  res.json({ ...updated, status: emailSent ? 'sent' : 'signed', emailSent });
});

// Resend email for an already-signed invoice
app.post('/api/invoices/:id/resend', authenticateToken, async (req, res) => {
  const { data: inv, error } = await supabase.from('invoices').select('*').eq('id', req.params.id).eq('company_id', getCompanyId(req)).single();
  if (error || !inv) return res.status(404).json({ error: 'Invoice not found' });
  if (!inv.signature_data) return res.status(400).json({ error: 'Invoice not yet signed' });
  if (!inv.customer_email) return res.status(400).json({ error: 'No email on file for this customer' });
  const mailer = createMailer();
  if (!mailer) return res.status(503).json({ error: 'Email not configured on server' });
  const pdfBuffer = await buildInvoicePDF(inv);
  await mailer.sendMail({
    from: `NodeRoute Systems <${process.env.SMTP_USER}>`,
    to: inv.customer_email,
    subject: `Invoice ${inv.invoice_number || inv.id.slice(0,8).toUpperCase()} (Resent)`,
    html: `<p>Hi ${inv.customer_name}, please find your invoice attached.</p>`,
    attachments: [{ filename: `invoice-${inv.invoice_number || inv.id.slice(0,8)}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }],
  });
  await supabase.from('invoices').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', req.params.id).eq('company_id', getCompanyId(req));
  res.json({ message: 'Email resent' });
});

// Download PDF for any invoice
app.get('/api/invoices/:id/pdf', authenticateToken, async (req, res) => {
  const { data: inv, error } = await supabase.from('invoices').select('*').eq('id', req.params.id).eq('company_id', getCompanyId(req)).single();
  if (error || !inv) return res.status(404).json({ error: 'Invoice not found' });
  const pdfBuffer = await buildInvoicePDF(inv);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="invoice-${inv.invoice_number || inv.id.slice(0,8)}.pdf"`);
  res.send(pdfBuffer);
});

// ── PDF BUILDER ───────────────────────────────────────────────────────────────
function buildInvoicePDF(inv) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
    const buffers = [];
    doc.on('data', d => buffers.push(d));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const ACCENT = '#ff6b35';
    const MUTED  = '#666666';
    const signedAt = inv.signed_at ? new Date(inv.signed_at).toLocaleString() : new Date().toLocaleString();
    const invNum = inv.invoice_number || inv.id.slice(0,8).toUpperCase();

    // Header bar
    doc.rect(0, 0, doc.page.width, 80).fill(ACCENT);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(22).text('NodeRoute Systems', 50, 25);
    doc.fillColor('#ffffff').font('Helvetica').fontSize(11).text('noderoutesystems.com', 50, 52);

    // Invoice title
    doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(18).text(`INVOICE #${invNum}`, 350, 25, { align: 'right', width: 200 });
    doc.fillColor(MUTED).font('Helvetica').fontSize(10).text(`Date: ${signedAt}`, 350, 52, { align: 'right', width: 200 });

    let y = 110;

    // Bill To
    doc.fillColor('#111').font('Helvetica-Bold').fontSize(11).text('BILL TO', 50, y);
    y += 16;
    doc.fillColor('#333').font('Helvetica').fontSize(11).text(inv.customer_name, 50, y);
    y += 14;
    if (inv.customer_address) { doc.text(inv.customer_address, 50, y); y += 14; }
    if (inv.customer_email)   { doc.fillColor(ACCENT).text(inv.customer_email, 50, y); y += 14; }
    if (inv.driver_name) {
      doc.fillColor(MUTED).fontSize(10).text(`Driver: ${inv.driver_name}`, 50, y); y += 14;
    }

    y += 16;

    // Items table header
    doc.rect(50, y, doc.page.width - 100, 22).fill('#f0f0f0');
    doc.fillColor('#111').font('Helvetica-Bold').fontSize(10);
    doc.text('DESCRIPTION', 58, y + 6);
    doc.text('QTY',         330, y + 6, { width: 50,  align: 'right' });
    doc.text('UNIT PRICE',  388, y + 6, { width: 80,  align: 'right' });
    doc.text('TOTAL',       476, y + 6, { width: 74,  align: 'right' });
    y += 24;

    // Items rows
    const items = inv.items || [];
    items.forEach((item, i) => {
      if (i % 2 === 0) doc.rect(50, y - 2, doc.page.width - 100, 20).fill('#fafafa');
      doc.fillColor('#222').font('Helvetica').fontSize(10);
      doc.text(item.description || '', 58, y, { width: 268 });
      doc.text(String(item.quantity || ''), 330, y, { width: 50, align: 'right' });
      doc.text(`$${parseFloat(item.unit_price||0).toFixed(2)}`, 388, y, { width: 80, align: 'right' });
      doc.text(`$${parseFloat(item.total||0).toFixed(2)}`,      476, y, { width: 74, align: 'right' });
      y += 20;
    });

    y += 10;
    // Divider
    doc.moveTo(50, y).lineTo(doc.page.width - 50, y).strokeColor('#dddddd').stroke();
    y += 10;

    // Totals
    const totalsX = 380;
    doc.fillColor(MUTED).font('Helvetica').fontSize(10).text('Subtotal:', totalsX, y, { width: 90, align: 'right' });
    doc.fillColor('#222').text(`$${parseFloat(inv.subtotal||0).toFixed(2)}`, 476, y, { width: 74, align: 'right' });
    y += 16;
    doc.fillColor(MUTED).text('Tax:', totalsX, y, { width: 90, align: 'right' });
    doc.fillColor('#222').text(`$${parseFloat(inv.tax||0).toFixed(2)}`, 476, y, { width: 74, align: 'right' });
    y += 16;
    doc.rect(totalsX - 10, y - 4, 160, 24).fill(ACCENT);
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(12).text('TOTAL:', totalsX, y + 2, { width: 90, align: 'right' });
    doc.text(`$${parseFloat(inv.total||0).toFixed(2)}`, 476, y + 2, { width: 74, align: 'right' });
    y += 40;

    // Signature
    if (inv.signature_data) {
      doc.moveTo(50, y).lineTo(doc.page.width - 50, y).strokeColor('#dddddd').stroke();
      y += 14;
      doc.fillColor('#111').font('Helvetica-Bold').fontSize(10).text('CUSTOMER SIGNATURE', 50, y);
      y += 12;
      try {
        const sigData = inv.signature_data.replace(/^data:image\/\w+;base64,/, '');
        doc.image(Buffer.from(sigData, 'base64'), 50, y, { width: 200, height: 80 });
      } catch(e) {}
      doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(`Signed electronically on ${signedAt}`, 50, y + 86);
    }

    if (inv.notes) {
      y += 110;
      doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(`Notes: ${inv.notes}`, 50, y);
    }

    doc.end();
  });
}

// ── ORDERS ────────────────────────────────────────────────────────────────────
app.get('/api/orders', authenticateToken, async (req, res) => {
  const { data, error } = await supabase.from('orders').select('*')
    .eq('company_id', getCompanyId(req)).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.post('/api/orders', authenticateToken, async (req, res) => {
  const { customerName, customerEmail, customerAddress, items, charges, notes } = req.body;
  const orderNumber = 'ORD-' + Date.now().toString().slice(-6);
  const { data, error } = await supabase.from('orders').insert([{
    order_number: orderNumber,
    customer_name: customerName,
    customer_email: customerEmail || null,
    customer_address: customerAddress || null,
    items: items || [],
    charges: charges || [],
    status: 'pending',
    notes: notes || null,
    driver_name: null,
    route_id: null,
    company_id: getCompanyId(req),
  }]).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.patch('/api/orders/:id', authenticateToken, async (req, res) => {
  const cid = getCompanyId(req);
  const updates = {};
  if (req.body.customerName !== undefined) updates.customer_name = req.body.customerName;
  if (req.body.items !== undefined) updates.items = req.body.items;
  if (req.body.charges !== undefined) updates.charges = req.body.charges;
  if (req.body.status !== undefined) updates.status = req.body.status;
  if (req.body.driverName !== undefined) updates.driver_name = req.body.driverName;
  if (req.body.routeId !== undefined) updates.route_id = req.body.routeId;
  if (req.body.notes !== undefined) updates.notes = req.body.notes;
  const { data, error } = await supabase.from('orders').update(updates)
    .eq('id', req.params.id).eq('company_id', cid).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/api/orders/:id', authenticateToken, async (req, res) => {
  const { error } = await supabase.from('orders').delete()
    .eq('id', req.params.id).eq('company_id', getCompanyId(req));
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Order deleted' });
});

// Send order to processing (prints + marks in_process)
app.post('/api/orders/:id/send', authenticateToken, async (req, res) => {
  const { data, error } = await supabase.from('orders').update({ status: 'in_process' })
    .eq('id', req.params.id).eq('company_id', getCompanyId(req)).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Fulfill order: enter actual weights → generate invoice
app.post('/api/orders/:id/fulfill', authenticateToken, async (req, res) => {
  const { items, driverName, routeId } = req.body;
  const cid = getCompanyId(req);
  const { data: order, error: oErr } = await supabase.from('orders').select('*')
    .eq('id', req.params.id).eq('company_id', cid).single();
  if (oErr) return res.status(500).json({ error: oErr.message });
  const productItems = items.map(it => {
    const qty = it.unit === 'lb' ? (it.actual_weight || it.requested_weight || 0) : (it.requested_qty || 0);
    return { description: it.name, quantity: qty, unit: it.unit, unit_price: it.unit_price, total: parseFloat((qty * it.unit_price).toFixed(2)) };
  });
  const subtotal = parseFloat(productItems.reduce((s, i) => s + i.total, 0).toFixed(2));
  const tax = parseFloat((subtotal * 0.09).toFixed(2));
  // Recalculate charges against actual subtotal
  const charges = (order.charges || []).map(c => {
    const amount = parseFloat((c.type === 'percent' ? subtotal * c.value / 100 : c.value).toFixed(2));
    return { ...c, amount };
  });
  const chargesTotal = parseFloat(charges.reduce((s, c) => s + c.amount, 0).toFixed(2));
  // Add charges as line items so they appear on the invoice
  const chargeItems = charges.filter(c => c.amount > 0).map(c => ({
    description: c.label,
    quantity: c.type === 'percent' ? `${c.value}%` : 1,
    unit_price: c.amount,
    total: c.amount,
    is_charge: true
  }));
  const invoiceItems = [...productItems, ...chargeItems];
  const total = parseFloat((subtotal + tax + chargesTotal).toFixed(2));
  const invoiceNumber = 'INV-' + Date.now().toString().slice(-6);
  const { data: invoice, error: iErr } = await supabase.from('invoices').insert([{
    invoice_number: invoiceNumber,
    customer_name: order.customer_name,
    customer_email: order.customer_email,
    customer_address: order.customer_address,
    items: invoiceItems,
    subtotal, tax, total,
    driver_name: driverName || null,
    status: 'pending',
    notes: order.notes || null,
    company_id: cid,
  }]).select().single();
  if (iErr) return res.status(500).json({ error: iErr.message });
  await supabase.from('orders').update({ status: 'invoiced', driver_name: driverName || null, route_id: routeId || null })
    .eq('id', req.params.id).eq('company_id', cid);
  res.json({ invoice, message: 'Invoice created' });
});

// ── DELIVERY TRACKING ─────────────────────────────────────────────────────────

// Google Maps Directions API — traffic-aware ETA with dwell time per prior stop
async function calculateETA(driverLat, driverLng, stopsBeforeCust, custLat, custLng, avgStopMins = 12) {
  const key = process.env.GOOGLE_MAPS_KEY;
  if (!key || !custLat || !custLng) return null;
  try {
    const origin      = `${driverLat},${driverLng}`;
    const destination = `${custLat},${custLng}`;
    const wpStr = stopsBeforeCust.length
      ? '&waypoints=' + stopsBeforeCust.map(s => `${s.lat},${s.lng}`).join('|')
      : '';
    const url = `https://maps.googleapis.com/maps/api/directions/json`
      + `?origin=${encodeURIComponent(origin)}`
      + `&destination=${encodeURIComponent(destination)}`
      + wpStr
      + `&departure_time=now&traffic_model=best_guess&key=${key}`;

    const r    = await fetch(url);
    const data = await r.json();
    if (data.status !== 'OK' || !data.routes[0]) return null;

    const legs = data.routes[0].legs;
    let driveSeconds = 0;
    legs.forEach(leg => {
      driveSeconds += (leg.duration_in_traffic || leg.duration).value;
    });
    const dwellSeconds = stopsBeforeCust.length * avgStopMins * 60;
    const totalSeconds = driveSeconds + dwellSeconds;
    return {
      etaTime:        new Date(Date.now() + totalSeconds * 1000).toISOString(),
      totalMinutes:   Math.round(totalSeconds / 60),
      driveMinutes:   Math.round(driveSeconds / 60),
      dwellMinutes:   Math.round(dwellSeconds / 60),
      stopsCount:     stopsBeforeCust.length,
      legs: legs.map(l => ({
        distance: l.distance.text,
        duration: (l.duration_in_traffic || l.duration).text,
        withTraffic: !!(l.duration_in_traffic)
      }))
    };
  } catch(e) {
    console.error('ETA error:', e.message);
    return null;
  }
}

// Send tracking link to customer (email + optional SMS)
app.post('/api/orders/:id/tracking/send', authenticateToken, async (req, res) => {
  const { data: order, error } = await supabase.from('orders').select('*')
    .eq('id', req.params.id).eq('company_id', getCompanyId(req)).single();
  if (error || !order) return res.status(404).json({ error: 'Order not found' });

  // Geocode customer address if we don't have coords yet
  let custLat = order.customer_lat;
  let custLng = order.customer_lng;
  if ((!custLat || !custLng) && order.customer_address && process.env.GOOGLE_MAPS_KEY) {
    try {
      const geo = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(order.customer_address)}&key=${process.env.GOOGLE_MAPS_KEY}`
      );
      const gd = await geo.json();
      if (gd.status === 'OK') {
        custLat = gd.results[0].geometry.location.lat;
        custLng = gd.results[0].geometry.location.lng;
      }
    } catch(e) { console.error('Geocode error:', e.message); }
  }

  const token     = crypto.randomBytes(20).toString('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await supabase.from('orders').update({
    tracking_token: token, tracking_expires_at: expiresAt,
    customer_lat: custLat || null, customer_lng: custLng || null
  }).eq('id', req.params.id);

  const trackUrl = `${BASE_URL}/track?t=${token}`;
  let emailSent = false, smsSent = false;

  if (order.customer_email) {
    try {
      const mailer = createMailer();
      if (mailer) {
        await mailer.sendMail({
          from: process.env.EMAIL_FROM || `NodeRoute Systems <${process.env.SMTP_USER}>`,
          to: order.customer_email,
          subject: `Your NodeRoute delivery is on the way — ${order.order_number}`,
          html: `<div style="font-family:Arial,sans-serif;max-width:600px">
            <div style="background:#ff6b35;padding:20px 28px;border-radius:8px 8px 0 0">
              <h2 style="color:#fff;margin:0;font-size:20px">NodeRoute Systems</h2>
            </div>
            <div style="padding:28px;background:#f9f9f9;border-radius:0 0 8px 8px">
              <p style="margin:0 0 16px">Hi <strong>${order.customer_name}</strong>,</p>
              <p style="margin:0 0 24px">Your delivery is on the way! Track your driver in real time — including live location and your estimated arrival time.</p>
              <div style="text-align:center;margin:0 0 24px">
                <a href="${trackUrl}" style="background:#ff6b35;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;display:inline-block">Track My Delivery →</a>
              </div>
              <p style="color:#999;font-size:12px;margin:0">Order ${order.order_number} · Link expires in 24 hours</p>
            </div>
          </div>`
        });
        emailSent = true;
      }
    } catch(e) { console.error('Tracking email error:', e.message); }
  }

  // SMS via Twilio if configured
  const phone = req.body.phone || order.customer_phone;
  if (phone && process.env.TWILIO_SID && process.env.TWILIO_TOKEN && process.env.TWILIO_FROM) {
    try {
      const twilioAuth = Buffer.from(`${process.env.TWILIO_SID}:${process.env.TWILIO_TOKEN}`).toString('base64');
      const smsRes = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_SID}/Messages.json`,
        {
          method: 'POST',
          headers: { 'Authorization': `Basic ${twilioAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ To: phone, From: process.env.TWILIO_FROM,
            Body: `NodeRoute: Your delivery (${order.order_number}) is on the way! Track your driver here: ${trackUrl}` }).toString()
        }
      );
      smsSent = smsRes.ok;
    } catch(e) { console.error('SMS error:', e.message); }
  }

  res.json({ trackUrl, emailSent, smsSent });
});

// Public tracking data — no auth required
app.get('/api/track/:token', async (req, res) => {
  const { data: order, error } = await supabase
    .from('orders').select('*').eq('tracking_token', req.params.token).single();
  if (error || !order) return res.status(404).json({ error: 'Tracking link not found' });
  if (order.tracking_expires_at && new Date() > new Date(order.tracking_expires_at))
    return res.status(410).json({ error: 'This tracking link has expired' });

  // Driver's current location
  const { data: driverLoc } = await supabase
    .from('driver_locations').select('*').eq('driver_name', order.driver_name || '').single();
  const driverLat = driverLoc?.lat || 32.7765;
  const driverLng = driverLoc?.lng || -79.9311;
  const driverUpdatedAt = driverLoc?.updated_at || null;

  // Load route stops in order — find stops ahead of this customer
  let stopsBeforeCustomer = [];
  let totalRouteStops = 0;
  if (order.route_id) {
    const { data: route } = await supabase.from('routes').select('*').eq('id', order.route_id).single();
    if (route?.stop_ids?.length) {
      const { data: allStops } = await supabase.from('stops').select('*').in('id', route.stop_ids);
      const ordered = route.stop_ids.map(id => allStops?.find(s => s.id === id)).filter(Boolean);
      totalRouteStops = ordered.length;
      // Match customer stop by address or name
      const custKey = (order.customer_address || order.customer_name || '').toLowerCase();
      const custIdx = ordered.findIndex(s =>
        (s.address || '').toLowerCase().includes(custKey.split(',')[0]) ||
        (s.name || '').toLowerCase().includes(custKey.split(' ')[0])
      );
      if (custIdx > 0) stopsBeforeCustomer = ordered.slice(0, custIdx).filter(s => s.lat && s.lng);
    }
  }

  const eta = await calculateETA(
    driverLat, driverLng,
    stopsBeforeCustomer,
    order.customer_lat, order.customer_lng
  );

  res.json({
    orderNumber:     order.order_number,
    customerName:    order.customer_name,
    deliveryAddress: order.customer_address,
    status:          order.status,
    driver: {
      name:      order.driver_name || 'Your driver',
      lat:       driverLat,
      lng:       driverLng,
      updatedAt: driverUpdatedAt
    },
    destination: {
      lat:     order.customer_lat,
      lng:     order.customer_lng,
      address: order.customer_address
    },
    stopsBeforeYou:  stopsBeforeCustomer.length,
    totalRouteStops,
    eta,
    lastUpdated: new Date().toISOString()
  });
});

// Driver updates their own location (called from driver mobile app)
app.post('/api/driver/location', authenticateToken, async (req, res) => {
  const { lat, lng, heading, speed_mph } = req.body;
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });
  const { error } = await supabase.from('driver_locations').upsert({
    driver_name: req.user.name,
    company_id: getCompanyId(req),
    lat: parseFloat(lat), lng: parseFloat(lng),
    heading: parseFloat(heading) || 0,
    speed_mph: parseFloat(speed_mph) || 0,
    updated_at: new Date().toISOString()
  }, { onConflict: 'driver_name' });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Location updated' });
});

// ── PAGES ─────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(frontendDir, 'login.html')));
app.get('/track', (req, res) => res.sendFile(path.join(frontendDir, 'track.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(frontendDir, 'index.html')));
app.get('/landing', (req, res) => res.sendFile(path.join(frontendDir, 'landing.html')));

app.listen(PORT, () => console.log(`NodeRoute API running on http://localhost:${PORT}`));
