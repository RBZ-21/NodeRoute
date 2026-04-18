require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const cluster = require('cluster');
const os = require('os');

if (cluster.isPrimary) {
  const numCPUs = os.cpus().length;
  console.log(`Primary ${process.pid} starting ${numCPUs} workers`);
  for (let i = 0; i < numCPUs; i++) cluster.fork();
  cluster.on('exit', (worker, code, signal) => {
    console.warn(`Worker ${worker.process.pid} died (${signal || code}). Restarting…`);
    cluster.fork();
  });
} else {

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

// Only one worker seeds the admin to avoid race conditions
if (cluster.worker.id === 1) {
  ensureAdminExists().catch(err => console.error('ensureAdminExists failed:', err.message));
}

if (!process.env.BASE_URL) {
  console.warn('WARNING: BASE_URL is not set — invite links will use http://localhost and will NOT work in production. Set BASE_URL to your public domain (e.g. https://yourapp.railway.app).');
}
if (!process.env.RESEND_API_KEY) {
  console.warn('WARNING: RESEND_API_KEY is not set — emails will not be sent.');
}
if (!process.env.OPENAI_API_KEY) {
  console.warn('WARNING: OPENAI_API_KEY is not set — AI demand forecasting will not work.');
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
app.get('/driver', (req, res) => res.sendFile(path.join(frontendDir, 'driver.html')));
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

app.listen(PORT, () => console.log(`Worker ${process.pid} listening on http://localhost:${PORT}`));

} // end cluster worker block
