require('./instrument.js');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const Sentry = require('@sentry/node');
const logger = require('./services/logger');
const config = require('./lib/config');
config.validate(logger);
const express = require('express');
const pinoHttp = require('pino-http');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { supabase } = require('./services/supabase');
const { globalLimiter, authLimiter, aiLimiter } = require('./middleware/rateLimiter');

// Route modules
const authRouter          = require('./routes/auth');
const usersRouter         = require('./routes/users');
const ordersRouter        = require('./routes/orders');
const invoicesRouter      = require('./routes/invoices');
const inventoryRouter     = require('./routes/inventory');
const deliveriesRouter    = require('./routes/deliveries');
const stopsRouter         = require('./routes/stops');
const routesRouter        = require('./routes/routes');
const customersRouter     = require('./routes/customers');
const forecastRouter      = require('./routes/forecast');
const aiRouter            = require('./routes/ai');
const portalRouter        = require('./routes/portal');
const driverRouter        = require('./routes/driver');
const driversRouter       = require('./routes/drivers');
const vendorsRouter       = require('./routes/vendors');
const purchaseOrdersRouter= require('./routes/purchase-orders');
const trackingRouter      = require('./routes/tracking');
const settingsRouter      = require('./routes/settings');
const temperatureLogsRouter = require('./routes/temperature-logs');
const opsRouter           = require('./routes/ops');
const reportingRouter     = require('./routes/reporting').router;
const lotsRouter          = require('./routes/lots');
const integrationsRouter  = require('./routes/integrations');
const warehouseRouter     = require('./routes/warehouse');
const superadminRouter    = require('./routes/superadmin');
const waitlistRouter      = require('./routes/waitlist');
const { stripeWebhookHandler } = require('./routes/stripe-webhooks');

const app = express();
const PORT = config.PORT;

app.set('trust proxy', 1);

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

// Global rate limiter
app.use(globalLimiter);

// CORS
app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  const allowedOrigins = config.CORS_ORIGINS;

  if (allowedOrigins.length > 0) {
    if (allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,sentry-trace,baggage');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const frontendV2DistDir = path.join(__dirname, '../frontend-v2/dist');
const landingV2DistDir  = path.join(__dirname, '../landing-v2/dist');
const frontendV2Entry   = path.join(frontendV2DistDir, 'index.html');
const landingV2Entry    = path.join(landingV2DistDir, 'index.html');

function requireBuildArtifact(buildName, entryPath, buildCommand) {
  if (!fs.existsSync(entryPath)) {
    throw new Error(
      `${buildName} build artifact is required before starting the server. ` +
      `Expected ${path.relative(path.join(__dirname, '..'), entryPath)}. ` +
      `Run \`${buildCommand}\`.`
    );
  }
}

requireBuildArtifact('frontend-v2', frontendV2Entry, 'npm --prefix frontend-v2 run build');
requireBuildArtifact('landing-v2',  landingV2Entry,  'npm --prefix landing-v2 run build');

app.use('/dashboard-v2', express.static(frontendV2DistDir, { index: false }));
app.use(express.static(landingV2DistDir, { index: false }));

const ADMIN_EMAIL    = config.ADMIN_EMAIL;
const ADMIN_PASSWORD = config.ADMIN_PASSWORD;

function extractRows(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.data)) return result.data;
  return [];
}

// Auto-create admin on first run if no users exist
async function ensureAdminExists() {
  const result = await supabase.from('users').select('*');
  const users = extractRows(result);
  const error = result?.error || null;
  if (error) { logger.error({ err: error }, 'Could not check users table'); return; }
  if (users.length === 0) {
    const passwordHash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
    const insertResult = await supabase.from('users').insert([{
      id:             'admin-001',
      name:           'Admin',
      email:          ADMIN_EMAIL,
      password_hash:  passwordHash,
      role:           'admin',
      status:         'active',
      invite_token:   null,
      invite_expires: null,
      created_at:     new Date().toISOString(),
    }]);
    const insertErr = insertResult?.error || null;
    if (insertErr) logger.error({ err: insertErr }, 'Failed to create admin user');
    else logger.info({ email: ADMIN_EMAIL }, 'Admin user created');
  }
}

ensureAdminExists().catch(err => logger.error({ err }, 'ensureAdminExists failed'));

// Mount routers
app.use('/auth', authLimiter, authRouter);
app.use('/api/users', usersRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api', deliveriesRouter);
app.use('/api/stops', stopsRouter);
app.use('/api/routes', routesRouter);
app.use('/api/customers', customersRouter);
app.use('/api/forecast', forecastRouter);
app.use('/api/ai', aiLimiter, aiRouter);
app.use('/api/portal', portalRouter);
app.use('/api/driver', driverRouter);
app.use('/api/drivers', driversRouter);
app.use('/api/vendors', vendorsRouter);
app.use('/api/purchase-orders', purchaseOrdersRouter);
app.use('/api/track', trackingRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/temperature-logs', temperatureLogsRouter);
app.use('/api/ops', opsRouter);
app.use('/api/reporting', reportingRouter);
app.use('/api/lots', lotsRouter);
app.use('/api/integrations', integrationsRouter);
app.use('/api/warehouse', warehouseRouter);
app.use('/api/superadmin', superadminRouter);
app.use('/api/waitlist', waitlistRouter);

const { authenticateToken, requireRole } = require('./middleware/auth');
app.get('/api/config/maps-key', authenticateToken, (req, res) => {
  res.json({ key: config.GOOGLE_MAPS_KEY });
});

app.get('/healthz', (req, res) => {
  res.json({ ok: true });
});

if (config.NODE_ENV !== 'production') {
  app.get('/debug-sentry', function mainHandler(_req, _res) {
    throw new Error('My first Sentry error!');
  });
}

// Dwell records
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

// Legacy alias
app.post('/api/drivers/invite', authenticateToken, requireRole('admin', 'manager'), (req, res, next) => {
  req.body.role = req.body.role || 'driver'; next();
}, (req, res) => res.redirect(307, '/api/users/invite'));

// ── PAGES ─────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(landingV2Entry));
app.get('/login', (req, res) => res.sendFile(frontendV2Entry));
app.get('/dashboard', (req, res) => res.redirect('/dashboard-v2'));
app.get('/dashboard-v2', (req, res) => res.sendFile(frontendV2Entry));
app.get(/^\/dashboard-v2\/.*/, (req, res) => res.sendFile(frontendV2Entry));

const frontendV2Routes = [
  '/orders', '/deliveries', '/map', '/drivers', '/routes', '/stops',
  '/customers', '/users', '/invoices', '/analytics', '/inventory',
  '/forecast', '/financials', '/purchasing', '/vendors', '/warehouse',
  '/planning', '/integrations', '/aihelp', '/settings', '/reports',
  '/admin/traceability',
  '/superadmin/companies',
  '/superadmin/waitlist',
];
app.get(frontendV2Routes, (req, res) => res.sendFile(frontendV2Entry));

app.get('/landing',          (req, res) => res.sendFile(landingV2Entry));
app.get('/driver',           (req, res) => res.sendFile(frontendV2Entry));
app.get('/portal',           (req, res) => res.sendFile(frontendV2Entry));
app.get('/customer-portal',  (req, res) => res.sendFile(frontendV2Entry));
app.get('/track',            (req, res) => res.sendFile(frontendV2Entry));
app.get('/track/:token',     (req, res) => res.redirect(`/track?t=${encodeURIComponent(req.params.token)}`));
app.get('/setup-password',   (req, res) => res.sendFile(frontendV2Entry));

// 404 for unknown API routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: `API route not found: ${req.method} ${req.path}` });
});

Sentry.setupExpressErrorHandler(app);

// Global error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.error({ err, method: req.method, url: req.url }, 'Unhandled server error');
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    sentry: res.sentry || undefined,
  });
});

app.listen(PORT, '0.0.0.0', () => {
  logger.info({ port: PORT, pid: process.pid, env: config.NODE_ENV }, 'Server listening');
});
