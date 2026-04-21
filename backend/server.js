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
const aiRouter = require('./routes/ai');
const portalRouter = require('./routes/portal');
const driverRouter = require('./routes/driver');
const purchaseOrdersRouter = require('./routes/purchase-orders');
const trackingRouter = require('./routes/tracking');
const settingsRouter = require('./routes/settings');
const temperatureLogsRouter = require('./routes/temperature-logs');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '1mb' }));
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

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

ensureAdminExists().catch(err => console.error('ensureAdminExists failed:', err.message));

if (!process.env.BASE_URL) {
  console.warn('WARNING: BASE_URL is not set — invite links will use http://localhost and will NOT work in production. Set BASE_URL to your public domain (e.g. https://yourapp.railway.app).');
}
const hasResend = !!process.env.RESEND_API_KEY;
const hasSmtp = !!(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASS);
if (!hasResend && !hasSmtp) {
  console.warn('WARNING: No email provider is configured — invite emails will not be sent. Set RESEND_API_KEY or the SMTP_* variables.');
}
if (hasResend && hasSmtp && String(process.env.EMAIL_PROVIDER || 'auto').toLowerCase() === 'auto') {
  console.warn('INFO: Both Resend and SMTP are configured. EMAIL_PROVIDER=auto will try Resend first, then SMTP fallback.');
}
if (!process.env.OPENAI_API_KEY) {
  console.warn('WARNING: OPENAI_API_KEY is not set — AI walkthroughs, PO scanning, inventory analysis, reorder drafting, and demand forecasting will use fallbacks or be unavailable.');
}
if (process.env.NODE_ENV === 'production') {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'noderoute-dev-secret-change-in-production') {
    console.warn('SECURITY WARNING: Set JWT_SECRET in production. The development fallback secret is not safe.');
  }
  if (ADMIN_PASSWORD === 'Admin@123') {
    console.warn('SECURITY WARNING: Set ADMIN_PASSWORD in production before first boot.');
  }
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
app.use('/api/ai', aiRouter);
app.use('/api/portal', portalRouter);
app.use('/api/driver', driverRouter);
app.use('/api/purchase-orders', purchaseOrdersRouter);
app.use('/api/track', trackingRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/temperature-logs', temperatureLogsRouter);

// Config endpoint — maps key exposed publicly (restricted via Google domain policy)
const { authenticateToken, requireRole } = require('./middleware/auth');
app.get('/api/config/maps-key', (req, res) => {
  res.json({ key: process.env.GOOGLE_MAPS_KEY || '' });
});

app.get('/healthz', (req, res) => {
  res.json({ ok: true });
});

// Dwell records (top-level path, shares in-memory state with stops router)
app.get('/api/dwell', authenticateToken, (req, res) => {
  if (req.user.role === 'driver') {
    return res.json(dwellRecords.filter((record) => record.driverId === req.user.id));
  }
  res.json(dwellRecords);
});

// Legacy alias: /api/drivers/invite → /api/users/invite
app.post('/api/drivers/invite', authenticateToken, requireRole('admin', 'manager'), (req, res, next) => {
  req.body.role = req.body.role || 'driver'; next();
}, (req, res) => res.redirect(307, '/api/users/invite'));

// ── PAGES ─────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(frontendDir, 'landing.html')));
app.get('/login', (req, res) => res.sendFile(path.join(frontendDir, 'login.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(frontendDir, 'index.html')));
app.get('/driver', (req, res) => res.sendFile(path.join(frontendDir, 'driver.html')));
app.get('/landing', (req, res) => res.sendFile(path.join(frontendDir, 'landing.html')));
app.get('/portal', (req, res) => res.sendFile(path.join(frontendDir, 'customer-portal.html')));
app.get('/customer-portal', (req, res) => res.sendFile(path.join(frontendDir, 'customer-portal.html')));
app.get('/track', (req, res) => res.sendFile(path.join(frontendDir, 'track.html')));
app.get('/track/:token', (req, res) => res.redirect(`/track?t=${encodeURIComponent(req.params.token)}`));

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

app.listen(PORT, '0.0.0.0', () => console.log(`Server ${process.pid} listening on http://0.0.0.0:${PORT}`));
