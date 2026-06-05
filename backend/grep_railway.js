const fs = require('fs');

// Check CI workflow for Railway tokens
const ciFile = fs.readFileSync('../.github/workflows/ci.yml', 'utf8');
const lines = ciFile.split('\n');
console.log('=== CI workflow Railway/SMTP references ===');
lines.forEach((l, i) => {
  if (/railway|smtp_pass|resend|email/i.test(l)) console.log(`L${i+1}: ${l}`);
});

// Also check if there's a RAILWAY_TOKEN in any local env files
const envFiles = ['.env', '.env.local', '.env.production', '../.env', '../.env.local'];
console.log('\n=== Checking env files for RAILWAY_TOKEN ===');
for (const f of envFiles) {
  try {
    const content = fs.readFileSync(f, 'utf8');
    const railwayLines = content.split('\n').filter(l => /RAILWAY/i.test(l));
    if (railwayLines.length > 0) console.log(`${f}:`, railwayLines.join(', '));
    else console.log(`${f}: no RAILWAY vars`);
  } catch(e) { console.log(`${f}: not found`); }
}
