const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..', '..');
const opsRouteSource = fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'ops.js'), 'utf8');
const frontendSource = fs.readFileSync(path.join(repoRoot, 'frontend', 'index.html'), 'utf8');

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
    "router.patch('/purchase-order-drafts/:id/status'",
    "router.get('/capabilities'",
  ]) {
    assert.ok(opsRouteSource.includes(endpoint), `missing endpoint ${endpoint}`);
  }
});

test('ops write routes require auth and manager/admin role checks', () => {
  for (const guardedWrite of [
    "router.post('/uom-rules', authenticateToken, requireRole('admin', 'manager')",
    "router.delete('/uom-rules/:id', authenticateToken, requireRole('admin', 'manager')",
    "router.post('/warehouses', authenticateToken, requireRole('admin', 'manager')",
    "router.post('/cycle-counts', authenticateToken, requireRole('admin', 'manager')",
    "router.post('/returns', authenticateToken, requireRole('admin', 'manager')",
    "router.post('/barcode-events', authenticateToken, requireRole('admin', 'manager')",
    "router.post('/edi-jobs', authenticateToken, requireRole('admin', 'manager')",
    "router.post('/purchase-order-drafts/from-suggestions', authenticateToken, requireRole('admin', 'manager')",
    "router.patch('/purchase-order-drafts/:id/status', authenticateToken, requireRole('admin', 'manager')",
  ]) {
    assert.ok(opsRouteSource.includes(guardedWrite), `missing guard for ${guardedWrite}`);
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

test('operations nav flows are wired to tabs and lazy loaders', () => {
  for (const marker of [
    'data-tab="warehouse"',
    'data-tab="planning"',
    'data-tab="integrations"',
    "if (name === 'warehouse') { loadWarehouseTab(); }",
    "if (name === 'planning') { loadPlanningTab(); }",
    "if (name === 'integrations') { loadIntegrationsTab(); }",
  ]) {
    assert.ok(frontendSource.includes(marker), `missing nav wiring ${marker}`);
  }
});

test('ops tab handlers call expected backend APIs', () => {
  for (const apiCall of [
    'fetch(`${API}/ops/warehouses`, authHeaders)',
    'fetch(`${API}/ops/returns`, authHeaders)',
    'fetch(`${API}/ops/barcode-events`, authHeaders)',
    'fetch(`${API}/ops/uom-rules`, authHeaders)',
    'fetch(`${API}/ops/projections?days=30&lookbackDays=30`, authHeaders)',
    'fetch(`${API}/ops/purchasing-suggestions?coverageDays=${coverageDays}&leadTimeDays=${leadTimeDays}&lookbackDays=30`, authHeaders)',
    'fetch(`${API}/ops/purchase-order-drafts`, authHeaders)',
    'fetch(`${API}/ops/purchase-order-drafts/from-suggestions`, {',
    'fetch(`${API}/ops/purchase-order-drafts/${id}/status`, {',
    'fetch(`${API}/ops/edi-jobs`, authHeaders)',
    'fetch(`${API}/ops/capabilities`, authHeaders)',
  ]) {
    assert.ok(frontendSource.includes(apiCall), `missing API integration ${apiCall}`);
  }
});

test('ops forms keep keyboard-friendly submit handlers', () => {
  for (const submitHook of [
    'onsubmit="event.preventDefault();createWarehouse()"',
    'onsubmit="event.preventDefault();logBarcodeEvent()"',
    'onsubmit="event.preventDefault();createReturnRecord()"',
    'onsubmit="event.preventDefault();createUomRule()"',
    'onsubmit="event.preventDefault();createPurchaseOrderDraftFromSuggestions()"',
    'onsubmit="event.preventDefault();createEdiJob()"',
  ]) {
    assert.ok(frontendSource.includes(submitHook), `missing form submit hook ${submitHook}`);
  }
});
