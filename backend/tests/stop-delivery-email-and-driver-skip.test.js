const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..', '..');
const stopsRouteSource = fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'stops.js'), 'utf8');
const driverApiSource = fs.readFileSync(path.join(repoRoot, 'driver-app', 'src', 'lib', 'api.ts'), 'utf8');
const stopDetailPageSource = fs.readFileSync(path.join(repoRoot, 'driver-app', 'src', 'pages', 'StopDetailPage.tsx'), 'utf8');
const driverAppHookSource = fs.readFileSync(path.join(repoRoot, 'driver-app', 'src', 'hooks', 'useDriverApp.tsx'), 'utf8');

test('stop depart email follows the stop invoice instead of customer fallback order lookup', () => {
  for (const marker of [
    "if (stop.invoice_id) {",
    ".from('invoices').select('*').eq('id', stop.invoice_id).single();",
    "if (invoice && email) await sendInvoiceEmail(invoice, 'Invoice');",
  ]) {
    assert.ok(stopsRouteSource.includes(marker), `stops route missing marker ${marker}`);
  }

  assert.ok(!stopsRouteSource.includes(".eq('customer_id'"), 'stop depart email should not fall back to customer-based order lookup');
});

test('stop routes sync driver notes onto the linked invoice and mark it delivered on depart', () => {
  for (const marker of [
    'mergeInvoiceNotesWithDriverNotes(linkedInvoice.notes, stop.driver_notes)',
    "await syncLinkedInvoiceForStop(data, req.context, { syncDriverNotes: true });",
    "const invoice = await syncLinkedInvoiceForStop(stop, req.context, { markDelivered: true, syncDriverNotes: true });",
    'updates.status = nextStatus;',
  ]) {
    assert.ok(stopsRouteSource.includes(marker), `stops route missing invoice sync marker ${marker}`);
  }
});

test('driver app exposes a dedicated skip to end action on the stop detail screen', () => {
  for (const marker of [
    'export async function deferStop(stopId: string)',
    "return request(`/api/stops/${stopId}/defer`, {",
    'deferStopToEnd: (stop: DriverStop) => Promise<void>;',
    'async function deferStopToEnd(stop: DriverStop)',
    "await deferStop(stop.id);",
    "onClick={() => void runAction('skipped')}",
    "Skip - move to end",
  ]) {
    assert.ok(
      driverApiSource.includes(marker)
      || driverAppHookSource.includes(marker)
      || stopDetailPageSource.includes(marker),
      `driver skip flow missing marker ${marker}`,
    );
  }
});

test('driver app supports a two-tap proof-of-delivery completion path', () => {
  for (const marker of [
    "const [autoDeliverAfterPhoto, setAutoDeliverAfterPhoto] = useState(false);",
    "await runAction('delivered', image);",
    "openPhotoCapture(true);",
    "needsProofBeforeDelivery ? 'Capture Photo + Deliver' : 'Mark Delivered'",
  ]) {
    assert.ok(stopDetailPageSource.includes(marker), `driver POD flow missing marker ${marker}`);
  }
});
