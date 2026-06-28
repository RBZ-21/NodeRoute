'use strict';

function clientError(err, fallback = 'Internal server error') {
  if ((process.env.NODE_ENV || '').toLowerCase() === 'production') return fallback;
  return err?.message || fallback;
}

function sendSafeError(req, res, err, fallback = 'Internal server error', status = 500) {
  const statusCode = Number.isInteger(status) ? status : 500;
  if (req?.log?.error) {
    req.log.error({ err }, fallback);
  }
  return res.status(statusCode).json({ error: clientError(err, fallback) });
}

module.exports = { clientError, sendSafeError };
