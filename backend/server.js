const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const PORT = 3001;

const AUTH_SALT = 'noderoute-salt';
const USERS_FILE = path.join(__dirname, 'data/users.json');

// In-memory sessions: token -> { userId, role }
const sessions = {};

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + AUTH_SALT).digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function readUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function authenticateToken(req, res, next) {
  const auth = req.headers['authorization'];
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token || !sessions[token]) return res.status(401).json({ error: 'Unauthorized' });
  const session = sessions[token];
  const users = readUsers();
  const user = users.find(u => u.id === session.userId);
  if (!user || user.status !== 'active') return res.status(401).json({ error: 'Unauthorized' });
  req.user = user;
  req.token = token;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// --- Auth Routes (no token required) ---

app.post('/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const users = readUsers();
  const user = users.find(u => u.email === email && u.status === 'active');
  if (!user || user.passwordHash !== hashPassword(password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = generateToken();
  sessions[token] = { userId: user.id, role: user.role };
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

app.post('/auth/setup-password', (req, res) => {
  const { inviteToken, password } = req.body;
  if (!inviteToken || !password) return res.status(400).json({ error: 'inviteToken and password required' });
  const users = readUsers();
  const user = users.find(u => u.inviteToken === inviteToken);
  if (!user) return res.status(404).json({ error: 'Invalid invite token' });
  if (user.inviteExpires && new Date(user.inviteExpires) < new Date()) {
    return res.status(400).json({ error: 'Invite token expired' });
  }
  user.passwordHash = hashPassword(password);
  user.status = 'active';
  user.inviteToken = null;
  user.inviteExpires = null;
  writeUsers(users);
  const token = generateToken();
  sessions[token] = { userId: user.id, role: user.role };
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

app.get('/auth/me', authenticateToken, (req, res) => {
  const { id, name, email, role } = req.user;
  res.json({ id, name, email, role });
});

// --- User Management (protected) ---

app.get('/api/users', authenticateToken, requireRole('admin'), (req, res) => {
  const users = readUsers();
  res.json(users.map(({ passwordHash, ...u }) => u));
});

app.post('/api/drivers/invite', authenticateToken, requireRole('admin', 'manager'), (req, res) => {
  const { name, email } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'name and email required' });
  const users = readUsers();
  if (users.find(u => u.email === email)) return res.status(409).json({ error: 'Email already exists' });
  const inviteToken = generateToken();
  const newUser = {
    id: Date.now().toString(),
    name,
    email,
    passwordHash: null,
    role: 'driver',
    status: 'pending',
    inviteToken,
    inviteExpires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString()
  };
  users.push(newUser);
  writeUsers(users);
  const previewUrl = `http://localhost:${PORT}/setup-password?token=${inviteToken}`;
  console.log(`[INVITE] Email to ${email}: ${previewUrl}`);
  res.json({ message: 'Invite sent', previewUrl, userId: newUser.id });
});

app.delete('/api/users/:id', authenticateToken, requireRole('admin'), (req, res) => {
  const users = readUsers();
  const idx = users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  users.splice(idx, 1);
  writeUsers(users);
  res.json({ message: 'User deleted' });
});

// --- Static files (unauthenticated pages) ---

const frontendDir = path.join(__dirname, '../frontend');
app.use(express.static(frontendDir));
app.get('/', (req, res) => res.sendFile(path.join(frontendDir, 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(frontendDir, 'login.html')));
app.get('/setup-password', (req, res) => res.sendFile(path.join(frontendDir, 'setup-password.html')));

// --- Mock data ---

const today = new Date();
const d = (h, m) => { const dt = new Date(today); dt.setHours(h, m, 0, 0); return dt.toISOString(); };

const deliveries = [
  { id: 1, orderId: 'NR-1001', restaurantName: 'Husk', driverName: 'Marcus Johnson', status: 'delivered', startTime: d(7,15), endTime: d(7,48), expectedWindowStart: d(7,30), expectedWindowEnd: d(8,0), distanceMiles: 3.2, stopDurationMinutes: 12, speedMph: 24, address: '76 Queen St, Charleston, SC', deliveryDoor: 'back dock', items: ['2x Bluefin Tuna (5lb)', '1x Oysters (100ct)', '3x Gulf Shrimp (2lb)'], onTime: true },
  { id: 2, orderId: 'NR-1002', restaurantName: 'FIG', driverName: 'Sarah Chen', status: 'delivered', startTime: d(7,45), endTime: d(8,22), expectedWindowStart: d(8,0), expectedWindowEnd: d(8,30), distanceMiles: 2.8, stopDurationMinutes: 15, speedMph: 22, address: '232 Meeting St, Charleston, SC', deliveryDoor: 'front entrance', items: ['4x Grouper Fillet (3lb)', '2x Scallops (1lb)', '1x Lobster (2ct)'], onTime: true },
  { id: 3, orderId: 'NR-1003', restaurantName: 'The Ordinary', driverName: 'Marcus Johnson', status: 'delivered', startTime: d(8,30), endTime: d(9,5), expectedWindowStart: d(8,45), expectedWindowEnd: d(9,15), distanceMiles: 4.1, stopDurationMinutes: 18, speedMph: 21, address: '544 King St, Charleston, SC', deliveryDoor: 'loading dock', items: ['10x East Coast Oysters (100ct)', '5x Littleneck Clams (50ct)', '2x Dungeness Crab (3lb)'], onTime: true },
  { id: 4, orderId: 'NR-1004', restaurantName: "Hall's Chophouse", driverName: 'James Rivera', status: 'delivered', startTime: d(8,0), endTime: d(8,44), expectedWindowStart: d(8,15), expectedWindowEnd: d(8,45), distanceMiles: 5.6, stopDurationMinutes: 20, speedMph: 26, address: '434 King St, Charleston, SC', deliveryDoor: 'back dock', items: ['3x Swordfish Steak (2lb)', '2x Mahi-Mahi (4lb)', '1x Jumbo Lump Crabmeat (5lb)'], onTime: true },
  { id: 5, orderId: 'NR-1005', restaurantName: '167 Raw', driverName: 'Priya Patel', status: 'in-transit', startTime: d(9,0), endTime: null, expectedWindowStart: d(9,15), expectedWindowEnd: d(9,45), distanceMiles: 3.9, stopDurationMinutes: null, speedMph: 23, address: '289 E Bay St, Charleston, SC', deliveryDoor: 'front entrance', items: ['6x Oysters Assorted (100ct)', '3x Shrimp Cocktail Pack (2lb)', '2x Snow Crab Legs (3lb)'], onTime: true },
  { id: 6, orderId: 'NR-1006', restaurantName: "Edmund's Oast", driverName: 'Sarah Chen', status: 'in-transit', startTime: d(9,20), endTime: null, expectedWindowStart: d(9,30), expectedWindowEnd: d(10,0), distanceMiles: 2.5, stopDurationMinutes: null, speedMph: 19, address: '1081 Morrison Dr, Charleston, SC', deliveryDoor: 'loading dock', items: ['4x Flounder (3lb)', '2x Redfish (4lb)', '1x Soft Shell Crab (6ct)'], onTime: true },
  { id: 7, orderId: 'NR-1007', restaurantName: 'Zero Restaurant', driverName: 'James Rivera', status: 'failed', startTime: d(8,50), endTime: d(9,30), expectedWindowStart: d(9,0), expectedWindowEnd: d(9,30), distanceMiles: 6.2, stopDurationMinutes: 5, speedMph: 18, address: '140 Ester Lee Dr, Charleston, SC', deliveryDoor: 'back dock', items: ['2x Black Sea Bass (3lb)', '1x Red Snapper (5lb)'], onTime: false },
  { id: 8, orderId: 'NR-1008', restaurantName: 'The Darling Oyster Bar', driverName: 'Priya Patel', status: 'delivered', startTime: d(7,30), endTime: d(8,10), expectedWindowStart: d(7,45), expectedWindowEnd: d(8,15), distanceMiles: 3.7, stopDurationMinutes: 14, speedMph: 25, address: '513 King St, Charleston, SC', deliveryDoor: 'front entrance', items: ['8x Oysters Premium (100ct)', '4x Cherrystone Clams (50ct)', '2x Manilla Clams (50ct)'], onTime: true },
  { id: 9, orderId: 'NR-1009', restaurantName: 'Maison', driverName: 'Marcus Johnson', status: 'pending', startTime: null, endTime: null, expectedWindowStart: d(10,0), expectedWindowEnd: d(10,30), distanceMiles: 4.8, stopDurationMinutes: null, speedMph: null, address: '691 King St, Charleston, SC', deliveryDoor: 'back dock', items: ['3x Whole Branzino (2lb)', '2x Dover Sole (1lb)', '1x Halibut (6lb)'], onTime: null },
  { id: 10, orderId: 'NR-1010', restaurantName: 'Delaney Oyster House', driverName: 'Sarah Chen', status: 'pending', startTime: null, endTime: null, expectedWindowStart: d(10,15), expectedWindowEnd: d(10,45), distanceMiles: 5.1, stopDurationMinutes: null, speedMph: null, address: '115 Calhoun St, Charleston, SC', deliveryDoor: 'loading dock', items: ['12x Oysters Local (100ct)', '5x Blue Crab (6ct)', '2x Spiny Lobster (2ct)'], onTime: null },
  { id: 11, orderId: 'NR-1011', restaurantName: 'Husk', driverName: 'James Rivera', status: 'delivered', startTime: d(6,45), endTime: d(7,20), expectedWindowStart: d(7,0), expectedWindowEnd: d(7,30), distanceMiles: 3.2, stopDurationMinutes: 11, speedMph: 27, address: '76 Queen St, Charleston, SC', deliveryDoor: 'back dock', items: ['1x Swordfish Loin (4lb)', '2x Tuna Steak (2lb)'], onTime: true },
  { id: 12, orderId: 'NR-1012', restaurantName: 'FIG', driverName: 'Priya Patel', status: 'in-transit', startTime: d(9,45), endTime: null, expectedWindowStart: d(9,45), expectedWindowEnd: d(10,15), distanceMiles: 2.8, stopDurationMinutes: null, speedMph: 20, address: '232 Meeting St, Charleston, SC', deliveryDoor: 'front entrance', items: ['3x Sea Scallops (1lb)', '4x Gulf Shrimp (2lb)', '1x King Crab Legs (3lb)'], onTime: false },
];

const drivers = [
  { name: 'Marcus Johnson', phone: '(843) 555-0101', status: 'on-duty', vehicleId: 'NR-VAN-01', totalStopsToday: 4, avgStopMinutes: 13.7, avgSpeedMph: 23.7, onTimeRate: 100, milesToday: 15.3 },
  { name: 'Sarah Chen', phone: '(843) 555-0102', status: 'on-duty', vehicleId: 'NR-VAN-02', totalStopsToday: 3, avgStopMinutes: 15.0, avgSpeedMph: 20.3, onTimeRate: 100, milesToday: 10.4 },
  { name: 'James Rivera', phone: '(843) 555-0103', status: 'on-duty', vehicleId: 'NR-VAN-03', totalStopsToday: 3, avgStopMinutes: 12.0, avgSpeedMph: 23.7, onTimeRate: 66.7, milesToday: 15.0 },
  { name: 'Priya Patel', phone: '(843) 555-0104', status: 'on-duty', vehicleId: 'NR-VAN-04', totalStopsToday: 3, avgStopMinutes: 14.0, avgSpeedMph: 22.7, onTimeRate: 75.0, milesToday: 10.4 },
];

// --- Protected API Routes ---

app.get('/api/stats', authenticateToken, (req, res) => {
  const total = deliveries.length;
  const delivered = deliveries.filter(d => d.status === 'delivered').length;
  const failed = deliveries.filter(d => d.status === 'failed').length;
  const inTransit = deliveries.filter(d => d.status === 'in-transit').length;
  const onTimeDelivered = deliveries.filter(d => d.status === 'delivered' && d.onTime).length;
  const onTimeRate = delivered > 0 ? Math.round((onTimeDelivered / delivered) * 100) : 0;
  const activeDrivers = drivers.filter(d => d.status === 'on-duty').length;
  res.json({
    totalDeliveries: total, delivered, inTransit,
    pending: deliveries.filter(d => d.status === 'pending').length,
    failed, onTimeRate, activeDrivers, totalDrivers: drivers.length,
    yesterday: { totalDeliveries: 11, onTimeRate: 82, activeDrivers: 3, failed: 2 }
  });
});

app.get('/api/deliveries', authenticateToken, (req, res) => res.json(deliveries));
app.get('/api/drivers', authenticateToken, (req, res) => res.json(drivers));

app.get('/api/analytics', authenticateToken, (req, res) => {
  const completed = deliveries.filter(d => d.status === 'delivered');
  const avgStopTime = completed.reduce((s, d) => s + d.stopDurationMinutes, 0) / completed.length;
  const withSpeed = deliveries.filter(d => d.speedMph);
  const avgSpeed = withSpeed.reduce((s, d) => s + d.speedMph, 0) / withSpeed.length;
  const onTimeRate = Math.round((completed.filter(d => d.onTime).length / completed.length) * 100);

  const deliveriesByHour = Array(24).fill(0);
  deliveries.forEach(d => {
    const t = d.endTime || d.startTime;
    if (t) deliveriesByHour[new Date(t).getHours()]++;
  });

  const weeklyTrend = [8, 11, 9, 13, 10, 12, deliveries.length];

  const driverRankings = drivers.map(d => ({
    name: d.name, stopsPerHour: parseFloat((d.totalStopsToday / 3).toFixed(1)),
    avgStopMinutes: d.avgStopMinutes, avgSpeedMph: d.avgSpeedMph,
    onTimeRate: d.onTimeRate, milesToday: d.milesToday
  })).sort((a, b) => b.onTimeRate - a.onTimeRate);

  const doorBreakdown = {};
  deliveries.forEach(d => { doorBreakdown[d.deliveryDoor] = (doorBreakdown[d.deliveryDoor] || 0) + 1; });

  res.json({
    avgStopTime: parseFloat(avgStopTime.toFixed(1)),
    avgSpeed: parseFloat(avgSpeed.toFixed(1)),
    onTimeRate, deliveriesByHour, weeklyTrend, driverRankings, doorBreakdown
  });
});

app.listen(PORT, () => console.log(`NodeRoute API running on http://localhost:${PORT}`));
