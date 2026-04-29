require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const logger = require('./services/logger');
const config = require('./lib/config');
config.validate(logger);

const express = require('express');
const pinoHttp = require('pino-http');
const fs = require('fs');
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
const opsRouter = require('./routes/ops');
const reportingRouter = require('./routes/reporting').router;
const lotsRouter = require('./routes/lots');
const { stripeWebhookHandler } = require('./routes/stripe-webhooks');

const app = express();
const PORT = config.PORT;

app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhookHandler);
app.use(express.json({ limit: config.JSON_BODY_LIMIT }));
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

// Structured request logging — skips health checks to avoid log noise
app.use(pinoHttp({
  logger,
  autoLogging: { ignore: (req) => req.url === '/healthz' },
  customLogLevel: (_req, res) => res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
  serializers: {
    req(req) { return { method: req.method, url: req.url, id: req.id }; },
    res(res) { return { statusCode: res.statusCode }; },
  },
}));

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const frontendDir = path.join(__dirname, '../frontend');
const frontendV2DistDir = path.join(__dirname, '../frontend-v2/dist');
const landingV2DistDir = path.join(__dirname, '../landing-v2/dist');
const hasFrontendV2Build = fs.existsSync(path.join(frontendV2DistDir, 'index.html'));
const hasLandingV2Build = fs.existsSync(path.join(landingV2DistDir, 'index.html'));
const featureUiV2Setting = String(process.env.FEATURE_UI_V2_DEFAULT || '').trim();
const featureUiV2Default = hasFrontendV2Build && !/^(0|false|no)$/i.test(featureUiV2Setting);
app.use(express.static(frontendDir, { index: false }));
if (hasFrontendV2Build) {
  app.use('/dashboard-v2', express.static(frontendV2DistDir, { index: false }));
} else {
  logger.info('frontend-v2 build not found — run `npm --prefix frontend-v2 run build` to enable /dashboard-v2');
}
if (hasLandingV2Build) {
  app.use(express.static(landingV2DistDir, { index: false }));
} else {
  logger.info('landing-v2 build not found — run `npm --prefix landing-v2 run build` to serve the new landing page');
}

const ADMIN_EMAIL = config.ADMIN_EMAIL;
const ADMIN_PASSWORD = config.ADMIN_PASSWORD;

function extractRows(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.data)) return result.data;
  return [];
}

// Auto-create admin on first run if no users exist in Supabase
async function ensureAdminExists() {
  const result = await supabase.from('users').select('*');
  const users = extractRows(result);
  const error = result?.error || null;
  if (error) { logger.error({ err: error }, 'Could not check users table'); return; }
  if (users.length === 0) {
    const passwordHash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
    const insertResult = await supabase.from('users').insert([{
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
    const insertErr = insertResult?.error || null;
    if (insertErr) logger.error({ err: insertErr }, 'Failed to create admin user');
    else logger.info({ email: ADMIN_EMAIL }, 'Admin user created');
  }
}

ensureAdminExists().catch(err => logger.error({ err }, 'ensureAdminExists failed'));

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
app.use('/api/ops', opsRouter);
app.use('/api/reporting', reportingRouter);
app.use('/api/lots', lotsRouter);
// traceability/report lives under /api/lots prefix as /api/lots/traceability/report

const { authenticateToken, requireRole } = require('./middleware/auth');
app.get('/api/config/maps-key', authenticateToken, (req, res) => {
  res.json({ key: config.GOOGLE_MAPS_KEY });
});

app.get('/healthz', (req, res) => {
  res.json({ ok: true });
});

// Dwell records (top-level path, reads from Supabase)
app.get('/api/dwell', authenticateToken, async (req, res) => {
  try {
    let query = supabase.from('dwell_records').select('*');
    if (req.user.role === 'driver') query = query.eq('driver_id', req.user.id);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Legacy alias: /api/drivers/invite → /api/users/invite
app.post('/api/drivers/invite', authenticateToken, requireRole('admin', 'manager'), (req, res, next) => {
  req.body.role = req.body.role || 'driver'; next();
}, (req, res) => res.redirect(307, '/api/users/invite'));

// ── PAGES ─────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  if (hasLandingV2Build) return res.sendFile(path.join(landingV2DistDir, 'index.html'));
  return res.sendFile(path.join(frontendDir, 'landing.html'));
});
app.get('/login', (req, res) => {
  if (hasFrontendV2Build) {
    return res.sendFile(path.join(frontendV2DistDir, 'index.html'));
  }
  return res.sendFile(path.join(frontendDir, 'login.html'));
});
app.get('/dashboard', (req, res) => {
  const requestedUi = String(req.query.ui || '').toLowerCase();
  const v2Requested = requestedUi === 'v2' || requestedUi === 'new';
  const legacyRequested = requestedUi === 'legacy' || requestedUi === 'old';
  if (hasFrontendV2Build && !legacyRequested && (featureUiV2Default || v2Requested)) {
    return res.redirect('/dashboard-v2');
  }
  return res.sendFile(path.join(frontendDir, 'index.html'));
});
app.get('/dashboard-legacy', (req, res) => res.sendFile(path.join(frontendDir, 'index.html')));
app.get('/dashboard-v2', (req, res) => {
  if (!hasFrontendV2Build) {
    return res.status(503).json({ error: 'Dashboard v2 is not built yet. Run `npm --prefix frontend-v2 run build`.' });
  }
  return res.sendFile(path.join(frontendV2DistDir, 'index.html'));
});
app.get(/^\/dashboard-v2\/.*/, (req, res) => {
  if (!hasFrontendV2Build) {
    return res.status(503).json({ error: 'Dashboard v2 is not built yet. Run `npm --prefix frontend-v2 run build`.' });
  }
  return res.sendFile(path.join(frontendV2DistDir, 'index.html'));
});
const frontendV2Routes = [
  '/orders',
  '/deliveries',
  '/map',
  '/drivers',
  '/routes',
  '/stops',
  '/customers',
  '/users',
  '/invoices',
  '/analytics',
  '/inventory',
  '/forecast',
  '/financials',
  '/purchasing',
  '/vendors',
  '/warehouse',
  '/planning',
  '/integrations',
  '/aihelp',
  '/settings',
  '/admin/traceability',
];
app.get(frontendV2Routes, (req, res) => {
  if (!hasFrontendV2Build) {
    return res.status(503).json({ error: 'Dashboard v2 is not built yet. Run `npm --prefix frontend-v2 run build`.' });
  }
  return res.sendFile(path.join(frontendV2DistDir, 'index.html'));
});
app.get('/landing', (req, res) => {
  if (hasLandingV2Build) return res.sendFile(path.join(landingV2DistDir, 'index.html'));
  return res.sendFile(path.join(frontendDir, 'landing.html'));
});
app.get('/driver', (req, res) => {
  if (hasFrontendV2Build) {
    return res.sendFile(path.join(frontendV2DistDir, 'index.html'));
  }
  return res.sendFile(path.join(frontendDir, 'driver.html'));
});
app.get('/portal', (req, res) => {
  if (hasFrontendV2Build) {
    return res.sendFile(path.join(frontendV2DistDir, 'index.html'));
  }
  return res.sendFile(path.join(frontendDir, 'customer-portal.html'));
});
app.get('/customer-portal', (req, res) => {
  if (hasFrontendV2Build) {
    return res.sendFile(path.join(frontendV2DistDir, 'index.html'));
  }
  return res.sendFile(path.join(frontendDir, 'customer-portal.html'));
});
app.get('/track', (req, res) => {
  if (hasFrontendV2Build) return res.sendFile(path.join(frontendV2DistDir, 'index.html'));
  return res.sendFile(path.join(frontendDir, 'track.html'));
});
app.get('/track/:token', (req, res) => res.redirect(`/track?t=${encodeURIComponent(req.params.token)}`));
app.get('/setup-password', (req, res) => {
  if (hasFrontendV2Build) return res.sendFile(path.join(frontendV2DistDir, 'index.html'));
  return res.sendFile(path.join(frontendDir, 'setup-password.html'));
});

// ── 404 for unknown API routes (must be before the global error handler) ──────
app.use('/api', (req, res) => {
  res.status(404).json({ error: `API route not found: ${req.method} ${req.path}` });
});

// ── Global error handler ───────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.error({ err, method: req.method, url: req.url }, 'Unhandled server error');
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
  logger.info({ port: PORT, pid: process.pid, env: config.NODE_ENV }, 'Server listening');
});
