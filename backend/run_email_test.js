// Live email send test — runs against real Resend API
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { createMailer, createConfiguredMailers } = require('./services/email');

(async () => {
  console.log('\n=== LIVE EMAIL SEND TEST ===');
  console.log('Provider order:', createConfiguredMailers().map(m => m.provider).join(' → '));

  const mailer = createMailer();
  if (!mailer) {
    console.log('RESULT: FAIL — createMailer() returned null. No email providers configured.');
    return;
  }
  console.log('Active provider:', mailer.provider);

  if (!process.env.EMAIL_TEST_TO) {
    console.log('RESULT: FAIL — set EMAIL_TEST_TO env var to the test recipient address.');
    return;
  }

  // Test 1: Resend API key test (via Resend SDK)
  console.log('\n--- Test 1: Sending via Resend API ---');
  try {
    const result = await mailer.sendMail({
      from: process.env.EMAIL_FROM,
      to: process.env.EMAIL_TEST_TO,
      subject: 'NodeRoute Email Config Test',
      html: '<h2>NodeRoute Email Test</h2><p>If you see this, email is working.</p>',
    });
    console.log('RESULT: ✅ SUCCESS');
    console.log('Response:', JSON.stringify(result));
  } catch (err) {
    console.log('RESULT: ❌ FAILED');
    console.log('Error message:', err.message);
    console.log('Error details:', JSON.stringify(err, null, 2));

    // Diagnose common Resend errors
    const msg = err.message || '';
    if (msg.includes('API key')) {
      console.log('\nDIAGNOSIS: Resend API key is invalid or revoked.');
      console.log('FIX: Go to resend.com/api-keys → create a new key → update RESEND_API_KEY in .env and Railway');
    } else if (msg.includes('domain') || msg.includes('not verified') || msg.includes('sender')) {
      console.log('\nDIAGNOSIS: Domain noderoutesystems.com is not verified in Resend.');
      console.log('FIX: Go to resend.com/domains → add noderoutesystems.com → add DNS records → verify');
    } else if (msg.includes('timed out')) {
      console.log('\nDIAGNOSIS: Resend API timed out. Network issue or API down.');
    } else if (msg.includes('422') || msg.includes('Unprocessable')) {
      console.log('\nDIAGNOSIS: Resend rejected the request (422). Likely domain not verified.');
    } else if (msg.includes('403') || msg.includes('Forbidden')) {
      console.log('\nDIAGNOSIS: Resend API key lacks permission or account issue.');
    }
  }

  // Test 2: Try SMTP fallback directly (for comparison)
  console.log('\n--- Test 2: SMTP config sanity check ---');
  const nodemailer = require('nodemailer');
  const smtpPass = process.env.SMTP_PASS;
  const resendKey = process.env.RESEND_API_KEY;
  console.log('SMTP_HOST:', process.env.SMTP_HOST);
  console.log('SMTP_PASS matches API key:', smtpPass === resendKey ? 'YES ✅' : 'NO ❌ (SMTP_PASS should equal RESEND_API_KEY for smtp.resend.com)');

  // Test 3: Check if Resend API key works at all via direct HTTP
  console.log('\n--- Test 3: Resend API key validation (direct fetch) ---');
  try {
    const https = require('https');
    await new Promise((resolve) => {
      const options = {
        hostname: 'api.resend.com',
        path: '/domains',
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        }
      };
      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => {
          console.log('Resend /domains HTTP status:', res.statusCode);
          try {
            const parsed = JSON.parse(body);
            if (res.statusCode === 200) {
              const domains = parsed.data || [];
              console.log('Verified domains in Resend account:', domains.length === 0 ? 'NONE' : domains.map(d => `${d.name} (${d.status})`).join(', '));
              const hasNodeRoute = domains.some(d => d.name === 'noderoutesystems.com');
              console.log('noderoutesystems.com verified:', hasNodeRoute ? '✅ YES' : '❌ NO — this is why emails fail');
            } else {
              console.log('Resend API response:', res.statusCode, body.slice(0, 200));
              if (res.statusCode === 401) console.log('DIAGNOSIS: API key is invalid or revoked');
            }
          } catch(e) {
            console.log('Raw response:', body.slice(0, 300));
          }
          resolve();
        });
      });
      req.on('error', e => { console.log('HTTP request failed:', e.message); resolve(); });
      req.setTimeout(8000, () => { console.log('Request timed out'); req.destroy(); resolve(); });
      req.end();
    });
  } catch(e) {
    console.log('Direct API check failed:', e.message);
  }
})();
