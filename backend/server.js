require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

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
app.use(express.static(frontendDir));

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

app.post('/api/users/invite', authenticateToken, requireRole('admin', 'manager'), (req, res) => {
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
  res.json({ message: `Invite created for ${name}`, userId: newUser.id, inviteUrl });
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

app.get('/', (req, res) => res.sendFile(path.join(frontendDir, 'login.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(frontendDir, 'index.html')));
app.get('/landing', (req, res) => res.sendFile(path.join(frontendDir, 'landing.html')));

app.listen(PORT, () => console.log(`NodeRoute API running on http://localhost:${PORT}`));
