require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const Sentry = require('@sentry/node');

const dsn = String(process.env.SENTRY_DSN || '').trim();
if (dsn) {
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
  });
}

module.exports = Sentry;
