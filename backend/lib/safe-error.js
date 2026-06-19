'use strict';

function clientError(err, fallback = 'Internal server error') {
  if ((process.env.NODE_ENV || '').toLowerCase() === 'production') return fallback;
  return err?.message || fallback;
}

module.exports = { clientError };
