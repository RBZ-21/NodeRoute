const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');

function read(...parts) {
  return fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');
}

function walkFiles(dir, predicate, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(fullPath, predicate, out);
    else if (predicate(fullPath)) out.push(fullPath);
  }
  return out;
}

test('logger redacts common secret and PII fields before writing logs', () => {
  const loggerSource = read('backend', 'services', 'logger.js');

  for (const marker of [
    'redact:',
    'req.headers.authorization',
    'req.headers.cookie',
    'password_hash',
    'service_role_key',
    'customer_phone',
    "'*.email'",
    'card_number',
  ]) {
    assert.ok(loggerSource.includes(marker), `missing logger redaction marker ${marker}`);
  }
});

test('SMS paths do not log raw phone numbers or message bodies', () => {
  const smsSource = read('backend', 'services', 'sms.js');
  const dailyBlastSource = read('backend', 'services', 'daily-fish-blast.js');
  const deliveryNotificationSource = read('backend', 'services', 'delivery-notifications.js');

  assert.ok(smsSource.includes('function maskPhone(value)'), 'SMS wrapper should expose phone masking');
  assert.ok(smsSource.includes('bodyLength'), 'dry-run SMS logging should record length only');
  assert.ok(!smsSource.includes("console.info('[sms] DRY RUN — would send to', to, ':', body)"));
  assert.ok(!smsSource.includes("console.warn('[sms] Twilio is not configured — skipping SMS to', to)"));
  assert.ok(dailyBlastSource.includes('maskPhone(customer.phone)'));
  assert.ok(deliveryNotificationSource.includes('const phoneForLog = maskPhone(phone)'));
});

test('Reports directory is ignored and not referenced by deployed code paths', () => {
  const gitignore = read('.gitignore');
  assert.match(gitignore, /^Reports\/$/m);

  const deployedSourceFiles = [
    ...walkFiles(path.join(repoRoot, 'backend'), (file) => file.endsWith('.js') && !file.includes(`${path.sep}tests${path.sep}`)),
    ...walkFiles(path.join(repoRoot, 'frontend-v2', 'src'), (file) => /\.(ts|tsx|js|jsx)$/.test(file)),
    ...walkFiles(path.join(repoRoot, 'landing-v2', 'src'), (file) => /\.(ts|tsx|js|jsx)$/.test(file)),
    ...walkFiles(path.join(repoRoot, 'driver-app', 'src'), (file) => /\.(ts|tsx|js|jsx)$/.test(file)),
  ];

  for (const file of deployedSourceFiles) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes('Reports/'), false, `${path.relative(repoRoot, file)} references Reports/`);
  }
});
