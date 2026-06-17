// Force SMTP path only — bypasses Resend SDK entirely
// Confirms the SMTP_PASS fix is correct for smtp.resend.com
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const nodemailer = require('nodemailer');

(async () => {
  const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, EMAIL_FROM, RESEND_API_KEY } = process.env;
  const TEST_TO = process.env.EMAIL_TEST_TO;
  if (!TEST_TO) {
    console.log('ABORT: set EMAIL_TEST_TO env var to the test recipient address.');
    return;
  }

  console.log('=== SMTP-ONLY EMAIL TEST ===\n');
  console.log('SMTP_HOST:        ', SMTP_HOST);
  console.log('SMTP_PORT:        ', SMTP_PORT);
  console.log('SMTP_SECURE:      ', SMTP_SECURE);
  console.log('SMTP_USER:        ', SMTP_USER);
  console.log('SMTP_PASS starts: ', (SMTP_PASS || '').slice(0, 10) + '...');
  console.log('RESEND_API_KEY:   ', (RESEND_API_KEY || '').slice(0, 10) + '...');
  console.log('EMAIL_FROM:       ', EMAIL_FROM);
  console.log('SMTP_PASS matches RESEND_API_KEY:', SMTP_PASS === RESEND_API_KEY ? '✅ YES' : '❌ NO');

  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    console.log('\n❌ ABORT: Missing required SMTP variables.');
    return;
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: String(SMTP_SECURE).toLowerCase() === 'true',
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
    tls: { servername: SMTP_HOST, rejectUnauthorized: true },
  });

  console.log('\nVerifying SMTP connection...');
  try {
    await transporter.verify();
    console.log('✅ SMTP connection verified — auth succeeded');
  } catch (err) {
    console.log('❌ SMTP verify failed:', err.message);
    if (/535|auth|credentials/i.test(err.message)) {
      console.log('   DIAGNOSIS: Authentication rejected — SMTP_PASS is still wrong');
    } else if (/ECONNREFUSED|ETIMEDOUT|network/i.test(err.message)) {
      console.log('   DIAGNOSIS: Network error — cannot reach', SMTP_HOST);
    }
    return;
  }

  console.log(`\nSending test email via SMTP to ${TEST_TO}...`);
  try {
    const info = await transporter.sendMail({
      from: EMAIL_FROM || `NodeRoute Systems <noreply@noderoutesystems.com>`,
      to: TEST_TO,
      subject: 'NodeRoute SMTP Test — Fix Confirmed',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px">
          <h2 style="color:#ff6b35">NodeRoute Systems</h2>
          <p>This is a test email sent via <strong>SMTP</strong> (smtp.resend.com:587).</p>
          <p>If you received this, the SMTP_PASS fix is confirmed working.</p>
          <hr/>
          <p style="color:#888;font-size:12px">
            Sent: ${new Date().toISOString()}<br/>
            Path: Nodemailer → smtp.resend.com → Resend delivery
          </p>
        </div>`,
    });

    console.log('\n✅ PASS — Email sent successfully via SMTP');
    console.log('   Message ID:', info.messageId);
    console.log('   Response:  ', info.response);
    console.log(`\n   Check ${TEST_TO} inbox (subject: "NodeRoute SMTP Test — Fix Confirmed")`);
  } catch (err) {
    console.log('\n❌ FAIL — SMTP send error:', err.message);
    if (/535|auth/i.test(err.message))  console.log('   DIAGNOSIS: Auth rejected — SMTP_PASS is still not the API key');
    if (/550|domain/i.test(err.message)) console.log('   DIAGNOSIS: Domain not verified on Resend account');
    if (/timeout/i.test(err.message))    console.log('   DIAGNOSIS: Connection timed out');
  }
})();
