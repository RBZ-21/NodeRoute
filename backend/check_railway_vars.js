// Query Railway API for production environment variables
// Uses the project/service IDs and access token from ~/.railway/config.json
const https = require('https');
const fs = require('fs');

const config = JSON.parse(fs.readFileSync(
  require('path').join(process.env.USERPROFILE, '.railway', 'config.json'), 'utf8'
));

const projectConfig = Object.values(config.projects || {})[0];
const token = config.user?.accessToken;

if (!token) { console.log('No access token found in Railway config'); process.exit(1); }
if (!projectConfig) { console.log('No project found in Railway config'); process.exit(1); }

console.log('Project:', projectConfig.name);
console.log('Environment:', projectConfig.environmentName);
console.log('Service ID:', projectConfig.service);

// Railway uses GraphQL API
const query = `
  query GetVariables($projectId: String!, $environmentId: String!, $serviceId: String!) {
    variables(
      projectId: $projectId
      environmentId: $environmentId
      serviceId: $serviceId
    )
  }
`;

const body = JSON.stringify({
  query,
  variables: {
    projectId: projectConfig.project,
    environmentId: projectConfig.environment,
    serviceId: projectConfig.service
  }
});

const req = https.request({
  hostname: 'backboard.railway.com',
  path: '/graphql/v2',
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  }
}, (res) => {
  let data = '';
  res.on('data', d => data += d);
  res.on('end', () => {
    if (res.statusCode !== 200) {
      console.log('HTTP', res.statusCode, data.slice(0, 300));
      return;
    }
    try {
      const result = JSON.parse(data);
      if (result.errors) {
        console.log('GraphQL errors:', JSON.stringify(result.errors, null, 2));
        return;
      }
      const vars = result.data?.variables || {};

      // Report only email-related vars (mask sensitive values partially)
      const EMAIL_KEYS = [
        'EMAIL_PROVIDER', 'EMAIL_FROM', 'EMAIL_SEND_TIMEOUT_MS',
        'RESEND_API_KEY',
        'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS',
        'SMTP_TLS_REJECT_UNAUTHORIZED'
      ];

      console.log('\n=== RAILWAY PRODUCTION — EMAIL VARIABLES ===\n');

      const resendKey = vars['RESEND_API_KEY'] || '';
      const smtpPass  = vars['SMTP_PASS'] || '';

      for (const key of EMAIL_KEYS) {
        const val = vars[key];
        if (val === undefined) {
          console.log(`${key}: *** NOT SET ***`);
        } else if (key === 'RESEND_API_KEY') {
          console.log(`${key}: ${val.slice(0, 10)}... (${val.length} chars)`);
        } else if (key === 'SMTP_PASS') {
          console.log(`${key}: ${val.slice(0, 8)}... (${val.length} chars)`);
        } else {
          console.log(`${key}: ${val}`);
        }
      }

      // The critical comparison
      console.log('\n=== SMTP_PASS vs RESEND_API_KEY COMPARISON ===\n');
      if (!smtpPass) {
        console.log('SMTP_PASS:      NOT SET in Railway');
      } else if (!resendKey) {
        console.log('RESEND_API_KEY: NOT SET in Railway — email will silently fail!');
      } else if (smtpPass === resendKey) {
        console.log('✅ SMTP_PASS matches RESEND_API_KEY — correctly configured');
      } else {
        console.log('❌ SMTP_PASS does NOT match RESEND_API_KEY');
        console.log(`   SMTP_PASS starts with:      "${smtpPass.slice(0, 8)}"`);
        console.log(`   RESEND_API_KEY starts with: "${resendKey.slice(0, 8)}"`);
        const isAdminPass = smtpPass.includes('Ein') || smtpPass.includes('Ash');
        if (isAdminPass) {
          console.log('   ⚠️  SMTP_PASS appears to be the admin account password, not the API key');
        }
        const correctValue = resendKey;
        console.log(`\n   SHOULD BE: SMTP_PASS=${correctValue.slice(0,10)}... (the RESEND_API_KEY value)`);
      }

      // Total variable count
      const allKeys = Object.keys(vars);
      console.log(`\n(${allKeys.length} total variables in Railway production environment)`);

    } catch(e) {
      console.log('Parse error:', e.message, '\nRaw:', data.slice(0, 500));
    }
  });
});

req.on('error', e => console.log('Request failed:', e.message));
req.setTimeout(12000, () => { console.log('Timed out'); req.destroy(); });
req.write(body);
req.end();
