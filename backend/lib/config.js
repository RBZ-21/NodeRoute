'use strict';

const { z } = require('zod');

const DEV_JWT_SECRET    = 'noderoute-dev-secret-change-in-production';
const DEV_PORTAL_SECRET = 'noderoute-portal-dev-secret-change-in-production';
const DEFAULT_ADMIN_PW  = 'Admin@123';

// Minimum password strength: 12+ chars, upper, lower, digit, special char.
const STRONG_PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{12,}$/;

function isWeakPassword(pw) {
  if (!pw) return true;
  if (pw === DEFAULT_ADMIN_PW) return true;
  if (pw === 'ChangeMe@123') return true;
  return !STRONG_PASSWORD_RE.test(pw);
}

const envSchema = z.object({
  NODE_ENV:                   z.string().optional().default('development'),
  PORT:                       z.preprocess(
    (v) => (v === undefined || v === null || v === '' ? 3001 : v),
    z.coerce.number().int().positive().catch(3001)
  ),
  JSON_BODY_LIMIT:            z.string().optional().default('1mb'),
  SUPABASE_URL:               z.string().optional().default(''),
  SUPABASE_SERVICE_KEY:       z.string().optional().default(''),
  JWT_SECRET:                 z.string().optional().default(DEV_JWT_SECRET),
  PORTAL_JWT_SECRET:          z.string().optional().default(DEV_PORTAL_SECRET),
  BASE_URL:                   z.string().optional().default(''),
  RESEND_API_KEY:             z.string().optional().default(''),
  SMTP_HOST:                  z.string().optional().default(''),
  SMTP_PORT:                  z.string().optional().default(''),
  SMTP_USER:                  z.string().optional().default(''),
  SMTP_PASS:                  z.string().optional().default(''),
  EMAIL_PROVIDER:             z.string().optional().default('auto'),
  OPENAI_API_KEY:             z.string().optional().default(''),
  ADMIN_EMAIL:                z.string().optional().default('admin@noderoutesystems.com'),
  ADMIN_PASSWORD:             z.string().optional().default(DEFAULT_ADMIN_PW),
  GOOGLE_MAPS_KEY:            z.string().optional().default(''),
  CORS_ORIGINS:               z.string().optional().default(''),
  CORS_ORIGIN:                z.string().optional().default(''),
  PORTAL_PAYMENT_ENABLED:     z.string().optional().default('false'),
  PORTAL_PAYMENT_PROVIDER:    z.string().optional().default('manual'),
  STRIPE_WEBHOOK_TOLERANCE_SECONDS: z.string().optional().default('300'),
  // SMS / Daily Fish Blast
  TWILIO_ACCOUNT_SID:         z.string().optional().default(''),
  TWILIO_AUTH_TOKEN:          z.string().optional().default(''),
  TWILIO_FROM_NUMBER:         z.string().optional().default(''),
  COMPANY_NAME:               z.string().optional().default(''),
  DAILY_BLAST_CRON:           z.string().optional().default('30 6 * * 1-6'),
}).passthrough();

const rawEnv       = envSchema.parse(process.env);
const isProduction = rawEnv.NODE_ENV.toLowerCase() === 'production';

const NODE_ENV        = rawEnv.NODE_ENV;
const PORT            = rawEnv.PORT;
const JSON_BODY_LIMIT = rawEnv.JSON_BODY_LIMIT;
const SUPABASE_URL    = rawEnv.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = rawEnv.SUPABASE_SERVICE_KEY;
const JWT_SECRET      = rawEnv.JWT_SECRET;
const PORTAL_JWT_SECRET = rawEnv.PORTAL_JWT_SECRET;
const BASE_URL        = rawEnv.BASE_URL;
const RESEND_API_KEY  = rawEnv.RESEND_API_KEY;
const hasResend       = !!RESEND_API_KEY;
const hasSmtp         = !!(rawEnv.SMTP_HOST && rawEnv.SMTP_PORT && rawEnv.SMTP_USER && rawEnv.SMTP_PASS);
const EMAIL_PROVIDER  = z.enum(['auto', 'resend', 'smtp']).catch('auto').parse(String(rawEnv.EMAIL_PROVIDER || 'auto').toLowerCase());
const OPENAI_API_KEY  = rawEnv.OPENAI_API_KEY;
const ADMIN_EMAIL     = rawEnv.ADMIN_EMAIL;
const ADMIN_PASSWORD  = rawEnv.ADMIN_PASSWORD;
const GOOGLE_MAPS_KEY = rawEnv.GOOGLE_MAPS_KEY;
const _corsRaw        = rawEnv.CORS_ORIGINS || rawEnv.CORS_ORIGIN || '';
const CORS_ORIGINS    = _corsRaw.split(',').map((s) => s.trim()).filter(Boolean);
const _rawPaymentEnabled = String(rawEnv.PORTAL_PAYMENT_ENABLED || 'false');
const PORTAL_PAYMENT_ENABLED = z.enum(['true','false']).catch('false').parse(_rawPaymentEnabled.toLowerCase()) === 'true';
const PORTAL_PAYMENT_PROVIDER = z.enum(['manual','stripe','stub']).catch('manual').parse(
  String(rawEnv.PORTAL_PAYMENT_PROVIDER || 'manual').toLowerCase()
);
const STRIPE_WEBHOOK_TOLERANCE_SECONDS = Math.max(
  1,
  z.coerce.number().int().positive().catch(300).parse(rawEnv.STRIPE_WEBHOOK_TOLERANCE_SECONDS)
);
const TWILIO_ACCOUNT_SID  = rawEnv.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN   = rawEnv.TWILIO_AUTH_TOKEN;
const TWILIO_FROM_NUMBER  = rawEnv.TWILIO_FROM_NUMBER;
const COMPANY_NAME        = rawEnv.COMPANY_NAME;
const DAILY_BLAST_CRON    = rawEnv.DAILY_BLAST_CRON;
const hasTwilio           = !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM_NUMBER);

function validate(logger) {
  const fatal  = [];
  const errors = [];
  const warns  = [];

  if (!SUPABASE_URL)         fatal.push('SUPABASE_URL is not set');
  if (!SUPABASE_SERVICE_KEY) fatal.push('SUPABASE_SERVICE_KEY is not set');

  if (isProduction) {
    if (!process.env.JWT_SECRET || JWT_SECRET === DEV_JWT_SECRET)
      fatal.push('JWT_SECRET must be set in production — the development fallback is not safe');

    if (!process.env.PORTAL_JWT_SECRET || PORTAL_JWT_SECRET === DEV_PORTAL_SECRET)
      fatal.push('PORTAL_JWT_SECRET must be set in production — the development fallback is not safe');

    if (!process.env.ADMIN_PASSWORD || isWeakPassword(ADMIN_PASSWORD))
      fatal.push(
        'ADMIN_PASSWORD is missing or too weak. Production requires a password that is at least ' +
        '12 characters and includes uppercase, lowercase, a digit, and a special character.'
      );

    if (!BASE_URL)
      errors.push('BASE_URL is not set — invite links and Stripe redirects will not work');
  } else {
    if (isWeakPassword(ADMIN_PASSWORD))
      warns.push(
        'ADMIN_PASSWORD is weak or is the default — set a strong password (12+ chars, mixed case, digit, special) before deploying to production'
      );
    if (!BASE_URL)
      warns.push('BASE_URL is not set — invite links will use http://localhost');
    if (PORTAL_JWT_SECRET === DEV_PORTAL_SECRET)
      warns.push('PORTAL_JWT_SECRET is the default — set it before deploying to production');
  }

  if (!hasResend && !hasSmtp)
    warns.push('No email provider configured — invite and portal emails will not be sent. Set RESEND_API_KEY or SMTP_* variables.');
  if (hasResend && hasSmtp && EMAIL_PROVIDER === 'auto')
    logger.info('Both Resend and SMTP are configured. EMAIL_PROVIDER=auto will try Resend first, then SMTP fallback.');

  const baseUrlResult = BASE_URL ? z.string().url().safeParse(BASE_URL) : { success: true };
  if (BASE_URL && !baseUrlResult.success) {
    const message = 'BASE_URL is not a valid absolute URL';
    if (isProduction) errors.push(message); else warns.push(message);
  }

  if (!OPENAI_API_KEY)
    warns.push('OPENAI_API_KEY not set — AI features will use fallbacks or be unavailable.');

  if (isProduction && CORS_ORIGINS.length === 0)
    warns.push('CORS_ORIGINS is not set — all browser cross-origin requests will be blocked in production.');

  if (process.env.PORTAL_PAYMENT_ENABLED &&
      !['true','false'].includes(_rawPaymentEnabled.toLowerCase()))
    warns.push(`PORTAL_PAYMENT_ENABLED="${_rawPaymentEnabled}" is not "true" or "false" — treated as disabled.`);

  if (process.env.PORTAL_PAYMENT_PROVIDER &&
      !['manual','stripe','stub'].includes(String(process.env.PORTAL_PAYMENT_PROVIDER).toLowerCase()))
    warns.push(`PORTAL_PAYMENT_PROVIDER="${process.env.PORTAL_PAYMENT_PROVIDER}" is not recognized — treated as "manual".`);

  if (process.env.EMAIL_PROVIDER &&
      !['auto','resend','smtp'].includes(String(process.env.EMAIL_PROVIDER).toLowerCase()))
    warns.push(`EMAIL_PROVIDER="${process.env.EMAIL_PROVIDER}" is not recognized — treated as "auto".`);

  if (!hasTwilio)
    warns.push('Twilio is not configured — daily fish blast SMS will not be sent. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER.');

  for (const msg of warns)  logger.warn(msg);
  for (const msg of errors) logger.error(msg);
  for (const msg of fatal)  logger.fatal(msg);

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
  PORTAL_JWT_SECRET,
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
  CORS_ORIGINS,
  STRIPE_WEBHOOK_TOLERANCE_SECONDS,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_FROM_NUMBER,
  COMPANY_NAME,
  DAILY_BLAST_CRON,
  hasTwilio,
};
