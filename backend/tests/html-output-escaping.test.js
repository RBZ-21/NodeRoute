const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');

test('HTML escaping helper encodes markup and preserves text line breaks safely', () => {
  const { escapeHtml, textToHtml } = require('../lib/html');

  assert.equal(
    escapeHtml(`<img src=x onerror="alert('x')">&`),
    '&lt;img src=x onerror=&quot;alert(&#x27;x&#x27;)&quot;&gt;&amp;'
  );
  assert.equal(
    textToHtml('<b>Line 1</b>\n<script>alert(1)</script>'),
    '&lt;b&gt;Line 1&lt;/b&gt;<br>&lt;script&gt;alert(1)&lt;/script&gt;'
  );
});

test('print slip HTML escapes rendered order text before sending text/html', () => {
  const source = read('backend', 'routes', 'print.js');

  assert.ok(source.includes("const { escapeHtml } = require('../lib/html')"));
  assert.ok(source.includes('escapeHtml(renderOrderSlip({ ...data, items: data.items || [] }))'));
});

test('invoice email HTML shows only ordered items and total with escaped values', () => {
  const { renderInvoiceEmailHtml } = require('../services/invoice-email');
  const html = renderInvoiceEmailHtml({
    seller: { businessName: '<Crosby & Sons>' },
    soldTo: { name: '<Morgan>' },
    metadata: { invoiceNumber: 'INV-10482' },
    items: [
      {
        description: '<Grouper>',
        orderedQuantity: 3,
        uom: 'CS',
        extension: 435,
        lotNumber: 'LOT-SECRET',
      },
    ],
    totals: { total: 942.85 },
  });

  assert.match(html, /&lt;Crosby &amp; Sons&gt;/);
  assert.match(html, /Hi &lt;Morgan&gt;/);
  assert.match(html, /&lt;Grouper&gt;/);
  assert.match(html, /3 CS/);
  assert.match(html, /\$435\.00/);
  assert.match(html, /\$942\.85/);
  for (const excluded of ['LOT-SECRET', 'Sales Terms', 'Credit Terms', 'Signature', 'Remit To']) {
    assert.ok(!html.includes(excluded), `email should not include ${excluded}`);
  }
});

test('AI reorder alert email escapes generated text before adding HTML line breaks', () => {
  const source = read('backend', 'routes', 'inventory.js');

  assert.ok(source.includes("const { textToHtml } = require('../lib/html')"));
  assert.ok(source.includes('${textToHtml(alert.body)}'));
  assert.ok(!source.includes("alert.body.replace(/\\n/g, '<br>')"));
});
