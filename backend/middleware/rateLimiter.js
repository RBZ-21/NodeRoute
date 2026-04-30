'use strict';

const rateLimit = require('express-rate-limit');

const isProduction = (process.env.NODE_ENV || '').toLowerCase() === 'production';

// Default message shape keeps it consistent with the rest of the API.
function jsonMessage(message) {
  return (_req, res) => res.status(429).json({ error: message });
}

// 200 requests per 15 minutes per IP — baseline protection for all routes.
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => !isProduction,
  handler: jsonMessage('Too many requests. Please slow down and try again shortly.'),
});

// 20 requests per 15 minutes — brute-force protection on login / auth routes.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => !isProduction,
  handler: jsonMessage('Too many authentication attempts. Please wait 15 minutes before trying again.'),
});

// 30 requests per 5 minutes — cost protection on OpenAI-backed routes.
const aiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => !isProduction,
  handler: jsonMessage('AI request limit reached. Please wait a few minutes before trying again.'),
});

module.exports = { globalLimiter, authLimiter, aiLimiter };
