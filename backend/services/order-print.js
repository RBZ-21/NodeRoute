/**
 * order-print.js
 * Impact printer integration for order tickets.
 *
 * Renders a plain-text print ticket and sends it to the configured
 * printer endpoint using PRINTER_URL env var (e.g. http://printserver:9100).
 *
 * If PRINTER_URL is not set the ticket is logged only (safe for dev/staging).
 */

const http  = require('http');
const https = require('https');

/**
 * Build a plain-text order ticket string.
 * @param {object} order  - the saved order record
 * @returns {string}
 */
function buildOrderTicket(order) {
  const line = '--------------------------------';
  const ts   = new Date().toLocaleString('en-US', {
    timeZone: process.env.TZ || 'America/New_York',
  });

  const itemLines = (order.items || []).map((it, i) => {
    const name   = it.name || it.description || `Item ${i + 1}`;
    const qty    = it.requested_qty || it.quantity || '';
    const wt     = it.requested_weight ? `${it.requested_weight} lbs` : '';
    const unit   = it.unit || '';
    const detail = [qty, wt, unit].filter(Boolean).join(' ');
    return `  ${name}${detail ? ' — ' + detail : ''}`;
  }).join('\n');

  return [
    line,
    `ORDER: ${order.order_number || order.id}`,
    `DATE:  ${ts}`,
    line,
    `CUSTOMER: ${order.customer_name || '—'}`,
    `ADDRESS:  ${order.customer_address || 'PICKUP'}`,
    line,
    'ITEMS:',
    itemLines || '  (none)',
    line,
    order.notes ? `NOTES: ${order.notes}` : '',
    line,
    '',   // trailing newline so printer advances paper
  ].filter(s => s !== null).join('\n');
}

/**
 * Send raw text to printer via HTTP POST.
 * Printer server must accept POST /print with Content-Type text/plain.
 */
function sendToPrinter(ticketText) {
  return new Promise((resolve, reject) => {
    const printerUrl = process.env.PRINTER_URL;
    if (!printerUrl) {
      // Dev / no-printer mode — just log
      console.log('[order-print] No PRINTER_URL set. Ticket:\n' + ticketText);
      return resolve({ printed: false, reason: 'PRINTER_URL not configured' });
    }

    let url;
    try {
      url = new URL(
        printerUrl.endsWith('/print')
          ? printerUrl
          : `${printerUrl.replace(/\/$/, '')}/print`
      );
    } catch (e) {
      return reject(new Error(`Invalid PRINTER_URL: ${printerUrl}`));
    }

    const body    = Buffer.from(ticketText, 'utf8');
    const lib     = url.protocol === 'https:' ? https : http;
    const options = {
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname,
      method:   'POST',
      headers:  {
        'Content-Type':   'text/plain; charset=utf-8',
        'Content-Length': body.length,
      },
      timeout: 5000,
    };

    const req = lib.request(options, (res) => {
      res.resume(); // drain response body
      if (res.statusCode >= 200 && res.statusCode < 300) {
        resolve({ printed: true, status: res.statusCode });
      } else {
        resolve({ printed: false, status: res.statusCode, reason: `Printer returned HTTP ${res.statusCode}` });
      }
    });

    req.on('timeout', () => { req.destroy(); reject(new Error('Printer request timed out')); });
    req.on('error',   (err) => reject(err));
    req.write(body);
    req.end();
  });
}

/**
 * Public API — call after a successful order insert.
 * Never throws; logs errors so a printer failure never blocks the API response.
 *
 * @param {object} order  - saved order record
 * @returns {Promise<{printed: boolean, reason?: string}>}
 */
async function printOrderTicket(order) {
  try {
    const ticket = buildOrderTicket(order);
    return await sendToPrinter(ticket);
  } catch (err) {
    console.error('[order-print] Failed to send print job:', err.message);
    return { printed: false, error: err.message };
  }
}

module.exports = { printOrderTicket, buildOrderTicket };
