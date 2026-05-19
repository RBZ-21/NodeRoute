'use strict';

function trackingBaseUrl(req) {
  const fallbackBase = req?.protocol && req?.get
    ? `${req.protocol}://${req.get('host')}`
    : 'http://localhost:3001';
  return (process.env.BASE_URL || fallbackBase).replace(/\/$/, '');
}

function buildTrackingUrl(req, token) {
  return `${trackingBaseUrl(req)}/track?t=${encodeURIComponent(token || '')}`;
}

function buildTrackingUrlFromBase(baseUrl, token) {
  const normalizedBase = String(baseUrl || '')
    .replace(/\/track\?t=.*$/, '')
    .replace(/\/$/, '');
  return `${normalizedBase}/track?t=${encodeURIComponent(token || '')}`;
}

module.exports = {
  trackingBaseUrl,
  buildTrackingUrl,
  buildTrackingUrlFromBase,
};
