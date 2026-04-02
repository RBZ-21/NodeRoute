const express = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const path     = require('path');
const https    = require('https');

const app = express();
const JWT_SECRET = 'deliverhub-secret-key-2026';

app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── In-memory data ──────────────────────────────────────────────
let users = [
  { id: 1, name: 'Ryan', email: 'ryandb21@gmail.com', password: bcrypt.hashSync('Admin1234!', 10), role: 'admin' }
];

let drivers = [
  { id: 1, name: 'Marcus Johnson', status: 'On Duty',  location: 'Downtown', phone: '843-555-0101', deliveries: 8 },
  { id: 2, name: 'Sarah Chen',     status: 'Off Duty', location: 'Midtown',  phone: '843-555-0102', deliveries: 5 },
  { id: 3, name: 'James Rivera',   status: 'On Duty',  location: 'Uptown',   phone: '843-555-0103', deliveries: 6 },
  { id: 4, name: 'Priya Patel',    status: 'On Duty',  location: 'Eastside', phone: '843-555-0104', deliveries: 4 },
];

let orders = [
  { id: 'ORD-001', customer: 'The Ocean Room',  address: '55 Market St, Charleston SC',     status: 'Delivered',  driver: 'Marcus Johnson', eta: null,       time: '11:30 AM' },
  { id: 'ORD-002', customer: 'Husk Restaurant', address: '76 Queen St, Charleston SC',      status: 'In Transit', driver: 'Sarah Chen',     eta: '1:15 PM',  time: null },
  { id: 'ORD-003', customer: 'FIG',             address: '232 Meeting St, Charleston SC',   status: 'Pending',    driver: null,             eta: null,       time: null },
  { id: 'ORD-004', customer: 'Halls Chophouse', address: '434 King St, Charleston SC',      status: 'In Transit', driver: 'James Rivera',   eta: '12:45 PM', time: null },
  { id: 'ORD-005', customer: 'Zero Restaurant', address: '140 East Bay St, Charleston SC',  status: 'Failed',     driver: 'Priya Patel',    eta: null,       time: '10:00 AM' },
  { id: 'ORD-006', customer: "Edmund's Oast",   address: '1081 Morrison Dr, Charleston SC', status: 'Delivered',  driver: 'Marcus Johnson', eta: null,       time: '10:45 AM' },
];

let routes = [
  { id: 1, name: 'Downtown Loop',  driver: 'Marcus Johnson', status: 'Active' },
  { id: 2, name: 'Midtown Run',    driver: 'James Rivera',   status: 'Active' },
  { id: 3, name: 'Eastside Route', driver: 'Priya Patel',    status: 'Pending' },
];

let stops = [
  { id: 1, routeId: 1, address: '55 Market St, Charleston, SC',     customer: 'The Ocean Room',  order: 1, status: 'Completed',   lat: 32.7765, lng: -79.9311, arrivalTime: '10:30 AM', departureTime: '10:45 AM', timeSpent: 15, notes: 'Bring to back kitchen entrance', doorCode: '1234', contactName: 'Chef Marcus', contactPhone: '843-555-0201' },
  { id: 2, routeId: 1, address: '76 Queen St, Charleston, SC',      customer: 'Husk Restaurant', order: 2, status: 'In Progress', lat: 32.7751, lng: -79.9370, arrivalTime: '11:00 AM', departureTime: null,       timeSpent: null, notes: '', doorCode: '', contactName: '', contactPhone: '' },
  { id: 3, routeId: 1, address: '232 Meeting St, Charleston, SC',   customer: 'FIG',             order: 3, status: 'Pending',     lat: 32.7798, lng: -79.9382, arrivalTime: null,       departureTime: null,       timeSpent: null, notes: '', doorCode: '', contactName: '', contactPhone: '' },
  { id: 4, routeId: 2, address: '434 King St, Charleston, SC',      customer: 'Halls Chophouse', order: 1, status: 'In Progress', lat: 32.7834, lng: -79.9414, arrivalTime: '11:15 AM', departureTime: null,       timeSpent: null, notes: 'Side entrance on Ann St', doorCode: '5678', contactName: 'Sarah', contactPhone: '843-555-0301' },
  { id: 5, routeId: 3, address: '140 East Bay St, Charleston, SC',  customer: 'Zero Restaurant', order: 1, status: 'Pending',     lat: 32.7761, lng: -79.9280, arrivalTime: null,       departureTime: null,       timeSpent: null, notes: '', doorCode: '', contactName: '', contactPhone: '' },
];

// GPS locations: { driverId: { lat, lng, timestamp, speed, heading } }
let gpsLocations = {
  1: { driverId: 1, name: 'Marcus Johnson', lat: 32.7751, lng: -79.9370, timestamp: Date.now(), speed: 0 },
  3: { driverId: 3, name: 'James Rivera',   lat: 32.7834, lng: -79.9414, timestamp: Date.now(), speed: 0 },
};

let nextStopId = 6;
let nextNotifId = 1;
// Notifications: { id, type, message, stopId, routeId, driverName, timestamp, read }
let notifications = [];

// ── Helpers ──────────────────────────────────────────────────────
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'BackPin/1.0 (deliveryhub@example.com)' } }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('Parse error')); } });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

async function geocodeAddress(address) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1&countrycodes=us`;
    const data = await fetchJson(url);
    if (data && data.length > 0) {
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), display: data[0].display_name };
    }
  } catch (e) { console.error('Geocode error:', e.message); }
  return null;
}

// Nearest-neighbor TSP (fallback if OSRM unavailable)
function nearestNeighbor(stopsArr) {
  if (stopsArr.length <= 1) return stopsArr;
  const unvisited = [...stopsArr];
  const result = [unvisited.shift()];
  while (unvisited.length > 0) {
    const last = result[result.length - 1];
    let nearest = 0, minDist = Infinity;
    for (let i = 0; i < unvisited.length; i++) {
      const dlat = (last.lat || 0) - (unvisited[i].lat || 0);
      const dlng = (last.lng || 0) - (unvisited[i].lng || 0);
      const d = Math.sqrt(dlat * dlat + dlng * dlng);
      if (d < minDist) { minDist = d; nearest = i; }
    }
    result.push(unvisited.splice(nearest, 1)[0]);
  }
  return result;
}

async function optimizeStops(stopsArr) {
  const withCoords = stopsArr.filter(s => s.lat && s.lng);
  const withoutCoords = stopsArr.filter(s => !s.lat || !s.lng);
  if (withCoords.length < 2) return stopsArr;
  try {
    const coords = withCoords.map(s => `${s.lng},${s.lat}`).join(';');
    const url = `http://router.project-osrm.org/trip/v1/driving/${coords}?roundtrip=false&source=first&destination=last`;
    // OSRM uses http not https
    const osrmData = await new Promise((resolve, reject) => {
      const http = require('http');
      const req = http.get(url, { headers: { 'User-Agent': 'BackPin/1.0' } }, res => {
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('Parse error')); } });
      });
      req.on('error', reject);
      req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
    });
    if (osrmData.code === 'Ok' && osrmData.waypoints) {
      const optimized = new Array(withCoords.length);
      osrmData.waypoints.forEach((w, i) => { optimized[w.waypoint_index] = withCoords[i]; });
      return [...optimized.filter(Boolean), ...withoutCoords];
    }
  } catch (e) { console.error('OSRM error:', e.message); }
  return [...nearestNeighbor(withCoords), ...withoutCoords];
}

// ── Auth middleware ──────────────────────────────────────────────
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid or expired token' }); }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Access denied' });
    next();
  };
}

// ── Auth ─────────────────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = users.find(u => u.email === email.toLowerCase().trim());
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Invalid email or password' });
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

// ── Users (Admin only) ───────────────────────────────────────────
app.get('/api/users', auth, requireRole('admin'), (req, res) => {
  res.json(users.map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role })));
});

app.post('/api/users', auth, requireRole('admin'), (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, and password are required' });
  if (users.find(u => u.email === email.toLowerCase())) return res.status(400).json({ error: 'Email already in use' });
  const newUser = { id: users.length + 1, name, email: email.toLowerCase().trim(), password: bcrypt.hashSync(password, 10), role: role || 'manager' };
  users.push(newUser);
  res.json({ id: newUser.id, name, email: newUser.email, role: newUser.role });
});

app.delete('/api/users/:id', auth, requireRole('admin'), (req, res) => {
  const id = parseInt(req.params.id);
  if (id === 1) return res.status(400).json({ error: 'Cannot delete the primary admin' });
  users = users.filter(u => u.id !== id);
  res.json({ success: true });
});

// ── Stats ────────────────────────────────────────────────────────
app.get('/api/stats', auth, (req, res) => {
  res.json({
    total:         orders.length,
    delivered:     orders.filter(o => o.status === 'Delivered').length,
    inTransit:     orders.filter(o => o.status === 'In Transit').length,
    pending:       orders.filter(o => o.status === 'Pending').length,
    failed:        orders.filter(o => o.status === 'Failed').length,
    driversOnDuty: drivers.filter(d => d.status === 'On Duty').length,
    activeRoutes:  routes.filter(r => r.status === 'Active').length,
  });
});

// ── Drivers ──────────────────────────────────────────────────────
app.get('/api/drivers', auth, (req, res) => res.json(drivers));

app.post('/api/drivers', auth, requireRole('admin', 'manager'), (req, res) => {
  const { name, phone, location } = req.body;
  if (!name) return res.status(400).json({ error: 'Driver name is required' });
  const driver = { id: drivers.length + 1, name, phone: phone || '', location: location || 'Unassigned', status: 'Off Duty', deliveries: 0 };
  drivers.push(driver);
  res.json(driver);
});

app.put('/api/drivers/:id', auth, requireRole('admin', 'manager'), (req, res) => {
  const id = parseInt(req.params.id);
  const idx = drivers.findIndex(d => d.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Driver not found' });
  drivers[idx] = { ...drivers[idx], ...req.body, id };
  res.json(drivers[idx]);
});

app.delete('/api/drivers/:id', auth, requireRole('admin', 'manager'), (req, res) => {
  drivers = drivers.filter(d => d.id !== parseInt(req.params.id));
  res.json({ success: true });
});

// ── GPS Locations ────────────────────────────────────────────────
app.get('/api/drivers/locations', auth, (req, res) => {
  res.json(Object.values(gpsLocations));
});

app.post('/api/drivers/:id/location', auth, (req, res) => {
  const id = parseInt(req.params.id);
  const { lat, lng, speed, heading } = req.body;
  const driver = drivers.find(d => d.id === id);
  gpsLocations[id] = { driverId: id, name: driver ? driver.name : 'Unknown', lat, lng, speed: speed || 0, heading: heading || 0, timestamp: Date.now() };
  res.json({ success: true });
});

// ── Orders ───────────────────────────────────────────────────────
app.get('/api/orders', auth, (req, res) => res.json(orders));

app.post('/api/orders', auth, requireRole('admin', 'manager'), (req, res) => {
  const order = { id: `ORD-${String(orders.length + 1).padStart(3, '0')}`, ...req.body, status: 'Pending' };
  orders.push(order);
  res.json(order);
});

app.put('/api/orders/:id', auth, requireRole('admin', 'manager'), (req, res) => {
  const idx = orders.findIndex(o => o.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Order not found' });
  orders[idx] = { ...orders[idx], ...req.body };
  res.json(orders[idx]);
});

// ── Routes ───────────────────────────────────────────────────────
app.get('/api/routes', auth, (req, res) => {
  const result = routes.map(r => ({ ...r, stops: stops.filter(s => s.routeId === r.id).length }));
  res.json(result);
});

app.post('/api/routes', auth, requireRole('admin', 'manager'), (req, res) => {
  const route = { id: routes.length + 1, ...req.body, status: 'Pending' };
  routes.push(route);
  res.json(route);
});

app.put('/api/routes/:id', auth, requireRole('admin', 'manager'), (req, res) => {
  const id = parseInt(req.params.id);
  const idx = routes.findIndex(r => r.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Route not found' });
  routes[idx] = { ...routes[idx], ...req.body, id };
  res.json(routes[idx]);
});

app.delete('/api/routes/:id', auth, requireRole('admin', 'manager'), (req, res) => {
  const id = parseInt(req.params.id);
  routes = routes.filter(r => r.id !== id);
  stops  = stops.filter(s => s.routeId !== id);
  res.json({ success: true });
});

// ── Stops ────────────────────────────────────────────────────────
app.get('/api/stops', auth, (req, res) => {
  const routeId = req.query.routeId ? parseInt(req.query.routeId) : null;
  const result = routeId ? stops.filter(s => s.routeId === routeId) : stops;
  res.json(result.sort((a, b) => a.order - b.order));
});

app.post('/api/stops', auth, requireRole('admin', 'manager'), async (req, res) => {
  const { routeId, address, customer, notes } = req.body;
  if (!routeId || !address) return res.status(400).json({ error: 'routeId and address are required' });
  const routeStops = stops.filter(s => s.routeId === parseInt(routeId));
  if (routeStops.length >= 50) return res.status(400).json({ error: 'Maximum 50 stops per route' });
  const coords = await geocodeAddress(address);
  const stop = {
    id: nextStopId++,
    routeId: parseInt(routeId),
    address,
    customer: customer || '',
    notes: notes || '',
    doorCode: req.body.doorCode || '',
    contactName: req.body.contactName || '',
    contactPhone: req.body.contactPhone || '',
    order: routeStops.length + 1,
    status: 'Pending',
    lat: coords ? coords.lat : null,
    lng: coords ? coords.lng : null,
    arrivalTime: null,
    departureTime: null,
    timeSpent: null,
  };
  stops.push(stop);
  res.json(stop);
});

app.put('/api/stops/:id', auth, (req, res) => {
  const id = parseInt(req.params.id);
  const idx = stops.findIndex(s => s.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Stop not found' });

  const isDriver = req.user.role === 'driver';
  const DRIVER_EDITABLE = ['address', 'notes', 'doorCode', 'contactName', 'contactPhone'];
  const hasDriverEdit = DRIVER_EDITABLE.some(f => req.body[f] !== undefined && req.body[f] !== stops[idx][f]);

  // Enforce 24-hour limit for driver detail edits
  if (isDriver && hasDriverEdit) {
    const last = stops[idx].lastDriverEditAt;
    if (last && (Date.now() - last) < 24 * 60 * 60 * 1000) {
      const hoursLeft = Math.ceil((24 * 60 * 60 * 1000 - (Date.now() - last)) / 3600000);
      return res.status(429).json({ error: `You can update stop details again in ${hoursLeft} hour${hoursLeft !== 1 ? 's' : ''}` });
    }
  }

  const updated = { ...stops[idx], ...req.body, id };

  // Record driver edit timestamp and create manager notification
  if (isDriver && hasDriverEdit) {
    updated.lastDriverEditAt = Date.now();
    const route = routes.find(r => r.id === updated.routeId);
    const changes = DRIVER_EDITABLE.filter(f => req.body[f] !== undefined && req.body[f] !== stops[idx][f]);
    notifications.push({
      id: nextNotifId++,
      type: 'driver_edit',
      message: `${req.user.name} updated stop details (${changes.join(', ')}) on ${updated.address}`,
      stopId: id,
      routeId: updated.routeId,
      routeName: route ? route.name : 'Unknown Route',
      driverName: req.user.name,
      timestamp: Date.now(),
      read: false,
    });
  }

  // Calculate timeSpent if both arrival and departure provided
  if (updated.arrivalTime && updated.departureTime && updated.timeSpent == null) {
    try {
      const arr = new Date(`1970-01-01 ${updated.arrivalTime}`);
      const dep = new Date(`1970-01-01 ${updated.departureTime}`);
      updated.timeSpent = Math.round((dep - arr) / 60000);
    } catch {}
  }
  stops[idx] = updated;
  res.json(stops[idx]);
});

app.delete('/api/stops/:id', auth, requireRole('admin', 'manager'), (req, res) => {
  const id = parseInt(req.params.id);
  const stop = stops.find(s => s.id === id);
  if (!stop) return res.status(404).json({ error: 'Stop not found' });
  stops = stops.filter(s => s.id !== id);
  // Re-number order for remaining stops in route
  stops.filter(s => s.routeId === stop.routeId)
       .sort((a, b) => a.order - b.order)
       .forEach((s, i) => { s.order = i + 1; });
  res.json({ success: true });
});

// Reorder stops manually
app.put('/api/routes/:id/stops/reorder', auth, requireRole('admin', 'manager'), (req, res) => {
  const routeId = parseInt(req.params.id);
  const { orderedIds } = req.body; // array of stop ids in new order
  if (!Array.isArray(orderedIds)) return res.status(400).json({ error: 'orderedIds must be an array' });
  orderedIds.forEach((stopId, idx) => {
    const stop = stops.find(s => s.id === stopId && s.routeId === routeId);
    if (stop) stop.order = idx + 1;
  });
  res.json(stops.filter(s => s.routeId === routeId).sort((a, b) => a.order - b.order));
});

// Auto-optimize stop order
app.post('/api/routes/:id/optimize', auth, requireRole('admin', 'manager'), async (req, res) => {
  const routeId = parseInt(req.params.id);
  const routeStops = stops.filter(s => s.routeId === routeId && s.status === 'Pending');
  const doneStops  = stops.filter(s => s.routeId === routeId && s.status !== 'Pending');
  if (routeStops.length < 2) return res.json({ message: 'Not enough pending stops to optimize', stops: stops.filter(s => s.routeId === routeId) });
  const optimized = await optimizeStops(routeStops);
  const startOrder = doneStops.length + 1;
  optimized.forEach((s, i) => { s.order = startOrder + i; });
  res.json({ message: 'Route optimized', stops: stops.filter(s => s.routeId === routeId).sort((a, b) => a.order - b.order) });
});

// Geocode address search (for autocomplete backend proxy)
app.get('/api/geocode', auth, async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 3) return res.json([]);
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=5&countrycodes=us&addressdetails=1`;
    const data = await fetchJson(url);
    res.json(data.map(d => ({ display: d.display_name, lat: parseFloat(d.lat), lng: parseFloat(d.lon) })));
  } catch { res.json([]); }
});

// ── Driver self-view ─────────────────────────────────────────────
app.get('/api/driver/route', auth, (req, res) => {
  const driver = drivers.find(d => d.name.toLowerCase() === req.user.name.toLowerCase());
  if (!driver) return res.status(404).json({ error: 'No driver profile found for your account' });
  const route = routes.find(r => r.driver === driver.name);
  if (!route) return res.json({ driver, route: null, stops: [] });
  const routeStops = stops.filter(s => s.routeId === route.id).sort((a, b) => a.order - b.order);
  res.json({ driver, route, stops: routeStops });
});

// ── Notifications (managers & admins) ────────────────────────────
app.get('/api/notifications', auth, requireRole('admin', 'manager'), (req, res) => {
  res.json(notifications.slice().reverse());
});

app.put('/api/notifications/:id/read', auth, requireRole('admin', 'manager'), (req, res) => {
  const n = notifications.find(n => n.id === parseInt(req.params.id));
  if (n) n.read = true;
  res.json({ success: true });
});

app.put('/api/notifications/read-all', auth, requireRole('admin', 'manager'), (req, res) => {
  notifications.forEach(n => n.read = true);
  res.json({ success: true });
});

// ── Start ─────────────────────────────────────────────────────────
app.listen(3001, () => {
  console.log('BackPin backend running on http://localhost:3001');
  console.log('Admin login: ryandb21@gmail.com / Admin1234!');
});
