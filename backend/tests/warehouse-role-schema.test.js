const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..', '..');

function source(...parts) {
  return fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');
}

test('users_role_check constraint includes warehouse', () => {
  const migration = source('supabase', 'migrations', '20260704010000_add_warehouse_role.sql');
  assert.ok(migration.includes("CHECK (role IN ('superadmin', 'admin', 'manager', 'driver', 'warehouse'))"));
});

test('USER_ROLES validation array includes warehouse', () => {
  const schemas = source('backend', 'lib', 'users-schemas.js');
  assert.ok(schemas.includes("const USER_ROLES = ['admin', 'manager', 'driver', 'warehouse'];"));
});

test('inventory.js grants warehouse on the intended endpoints only', () => {
  const routeSource = source('backend', 'routes', 'inventory.js');
  const grantedMarkers = [
    "router.post('/', authenticateToken, requireRole('admin', 'manager', 'warehouse')",
    "router.get('/low-stock', authenticateToken, requireRole('admin', 'manager', 'warehouse')",
    "router.post('/lots', authenticateToken, requireRole('admin', 'manager', 'warehouse')",
    "router.patch('/lots/:lotId', authenticateToken, requireRole('admin', 'manager', 'warehouse')",
    "router.post('/lots/:lotId/deplete', authenticateToken, requireRole('admin', 'manager', 'warehouse')",
    "router.delete('/lots/:lotId', authenticateToken, requireRole('admin', 'manager', 'warehouse')",
    "router.post('/count', authenticateToken, requireRole('admin', 'manager', 'warehouse')",
    "router.post('/:id/restock', authenticateToken, requireRole('admin', 'manager', 'warehouse')",
    "router.post('/:id/adjust', authenticateToken, requireRole('admin', 'manager', 'warehouse')",
    "router.post('/:id/pick', authenticateToken, requireRole('admin', 'manager', 'warehouse')",
    "router.post('/:id/spoilage', authenticateToken, requireRole('admin', 'manager', 'warehouse')",
    "router.post('/transfer', authenticateToken, requireRole('admin', 'manager', 'warehouse')",
    "router.patch('/:id', authenticateToken, requireRole('admin', 'manager', 'warehouse')",
  ];
  for (const marker of grantedMarkers) {
    assert.ok(routeSource.includes(marker), `Expected inventory.js to include: ${marker}`);
  }

  const untouchedMarkers = [
    "router.post('/adjust-shortage', authenticateToken, requireRole('admin', 'manager')",
    "router.post('/return', authenticateToken, requireRole('admin', 'manager')",
    "router.delete('/:id', authenticateToken, requireRole('admin', 'manager')",
  ];
  for (const marker of untouchedMarkers) {
    assert.ok(routeSource.includes(marker), `Expected inventory.js to still exclude warehouse from: ${marker}`);
  }
});

test('lots.js opens trace/report to manager and warehouse, leaves notice/ftl admin-only', () => {
  const routeSource = source('backend', 'routes', 'lots.js');
  assert.ok(routeSource.includes("router.get('/:lotNumber/trace', authenticateToken, requireRole('admin', 'manager', 'warehouse')"));
  assert.ok(routeSource.includes("router.get('/traceability/report', authenticateToken, requireRole('admin', 'manager', 'warehouse')"));
  assert.ok(routeSource.includes("router.post('/', authenticateToken, requireRole('admin', 'manager', 'warehouse')"));
  assert.ok(routeSource.includes("router.post('/:lotNumber/notice', authenticateToken, requireRole('admin')"));
  assert.ok(routeSource.includes("router.patch('/products/:itemNumber/ftl', authenticateToken, requireRole('admin')"));
});

test('cycle-counts.js grants warehouse on all three endpoints', () => {
  const routeSource = source('backend', 'routes', 'cycle-counts.js');
  assert.ok(routeSource.includes("router.post('/', authenticateToken, requireRole('admin', 'manager', 'warehouse')"));
  assert.ok(routeSource.includes("router.patch('/:id/items', authenticateToken, requireRole('admin', 'manager', 'warehouse')"));
  assert.ok(routeSource.includes("router.post('/:id/commit', authenticateToken, requireRole('admin', 'manager', 'warehouse')"));
});

test('kits.js keeps recipe/process creation manager-only but opens viewing to warehouse', () => {
  const routeSource = source('backend', 'routes', 'kits.js');
  assert.ok(routeSource.includes("const kitViewRoles = requireRole('admin', 'manager', 'warehouse');"));
  assert.ok(routeSource.includes("router.get('/recipes', authenticateToken, kitViewRoles"));
  assert.ok(routeSource.includes("router.get('/runs', authenticateToken, kitViewRoles"));
  assert.ok(routeSource.includes("router.post('/recipes', authenticateToken, kitRoles"));
  assert.ok(routeSource.includes("router.post('/process', authenticateToken, kitRoles"));
});
