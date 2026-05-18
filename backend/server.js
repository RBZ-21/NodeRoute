require('./instrument.js');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const Sentry = require('@sentry/node');
const logger = require('./services/logger');
const config = require('./lib/config');
config.validate(logger);
const express = require('express');
const cookieParser = require('cookie-parser');
const pinoHttp = require('pino-http');
const fs = require('fs');
const path = require('path');
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
const reorderRouter       = require('./routes/reorder');
const trackingRouter      = require('./routes/tracking');
const settingsRouter      = require('./routes/settings');
const temperatureLogsRouter = require('./routes/temperature-logs');
const opsRouter           = require('./routes/ops');
const reportingRouter     = require('./routes/reporting').router;
const lotsRouter          = require('./routes/lots');
const integrationsRouter  = require('./routes/integrations');
const warehouseRouter     = require('./routes/warehouse');
const catchWeightRouter   = require('./routes/catch-weight');
const superadminRouter    = require('./routes/superadmin');
const companyConfigRouter = require('./routes/company-config');
const onboardingRouter    = require('./routes/onboarding');
const waitlistRouter      = require('./routes/waitlist');
const dwellRouter         = require('./routes/dwell');
const salesRepsRouter     = require('./routes/sales-reps');
const arHubRouter         = require('./routes/ar-hub');
const creditHoldRouter    = require('./routes/credit-hold');
const vendorBillsRouter   = require('./routes/vendor-bills');
const complianceRouter    = require('./routes/compliance');
const { stripeWebhookHandler } = require('./routes/stripe-webhooks');

const helmet = require('helmet');

const app  = express();
const PORT = config.PORT;

app.set('trust proxy', 1);

app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhookHandler);
app.use(express.json({ limit: config.JSON_BODY_LIMIT }));
app.use(cookieParser());
app.disable('x-powered-by');

// Helmet supplies headers not covered by the custom security middleware below:
// dnsPrefetchControl, ieNoOpen, originAgentCluster, permittedCrossDomainPolicies,
// crossOriginEmbedderPolicy, crossOriginResourcePolicy.
// Headers already set explicitly below (CSP, HSTS, frameguard, noSniff,
// referrerPolicy, crossOriginOpenerPolicy) are disabled here to avoid conflicts.
app.use(helmet({
  contentSecurityPolicy:        false,
  crossOriginOpenerPolicy:      false,
  frameguard:                   false,
  hsts:                         false,
  noSniff:                      false,
  referrerPolicy:               false,
  hidePoweredBy:                false, // already done with app.disable('x-powered-by')
}));

// Warn at startup if body limit is unusually large (potential DoS risk).
(function warnBodyLimit() {
  const raw = String(config.JSON_BODY_LIMIT || '1mb').toLowerCase();
  const mb = raw.endsWith('mb') ? parseFloat(raw) : raw.endsWith('kb') ? parseFloat(raw) / 1024 : NaN;
  if (!isNaN(mb) && mb > 1) {
    logger.warn({ JSON_BODY_LIMIT: config.JSON_BODY_LIMIT }, 'JSON_BODY_LIMIT exceeds 1mb — verify this is intentional to avoid DoS risk');
  }
})();

// Attach a unique request ID to every request for log correlation.
const crypto = require('crypto');
app.use((req, res, next) => {
  req.id = crypto.randomUUID();
  res.setHeader('X-Request-ID', req.id);
  next();
});

// ── Security headers ─────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader(
    'Permissions-Policy',
    'camera=(self), microphone=(), geolocation=(self), payment=()'
  );
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://maps.googleapis.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      "connect-src 'self' https://*.supabase.co https://api.openai.com https://api.stripe.com https://api.resend.com https://maps.googleapis.com https://*.googleapis.com https://maps.gstatic.com https://*.gstatic.com wss://*.supabase.co",
      "frame-src https://js.stripe.com",
      "object-src 'none'",
      "base-uri 'self'",
    ].join('; ')
  );
  if (config.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }
  next();
});

app.use(pinoHttp({
  logger,
  autoLogging: { ignore: (req) => req.url === '/healthz' },
  customLogLevel: (_req, res) => res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
  serializers: {
    req(req) { return { method: req.method, url: req.url, id: req.id }; },
    res(res) { return { statusCode: res.statusCode }; },
  },
}));

app.use(globalLimiter);

// CORS
app.use((req, res, next) => {
  const origin         = req.headers.origin || '';
  const allowedOrigins = config.CORS_ORIGINS;
  if (allowedOrigins.length > 0 && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,sentry-trace,baggage');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const frontendV2DistDir = path.join(__dirname, '../frontend-v2/dist');
const landingV2DistDir  = path.join(__dirname, '../landing-v2/dist');
const driverAppDistDir  = path.join(__dirname, '../driver-app/dist');
const frontendV2Entry   = path.join(frontendV2DistDir, 'index.html');
const landingV2Entry    = path.join(landingV2DistDir, 'index.html');
const driverAppEntry    = path.join(driverAppDistDir, 'index.html');

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
requireBuildArtifact('driver-app',  driverAppEntry,   'npm --prefix driver-app run build');

app.use('/dashboard-v2', express.static(frontendV2DistDir, { index: false }));
app.use('/driver-app', express.static(driverAppDistDir, { index: false }));
app.use(express.static(landingV2DistDir, { index: false }));

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
app.use('/api/reorder', reorderRouter);
app.use('/api/track', trackingRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/temperature-logs', temperatureLogsRouter);
app.use('/api/ops', opsRouter);
app.use('/api/reporting', reportingRouter);
app.use('/api/lots', lotsRouter);
app.use('/api/integrations', integrationsRouter);
app.use('/api/warehouse', warehouseRouter);
app.use('/api/catch-weight', catchWeightRouter);
// restore-session must be reachable while holding an impersonation token
// (role=admin), so it runs with only authenticateToken — before the guarded router.
const { authenticateToken: _authenticateToken } = require('./middleware/auth');
app.post('/api/superadmin/restore-session', _authenticateToken, superadminRouter.restoreSessionHandler);

app.use('/api/superadmin', superadminRouter);
app.use('/api/company-config', companyConfigRouter);
app.use('/api/onboarding', onboardingRouter);
app.use('/api/waitlist', waitlistRouter);
app.use('/api/dwell', dwellRouter);
app.use('/api/sales-reps', salesRepsRouter);
app.use('/api/ar', arHubRouter);
app.use('/api/credit', creditHoldRouter);
app.use('/api/vendor-bills', vendorBillsRouter);
app.use('/api/compliance', complianceRouter);

const { authenticateToken, requireRole } = require('./middleware/auth');

app.get('/healthz', (req, res) => res.json({ ok: true }));

if (config.NODE_ENV !== 'production') {
  app.get('/debug-sentry', function mainHandler(_req, _res) {
    throw new Error('My first Sentry error!');
  });
}

app.post('/api/drivers/invite', authenticateToken, requireRole('admin', 'manager'), (req, res, next) => {
  req.body.role = req.body.role || 'driver'; next();
}, (req, res) => res.redirect(307, '/api/users/invite'));

// ── Pages ─────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(landingV2Entry));
app.get('/login', (req, res) => res.sendFile(frontendV2Entry));
app.get('/signup', (req, res) => res.sendFile(frontendV2Entry));
app.get('/dashboard', (req, res) => res.redirect('/dashboard-v2'));
app.get('/dashboard-v2', (req, res) => res.sendFile(frontendV2Entry));
app.get(/^\/dashboard-v2\/.*/, (req, res) => res.sendFile(frontendV2Entry));
app.get('/driver-app', (req, res) => res.sendFile(driverAppEntry));
app.get(/^\/driver-app\/.*/, (req, res) => res.sendFile(driverAppEntry));

const frontendV2Routes = [
  '/orders', '/deliveries', '/map', '/drivers', '/routes', '/stops',
  '/customers', '/users', '/invoices', '/analytics', '/inventory',
  '/forecast', '/financials', '/purchasing', '/reorder', '/vendors', '/warehouse',
  '/planning', '/integrations', '/aihelp', '/settings', '/reports',
  '/admin/traceability',
  '/superadmin/companies',
  '/superadmin/waitlist',
  '/sales-rep',
  '/ar-hub',
  '/ar',
  '/credit',
];
app.get(frontendV2Routes, (req, res) => res.sendFile(frontendV2Entry));

app.get('/landing',         (req, res) => res.sendFile(landingV2Entry));
app.get('/driver',          (req, res) => res.sendFile(frontendV2Entry));
app.get('/portal',          (req, res) => res.sendFile(frontendV2Entry));
app.get('/customer-portal', (req, res) => res.sendFile(frontendV2Entry));
app.get('/track',           (req, res) => res.sendFile(frontendV2Entry));
app.get('/track/:token',    (req, res) => res.redirect(`/track?t=${encodeURIComponent(req.params.token)}`));
app.get('/setup-password',  (req, res) => res.sendFile(frontendV2Entry));

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

Sentry.setupExpressErrorHandler(app);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.error({ err, method: req.method, url: req.url }, 'Unhandled server error');
  const message = config.NODE_ENV === 'production'
    ? 'Internal server error'
    : err.message;
  res.status(err.status || 500).json({
    error: message || 'Internal server error',
    sentry: res.sentry || undefined,
  });
});

const { startScheduler } = require('./lib/scheduler');

app.listen(PORT, '0.0.0.0', () => {
  logger.info({ port: PORT, pid: process.pid, env: config.NODE_ENV }, 'Server listening');
  startScheduler();
});
