const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..', '..');
function readSources(paths) {
  return paths.map((filePath) => fs.readFileSync(filePath, 'utf8')).join('\n');
}

const opsRouteSource = readSources([
  path.join(repoRoot, 'backend', 'routes', 'ops.js'),
  path.join(repoRoot, 'backend', 'routes', 'ops-purchasing.js'),
  path.join(repoRoot, 'backend', 'routes', 'ops', 'admin-routes.js'),
  path.join(repoRoot, 'backend', 'routes', 'ops', 'purchasing-shared.js'),
  path.join(repoRoot, 'backend', 'routes', 'ops', 'purchasing-planning-routes.js'),
  path.join(repoRoot, 'backend', 'routes', 'ops', 'purchasing-order-routes.js'),
]);
const reactSrcDir = path.join(repoRoot, 'frontend-v2', 'src');
const frontendNavSource = fs.readFileSync(path.join(reactSrcDir, 'lib', 'nav.ts'), 'utf8');
const frontendDashboardSource = fs.readFileSync(path.join(reactSrcDir, 'hooks', 'useDashboard.ts'), 'utf8');

test('ops routes expose the expected API surface', () => {
  for (const endpoint of [
    "router.get('/uom-rules'",
    "router.post('/uom-rules'",
    "router.delete('/uom-rules/:id'",
    "router.get('/warehouses'",
    "router.post('/warehouses'",
    "router.get('/cycle-counts'",
    "router.post('/cycle-counts'",
    "router.get('/returns'",
    "router.post('/returns'",
    "router.get('/barcode-events'",
    "router.post('/barcode-events'",
    "router.get('/edi-jobs'",
    "router.post('/edi-jobs'",
    "router.get('/projections'",
    "router.get('/purchasing-suggestions'",
    "router.get('/purchase-order-drafts'",
    "router.post('/purchase-order-drafts/from-suggestions'",
    "router.post('/purchase-order-drafts/from-order-intake'",
    "router.patch('/purchase-order-drafts/:id/status'",
    "router.get('/vendor-purchase-orders'",
    "router.post('/vendor-purchase-orders/from-draft/:id'",
    "router.post('/vendor-purchase-orders'",
    "router.patch('/vendor-purchase-orders/:id/status'",
    "router.post('/vendor-purchase-orders/:id/receive'",
    "router.get('/capabilities'",
  ]) {
    assert.ok(opsRouteSource.includes(endpoint), `missing endpoint ${endpoint}`);
  }
});

test('ops routes are globally gated to admin-only server access', () => {
  assert.ok(
    opsRouteSource.includes("router.use(authenticateToken, requireRole('admin'));"),
    'ops router should enforce global authenticateToken + admin role gate'
  );
});

test('vendor PO receiving updates inventory quantity and weighted unit cost', () => {
  for (const marker of [
    "const weighted = ((prevQty * prevCost) + (acceptedQty * unitCost)) / newQty;",
    "notes: `PO ${po.po_number} receipt (${po.vendor})`",
    "weighted_inventory_cost_updates: true",
  ]) {
    assert.ok(opsRouteSource.includes(marker), `missing receiving marker ${marker}`);
  }
});

test('ops planning endpoints enforce bounded query controls', () => {
  for (const constraint of [
    "const days = Math.max(1, Math.min(90, parseInt(req.query.days || '30', 10)));",
    "const lookbackDays = Math.max(7, Math.min(90, parseInt(req.query.lookbackDays || '30', 10)));",
    "const coverageDays = Math.max(1, Math.min(90, parseInt(req.query.coverageDays || '30', 10)));",
    "const leadTimeDays = Math.max(0, Math.min(60, parseInt(req.query.leadTimeDays || '5', 10)));",
  ]) {
    assert.ok(opsRouteSource.includes(constraint), `missing planning constraint ${constraint}`);
  }
  assert.ok(opsRouteSource.includes("urgency: reorderQty <= 0 ? 'none' : (stock <= avgDaily * leadTimeDays ? 'high' : 'normal')"));
});

test('operations workspace tabs are registered in the React nav', () => {
  for (const tabId of ['purchasing', 'warehouse', 'planning', 'integrations']) {
    assert.ok(frontendNavSource.includes(`id: '${tabId}'`), `missing nav tab id '${tabId}'`);
  }
  assert.ok(frontendNavSource.includes("label: 'Operations'"), 'operations nav group should be present');
  assert.ok(frontendNavSource.includes("label: 'Purchasing'"), 'purchasing nav item should be present');
  assert.ok(frontendNavSource.includes("label: 'Warehouse'"), 'warehouse nav item should be present');
});

test('ops vendor-purchase-orders API is called from the React frontend', () => {
  assert.ok(
    frontendDashboardSource.includes('/api/ops/vendor-purchase-orders'),
    'vendor POs should be fetched in dashboard hook'
  );
});
