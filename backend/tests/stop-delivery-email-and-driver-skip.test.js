const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..', '..');
const stopsRouteSource = fs.readFileSync(path.join(repoRoot, 'backend', 'routes', 'stops.js'), 'utf8');
const driverApiSource = fs.readFileSync(path.join(repoRoot, 'driver-app', 'src', 'lib', 'api.ts'), 'utf8');
const stopDetailPageSource = fs.readFileSync(path.join(repoRoot, 'driver-app', 'src', 'pages', 'StopDetailPage.tsx'), 'utf8');
const driverAppHookSource = fs.readFileSync(path.join(repoRoot, 'driver-app', 'src', 'hooks', 'useDriverApp.tsx'), 'utf8');
const driverLocationUpdaterSource = fs.readFileSync(path.join(repoRoot, 'driver-app', 'src', 'hooks', 'useLocationUpdater.ts'), 'utf8');

test('stop depart email follows the stop invoice instead of customer fallback order lookup', () => {
  for (const marker of [
    "if (stop.invoice_id) {",
    "scopeQueryByContext(supabase.from('invoices').select('*'), context).eq('id', stop.invoice_id).single();",
    'const requestInvoiceId = req.body?.invoice_id || req.body?.invoiceId || null;',
    "{ ...stopForInvoice, status: 'completed', driver_notes: driverNotes },",
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
    "const invoice = await syncLinkedInvoiceForStop(",
    "{ ...stopForInvoice, status: 'completed', driver_notes: driverNotes },",
    'updates.status = nextStatus;',
  ]) {
    assert.ok(stopsRouteSource.includes(marker), `stops route missing invoice sync marker ${marker}`);
  }
});

test('driver app exposes a dedicated skip to end action on the stop detail screen', () => {
  for (const marker of [
    'export async function deferStop(stopId: string',
    "return request(`/api/stops/${stopId}/defer`, {",
    'deferStopToEnd: (stop: DriverStop) => Promise<void>;',
    'async function deferStopToEnd(stop: DriverStop)',
    "await deferStop(stop.id, clientActionId);",
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
    "const deliveryButtonLabel = signatureRequired && needsProofBeforeDelivery",
    "? 'Capture Photo + Deliver'",
  ]) {
    assert.ok(stopDetailPageSource.includes(marker), `driver POD flow missing marker ${marker}`);
  }
});

test('driver location updates require active route work and expire after idle timeout', () => {
  for (const marker of [
    'const activeRouteStops = currentRoute?.stops ?? [];',
    'const hasActiveRouteWork = activeRouteStops.length > 0 && activeRouteStops.some(',
    'const routeLocationUpdatesEnabled = Boolean(currentRoute && stop && hasActiveRouteWork);',
    'useLocationUpdater(routeLocationUpdatesEnabled);',
  ]) {
    assert.ok(stopDetailPageSource.includes(marker), `stop detail location gating missing marker ${marker}`);
  }

  assert.ok(
    !stopDetailPageSource.includes('useLocationUpdater(true)'),
    'driver location updater should not be hardcoded enabled',
  );

  for (const marker of [
    'const LOCATION_UPDATE_IDLE_TIMEOUT_MS = 30 * 60 * 1000;',
    'const lastActiveAtRef = useRef(Date.now());',
    'if (now - lastActiveAtRef.current > LOCATION_UPDATE_IDLE_TIMEOUT_MS) return;',
    'void sendLocation({ userInitiated: true });',
  ]) {
    assert.ok(driverLocationUpdaterSource.includes(marker), `location updater idle cutoff missing marker ${marker}`);
  }
});

test('driver location updater surfaces iOS permission denial instead of toggling a dead warning ref', () => {
  assert.ok(!driverLocationUpdaterSource.includes('hasWarnedRef'), 'dead warning ref should be removed');

  for (const marker of [
    'function isIosLocationDenied(error: GeolocationPositionError)',
    'error.code === error.PERMISSION_DENIED',
    '/iphone|ipad|ipod/i.test(window.navigator.userAgent)',
    'const deniedToastShownRef = useRef(false);',
    'deniedToastShownRef.current = true;',
    'Location permission denied. Enable Location Services for this app in iOS Settings to share route updates.',
  ]) {
    assert.ok(driverLocationUpdaterSource.includes(marker), `iOS location denial toast missing marker ${marker}`);
  }
});
