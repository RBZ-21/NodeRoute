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

const html = fs.readFileSync(path.join(repoRoot, 'frontend', 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
for (const [index, script] of scripts.entries()) {
  try {
    new Function(script[1]);
  } catch (error) {
    throw new Error(`frontend/index.html script ${index} failed parse: ${error.message}`);
  }
}

const routeFiles = ['customers', 'stops', 'routes', 'orders', 'invoices', 'inventory'];
for (const name of routeFiles) {
  const source = fs.readFileSync(path.join(backendDir, 'routes', `${name}.js`), 'utf8');
  assert(!/update\(req\.body\)/.test(source), `${name}: raw req.body update found`);
  assert(!/insert\(\[req\.body\]/.test(source), `${name}: raw req.body insert found`);
}

assert(html.includes('function normalizeRoute'), 'Route normalization helper missing');
assert(html.includes('function customerName'), 'Customer field normalization helper missing');
assert(html.includes('function submitInventoryCount'), 'Inventory count workflow missing');
assert(html.includes("headers: { 'Content-Type': 'application/json', ...authHeaders.headers }"), 'JSON content-type hardening missing');

console.log(`stress smoke passed: ${walk(backendDir).length} backend files, ${scripts.length} frontend script block`);
