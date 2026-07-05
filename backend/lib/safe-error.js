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

function apiError(message, { code, status = 400, details = null } = {}) {
  const payload = { error: message };
  if (code) payload.code = code;
  if (details) payload.details = details;
  return { status: Number.isInteger(status) ? status : 400, payload };
}

module.exports = { clientError, sendSafeError, apiError };
