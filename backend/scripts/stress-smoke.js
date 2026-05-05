const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const backendDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(backendDir, '..');

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath, files);
    else if (entry.name.endsWith('.js')) files.push(fullPath);
  }
  return files;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runNodeCheck(file) {
  const result = spawnSync(process.execPath, ['-c', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${path.relative(repoRoot, file)} failed syntax check\n${result.stderr || result.stdout}`);
  }
}

for (const file of walk(backendDir)) runNodeCheck(file);

const routeFiles = ['customers', 'stops', 'routes', 'orders', 'invoices', 'inventory'];
for (const name of routeFiles) {
  const source = fs.readFileSync(path.join(backendDir, 'routes', `${name}.js`), 'utf8');
  assert(!/update\(req\.body\)/.test(source), `${name}: raw req.body update found`);
  assert(!/insert\(\[req\.body\]/.test(source), `${name}: raw req.body insert found`);
}

// Frontend-v2 React source checks (replaced legacy frontend/index.html assertions)
const frontendSrc = path.join(repoRoot, 'frontend-v2', 'src');
const apiSrc        = fs.readFileSync(path.join(frontendSrc, 'lib', 'api.ts'), 'utf8');
const invoicesSrc   = fs.readFileSync(path.join(frontendSrc, 'pages', 'InvoicesPage.tsx'), 'utf8');
const inventorySrc  = fs.readFileSync(path.join(frontendSrc, 'pages', 'InventoryPage.tsx'), 'utf8');
const navSrc        = fs.readFileSync(path.join(frontendSrc, 'lib', 'nav.ts'), 'utf8');

assert(apiSrc.includes("'Content-Type': 'application/json'"), 'JSON content-type hardening missing in api.ts');
assert(invoicesSrc.includes('function customerName'), 'Customer field normalization helper missing in InvoicesPage');
assert(inventorySrc.includes('function downloadCsv'), 'Inventory CSV export helper missing in InventoryPage');
assert(navSrc.includes("id: 'purchasing'"), 'Purchasing nav tab missing');

console.log(`stress smoke passed: ${walk(backendDir).length} backend files, frontend-v2 React source checks passed`);
