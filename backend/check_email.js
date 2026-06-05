// Email configuration diagnostic
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

console.log('\n=== EMAIL ENVIRONMENT VARIABLES ===');
console.log('EMAIL_PROVIDER:', process.env.EMAIL_PROVIDER || '(not set)');
console.log('RESEND_API_KEY:', process.env.RESEND_API_KEY ? `SET (${process.env.RESEND_API_KEY.slice(0,8)}...)` : '(not set)');
console.log('SMTP_HOST:     ', process.env.SMTP_HOST || '(not set)');
console.log('SMTP_PORT:     ', process.env.SMTP_PORT || '(not set)');
console.log('SMTP_USER:     ', process.env.SMTP_USER || '(not set)');
console.log('SMTP_PASS:     ', process.env.SMTP_PASS ? `SET (${process.env.SMTP_PASS.slice(0,6)}...)` : '(not set)');
console.log('EMAIL_FROM:    ', process.env.EMAIL_FROM || '(not set)');

console.log('\n=== PACKAGE AVAILABILITY ===');
try { require('resend'); console.log('resend npm package: INSTALLED'); }
catch(e) { console.log('resend npm package: NOT FOUND -', e.code); }

try { require('nodemailer'); console.log('nodemailer npm package: INSTALLED'); }
catch(e) { console.log('nodemailer npm package: NOT FOUND -', e.code); }

console.log('\n=== MAILER CREATION TEST ===');
try {
  const { createMailer, createConfiguredMailers } = require('./services/email');
  const mailers = createConfiguredMailers();
  if (mailers.length === 0) {
    console.log('createMailer() returns: NULL — No providers configured');
  } else {
    console.log('Configured mailers:', mailers.map(m => m.provider).join(', '));
  }
  const mailer = createMailer();
  console.log('createMailer():', mailer ? `OK (provider: ${mailer.provider})` : 'NULL — email will silently fail');
} catch(e) {
  console.log('Error creating mailer:', e.message);
}

console.log('\n=== SMTP PASS CHECK ===');
const smtpPass = process.env.SMTP_PASS || '';
const resendKey = process.env.RESEND_API_KEY || '';
if (process.env.SMTP_HOST === 'smtp.resend.com' && smtpPass !== resendKey) {
  console.log('⚠️  WARNING: SMTP_HOST is smtp.resend.com but SMTP_PASS is NOT your RESEND_API_KEY!');
  console.log('   Resend SMTP requires: SMTP_PASS = your Resend API key (re_...)');
  console.log('   Current SMTP_PASS starts with:', smtpPass.slice(0,6));
  console.log('   RESEND_API_KEY starts with:   ', resendKey.slice(0,8));
} else if (process.env.SMTP_HOST === 'smtp.resend.com') {
  console.log('✅ SMTP_PASS matches RESEND_API_KEY (Resend SMTP correctly configured)');
}

console.log('\n=== RESEND DOMAIN CHECK ===');
const emailFrom = process.env.EMAIL_FROM || '';
const domainMatch = emailFrom.match(/@([^>]+)/);
const senderDomain = domainMatch ? domainMatch[1] : '(unknown)';
console.log('Sending from domain:', senderDomain);
if (senderDomain !== 'resend.dev') {
  console.log('→ Domain', senderDomain, 'must be verified in Resend dashboard at resend.com/domains');
  console.log('→ If unverified, all emails will silently fail or bounce');
} else {
  console.log('→ Using resend.dev (sandbox domain) — delivery to external addresses may be blocked');
}

console.log('\n=== LIVE SEND TEST (dry run — will NOT actually send) ===');
console.log('To send a real test: set EMAIL_TEST_TO env var and run:');
console.log('  node -e "require(\'./check_email\').testSend()"');

module.exports = { testSend: async function() {
  require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
  const { createMailer } = require('./services/email');
  const mailer = createMailer();
  if (!mailer) { console.log('No mailer — cannot send'); return; }
  try {
    await mailer.sendMail({
      from: process.env.EMAIL_FROM || 'test@test.com',
      to: process.env.EMAIL_TEST_TO || 'ryandb21@gmail.com',
      subject: 'NodeRoute Email Test',
      html: '<p>Email configuration test from NodeRoute backend.</p>',
    });
    console.log('✅ Test email sent successfully via', mailer.provider);
  } catch(e) {
    console.log('❌ Send failed:', e.message);
    if (e.message.includes('Invalid API key')) console.log('   → Resend API key is invalid or expired');
    if (e.message.includes('domain')) console.log('   → Domain is not verified in Resend');
    if (e.message.includes('535') || e.message.includes('Authentication')) console.log('   → SMTP auth failed — check SMTP_PASS');
  }
}};
