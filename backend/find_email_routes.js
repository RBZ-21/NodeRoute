// Find all email-related route handlers in invoices.js
const fs = require('fs');
const lines = fs.readFileSync('./routes/invoices.js', 'utf8').split('\n');

console.log('=== Email-related lines in invoices.js ===\n');
lines.forEach((line, i) => {
  if (/email|sendMail|sendInvoice|resend|smtp|mailer/i.test(line)) {
    console.log(`L${i+1}: ${line}`);
  }
});

// Also find the /send or /email endpoint definition
console.log('\n=== Route endpoints containing "email" or "send" ===\n');
lines.forEach((line, i) => {
  if (/router\.(get|post|put|patch|delete).*email|router\.(get|post|put|patch|delete).*send/i.test(line)) {
    console.log(`L${i+1}: ${line.trim()}`);
  }
});

// Check Railway env (railway.toml)
const railwayToml = fs.readFileSync('../railway.toml', 'utf8');
console.log('\n=== railway.toml ===');
console.log(railwayToml);
