# Emailed Invoice Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every NodeRoute invoice email include a concise ordered-items-and-total body plus a complete attached PDF using editable per-company invoice details and an immutable per-invoice snapshot.

**Architecture:** Add a tenant-scoped invoice document service that enriches an invoice once, normalizes the approved document model, and snapshots the customer-facing values. Extend existing `companies.settings` for seller/remit/legal fields, then make the HTML email and PDF consume the same model so every send path stays consistent.

**Tech Stack:** Node.js 20, Express, Supabase Postgres 17, PDFKit, React 18, TypeScript, TanStack Query, Vitest, Node test runner.

## Global Constraints

- Preserve NodeRoute's existing tenant and location scoping on every related-record lookup.
- Keep the service-role key backend-only and do not weaken existing RLS or grants.
- Store seller/remit/legal configuration in existing `companies.settings`; do not create a new settings table.
- The email body shows ordered items and invoice total only; the attached PDF shows the complete approved invoice.
- Escape every stored value rendered into HTML.
- Do not add runtime dependencies.
- Do not commit the reference image, rendered previews, or anything under `Reports/`.
- Use Node 20 in CI; local Node 26 warnings must not replace test, build, and lint evidence.

---

### Task 1: Invoice snapshot schema and pure document model

**Files:**
- Modify: `supabase/migrations/20260710101729_invoice_document_snapshot.sql`
- Create: `backend/services/invoice-document.js`
- Create: `backend/tests/invoice-document.test.js`

**Interfaces:**
- Consumes: raw `{ invoice, companySettings, order, customer, stop, route, driver }` records.
- Produces: `buildInvoiceDocument(input): InvoiceDocument`, `snapshotInvoiceDocument(document): object`, `countInvoicePieces(items): number`.

- [ ] **Step 1: Write the failing pure-model tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildInvoiceDocument,
  countInvoicePieces,
  snapshotInvoiceDocument,
} = require('../services/invoice-document');

test('buildInvoiceDocument maps the approved customer invoice fields', () => {
  const document = buildInvoiceDocument({
    invoice: {
      id: 'inv-1', invoice_number: 'INV-10482', customer_name: 'Harbor Kitchen',
      customer_address: '125 Waterfront Drive', billing_name: 'Harbor Kitchen LLC',
      billing_contact: 'Morgan Lee', billing_address: '100 Harbor Way',
      billing_phone: '843-555-0100', billing_email: 'billing@example.test',
      subtotal: 865, tax: 77.85, total: 942.85, created_at: '2026-07-10T12:00:00Z',
      items: [
        { item_number: 'FISH-101', requested_qty: 3, quantity: 3, unit: 'case', description: 'Grouper', lot_number: 'LOT-7021', unit_price: 145, total: 435 },
        { item_number: 'SHR-16', requested_weight: 20, actual_weight: 18.4, quantity: 18.4, unit: 'lb', description: 'Shrimp', lot_number: 'LOT-7050', unit_price: 13.75, total: 253 },
      ],
    },
    companySettings: { businessName: "Crosby's Seafood", invoicePhone: '(843) 577-3531', invoiceSafetyNotice: 'ALL SEAFOOD SHOULD BE FULLY COOKED' },
    order: { created_at: '2026-07-10T11:00:00Z', salesperson_name: 'Jordan Reed' },
    customer: { customer_number: '004', payment_terms: 'NET 30 DAYS' },
    stop: { scheduled_date: '2026-07-11' },
    route: { name: 'North' },
    driver: { vehicle_id: 'Truck 8' },
  });

  assert.equal(document.metadata.customerNumber, '004');
  assert.equal(document.metadata.salesperson, 'Jordan Reed');
  assert.equal(document.metadata.truckRoute, 'Truck 8 / North');
  assert.equal(document.items[0].orderedQuantity, 3);
  assert.equal(document.items[1].shippedQuantity, 18.4);
  assert.equal(document.totals.pieceCount, 3);
  assert.equal(document.totals.total, 942.85);
});

test('snapshotInvoiceDocument excludes base64 image payloads', () => {
  const snapshot = snapshotInvoiceDocument({ seller: { logoDataUrl: 'data:image/png;base64,AAA' }, signature: { imageData: 'data:image/png;base64,BBB' }, proofOfDelivery: { imageData: 'data:image/jpeg;base64,CCC' } });
  assert.equal(snapshot.seller.logoDataUrl, null);
  assert.equal(snapshot.signature.imageData, null);
  assert.equal(snapshot.proofOfDelivery.imageData, null);
});

test('countInvoicePieces excludes weight units', () => {
  assert.equal(countInvoicePieces([{ shippedQuantity: 4, uom: 'case' }, { shippedQuantity: 18.4, uom: 'lb' }]), 4);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test backend/tests/invoice-document.test.js`

Expected: FAIL because `backend/services/invoice-document.js` does not exist.

- [ ] **Step 3: Add the migration SQL**

```sql
alter table public.invoices
  add column if not exists document_snapshot jsonb,
  add column if not exists salesperson_name text;

alter table public.orders
  add column if not exists salesperson_name text;

update public.companies
set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object(
  'invoice_address', E'2019-C Cherry Hill Lane\nCharleston, SC 29405',
  'invoice_phone', '(843) 577-3531',
  'invoice_fax', '(843) 722-2445',
  'invoice_after_hours_phone', '(843) 723-1278',
  'invoice_remit_to', E'2019-C Cherry Hill Lane\nCharleston, SC 29405',
  'invoice_sales_terms', 'The above named "SOLD TO" a) authorizes its agents to purchase seafood items from Crosby''s Seafood, Inc., b) agrees to comply with all the terms of sale if credit is extended, c) does personally guarantee the business debt to Crosby''s Seafood.',
  'invoice_credit_terms', 'A Financial Charge of 1 1/2% per month, which is an annual percentage of 18% will be added on the unpaid balance after 30 days. Customer agrees to pay all costs necessary for collection of this invoice, including reasonable attorney''s fees. I hereby accept the above product as being satisfactory.',
  'invoice_copy_label', 'CUSTOMER COPY',
  'invoice_safety_notice', 'ALL SEAFOOD SHOULD BE FULLY COOKED'
)
where id = '00000000-0000-0000-0000-000000000001'
  and lower(coalesce(settings ->> 'business_name', name, '')) like 'crosby%';
```

- [ ] **Step 4: Implement the pure document model**

```js
function lineQuantity(item, keys) {
  for (const key of keys) {
    const value = Number(item?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function normalizeInvoiceItem(item = {}) {
  const shippedQuantity = lineQuantity(item, ['shipped_qty', 'actual_weight', 'quantity', 'qty']);
  return {
    itemNumber: String(item.item_number || item.itemNumber || ''),
    orderedQuantity: lineQuantity(item, ['requested_qty', 'ordered_qty', 'requested_weight', 'quantity', 'qty']),
    shippedQuantity,
    uom: String(item.unit || item.uom || ''),
    description: String(item.description || item.name || ''),
    lotNumber: String(item.lot_number || ''),
    unitPrice: Number(item.unit_price ?? item.unitPrice ?? 0) || 0,
    extension: Number(item.total) || 0,
  };
}

function countInvoicePieces(items = []) {
  const weightUnits = new Set(['lb', 'lbs', 'kg', 'kgs', 'oz']);
  return items.reduce((sum, item) => weightUnits.has(String(item.uom || '').toLowerCase()) ? sum : sum + (Number(item.shippedQuantity) || 0), 0);
}
```

```js
function buildInvoiceDocument({ invoice = {}, companySettings = {}, order = {}, customer = {}, stop = {}, route = {}, driver = {} }) {
  const items = (invoice.items || []).map(normalizeInvoiceItem);
  return {
    seller: {
      businessName: companySettings.businessName || 'NodeRoute Systems',
      logoDataUrl: companySettings.invoiceLogoDataUrl || null,
      address: companySettings.invoiceAddress || '',
      phone: companySettings.invoicePhone || '',
      fax: companySettings.invoiceFax || '',
      afterHoursPhone: companySettings.invoiceAfterHoursPhone || '',
      remitTo: companySettings.invoiceRemitTo || '',
      salesTerms: companySettings.invoiceSalesTerms || '',
      creditTerms: companySettings.invoiceCreditTerms || '',
      copyLabel: companySettings.invoiceCopyLabel || '',
      safetyNotice: companySettings.invoiceSafetyNotice || '',
    },
    soldTo: {
      name: invoice.billing_name || invoice.customer_name || '',
      contact: invoice.billing_contact || customer.contact_name || '',
      address: invoice.billing_address || customer.billing_address || customer.address || '',
      phone: invoice.billing_phone || customer.billing_phone || customer.phone_number || '',
      email: invoice.billing_email || customer.billing_email || invoice.customer_email || '',
    },
    shippedTo: { name: invoice.customer_name || '', address: invoice.customer_address || order.customer_address || '' },
    metadata: {
      invoiceNumber: invoice.invoice_number || String(invoice.id || '').slice(0, 8).toUpperCase(),
      customerNumber: customer.customer_number || '',
      salesperson: invoice.salesperson_name || order.salesperson_name || '',
      truckRoute: [driver.vehicle_id, route.name].filter(Boolean).join(' / '),
      orderDate: order.created_at || invoice.created_at || null,
      deliveryDate: stop.scheduled_date || null,
      paymentTerms: customer.payment_terms || customer.credit_terms || '',
    },
    items,
    totals: {
      pieceCount: countInvoicePieces(items),
      subtotal: Number(invoice.subtotal) || 0,
      tax: Number(invoice.tax) || 0,
      total: Number(invoice.total) || 0,
    },
    signature: { imageData: invoice.signature_data || null, signedAt: invoice.signed_at || null },
    proofOfDelivery: { imageData: invoice.proof_of_delivery_image_data || null, uploadedAt: invoice.proof_of_delivery_uploaded_at || null },
  };
}

function snapshotInvoiceDocument(document) {
  return {
    ...document,
    seller: { ...document.seller, logoDataUrl: null },
    signature: { ...document.signature, imageData: null },
    proofOfDelivery: { ...document.proofOfDelivery, imageData: null },
  };
}
```

- [ ] **Step 5: Run the model tests and verify GREEN**

Run: `node --test backend/tests/invoice-document.test.js`

Expected: 3 tests pass, 0 fail.

- [ ] **Step 6: Commit the schema and model**

```bash
git add supabase/migrations/20260710101729_invoice_document_snapshot.sql backend/services/invoice-document.js backend/tests/invoice-document.test.js
git commit -m "feat: add invoice document snapshots"
```

---

### Task 2: Editable company invoice settings

**Files:**
- Modify: `backend/services/company-settings.js`
- Modify: `backend/routes/settings.js`
- Create: `backend/tests/company-invoice-settings.test.js`

**Interfaces:**
- Consumes: snake_case values in `companies.settings` and existing company profile columns.
- Produces: camelCase `CompanySettings` fields including `invoiceAddress`, `invoicePhone`, `invoiceFax`, `invoiceAfterHoursPhone`, `invoiceRemitTo`, `invoiceSalesTerms`, `invoiceCreditTerms`, `invoiceCopyLabel`, and `invoiceSafetyNotice`.

- [ ] **Step 1: Write failing normalization tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCompanySettings } = require('../services/company-settings');

test('normalizes editable invoice identity and legal settings', () => {
  const settings = normalizeCompanySettings({
    invoice_address: '2019-C Cherry Hill Lane\nCharleston, SC 29405',
    invoice_phone: '(843) 577-3531',
    invoice_fax: '(843) 722-2445',
    invoice_after_hours_phone: '(843) 723-1278',
    invoice_remit_to: '2019-C Cherry Hill Lane\nCharleston, SC 29405',
    invoice_sales_terms: 'Sales terms',
    invoice_credit_terms: 'Credit terms',
    invoice_copy_label: 'CUSTOMER COPY',
    invoice_safety_notice: 'ALL SEAFOOD SHOULD BE FULLY COOKED',
  });
  assert.equal(settings.invoicePhone, '(843) 577-3531');
  assert.equal(settings.invoiceFax, '(843) 722-2445');
  assert.equal(settings.invoiceCopyLabel, 'CUSTOMER COPY');
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test backend/tests/company-invoice-settings.test.js`

Expected: FAIL because the normalized invoice fields are undefined.

- [ ] **Step 3: Extend company settings normalization and loading**

```js
function boundedText(value, maxLength) {
  return normalizeString(value).slice(0, maxLength);
}

const profileAddress = [profile.address, [profile.city, profile.state, profile.zip].filter(Boolean).join(' ')].filter(Boolean).join('\n');

return {
  ...existingSettings,
  invoiceAddress: boundedText(source.invoice_address || profileAddress, 500),
  invoicePhone: boundedText(source.invoice_phone || profile.phone, 200),
  invoiceFax: boundedText(source.invoice_fax, 200),
  invoiceAfterHoursPhone: boundedText(source.invoice_after_hours_phone, 200),
  invoiceRemitTo: boundedText(source.invoice_remit_to || profileAddress, 500),
  invoiceSalesTerms: boundedText(source.invoice_sales_terms, 4000),
  invoiceCreditTerms: boundedText(source.invoice_credit_terms, 4000),
  invoiceCopyLabel: boundedText(source.invoice_copy_label, 200),
  invoiceSafetyNotice: boundedText(source.invoice_safety_notice, 200),
};
```

Change the company select to `name,phone,address,city,state,zip,settings` and pass the profile row into `normalizeCompanySettings`.

- [ ] **Step 4: Extend the settings PATCH route**

Write snake_case fields into `mergedSettings` while preserving unrelated keys:

```js
invoice_address: normalized.invoiceAddress,
invoice_phone: normalized.invoicePhone,
invoice_fax: normalized.invoiceFax,
invoice_after_hours_phone: normalized.invoiceAfterHoursPhone,
invoice_remit_to: normalized.invoiceRemitTo,
invoice_sales_terms: normalized.invoiceSalesTerms,
invoice_credit_terms: normalized.invoiceCreditTerms,
invoice_copy_label: normalized.invoiceCopyLabel,
invoice_safety_notice: normalized.invoiceSafetyNotice,
```

- [ ] **Step 5: Run backend settings tests and verify GREEN**

Run: `node --test backend/tests/company-invoice-settings.test.js backend/tests/company-config-context.test.js`

Expected: all tests pass.

- [ ] **Step 6: Commit backend settings**

```bash
git add backend/services/company-settings.js backend/routes/settings.js backend/tests/company-invoice-settings.test.js
git commit -m "feat: add editable invoice settings"
```

---

### Task 3: Invoice settings UI

**Files:**
- Create: `frontend-v2/src/pages/InvoiceSettingsFields.tsx`
- Create: `frontend-v2/src/pages/InvoiceSettingsFields.test.tsx`
- Modify: `frontend-v2/src/hooks/useSettings.ts`
- Modify: `frontend-v2/src/pages/SettingsPage.tsx`

**Interfaces:**
- Consumes: the invoice settings fields from `CompanySettings` and one `onChange(field, value)` callback.
- Produces: accessible labeled controls embedded in the existing Company Controls card.

- [ ] **Step 1: Write the failing component test**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InvoiceSettingsFields } from './InvoiceSettingsFields';

describe('InvoiceSettingsFields', () => {
  it('shows the approved editable invoice fields and reports changes', () => {
    const onChange = vi.fn();
    render(<InvoiceSettingsFields values={{ invoicePhone: '(843) 577-3531', invoiceSafetyNotice: 'ALL SEAFOOD SHOULD BE FULLY COOKED' }} disabled={false} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Invoice phone'), { target: { value: '(843) 555-0100' } });
    expect(screen.getByLabelText('Sales terms')).toBeInTheDocument();
    expect(screen.getByLabelText('Credit terms')).toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith('invoicePhone', '(843) 555-0100');
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm --prefix frontend-v2 run test -- InvoiceSettingsFields.test.tsx`

Expected: FAIL because `InvoiceSettingsFields` does not exist.

- [ ] **Step 3: Implement the field component**

```tsx
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import type { CompanySettings } from '../hooks/useSettings';

type InvoiceSettingKey = 'invoiceAddress' | 'invoicePhone' | 'invoiceFax' | 'invoiceAfterHoursPhone' | 'invoiceRemitTo' | 'invoiceSalesTerms' | 'invoiceCreditTerms' | 'invoiceCopyLabel' | 'invoiceSafetyNotice';

export function InvoiceSettingsFields({ values, disabled, onChange }: { values: CompanySettings; disabled: boolean; onChange: (field: InvoiceSettingKey, value: string) => void }) {
  const inputs: Array<[InvoiceSettingKey, string]> = [['invoicePhone', 'Invoice phone'], ['invoiceFax', 'Fax'], ['invoiceAfterHoursPhone', 'After-hours phone'], ['invoiceCopyLabel', 'Copy label'], ['invoiceSafetyNotice', 'Safety notice']];
  const textareas: Array<[InvoiceSettingKey, string]> = [['invoiceAddress', 'Invoice address'], ['invoiceRemitTo', 'Remit-to address'], ['invoiceSalesTerms', 'Sales terms'], ['invoiceCreditTerms', 'Credit terms']];
  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2">{inputs.map(([field, label]) => <label key={field} className="space-y-1 text-sm"><span>{label}</span><Input aria-label={label} value={String(values[field] || '')} disabled={disabled} onChange={(event) => onChange(field, event.target.value)} /></label>)}</div>
    <div className="grid gap-3 sm:grid-cols-2">{textareas.map(([field, label]) => <label key={field} className="space-y-1 text-sm"><span>{label}</span><Textarea aria-label={label} value={String(values[field] || '')} disabled={disabled} onChange={(event) => onChange(field, event.target.value)} /></label>)}</div>
  </div>;
}
```

- [ ] **Step 4: Integrate the fields with Settings state and payloads**

```tsx
const [invoiceSettings, setInvoiceSettings] = useState<CompanySettings | null>(null);
const invoiceValues = invoiceSettings ?? company;

function updateInvoiceSetting(field: InvoiceSettingKey, value: string) {
  setInvoiceSettings((current) => ({ ...(current ?? company), [field]: value }));
}

await saveCompany.mutateAsync({
  forceDriverSignature: sig,
  forceDriverProofOfDelivery: pod,
  businessName: biz.trim(),
  invoiceLogoDataUrl: logo,
  orderCutoffHour: cutoffHour,
  orderCutoffDay: cutoffDay,
  ...invoiceValues,
});
```

Render `<InvoiceSettingsFields values={invoiceValues} disabled={isCompanyDisabled} onChange={updateInvoiceSetting} />`, reset `invoiceSettings` to `null` after success, and include `invoiceSettings !== null` in `companyDirty`.

- [ ] **Step 5: Run the component test, TypeScript build, and lint**

Run: `npm --prefix frontend-v2 run test -- InvoiceSettingsFields.test.tsx`

Expected: PASS.

Run: `npm --prefix frontend-v2 run build`

Expected: exit 0.

Run: `npm --prefix frontend-v2 run lint`

Expected: 0 errors and no new warnings in touched files.

- [ ] **Step 6: Commit the settings UI**

```bash
git add frontend-v2/src/pages/InvoiceSettingsFields.tsx frontend-v2/src/pages/InvoiceSettingsFields.test.tsx frontend-v2/src/hooks/useSettings.ts frontend-v2/src/pages/SettingsPage.tsx
git commit -m "feat: expose invoice document settings"
```

---

### Task 4: Shared enrichment and salesperson capture

**Files:**
- Modify: `backend/services/invoice-document.js`
- Modify: `backend/routes/orders.js`
- Modify: `backend/routes/invoices.js`
- Modify: `backend/tests/order-fulfillment-email.test.js`
- Modify: `backend/tests/invoice-document.test.js`

**Interfaces:**
- Consumes: invoice id/company/location plus linked order/customer/stop/route/driver records.
- Produces: `loadInvoiceDocument(invoice, { db, loadSettings }): Promise<InvoiceDocument>` and captures `salesperson_name` when orders or invoices are created.

- [ ] **Step 1: Write failing enrichment and salesperson tests**

```js
test('loadInvoiceDocument reuses an immutable snapshot without querying related records', async () => {
  const snapshot = { metadata: { invoiceNumber: 'INV-OLD' }, items: [], totals: { total: 25 } };
  const db = { from() { throw new Error('database should not be queried'); } };
  const document = await loadInvoiceDocument({ document_snapshot: snapshot }, { db });
  assert.deepEqual(document, snapshot);
});

test('invoice document source scopes every related table', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'services', 'invoice-document.js'), 'utf8');
  for (const table of ['invoices', 'orders', 'Customers', 'stops', 'routes', 'users']) {
    assert.match(source, new RegExp(`from\\(['\"]${table}['\"]\\)`));
  }
  assert.match(source, /scopeQueryByContext/);
});

test('order and invoice creation capture salesperson identity', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const orders = fs.readFileSync(path.join(__dirname, '..', 'routes', 'orders.js'), 'utf8');
  const invoices = fs.readFileSync(path.join(__dirname, '..', 'routes', 'invoices.js'), 'utf8');
  assert.match(orders, /salesperson_name/);
  assert.match(invoices, /salesperson_name/);
  assert.match(orders, /req\.user\?\.name/);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test backend/tests/invoice-document.test.js backend/tests/order-fulfillment-email.test.js`

Expected: FAIL on missing `loadInvoiceDocument` and missing salesperson capture.

- [ ] **Step 3: Implement scoped record loading**

```js
async function loadInvoiceDocument(invoice, { db = supabase, loadSettings = loadCompanySettings } = {}) {
  if (invoice?.document_snapshot && typeof invoice.document_snapshot === 'object') return invoice.document_snapshot;
  const context = { companyId: invoice.company_id || null, locationId: invoice.location_id || null };
  const one = async (table, id) => {
    if (!id) return null;
    const result = await scopeQueryByContext(db.from(table).select('*'), context).eq('id', id).limit(1);
    if (result.error) throw result.error;
    return Array.isArray(result.data) ? result.data[0] || null : result.data || null;
  };
  const completeInvoice = await one('invoices', invoice.id) || invoice;
  const order = await one('orders', completeInvoice.order_id);
  const customer = await one('Customers', completeInvoice.customer_id || order?.customer_id);
  const stop = await one('stops', order?.stop_id);
  const route = await one('routes', order?.route_id || stop?.route_id);
  const driver = await one('users', route?.driver_id);
  const companySettings = await loadSettings(completeInvoice.company_id, completeInvoice.company_name);
  return buildInvoiceDocument({ invoice: completeInvoice, companySettings, order, customer, stop, route, driver });
}
```

- [ ] **Step 4: Capture salesperson identity**

```js
salesperson_name: req.body?.salesperson_name || req.body?.salespersonName || req.user?.name || null,
```

Add `salesperson_name: overrides.salesperson_name || order.salesperson_name || null` to `invoicePayloadForOrder`.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `node --test backend/tests/invoice-document.test.js backend/tests/order-fulfillment-email.test.js`

Expected: all tests pass.

- [ ] **Step 6: Commit enrichment**

```bash
git add backend/services/invoice-document.js backend/routes/orders.js backend/routes/invoices.js backend/tests/invoice-document.test.js backend/tests/order-fulfillment-email.test.js
git commit -m "feat: enrich invoice document metadata"
```

---

### Task 5: Concise email and complete PDF rendering

**Files:**
- Modify: `backend/services/invoice-email.js`
- Modify: `backend/services/pdf.js`
- Modify: `backend/tests/html-output-escaping.test.js`
- Modify: `backend/tests/invoice-lot-forwarding.test.js`

**Interfaces:**
- Consumes: `InvoiceDocument` from Task 4.
- Produces: `renderInvoiceEmailHtml(document): string`, `buildInvoicePDF(invoice, document?): Promise<Buffer>`, and the existing `sendInvoiceEmail(invoice, subjectPrefix)` result.

- [ ] **Step 1: Write failing renderer tests**

```js
test('invoice email contains ordered items and total without attachment-only sections', () => {
  const html = renderInvoiceEmailHtml({
    seller: { businessName: '<Crosby>' },
    soldTo: { name: '<Morgan>' },
    metadata: { invoiceNumber: 'INV-10482' },
    items: [{ description: '<Grouper>', orderedQuantity: 3, uom: 'CS', extension: 435 }],
    totals: { total: 942.85 },
  });
  assert.match(html, /&lt;Grouper&gt;/);
  assert.match(html, /3 CS/);
  assert.match(html, /\$942\.85/);
  assert.doesNotMatch(html, /Sales terms|Credit terms|Lot number|Customer signature/i);
});
```

```js
const pdfSource = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'services', 'pdf.js'), 'utf8');
for (const label of ['SOLD TO', 'SHIPPED TO', 'PLEASE REMIT TO', 'CUSTOMER #', 'SALESPERSON', 'TRUCK / ROUTE', 'ORDER DATE', 'DELIVERY DATE', 'TERMS', 'INVOICE #', 'ITEM NO.', 'ORDERED', 'SHIPPED', 'UOM', 'DESCRIPTION', 'LOT NO.', 'UNIT PRICE', 'EXTENSION', 'NUMBER OF PCS.', "CUSTOMER'S SIGNATURE", 'INVOICE TOTAL', 'SALES TERMS', 'CREDIT TERMS']) {
  assert.ok(pdfSource.includes(label), `invoice PDF missing ${label}`);
}
```

- [ ] **Step 2: Run renderer tests and verify RED**

Run: `node --test backend/tests/html-output-escaping.test.js backend/tests/invoice-lot-forwarding.test.js`

Expected: FAIL because the email renderer export and PDF labels do not exist.

- [ ] **Step 3: Implement concise escaped email HTML**

```js
function renderInvoiceEmailHtml(document) {
  const rows = document.items.map((item) => `<tr><td>${escapeHtml(item.description)}</td><td style="text-align:right">${escapeHtml(item.orderedQuantity)} ${escapeHtml(item.uom)}</td><td style="text-align:right">$${money(item.extension)}</td></tr>`).join('');
  return `<div style="font-family:Arial,sans-serif;max-width:600px"><h2>${escapeHtml(document.seller.businessName)}</h2><p>Invoice ${escapeHtml(document.metadata.invoiceNumber)} is attached.</p><table style="width:100%;border-collapse:collapse"><tr><th style="text-align:left">Item ordered</th><th style="text-align:right">Quantity</th><th style="text-align:right">Line total</th></tr>${rows}</table><p style="text-align:right"><strong>Invoice total: $${money(document.totals.total)}</strong></p></div>`;
}
```

- [ ] **Step 4: Implement the approved PDF layout**

```js
const metadataLabels = ['CUSTOMER #', 'SALESPERSON', 'TRUCK / ROUTE', 'ORDER DATE', 'DELIVERY DATE', 'TERMS', 'INVOICE #'];
const itemLabels = ['ITEM NO.', 'ORDERED', 'SHIPPED', 'UOM', 'DESCRIPTION', 'LOT NO.', 'UNIT PRICE', 'EXTENSION'];

function drawLabelBand(doc, labels, y, widths) {
  let x = 40;
  doc.fillColor('#111111');
  labels.forEach((label, index) => {
    doc.rect(x, y, widths[index], 20).fill('#111111');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7).text(label, x + 3, y + 6, { width: widths[index] - 6, align: index >= labels.length - 2 ? 'right' : 'left' });
    x += widths[index];
  });
}
```

Call `drawLabelBand` for both approved bands, draw seller/sold-to/shipped-to/remit-to blocks above them, then draw piece count, signature, totals, sales terms, credit terms, copy label, and safety notice below the line rows. Continue to render the existing signature and proof-of-delivery images from the invoice record and do not render `invoice.notes`.

- [ ] **Step 5: Persist the snapshot only after successful send**

Update the invoice with one scoped write:

```js
{
  status: nextStatus,
  sent_at: new Date().toISOString(),
  document_snapshot: snapshotInvoiceDocument(document),
}
```

- [ ] **Step 6: Run renderer and send-path tests and verify GREEN**

Run: `node --test backend/tests/html-output-escaping.test.js backend/tests/invoice-lot-forwarding.test.js backend/tests/order-fulfillment-email.test.js backend/tests/stop-delivery-email-and-driver-skip.test.js`

Expected: all tests pass.

- [ ] **Step 7: Commit the renderers**

```bash
git add backend/services/invoice-email.js backend/services/pdf.js backend/tests/html-output-escaping.test.js backend/tests/invoice-lot-forwarding.test.js
git commit -m "feat: redesign emailed invoice documents"
```

---

### Task 6: Final verification and publish preparation

**Files:**
- Modify: `docs/superpowers/plans/2026-07-10-invoice-email-layout.md`

**Interfaces:**
- Consumes: all implementation tasks.
- Produces: verified branch ready for the user-requested push.

- [ ] **Step 1: Run focused backend verification**

Run: `node --test backend/tests/invoice-document.test.js backend/tests/company-invoice-settings.test.js backend/tests/html-output-escaping.test.js backend/tests/invoice-lot-forwarding.test.js backend/tests/order-fulfillment-email.test.js backend/tests/stop-delivery-email-and-driver-skip.test.js`

Expected: 0 failures.

- [ ] **Step 2: Run broad backend verification**

Run: `node --test backend/tests/*.test.js`

Expected: 0 failures.

- [ ] **Step 3: Run frontend verification**

Run: `npm --prefix frontend-v2 run test -- InvoiceSettingsFields.test.tsx`

Expected: PASS.

Run: `npm --prefix frontend-v2 run build`

Expected: exit 0.

Run: `npm --prefix frontend-v2 run lint`

Expected: 0 errors and no new warnings in touched files.

- [ ] **Step 4: Run the root production build**

Run: `npm run build`

Expected: all three web applications build successfully.

- [ ] **Step 5: Validate migration state and advisors without mutating production**

Run: `npx supabase migration list --local`

Expected: `20260710101729` appears in the local migration list.

Use the connected Supabase project to run security and performance advisors. Do not apply the migration during this publish-only task.

- [ ] **Step 6: Inspect the final diff and commit plan tracking**

```bash
git diff --check
git status --short
git diff --stat origin/main...HEAD
git add docs/superpowers/plans/2026-07-10-invoice-email-layout.md
git commit -m "docs: record invoice implementation plan"
```
