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

ensureAdminExists();

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

app.listen(PORT, () => console.log(`NodeRoute API running on http://localhost:${PORT}`));
