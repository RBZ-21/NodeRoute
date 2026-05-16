'use strict';

/**
 * Thin Twilio SMS wrapper.
 * All callers should import { sendSms } from this module.
 * Returns { success: true, sid } or { success: false, error }.
 */

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const AUTH_TOKEN  = process.env.TWILIO_AUTH_TOKEN  || '';
const FROM_NUMBER = process.env.TWILIO_FROM_NUMBER || '';

const hasTwilio = !!(ACCOUNT_SID && AUTH_TOKEN && FROM_NUMBER);

/**
 * @param {string} to   - E.164 phone number, e.g. '+18435551234'
 * @param {string} body - SMS body text
 */
async function sendSms(to, body) {
  if (!hasTwilio) {
    console.warn('[sms] Twilio is not configured — skipping SMS to', to);
    return { success: false, error: 'Twilio not configured' };
  }
  if (!to || !body) {
    return { success: false, error: 'Missing to or body' };
  }

  // Lazy-require twilio so the server doesn't crash if the package
  // isn't installed yet (dev environments without Twilio creds).
  let twilioClient;
  try {
    // eslint-disable-next-line
    const twilio = require('twilio');
    twilioClient = twilio(ACCOUNT_SID, AUTH_TOKEN);
  } catch {
    return { success: false, error: 'twilio package not installed — run: npm install twilio' };
  }

  try {
    const message = await twilioClient.messages.create({
      from: FROM_NUMBER,
      to,
      body,
    });
    return { success: true, sid: message.sid };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = { sendSms, hasTwilio };
