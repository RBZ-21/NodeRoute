'use strict';

const rateLimit = require('express-rate-limit');

const isTest = (process.env.NODE_ENV || '').toLowerCase() === 'test';

// Default message shape keeps it consistent with the rest of the API.
function jsonMessage(message) {
  return (_req, res) => res.status(429).json({ error: message });
}

// 1000 requests per 15 minutes per IP — raised from 200 to support high-volume
// order entry (approx. 100 orders/day, heavy traffic 5am-7am).
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => isTest,
  handler: jsonMessage('Too many requests. Please slow down and try again shortly.'),
});

// 20 requests per 15 minutes — shared fallback for /auth routes not covered below.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => isTest,
  handler: jsonMessage('Too many authentication attempts. Please wait 15 minutes before trying again.'),
});

// 20 attempts per 15 minutes per IP — raised from 5 to prevent false triggers.
// skipSuccessfulRequests ensures legitimate logins don't count against the limit.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => isTest,
  handler: jsonMessage('Too many login attempts. Please wait 15 minutes before trying again.'),
});

// 10 attempts per hour per IP — invite setup is one-shot, be generous but bounded.
const setupPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => isTest,
  handler: jsonMessage('Too many setup attempts. Please wait an hour before trying again.'),
});

// 5 attempts per 15 minutes per IP — protect change-password from credential stuffing.
const changePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => isTest,
  handler: jsonMessage('Too many password change attempts. Please wait 15 minutes before trying again.'),
});

// 30 requests per 5 minutes — cost protection on OpenAI-backed routes.
const aiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => isTest,
  handler: jsonMessage('AI request limit reached. Please wait a few minutes before trying again.'),
});

module.exports = {
  globalLimiter,
  authLimiter,
  loginLimiter,
  setupPasswordLimiter,
  changePasswordLimiter,
  aiLimiter,
};
