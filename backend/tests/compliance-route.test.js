const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const path = require('node:path');

const routePath = require.resolve('../routes/compliance');
const supabasePath = require.resolve('../services/supabase');
const authPath = require.resolve('../middleware/auth');

function clearRouteCache() {
  for (const modulePath of [routePath, supabasePath, authPath]) {
    delete require.cache[modulePath];
  }
}

function mockSupabase({ lotCodes = [], inventoryLots = [] }) {
  return {
    from(table) {
      return {
        select() {
          if (table === 'lot_codes') return Promise.resolve({ data: lotCodes, error: null });
          if (table === 'inventory_lots') return Promise.resolve({ data: inventoryLots, error: null });
          return Promise.resolve({ data: [], error: null });
        },
      };
    },
  };
}

async function requestCompliance(pathname, data) {
  clearRouteCache();
  require.cache[supabasePath] = {
    exports: { supabase: mockSupabase(data) },
  };
  require.cache[authPath] = {
    exports: {
      authenticateToken(req, _res, next) {
        req.user = { id: 'admin-1', role: 'admin', email: 'admin@example.com' };
        req.context = { isGlobalOperator: true };
        next();
      },
      requireRole() {
        return (_req, _res, next) => next();
      },
    },
  };

  const app = express();
  app.use('/api/compliance', require('../routes/compliance'));
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${pathname}`);
    const body = await response.json();
    return { status: response.status, body };
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    clearRouteCache();
  }
}

const lotCodes = [
  {
    id: 'lot-1',
    lot_number: 'LOT-001',
    product_id: 'SALMON',
    vendor_id: 'Dock Vendor',
    received_date: '2026-05-01',
    received_by: 'Receiver',
    source_po_number: 'PO-001',
    quantity_received: 10,
    created_at: '2026-05-01T00:00:00.000Z',
  },
  {
    id: 'lot-2',
    lot_number: 'LOT-002',
    product_id: 'TUNA',
    created_at: '2026-05-10T00:00:00.000Z',
  },
];

test('GET /api/compliance/summary returns wrapped compliance summary', async () => {
  const response = await requestCompliance('/api/compliance/summary', {
    lotCodes,
    inventoryLots: [{ id: 'inv-lot-1', lot_number: 'LOT-001' }],
  });

  assert.equal(response.status, 200);
  assert.equal(typeof response.body.summary.score, 'number');
  assert.equal(response.body.summary.kte_total, 8);
  assert.equal(response.body.summary.open_gaps > 0, true);
});

test('GET /api/compliance/cte-completeness returns per-lot completeness scores', async () => {
  const response = await requestCompliance('/api/compliance/cte-completeness', {
    lotCodes,
    inventoryLots: [],
  });

  assert.equal(response.status, 200);
  assert.equal(Array.isArray(response.body.lots), true);
  assert.equal(response.body.lots[0].lot_number, 'LOT-001');
  assert.equal(typeof response.body.lots[0].score, 'number');
});

test('GET /api/compliance/gaps returns missing CTE fields', async () => {
  const response = await requestCompliance('/api/compliance/gaps', {
    lotCodes,
    inventoryLots: [],
  });

  assert.equal(response.status, 200);
  assert.equal(Array.isArray(response.body.gaps), true);
  assert.ok(response.body.gaps.some((gap) => gap.event_type === 'harvest' || gap.event_type === 'processing' || gap.event_type === 'shipping'));
});
