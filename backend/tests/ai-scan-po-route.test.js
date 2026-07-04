const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const express = require('express');
const cookieParser = require('cookie-parser');

const fixturePngPath = path.join(__dirname, 'fixtures', 'sample-po.png');
const fixturePdfPath = path.join(__dirname, 'fixtures', 'sample-po.pdf');
const routePath = require.resolve('../routes/ai');
const authPath = require.resolve('../middleware/auth');
const supabasePath = require.resolve('../services/supabase');
const aiServicePath = require.resolve('../services/ai');
const poWorkflowPath = require.resolve('../services/purchase-order-workflows');
const operatingContextPath = require.resolve('../services/operating-context');
const configPath = require.resolve('../lib/config');
const loggerPath = require.resolve('../services/logger');

function clearBackendModuleCache() {
  for (const modulePath of [
    routePath,
    authPath,
    supabasePath,
    aiServicePath,
    poWorkflowPath,
    operatingContextPath,
    configPath,
    loggerPath,
  ]) {
    delete require.cache[modulePath];
  }
}

function mockAiModule({ parsedResult, thrownError, calls }) {
  return {
    generateWalkthrough: async () => ({ title: 'unused', summary: '', steps: [], tips: [], warnings: [] }),
    generateOrderIntakeDraft: async () => ({ customer_name_hint: null, order_notes: null, items: [], warnings: [] }),
    generateChatReply: async () => 'unused',
    generateChatReplyWithContext: async () => 'unused',
    checkChatRateLimit: () => true,
    analyzeInventory: async () => ({}),
    optimizeRoute: async () => ({}),
    scoreCustomerRisk: async () => ({}),
    detectAnomalies: async () => ({}),
    scoreVendorPerformance: async () => ({}),
    scoreVendorList: async () => ({}),
    optimizeDriverAssignments: async () => ({}),
    generateMarkdownRecommendations: async () => ({}),
    generateInvoiceFollowUp: async () => ({}),
    generateBulkReorderAlerts: async () => ({}),
    scoreLatePaymentRisk: async () => ({}),
    detectPricingAnomalies: async () => ({}),
    parsePurchaseOrderImage: async (pages, mimeType) => {
      // The route now passes an ordered array of { base64, mimeType } pages.
      // Normalize to an array so legacy single-arg callers stay assertable.
      const pageList = Array.isArray(pages) ? pages : [{ base64: pages, mimeType }];
      calls.push({ pages: pageList });
      if (thrownError) throw thrownError;
      return parsedResult;
    },
  };
}

function mockWorkflowModule({ calls }) {
  return {
    recordPoInvoiceScan: async (payload) => {
      calls.push(payload);
      return { id: 'scan-test-001' };
    },
  };
}

function requireAiRouterWithUnrefdInterval() {
  const realSetInterval = global.setInterval;
  global.setInterval = (...args) => {
    const handle = realSetInterval(...args);
    if (typeof handle?.unref === 'function') handle.unref();
    return handle;
  };

  try {
    return require(routePath);
  } finally {
    global.setInterval = realSetInterval;
  }
}

async function startAiScanHarness(t, { userRole = 'manager', parsedResult, thrownError } = {}) {
  const previousEnv = {
    NODEROUTE_BACKUP_PATH: process.env.NODEROUTE_BACKUP_PATH,
    NODEROUTE_FORCE_DEMO_MODE: process.env.NODEROUTE_FORCE_DEMO_MODE,
  };
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-ai-scan-'));
  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';

  clearBackendModuleCache();

  const aiCalls = [];
  const workflowCalls = [];
  require.cache[aiServicePath] = {
    exports: mockAiModule({ parsedResult, thrownError, calls: aiCalls }),
  };
  require.cache[poWorkflowPath] = {
    exports: mockWorkflowModule({ calls: workflowCalls }),
  };

  const config = require('../lib/config');
  const { supabase } = require('../services/supabase');
  const user = {
    id: `${userRole}-scan-user`,
    name: `${userRole[0].toUpperCase()}${userRole.slice(1)} User`,
    email: `${userRole}@noderoute.test`,
    role: userRole,
    status: 'active',
    company_id: 'scan-company-a',
    location_id: 'scan-location-a',
  };
  await supabase.from('users').insert(user);

  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use('/api/ai', requireAiRouterWithUnrefdInterval());
  app.use((err, req, res, next) => {
    res.status(err?.status || 500).json({ error: err?.message || 'Internal server error' });
  });

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });

  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });

    if (previousEnv.NODEROUTE_BACKUP_PATH === undefined) delete process.env.NODEROUTE_BACKUP_PATH;
    else process.env.NODEROUTE_BACKUP_PATH = previousEnv.NODEROUTE_BACKUP_PATH;

    if (previousEnv.NODEROUTE_FORCE_DEMO_MODE === undefined) delete process.env.NODEROUTE_FORCE_DEMO_MODE;
    else process.env.NODEROUTE_FORCE_DEMO_MODE = previousEnv.NODEROUTE_FORCE_DEMO_MODE;

    clearBackendModuleCache();
    fs.rmSync(backupPath, { recursive: true, force: true });
  });

  const token = jwt.sign(
    { userId: user.id, email: user.email, role: user.role },
    config.JWT_SECRET,
    { expiresIn: '1h' }
  );
  const csrfToken = 'csrf-scan-test-token';

  return {
    aiCalls,
    workflowCalls,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    sessionCookie: `token=${token}; csrf-token=${csrfToken}`,
    csrfToken,
    jwtSecret: config.JWT_SECRET,
    user,
  };
}

async function postScanPo(baseUrl, { cookie, csrfToken, filePath, fileName, mimeType, authorization, fieldName = 'file', files } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (csrfToken) headers['x-csrf-token'] = csrfToken;
  if (authorization) headers.authorization = authorization;

  const options = { method: 'POST', headers };
  // `files` lets a test attach several pages; falls back to the single-file shape.
  const attachments = files || (filePath ? [{ filePath, fileName, mimeType, fieldName }] : []);
  if (attachments.length) {
    const form = new FormData();
    for (const att of attachments) {
      const blob = new Blob([fs.readFileSync(att.filePath)], { type: att.mimeType });
      form.append(att.fieldName || 'file', blob, att.fileName);
    }
    options.body = form;
  }

  const response = await fetch(`${baseUrl}/api/ai/scan-po`, options);
  const raw = await response.text();
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    body = raw;
  }

  return { status: response.status, body };
}

test('scan-po accepts bearer auth after driver token contract restoration and still validates uploads', async (t) => {
  const harness = await startAiScanHarness(t);

  const response = await postScanPo(harness.baseUrl, {
    authorization: `Bearer ${jwt.sign({ userId: harness.user.id }, harness.jwtSecret, { expiresIn: '1h' })}`,
  });

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error: 'No file uploaded. Send the image(s) as multipart field "file" or "image".' });
  assert.equal(harness.aiCalls.length, 0);
});

test('scan-po requires a valid CSRF token for authenticated uploads', async (t) => {
  const harness = await startAiScanHarness(t);

  const response = await postScanPo(harness.baseUrl, {
    cookie: harness.sessionCookie,
    filePath: fixturePngPath,
    fileName: 'sample-po.png',
    mimeType: 'image/png',
  });

  assert.equal(response.status, 403);
  assert.deepEqual(response.body, { error: 'Invalid CSRF token' });
  assert.equal(harness.aiCalls.length, 0);
});

test('scan-po parses a PNG upload and records the scan workflow metadata', async (t) => {
  const parsedResult = {
    vendor: 'Blue Ocean Seafood',
    po_number: 'PO-2001',
    date: '2026-05-13',
    total_cost: 53,
    items: [
      {
        description: 'Atlantic Salmon Fillet',
        category: 'Finfish',
        quantity: 2,
        unit: 'lb',
        unit_price: 11,
        total: 22,
        item_type: 'weighted',
        lot_number: 'SAL-LOT-01',
        lot_number_confidence: 'high',
      },
    ],
  };
  const harness = await startAiScanHarness(t, { parsedResult });

  const response = await postScanPo(harness.baseUrl, {
    cookie: harness.sessionCookie,
    csrfToken: harness.csrfToken,
    filePath: fixturePngPath,
    fileName: 'sample-po.png',
    mimeType: 'image/png',
  });

  assert.equal(response.status, 200);
  assert.equal(harness.aiCalls.length, 1);
  assert.equal(harness.aiCalls[0].pages.length, 1);
  assert.equal(harness.aiCalls[0].pages[0].mimeType, 'image/png');
  assert.equal(typeof harness.aiCalls[0].pages[0].base64, 'string');
  assert.ok(harness.aiCalls[0].pages[0].base64.length > 0);

  assert.equal(harness.workflowCalls.length, 1);
  assert.equal(harness.workflowCalls[0].createdBy, 'Manager User');
  assert.equal(harness.workflowCalls[0].fileName, 'sample-po.png');
  assert.equal(harness.workflowCalls[0].mimeType, 'image/png');
  assert.equal(harness.workflowCalls[0].source, 'ai-scan-po');
  assert.equal(harness.workflowCalls[0].parsed.po_number, 'PO-2001');

  assert.deepEqual(response.body, {
    ...parsedResult,
    scan_id: 'scan-test-001',
  });
});

test('scan-po accepts legacy image upload field used by the dashboard scanner', async (t) => {
  const harness = await startAiScanHarness(t);

  const response = await postScanPo(harness.baseUrl, {
    cookie: harness.sessionCookie,
    csrfToken: harness.csrfToken,
    filePath: fixturePngPath,
    fileName: 'dashboard-invoice.png',
    mimeType: 'image/png',
    fieldName: 'image',
  });

  assert.equal(response.status, 200);
  assert.equal(harness.aiCalls.length, 1);
  assert.equal(harness.workflowCalls[0].fileName, 'dashboard-invoice.png');
});

test('scan-po sends PDF uploads to AI as application/pdf while keeping the original file metadata', async (t) => {
  const parsedResult = {
    vendor: 'Harbor Foods',
    po_number: 'INV-445',
    date: '2026-05-13',
    total_cost: 88.5,
    items: [],
  };
  const harness = await startAiScanHarness(t, { parsedResult });

  const response = await postScanPo(harness.baseUrl, {
    cookie: harness.sessionCookie,
    csrfToken: harness.csrfToken,
    filePath: fixturePdfPath,
    fileName: 'sample-po.pdf',
    mimeType: 'application/pdf',
  });

  assert.equal(response.status, 200);
  assert.equal(harness.aiCalls.length, 1);
  assert.equal(harness.aiCalls[0].pages[0].mimeType, 'application/pdf');
  assert.equal(harness.workflowCalls[0].mimeType, 'application/pdf');
  assert.equal(harness.workflowCalls[0].fileName, 'sample-po.pdf');
});

test('scan-po returns 503 when AI scanning is unavailable', async (t) => {
  const harness = await startAiScanHarness(t, {
    thrownError: new Error('OPENAI_API_KEY environment variable is not set'),
  });

  const response = await postScanPo(harness.baseUrl, {
    cookie: harness.sessionCookie,
    csrfToken: harness.csrfToken,
    filePath: fixturePngPath,
    fileName: 'sample-po.png',
    mimeType: 'image/png',
  });

  assert.equal(response.status, 503);
  assert.deepEqual(response.body, { error: 'AI service is not configured. Update OPENAI_API_KEY and restart the server.' });
  assert.equal(harness.workflowCalls.length, 0);
});

test('scan-po does not expose provider authentication details when the AI key is invalid', async (t) => {
  const providerError = new Error('401 Incorrect API key provided: sk-proj-secret0z0b');
  providerError.status = 401;
  const harness = await startAiScanHarness(t, {
    thrownError: providerError,
  });

  const response = await postScanPo(harness.baseUrl, {
    cookie: harness.sessionCookie,
    csrfToken: harness.csrfToken,
    filePath: fixturePngPath,
    fileName: 'sample-po.png',
    mimeType: 'image/png',
  });

  assert.equal(response.status, 503);
  assert.deepEqual(response.body, { error: 'AI service is not configured. Update OPENAI_API_KEY and restart the server.' });
  assert.doesNotMatch(JSON.stringify(response.body), /sk-proj|Incorrect API key|secret0z0b/i);
  assert.equal(harness.workflowCalls.length, 0);
});

test('scan-po returns a clear failure when the AI vision request fails', async (t) => {
  const harness = await startAiScanHarness(t, {
    thrownError: new Error('model could not read image'),
  });

  const response = await postScanPo(harness.baseUrl, {
    cookie: harness.sessionCookie,
    csrfToken: harness.csrfToken,
    filePath: fixturePngPath,
    fileName: 'sample-po.png',
    mimeType: 'image/png',
  });

  assert.equal(response.status, 502);
  assert.deepEqual(response.body, { error: 'PO scan failed. Please try again with a clearer image or enter the details manually.' });
  assert.equal(harness.workflowCalls.length, 0);
});

test('scan-po merges multiple page uploads into a single parse and records every filename', async (t) => {
  const parsedResult = {
    vendor: 'Harbor Foods',
    po_number: 'PO-3003',
    date: '2026-06-30',
    total_cost: 120,
    items: [],
  };
  const harness = await startAiScanHarness(t, { parsedResult });

  const response = await postScanPo(harness.baseUrl, {
    cookie: harness.sessionCookie,
    csrfToken: harness.csrfToken,
    files: [
      { filePath: fixturePngPath, fileName: 'page-1.png', mimeType: 'image/png', fieldName: 'image' },
      { filePath: fixturePdfPath, fileName: 'page-2.pdf', mimeType: 'application/pdf', fieldName: 'image' },
    ],
  });

  assert.equal(response.status, 200);
  // One combined parse call carrying both pages in order.
  assert.equal(harness.aiCalls.length, 1);
  assert.equal(harness.aiCalls[0].pages.length, 2);
  assert.equal(harness.aiCalls[0].pages[0].mimeType, 'image/png');
  assert.equal(harness.aiCalls[0].pages[1].mimeType, 'application/pdf');

  // Audit record lists all page filenames.
  assert.equal(harness.workflowCalls.length, 1);
  assert.equal(harness.workflowCalls[0].fileName, 'page-1.png, page-2.pdf');
});

test('scan-po rejects more than five pages before calling the AI model', async (t) => {
  const harness = await startAiScanHarness(t);

  const files = Array.from({ length: 6 }, (_, i) => ({
    filePath: fixturePngPath,
    fileName: `page-${i + 1}.png`,
    mimeType: 'image/png',
    fieldName: 'image',
  }));

  const response = await postScanPo(harness.baseUrl, {
    cookie: harness.sessionCookie,
    csrfToken: harness.csrfToken,
    files,
  });

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error: 'Too many pages. Upload at most 5 images per scan.' });
  assert.equal(harness.aiCalls.length, 0);
  assert.equal(harness.workflowCalls.length, 0);
});

test('scan-po rejects the batch when one page has an unsupported type', async (t) => {
  const harness = await startAiScanHarness(t);

  const response = await postScanPo(harness.baseUrl, {
    cookie: harness.sessionCookie,
    csrfToken: harness.csrfToken,
    files: [
      { filePath: fixturePngPath, fileName: 'page-1.png', mimeType: 'image/png', fieldName: 'image' },
      { filePath: fixturePngPath, fileName: 'notes.txt', mimeType: 'text/plain', fieldName: 'image' },
    ],
  });

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error: 'Unsupported file type. Upload a JPEG, PNG, WEBP, or PDF.' });
  assert.equal(harness.aiCalls.length, 0);
});
