require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

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

const dataDir = path.join(__dirname, 'data');
const usersFile = path.join(dataDir, 'users.json');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@noderoute.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@123';

if (!fs.existsSync(usersFile)) {
  fs.writeFileSync(usersFile, JSON.stringify([{
    id: 'admin-001', name: 'Admin', email: ADMIN_EMAIL,
    passwordHash: bcrypt.hashSync(ADMIN_PASSWORD, 10),
    role: 'admin', status: 'active',
    inviteToken: null, inviteExpires: null, createdAt: new Date().toISOString()
  }], null, 2));
}

function readUsers() { return JSON.parse(fs.readFileSync(usersFile, 'utf8')); }
function writeUsers(u) { fs.writeFileSync(usersFile, JSON.stringify(u, null, 2)); }

const sessions = {};

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

function generateToken() { return crypto.randomBytes(32).toString('hex'); }

function authenticateToken(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  const token = auth.slice(7);
  const userId = sessions[token];
  if (!userId) return res.status(401).json({ error: 'Invalid or expired session' });
  const user = readUsers().find(u => u.id === userId);
  if (!user) return res.status(401).json({ error: 'User not found' });
  req.user = user; req.token = token; next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

app.post('/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const users = readUsers();
  const idx = users.findIndex(u => u.email.toLowerCase() === email.toLowerCase());
  if (idx === -1 || users[idx].status !== 'active') return res.status(401).json({ error: 'Invalid credentials' });
  const { valid, migrate } = verifyPassword(password, users[idx].passwordHash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
  if (migrate) { users[idx].passwordHash = bcrypt.hashSync(password, 10); writeUsers(users); }
  const token = generateToken();
  sessions[token] = users[idx].id;
  const u = users[idx];
  res.json({ token, user: { id: u.id, name: u.name, email: u.email, role: u.role } });
});

app.post('/auth/setup-password', (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Token and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const users = readUsers();
  const idx = users.findIndex(u => u.inviteToken === token);
  if (idx === -1) return res.status(400).json({ error: 'Invalid invite token' });
  if (new Date() > new Date(users[idx].inviteExpires)) return res.status(400).json({ error: 'Invite link expired' });
  users[idx].passwordHash = hashPassword(password);
  users[idx].status = 'active';
  users[idx].inviteToken = null;
  users[idx].inviteExpires = null;
  writeUsers(users);
  const sessionToken = generateToken();
  sessions[sessionToken] = users[idx].id;
  res.json({ token: sessionToken, user: { id: users[idx].id, name: users[idx].name, email: users[idx].email, role: users[idx].role } });
});

app.get('/auth/me', authenticateToken, (req, res) => {
  res.json({ id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role });
});

app.post('/auth/logout', authenticateToken, (req, res) => {
  delete sessions[req.token];
  res.json({ message: 'Logged out' });
});

app.get('/api/users', authenticateToken, requireRole('admin', 'manager'), (req, res) => {
  res.json(readUsers().map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role, status: u.status, createdAt: u.createdAt })));
});

app.post('/api/users/invite', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { name, email, role = 'driver' } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'Name and email required' });
  if (!['admin', 'manager', 'driver'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (role === 'admin' && req.user.role !== 'admin') return res.status(403).json({ error: 'Only admins can invite admins' });
  const users = readUsers();
  if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) return res.status(409).json({ error: 'Email already exists' });
  const inviteToken = generateToken();
  const newUser = { id: 'user-' + Date.now(), name, email, passwordHash: null, role, status: 'pending', inviteToken, inviteExpires: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(), createdAt: new Date().toISOString() };
  users.push(newUser);
  writeUsers(users);
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

app.delete('/api/users/:id', authenticateToken, requireRole('admin'), (req, res) => {
  const users = readUsers();
  const idx = users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  if (users[idx].role === 'admin') return res.status(403).json({ error: 'Cannot delete admin' });
  users.splice(idx, 1); writeUsers(users);
  res.json({ message: 'User deleted' });
});

app.patch('/api/users/:id/role', authenticateToken, requireRole('admin'), (req, res) => {
  const { role } = req.body;
  if (!['admin', 'manager', 'driver'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const users = readUsers();
  const idx = users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  users[idx].role = role; writeUsers(users);
  res.json({ message: 'Role updated' });
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
  const { data, error } = await supabase.from('stops').select('*').order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post('/api/stops', authenticateToken, async (req, res) => {
  const { name, address, lat, lng, notes } = req.body;
  if (!name || !address) return res.status(400).json({ error: 'Name and address required' });
  const { data, error } = await supabase
    .from('stops')
    .insert([{ name, address, lat: parseFloat(lat)||0, lng: parseFloat(lng)||0, notes: notes||'' }])
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.patch('/api/stops/:id', authenticateToken, async (req, res) => {
  const { data, error } = await supabase.from('stops').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.delete('/api/stops/:id', authenticateToken, async (req, res) => {
  const { error } = await supabase.from('stops').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Deleted' });
});

// ── ROUTES (Supabase) ───────────────────────────────────
app.get('/api/routes', authenticateToken, async (req, res) => {
  const { data, error } = await supabase.from('routes').select('*').order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post('/api/routes', authenticateToken, async (req, res) => {
  const { name, stopIds, driver, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Route name required' });
  const { data, error } = await supabase
    .from('routes')
    .insert([{ name, stop_ids: stopIds||[], driver: driver||'', notes: notes||'' }])
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.patch('/api/routes/:id', authenticateToken, async (req, res) => {
  const payload = { ...req.body };
  if (payload.stopIds !== undefined) { payload.stop_ids = payload.stopIds; delete payload.stopIds; }
  const { data, error } = await supabase.from('routes').update(payload).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.delete('/api/routes/:id', authenticateToken, async (req, res) => {
  const { error } = await supabase.from('routes').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Deleted' });
});

// ── CUSTOMERS (Supabase: "250 restaurants") ─────────────
app.get('/api/customers', authenticateToken, async (req, res) => {
  const { data, error } = await supabase
    .from('250 restaurants')
    .select('*')
    .order('Rank', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post('/api/customers', authenticateToken, async (req, res) => {
  const { Restaurant, Address, Phone, Area, Cuisine, Rank } = req.body;
  if (!Restaurant) return res.status(400).json({ error: 'Restaurant name required' });
  const { data, error } = await supabase
    .from('250 restaurants')
    .insert([{ Restaurant, Address: Address||'', Phone: Phone||'', Area: Area||'', Cuisine: Cuisine||'', Rank: Rank||null }])
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.patch('/api/customers/:rank', authenticateToken, async (req, res) => {
  const { data, error } = await supabase
    .from('250 restaurants')
    .update(req.body)
    .eq('Rank', req.params.rank)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.delete('/api/customers/:rank', authenticateToken, async (req, res) => {
  const { error } = await supabase
    .from('250 restaurants')
    .delete()
    .eq('Rank', req.params.rank);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Deleted' });
});

// ── DWELL TIME (geofence check-in/out) ──────────────────
const dwellRecords = []; // { id, stopId, routeId, driverId, arrivedAt, departedAt, dwellMs }
app.post('/api/stops/:id/arrive', authenticateToken, (req, res) => {
  const { routeId } = req.body;
  const existing = dwellRecords.find(d => d.stopId === req.params.id && d.routeId === routeId && !d.departedAt);
  if (existing) return res.json(existing);
  const record = { id: 'dwell-' + Date.now(), stopId: req.params.id, routeId: routeId||'', driverId: req.user.userId, arrivedAt: new Date().toISOString(), departedAt: null, dwellMs: null };
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
      description: description || ''
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
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/api/inventory/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
  const { error } = await supabase.from('seafood_inventory').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Deleted' });
});

// ── INVOICES ──────────────────────────────────────────────────────────────────

app.get('/api/invoices', authenticateToken, async (req, res) => {
  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/invoices', authenticateToken, async (req, res) => {
  const { invoice_number, customer_name, customer_email, customer_address, items, subtotal, tax, total, driver_name, notes, entree_invoice_id } = req.body;
  if (!customer_name) return res.status(400).json({ error: 'Customer name required' });
  const { data, error } = await supabase
    .from('invoices')
    .insert([{ invoice_number, customer_name, customer_email, customer_address, items: items||[], subtotal: subtotal||0, tax: tax||0, total: total||0, status: 'pending', driver_name, notes, entree_invoice_id }])
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Entree import — accepts one or many invoices in Entree's export format
app.post('/api/invoices/import', authenticateToken, async (req, res) => {
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
  }));
  const { data, error } = await supabase.from('invoices').insert(mapped).select();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ imported: data.length, invoices: data });
});

// Save signature → generate PDF → email customer
app.post('/api/invoices/:id/sign', authenticateToken, async (req, res) => {
  const { signature_data } = req.body; // base64 PNG from canvas
  if (!signature_data) return res.status(400).json({ error: 'Signature data required' });

  const { data: inv, error: fetchErr } = await supabase
    .from('invoices').select('*').eq('id', req.params.id).single();
  if (fetchErr || !inv) return res.status(404).json({ error: 'Invoice not found' });

  // Update invoice as signed
  const { data: updated, error: updateErr } = await supabase
    .from('invoices')
    .update({ signature_data, status: 'signed', signed_at: new Date().toISOString() })
    .eq('id', req.params.id).select().single();
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
        await supabase.from('invoices').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', req.params.id);
      }
    } catch (e) {
      console.error('Email error:', e.message);
    }
  }

  res.json({ ...updated, status: emailSent ? 'sent' : 'signed', emailSent });
});

// Resend email for an already-signed invoice
app.post('/api/invoices/:id/resend', authenticateToken, async (req, res) => {
  const { data: inv, error } = await supabase.from('invoices').select('*').eq('id', req.params.id).single();
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
  await supabase.from('invoices').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', req.params.id);
  res.json({ message: 'Email resent' });
});

// Download PDF for any invoice
app.get('/api/invoices/:id/pdf', authenticateToken, async (req, res) => {
  const { data: inv, error } = await supabase.from('invoices').select('*').eq('id', req.params.id).single();
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
  const { data, error } = await supabase.from('orders').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.post('/api/orders', authenticateToken, async (req, res) => {
  const { customerName, customerEmail, customerAddress, items, notes } = req.body;
  const orderNumber = 'ORD-' + Date.now().toString().slice(-6);
  const { data, error } = await supabase.from('orders').insert([{
    order_number: orderNumber,
    customer_name: customerName,
    customer_email: customerEmail || null,
    customer_address: customerAddress || null,
    items: items || [],
    status: 'pending',
    notes: notes || null,
    driver_name: null,
    route_id: null
  }]).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.patch('/api/orders/:id', authenticateToken, async (req, res) => {
  const updates = {};
  if (req.body.customerName !== undefined) updates.customer_name = req.body.customerName;
  if (req.body.items !== undefined) updates.items = req.body.items;
  if (req.body.status !== undefined) updates.status = req.body.status;
  if (req.body.driverName !== undefined) updates.driver_name = req.body.driverName;
  if (req.body.routeId !== undefined) updates.route_id = req.body.routeId;
  if (req.body.notes !== undefined) updates.notes = req.body.notes;
  const { data, error } = await supabase.from('orders').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/api/orders/:id', authenticateToken, async (req, res) => {
  const { error } = await supabase.from('orders').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Order deleted' });
});

// Send order to processing (prints + marks in_process)
app.post('/api/orders/:id/send', authenticateToken, async (req, res) => {
  const { data, error } = await supabase.from('orders').update({ status: 'in_process' }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Fulfill order: enter actual weights → generate invoice
app.post('/api/orders/:id/fulfill', authenticateToken, async (req, res) => {
  const { items, driverName, routeId } = req.body;
  const { data: order, error: oErr } = await supabase.from('orders').select('*').eq('id', req.params.id).single();
  if (oErr) return res.status(500).json({ error: oErr.message });
  const invoiceItems = items.map(it => {
    const qty = it.unit === 'lb' ? (it.actual_weight || it.requested_weight || 0) : (it.requested_qty || 0);
    return { description: it.name, quantity: qty, unit: it.unit, unit_price: it.unit_price, total: parseFloat((qty * it.unit_price).toFixed(2)) };
  });
  const subtotal = invoiceItems.reduce((s, i) => s + i.total, 0);
  const tax = parseFloat((subtotal * 0.09).toFixed(2));
  const total = parseFloat((subtotal + tax).toFixed(2));
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
    notes: order.notes || null
  }]).select().single();
  if (iErr) return res.status(500).json({ error: iErr.message });
  await supabase.from('orders').update({ status: 'invoiced', driver_name: driverName || null, route_id: routeId || null }).eq('id', req.params.id);
  res.json({ invoice, message: 'Invoice created' });
});

// ── PAGES ─────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(frontendDir, 'login.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(frontendDir, 'index.html')));
app.get('/landing', (req, res) => res.sendFile(path.join(frontendDir, 'landing.html')));

app.listen(PORT, () => console.log(`NodeRoute API running on http://localhost:${PORT}`));
