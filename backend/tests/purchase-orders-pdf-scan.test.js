const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');

const fixturePdfPath = path.join(__dirname, 'fixtures', 'sample-po.pdf');
const routePath = require.resolve('../routes/purchase-orders');
const authPath = require.resolve('../middleware/auth');
const supabasePath = require.resolve('../services/supabase');
const aiServicePath = require.resolve('../services/ai');
const poWorkflowPath = require.resolve('../services/purchase-order-workflows');
const configPath = require.resolve('../lib/config');

function clearBackendModuleCache() {
  for (const modulePath of [
    routePath,
    authPath,
    supabasePath,
    aiServicePath,
    poWorkflowPath,
    configPath,
  ]) {
    delete require.cache[modulePath];
  }
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('purchase order scan accepts PDF uploads and preserves application/pdf for AI parsing', async () => {
  const previousBackupPath = process.env.NODEROUTE_BACKUP_PATH;
  const previousForceDemoMode = process.env.NODEROUTE_FORCE_DEMO_MODE;
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-po-pdf-scan-'));
  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';

  clearBackendModuleCache();
  const aiCalls = [];
  const workflowCalls = [];
  const parsedResult = {
    vendor: 'Harbor Foods',
    vendor_details: { name: 'Harbor Foods' },
    po_number: 'PDF-1001',
    date: '2026-05-22',
    total_cost: 25,
    items: [
      {
        description: 'Atlantic Salmon',
        quantity: 2,
        unit_price: 12.5,
        total: 25,
        unit: 'lb',
        category: 'Finfish',
        item_type: 'weighted',
      },
    ],
  };

  require.cache[aiServicePath] = {
    exports: {
      parsePurchaseOrderImage: async (base64Image, mimeType) => {
        aiCalls.push({ base64Image, mimeType });
        return parsedResult;
      },
    },
  };
  require.cache[poWorkflowPath] = {
    exports: {
      attachLotsToPurchaseOrder: async () => {},
      findVendorByName: async () => null,
      linkScanToPurchaseOrder: async () => {},
      recordPoInvoiceScan: async (payload) => {
        workflowCalls.push(payload);
        return { id: 'po-scan-pdf-001' };
      },
    },
  };

  let server;
  try {
    const config = require('../lib/config');
    const { supabase } = require('../services/supabase');
    await supabase.from('users').insert({
      id: 'po-pdf-manager',
      name: 'PO PDF Manager',
      email: 'po-pdf-manager@noderoute.test',
      role: 'manager',
      status: 'active',
      company_id: 'company-po-pdf',
      location_id: 'loc-po-pdf',
      accessible_company_ids: ['company-po-pdf'],
      accessible_location_ids: ['loc-po-pdf'],
    });

    const app = express();
    app.use(express.json());
    app.use('/api/purchase-orders', require(routePath));
    app.use((err, req, res, next) => {
      res.status(err?.status || 500).json({ error: err?.message || 'Internal server error' });
    });
    server = await listen(app);

    const token = jwt.sign({ userId: 'po-pdf-manager' }, config.JWT_SECRET, { expiresIn: '1h' });
    const form = new FormData();
    form.append(
      'image',
      new Blob([fs.readFileSync(fixturePdfPath)], { type: 'application/pdf' }),
      'sample-po.pdf'
    );

    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/purchase-orders/scan`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(aiCalls.length, 1);
    assert.equal(aiCalls[0].mimeType, 'application/pdf');
    assert.equal(typeof aiCalls[0].base64Image, 'string');
    assert.ok(aiCalls[0].base64Image.length > 0);
    assert.equal(workflowCalls.length, 1);
    assert.equal(workflowCalls[0].fileName, 'sample-po.pdf');
    assert.equal(workflowCalls[0].mimeType, 'application/pdf');
    assert.equal(workflowCalls[0].source, 'purchase-orders-scan');
    assert.equal(body.vendor, 'Harbor Foods');
    assert.equal(body.po_number, 'PDF-1001');
    assert.equal(body.scan_id, 'po-scan-pdf-001');
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (previousBackupPath === undefined) delete process.env.NODEROUTE_BACKUP_PATH;
    else process.env.NODEROUTE_BACKUP_PATH = previousBackupPath;
    if (previousForceDemoMode === undefined) delete process.env.NODEROUTE_FORCE_DEMO_MODE;
    else process.env.NODEROUTE_FORCE_DEMO_MODE = previousForceDemoMode;
    clearBackendModuleCache();
    fs.rmSync(backupPath, { recursive: true, force: true });
  }
});
