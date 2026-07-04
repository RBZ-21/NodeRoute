'use strict';

const pino = require('pino');

const redactPaths = [
  'authorization',
  '*.authorization',
  'req.headers.authorization',
  'cookie',
  '*.cookie',
  'req.headers.cookie',
  'password',
  '*.password',
  'password_hash',
  '*.password_hash',
  'token',
  '*.token',
  'access_token',
  '*.access_token',
  'refresh_token',
  '*.refresh_token',
  'secret',
  '*.secret',
  'api_key',
  '*.api_key',
  'service_role_key',
  '*.service_role_key',
  'phone',
  '*.phone',
  'customer_phone',
  '*.customer_phone',
  'email',
  '*.email',
  'card',
  '*.card',
  'card_number',
  '*.card_number',
  'payment_method',
  '*.payment_method',
];

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { pid: process.pid },
  redact: {
    paths: redactPaths,
    censor: '[redacted]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
});

module.exports = logger;
