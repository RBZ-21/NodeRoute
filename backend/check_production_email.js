// Production email diagnostic — uses Supabase auth (not custom JWT login)
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const https = require('https');

const BASE = 'noderoutesystems.com';

async function httpsRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request({ ...options, hostname: BASE }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, headers: res.headers, body: data }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(12000, () => { req.destroy(new Error('timeout')); });
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

(async () => {
  console.log('=== PRODUCTION EMAIL DIAGNOSTIC ===\n');

  // Try several auth endpoint patterns
  const authPaths = ['/api/auth/login', '/api/login', '/api/users/login', '/auth/login'];
  let token = null;

  for (const authPath of authPaths) {
    console.log(`Trying ${authPath}...`);
    try {
      const resp = await httpsRequest({
        path: authPath, method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, { email: 'admin@noderoutesystems.com', password: 'Ash&Ein080994$' });

      console.log(`  → ${resp.status}`, JSON.stringify(resp.body).slice(0, 120));
      if (resp.status === 200) {
        token = resp.body?.token || resp.body?.access_token || resp.body?.accessToken;
        if (token) { console.log('  ✅ Got token via', authPath); break; }
        // Maybe it sets a cookie
        const cookie = resp.headers?.['set-cookie']?.[0] || '';
        if (cookie) { console.log('  → Auth via cookie:', cookie.slice(0, 80)); }
      }
    } catch(e) { console.log('  error:', e.message); }
  }

  if (!token) {
    console.log('\nCould not get a JWT token. Testing email endpoint without auth...');
  }

  const headers = token
    ? { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };

  // Fetch invoices
  console.log('\n=== INVOICES ===');
  try {
    const resp = await httpsRequest({ path: '/api/invoices', method: 'GET', headers });
    console.log('Status:', resp.status);
    const invoices = Array.isArray(resp.body) ? resp.body : [];
    console.log('Invoice count:', invoices.length);
    if (invoices.length > 0) {
      const inv = invoices[0];
      console.log('Sample invoice:', { id: inv.id, customer: inv.customer_name, email: inv.billing_email || inv.customer_email || '(none)', status: inv.status });

      // Test the email endpoint
      console.log('\n=== EMAIL ENDPOINT TEST ===');
      console.log(`POST /api/invoices/${inv.id}/email`);
      const emailResp = await httpsRequest({
        path: `/api/invoices/${inv.id}/email`, method: 'POST', headers
      });
      console.log('HTTP Status:', emailResp.status);
      console.log('Response:', JSON.stringify(emailResp.body));

      if (emailResp.status === 503) {
        console.log('\n🔴 ROOT CAUSE: HTTP 503 — "Email not configured on server"');
        console.log('   The production Railway environment is missing RESEND_API_KEY (and SMTP credentials).');
        console.log('   The .env file is local only — Railway needs the variable set separately.');
      } else if (emailResp.status === 400 && JSON.stringify(emailResp.body).includes('No email')) {
        console.log('\n🟡 ROOT CAUSE: Invoice has no customer email address on file.');
        console.log('   sendInvoiceEmail() returned { sent: false, error: "No email on file..." }');
      } else if (emailResp.status === 200) {
        console.log('\n✅ Email API returned success from production!');
        console.log('   Check spam folder at ryandb21@gmail.com');
      } else if (emailResp.status === 500) {
        console.log('\n🔴 ROOT CAUSE: 500 Server Error during email send');
        console.log('   Error:', emailResp.body?.error);
      }
    }
  } catch(e) {
    console.log('Invoices request error:', e.message);
  }

  // Check if there's a settings/config endpoint that reveals email setup
  console.log('\n=== SETTINGS CHECK ===');
  try {
    const resp = await httpsRequest({ path: '/api/settings', method: 'GET', headers });
    console.log('Status:', resp.status, '| Body snippet:', JSON.stringify(resp.body).slice(0, 200));
  } catch(e) { console.log('Settings unavailable:', e.message); }

  // Check Resend directly — did the test email we sent earlier arrive?
  console.log('\n=== RESEND SEND LOG (last 5 sent emails) ===');
  const resendKey = process.env.RESEND_API_KEY;
  try {
    await new Promise((resolve) => {
      const req = https.request({
        hostname: 'api.resend.com',
        path: '/emails?limit=5',
        method: 'GET',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' }
      }, (res) => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            const emails = parsed.data || parsed.emails || [];
            if (emails.length > 0) {
              console.log(`Found ${emails.length} sent emails in Resend:`);
              emails.forEach((e, i) => {
                console.log(`  ${i+1}. To: ${e.to} | Subject: "${e.subject}" | Created: ${e.created_at} | Status: ${e.last_event || e.status || '?'}`);
              });
            } else {
              console.log('No sent emails found via Resend API (endpoint may require plan upgrade)');
              console.log('Raw:', body.slice(0, 300));
            }
          } catch(e) { console.log('Raw response:', body.slice(0, 300)); }
          resolve();
        });
      });
      req.on('error', e => { console.log('Resend log request failed:', e.message); resolve(); });
      req.setTimeout(8000, () => { req.destroy(); resolve(); });
      req.end();
    });
  } catch(e) { console.log('Resend API error:', e.message); }
})();
