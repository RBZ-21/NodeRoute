'use strict';

// Validate and normalize all environment variables at startup.
// Call validate() in server.js after dotenv.config() — it logs issues
// via the provided logger and exits the process on fatal errors in production.

const isProduction = (process.env.NODE_ENV || '').toLowerCase() === 'production';

// ── Normalized values ────────────────────────────────────────────────────────

const NODE_ENV         = process.env.NODE_ENV || 'development';
const PORT             = Number(process.env.PORT) || 3001;
const JSON_BODY_LIMIT  = process.env.JSON_BODY_LIMIT || '1mb';

const SUPABASE_URL         = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

const JWT_SECRET = process.env.JWT_SECRET || 'noderoute-dev-secret-change-in-production';
const DEV_JWT_SECRET = 'noderoute-dev-secret-change-in-production';

const BASE_URL = process.env.BASE_URL || '';

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const hasResend = !!RESEND_API_KEY;
const hasSmtp   = !!(process.env.SMTP_HOST && process.env.SMTP_PORT &&
                     process.env.SMTP_USER && process.env.SMTP_PASS);
const EMAIL_PROVIDER = String(process.env.EMAIL_PROVIDER || 'auto').toLowerCase();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    || 'admin@noderoutesystems.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@123';

const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_KEY || '';

// Normalize boolean-like env var — catches "True", "TRUE", "1", "yes"
const _rawPaymentEnabled = String(process.env.PORTAL_PAYMENT_ENABLED || 'false');
const PORTAL_PAYMENT_ENABLED = _rawPaymentEnabled.toLowerCase() === 'true';
const PORTAL_PAYMENT_PROVIDER = String(process.env.PORTAL_PAYMENT_PROVIDER || 'manual').toLowerCase();

// ── Validation ───────────────────────────────────────────────────────────────

// validate(logger) logs all issues and exits in production on fatal errors.
function validate(logger) {
  const fatal  = [];
  const errors = [];
  const warns  = [];

  // Always required — nothing works without a database connection.
  if (!SUPABASE_URL)         fatal.push('SUPABASE_URL is not set');
  if (!SUPABASE_SERVICE_KEY) fatal.push('SUPABASE_SERVICE_KEY is not set');

  if (isProduction) {
    // Security: weak JWT secret in production exposes all sessions.
    if (!process.env.JWT_SECRET || JWT_SECRET === DEV_JWT_SECRET) {
      fatal.push('JWT_SECRET must be set in production — the development fallback is not safe');
    }
    if (ADMIN_PASSWORD === 'Admin@123') {
      errors.push('ADMIN_PASSWORD is still the default — set it before first production boot');
    }
    if (!BASE_URL) {
      errors.push('BASE_URL is not set — invite links and Stripe redirects will not work');
    }
  } else {
    if (!BASE_URL) {
      warns.push('BASE_URL is not set — invite links will use http://localhost');
    }
  }

  // Email
  if (!hasResend && !hasSmtp) {
    warns.push('No email provider configured — invite and portal emails will not be sent. Set RESEND_API_KEY or SMTP_* variables.');
  }
  if (hasResend && hasSmtp && EMAIL_PROVIDER === 'auto') {
    logger.info('Both Resend and SMTP are configured. EMAIL_PROVIDER=auto will try Resend first, then SMTP fallback.');
  }

  // AI
  if (!OPENAI_API_KEY) {
    warns.push('OPENAI_API_KEY not set — AI walkthroughs, PO scanning, inventory analysis, reorder drafting, and demand forecasting will use fallbacks or be unavailable.');
  }

  // Catch common PORTAL_PAYMENT_ENABLED formatting mistakes
  if (process.env.PORTAL_PAYMENT_ENABLED &&
      !['true', 'false'].includes(_rawPaymentEnabled.toLowerCase())) {
    warns.push(`PORTAL_PAYMENT_ENABLED="${_rawPaymentEnabled}" is not "true" or "false" — treated as disabled. Use lowercase "true" to enable.`);
  }

  for (const msg of warns)   logger.warn(msg);
  for (const msg of errors)  logger.error(msg);
  for (const msg of fatal)   logger.fatal(msg);

  if (fatal.length && isProduction) {
    logger.fatal('Fatal configuration errors in production — exiting.');
    process.exit(1);
  }
}

module.exports = {
  validate,
  NODE_ENV,
  PORT,
  JSON_BODY_LIMIT,
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  JWT_SECRET,
  BASE_URL,
  hasResend,
  hasSmtp,
  EMAIL_PROVIDER,
  OPENAI_API_KEY,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  GOOGLE_MAPS_KEY,
  PORTAL_PAYMENT_ENABLED,
  PORTAL_PAYMENT_PROVIDER,
};
