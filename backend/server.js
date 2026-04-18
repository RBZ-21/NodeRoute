require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const { supabase } = require('./services/supabase');

// Route modules
const authRouter = require('./routes/auth');
const usersRouter = require('./routes/users');
const ordersRouter = require('./routes/orders');
const invoicesRouter = require('./routes/invoices');
const inventoryRouter = require('./routes/inventory');
const deliveriesRouter = require('./routes/deliveries');
const stopsRouter = require('./routes/stops');
const { dwellRecords } = require('./routes/stops');
const routesRouter = require('./routes/routes');
const customersRouter = require('./routes/customers');
const forecastRouter = require('./routes/forecast');
const portalRouter = require('./routes/portal');
const driverRouter = require('./routes/driver');

const app = express();
const PORT = process.env.PORT || 3001;

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

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
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
app.use(express.static(frontendDir, { index: false }));

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@noderoute.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@123';

// Auto-create admin on first run if no users exist in Supabase
async function ensureAdminExists() {
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
      status: 'active',
      invite_token: null,
      invite_expires: null,
      created_at: new Date().toISOString()
    }]);
    if (insertErr) console.error('Failed to create admin user:', insertErr.message);
    else console.log('Admin user created:', ADMIN_EMAIL);
  }
}

ensureAdminExists().catch(err => console.error('ensureAdminExists failed:', err.message));

if (!process.env.BASE_URL) {
  console.warn('WARNING: BASE_URL is not set — invite links will use http://localhost and will NOT work in production. Set BASE_URL to your public domain (e.g. https://yourapp.railway.app).');
}
if (!process.env.RESEND_API_KEY) {
  console.warn('WARNING: RESEND_API_KEY is not set — emails will not be sent.');
}

// Mount routers
app.use('/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api', deliveriesRouter);
app.use('/api/stops', stopsRouter);
app.use('/api/routes', routesRouter);
app.use('/api/customers', customersRouter);
app.use('/api/forecast', forecastRouter);
app.use('/api/portal', portalRouter);
app.use('/api/driver', driverRouter);

// Config endpoint
const { authenticateToken, requireRole } = require('./middleware/auth');
app.get('/api/config/maps-key', authenticateToken, (req, res) => {
  res.json({ key: process.env.GOOGLE_MAPS_KEY || '' });
});

// Dwell records (top-level path, shares in-memory state with stops router)
app.get('/api/dwell', authenticateToken, (req, res) => res.json(dwellRecords));

// Legacy alias: /api/drivers/invite → /api/users/invite
app.post('/api/drivers/invite', authenticateToken, requireRole('admin', 'manager'), (req, res, next) => {
  req.body.role = req.body.role || 'driver'; next();
}, (req, res) => res.redirect(307, '/api/users/invite'));

// ── PAGES ─────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(frontendDir, 'login.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(frontendDir, 'index.html')));
app.get('/landing', (req, res) => res.sendFile(path.join(frontendDir, 'landing.html')));
app.get('/portal', (req, res) => res.sendFile(path.join(frontendDir, 'customer-portal.html')));
app.get('/driver', (req, res) => res.sendFile(path.join(frontendDir, 'driver.html')));

// ── 404 for unknown API routes (must be before the global error handler) ──────
app.use('/api', (req, res) => {
  res.status(404).json({ error: `API route not found: ${req.method} ${req.path}` });
});

// ── Global error handler — returns JSON instead of Express's default HTML ─────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err.message, err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => console.log(`NodeRoute API running on http://localhost:${PORT}`));
