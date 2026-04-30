const Sentry = require('@sentry/node');

Sentry.init({
  dsn: 'https://317cacbec786f35eb01791f520912ab3@o4511304951791616.ingest.us.sentry.io/4511304980299776',
  sendDefaultPii: true,
});

module.exports = Sentry;
