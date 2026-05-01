import {
  Camera,
  CheckCircle2,
  Gauge,
  Loader2,
  LogOut,
  Navigation,
  NotebookText,
  Route as RouteIcon,
  Satellite,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { sendWithAuth } from '../lib/api';
import { useDriverWorkspace } from '../hooks/useDriverWorkspace';
import { useLocationSharing } from '../hooks/useLocationSharing';
import { useSignatureCapture } from '../hooks/useSignatureCapture';
import { DriverRouteTab } from './DriverRouteTab';
import { SignatureModal } from './SignatureModal';
import { asDriverNumber, dwellForStop, formatDateTime, formatMoney, greeting, routeProgress, stopStatus } from './driver.types';
import type { DriverRoute, DriverTab, DwellRecord } from './driver.types';

export function DriverPage() {
  const ws = useDriverWorkspace();
  const loc = useLocationSharing();

  const [activeTab, setActiveTab]         = useState<DriverTab>('route');
  const [busyStopId, setBusyStopId]       = useState('');
  const [signatureStopId, setSignatureStopId] = useState('');
  const [signatureSaving, setSignatureSaving] = useState(false);
  const [proofUploadStopId, setProofUploadStopId] = useState('');
  const [proofUploadSaving, setProofUploadSaving] = useState(false);
  const proofInputRef = useRef<HTMLInputElement | null>(null);

  const sig = useSignatureCapture(signatureStopId);

  useEffect(() => {
    void ws.load();
    return () => loc.stopLocationSharing();
  }, []);

  const activeRoute: DriverRoute | null = useMemo(
    () => ws.routes.find((r) => r.id === ws.selectedRouteId) || ws.routes[0] || null,
    [ws.routes, ws.selectedRouteId],
  );

  const activeStops = activeRoute?.stops || [];
  const progress = routeProgress(activeStops, ws.dwellRecords, activeRoute?.id || '');
  const currentStop = activeStops.find((stop) => stopStatus(stop, activeRoute?.id || '', ws.dwellRecords) === 'arrived')
    || activeStops.find((stop) => stopStatus(stop, activeRoute?.id || '', ws.dwellRecords) === 'pending')
    || null;

  const analytics = useMemo(() => {
    const delivered = ws.deliveries.filter((item) => item.status === 'delivered');
    return {
      completedStops: progress.completed,
      onTimeRate: delivered.length
        ? Math.round((delivered.filter((item) => item.onTime !== false).length / delivered.length) * 100)
        : 100,
      milesToday: ws.deliveries.reduce((sum, item) => sum + asDriverNumber(item.distanceMiles, 0), 0),
      avgStopMinutes: delivered.length
        ? Math.round(delivered.reduce((sum, item) => sum + asDriverNumber(item.stopDurationMinutes, 0), 0) / delivered.length)
        : 0,
    };
  }, [ws.deliveries, progress.completed]);

  function logout() {
    loc.stopLocationSharing();
    localStorage.removeItem('nr_token');
    localStorage.removeItem('nr_user');
    sessionStorage.removeItem('drv_token');
    sessionStorage.removeItem('drv_user');
    window.location.href = '/login?next=%2Fdriver';
  }

  async function markArrive(stopId: string) {
    if (!activeRoute) return;
    setBusyStopId(stopId);
    try {
      const record = await sendWithAuth<DwellRecord>(`/api/stops/${stopId}/arrive`, 'POST', { routeId: activeRoute.id } as never);
      ws.applyDwell(record);
    } catch (err) {
      ws.setError(String((err as Error).message || 'Could not mark arrival.'));
    } finally {
      setBusyStopId('');
    }
  }

  async function markDepart(stopId: string) {
    if (!activeRoute) return;
    const stop = activeStops.find((s) => s.id === stopId) || null;
    if (ws.companySettings.forceDriverSignature && stop?.invoice_id && !stop.invoice_has_signature) {
      setSignatureStopId(stopId);
      return;
    }
    if (ws.companySettings.forceDriverProofOfDelivery && stop?.invoice_id && !stop.invoice_has_proof_of_delivery) {
      setProofUploadStopId(stopId);
      window.setTimeout(() => proofInputRef.current?.click(), 0);
      return;
    }
    if (ws.companySettings.forceDriverSignature && !stop?.invoice_id) {
      ws.setError('Signature is required, but this stop has no invoice attached yet.');
      return;
    }
    if (ws.companySettings.forceDriverProofOfDelivery && !stop?.invoice_id) {
      ws.setError('Proof of delivery is required, but this stop has no invoice attached yet.');
      return;
    }
    setBusyStopId(stopId);
    try {
      const record = await sendWithAuth<DwellRecord>(`/api/stops/${stopId}/depart`, 'POST', { routeId: activeRoute.id } as never);
      ws.applyDwell(record);
    } catch (err) {
      ws.setError(String((err as Error).message || 'Could not complete this stop.'));
    } finally {
      setBusyStopId('');
    }
  }

  async function downloadInvoice(invoiceId: string) {
    const token = localStorage.getItem('nr_token') || '';
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/pdf`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(String(payload?.error || 'Could not open invoice PDF.'));
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (err) {
      ws.setError(String((err as Error).message || 'Could not open invoice PDF.'));
    }
  }

  async function saveSignature() {
    const stop = activeStops.find((s) => s.id === signatureStopId) || null;
    const canvas = sig.canvasRef.current;
    if (!stop?.invoice_id || !canvas) {
      ws.setError('This stop is missing an invoice, so the signature could not be saved.');
      return;
    }
    if (!sig.hasSignatureRef.current) {
      ws.setError('Please capture a customer signature first.');
      return;
    }
    setSignatureSaving(true);
    try {
      const payload = await sendWithAuth<{ signed_at?: string; status?: string; emailSent?: boolean }>(
        `/api/invoices/${stop.invoice_id}/sign`, 'POST',
        { signature: canvas.toDataURL('image/png') } as never,
      );
      ws.updateStopInvoice(stop.id, {
        invoice_has_signature: true,
        invoice_signed_at: payload.signed_at || new Date().toISOString(),
        invoice_status: payload.status || 'signed',
      });
      setSignatureStopId('');
      ws.setError(payload.emailSent ? 'Signature saved and invoice emailed to the customer.' : '');
    } catch (err) {
      ws.setError(String((err as Error).message || 'Could not save the signature.'));
    } finally {
      setSignatureSaving(false);
    }
  }

  function promptForProofOfDelivery(stopId: string) {
    setProofUploadStopId(stopId);
    proofInputRef.current?.click();
  }

  async function handleProofOfDeliverySelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    const stop = activeStops.find((s) => s.id === proofUploadStopId) || null;
    if (!file || !stop?.invoice_id) return;
    if (!/^image\/(png|jpeg|jpg)$/i.test(file.type)) {
      ws.setError('Proof of delivery must be a PNG or JPG image.');
      return;
    }
    if (file.size > 3_000_000) {
      ws.setError('Proof of delivery image must be under 3 MB.');
      return;
    }

    setProofUploadSaving(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
        reader.onerror = () => reject(new Error('Could not read the selected image.'));
        reader.readAsDataURL(file);
      });

      const payload = await sendWithAuth<{ proof_of_delivery_uploaded_at?: string }>(
        `/api/invoices/${stop.invoice_id}/proof-of-delivery`,
        'POST',
        { proofImageData: dataUrl } as never,
      );

      ws.updateStopInvoice(stop.id, {
        invoice_has_proof_of_delivery: true,
        invoice_proof_of_delivery_uploaded_at: payload.proof_of_delivery_uploaded_at || new Date().toISOString(),
      });
      setProofUploadStopId('');
      ws.setError('');
    } catch (err) {
      ws.setError(String((err as Error).message || 'Could not upload proof of delivery.'));
    } finally {
      setProofUploadSaving(false);
    }
  }

  if (ws.loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-enterprise-gradient">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading driver workspace...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-enterprise-gradient">
      <div className="mx-auto max-w-[1180px] p-4 md:p-6">
        <header className="rounded-xl border border-border bg-card shadow-panel">
          <div className="flex flex-col gap-4 border-b border-border p-5 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-primary">
                <RouteIcon className="h-4 w-4" />
                Driver Workspace V2
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                Good {greeting()}, {ws.driverName}
              </h1>
              <p className="text-sm text-muted-foreground">
                Route execution, notes, invoices, and location updates in one dedicated driver screen.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <LocationBadge tone={loc.locationStatus.tone} text={loc.locationStatus.text} />
              {loc.watchIdRef.current == null ? (
                <Button variant="outline" onClick={loc.startLocationSharing} disabled={loc.locationBusy}>
                  <Satellite className="mr-2 h-4 w-4" />
                  {loc.locationBusy ? 'Starting...' : 'Start Location Sync'}
                </Button>
              ) : (
                <Button variant="outline" onClick={loc.stopLocationSharing}>
                  <Satellite className="mr-2 h-4 w-4" />
                  Stop Sync
                </Button>
              )}
              <Button variant="outline" onClick={logout}>
                <LogOut className="mr-2 h-4 w-4" />
                Logout
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 p-4">
            {(['route', 'analytics', 'notes', 'invoices'] as DriverTab[]).map((tab) => (
              <Button key={tab} variant={activeTab === tab ? 'default' : 'outline'} size="sm" onClick={() => setActiveTab(tab)} className="capitalize">
                {tab}
              </Button>
            ))}
            {ws.routes.length > 1 ? (
              <select
                className="ml-auto h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
                value={activeRoute?.id || ''}
                onChange={(e) => ws.setSelectedRouteId(e.target.value)}
              >
                {ws.routes.map((route) => (
                  <option key={route.id} value={route.id}>
                    {route.name || `Route ${route.id.slice(0, 8)}`}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        </header>

        {ws.error ? (
          <div className="mt-4 rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">
            {ws.error}
          </div>
        ) : null}

        <main className="mt-4 space-y-4">
          <input
            ref={proofInputRef}
            type="file"
            accept="image/png,image/jpeg,image/jpg"
            capture="environment"
            className="hidden"
            onChange={(event) => void handleProofOfDeliverySelected(event)}
          />
          {!activeRoute ? (
            <Card>
              <CardContent className="p-10 text-center">
                <div className="text-lg font-semibold text-foreground">No route assigned for today</div>
                <div className="mt-2 text-sm text-muted-foreground">Check with your dispatcher for route assignment details.</div>
              </CardContent>
            </Card>
          ) : null}

          {activeRoute && activeTab === 'route' ? (
            <DriverRouteTab
              activeRoute={activeRoute}
              dwellRecords={ws.dwellRecords}
              busyStopId={busyStopId}
              companySettings={ws.companySettings}
              onArrive={(id) => void markArrive(id)}
              onDepart={(id) => void markDepart(id)}
              onOpenSignature={setSignatureStopId}
              onUploadProofOfDelivery={promptForProofOfDelivery}
              onDownloadInvoice={(id) => void downloadInvoice(id)}
            />
          ) : null}

          {activeRoute && activeTab === 'analytics' ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard icon={CheckCircle2} label="Completed Stops" value={`${analytics.completedStops}`} />
              <MetricCard icon={Gauge}        label="On-Time Rate"    value={`${analytics.onTimeRate}%`} />
              <MetricCard icon={Navigation}   label="Miles Today"     value={`${analytics.milesToday.toFixed(1)} mi`} />
              <MetricCard icon={NotebookText} label="Avg Stop"        value={`${analytics.avgStopMinutes || 0} min`} />
            </div>
          ) : null}

          {activeRoute && activeTab === 'notes' ? (
            <Card>
              <CardHeader>
                <CardTitle>{currentStop ? 'Current / Next Stop' : 'Route Notes'}</CardTitle>
                <CardDescription>
                  Door code, stop notes, and next-action guidance for the route in front of you.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {currentStop ? (
                  <>
                    <div className="rounded-lg border border-border bg-muted/20 p-4">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {stopStatus(currentStop, activeRoute.id, ws.dwellRecords) === 'arrived' ? 'Current Stop' : 'Next Stop'}
                      </div>
                      <div className="mt-2 text-xl font-semibold text-foreground">{currentStop.name || 'Delivery Stop'}</div>
                      <div className="mt-1 text-sm text-muted-foreground">{currentStop.address || 'Address unavailable'}</div>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <Card className="border-border/80 bg-muted/20">
                        <CardHeader>
                          <CardTitle className="text-base">Door / Access Code</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="text-3xl font-semibold tracking-[0.3em] text-amber-600">
                            {currentStop.door_code || '—'}
                          </div>
                        </CardContent>
                      </Card>
                      <Card className="border-border/80 bg-muted/20">
                        <CardHeader>
                          <CardTitle className="text-base">Stop Notes</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          {currentStop.notes || 'No notes for this stop.'}
                        </CardContent>
                      </Card>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {stopStatus(currentStop, activeRoute.id, ws.dwellRecords) === 'pending' ? (
                        <Button onClick={() => void markArrive(currentStop.id)}>Mark Arrived</Button>
                      ) : (
                        <Button onClick={() => void markDepart(currentStop.id)}>Mark Departed</Button>
                      )}
                      {currentStop.invoice_id ? (
                        <Button variant="outline" onClick={() => setSignatureStopId(currentStop.id)}>
                          Capture Signature
                        </Button>
                      ) : null}
                      {currentStop.invoice_id ? (
                        <Button variant="outline" onClick={() => promptForProofOfDelivery(currentStop.id)} disabled={proofUploadSaving && proofUploadStopId === currentStop.id}>
                          <Camera className="mr-2 h-4 w-4" />
                          {proofUploadSaving && proofUploadStopId === currentStop.id
                            ? 'Uploading Photo...'
                            : currentStop.invoice_has_proof_of_delivery
                              ? 'Replace Delivery Photo'
                              : 'Upload Delivery Photo'}
                        </Button>
                      ) : null}
                    </div>
                    {ws.companySettings.forceDriverProofOfDelivery ? (
                      <div className={`rounded-md px-3 py-2 text-xs ${currentStop.invoice_has_proof_of_delivery ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                        {currentStop.invoice_has_proof_of_delivery
                          ? 'Proof-of-delivery photo uploaded for this stop.'
                          : 'Proof-of-delivery photo is required before departure.'}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    There is no active stop right now. Once a route is assigned, notes will appear here.
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}

          {activeTab === 'invoices' ? (
            <Card>
              <CardHeader>
                <CardTitle>Assigned Invoices</CardTitle>
                <CardDescription>Invoice documents available to this driver based on assigned route scope.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {ws.driverInvoices.length ? (
                  ws.driverInvoices.map((invoice) => (
                    <div key={invoice.id} className="rounded-lg border border-border bg-muted/20 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-primary">
                            {invoice.invoice_number || invoice.id.slice(0, 8)}
                          </div>
                          <div className="mt-1 text-sm text-foreground">{invoice.customer_name || 'Customer invoice'}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {formatDateTime(invoice.created_at)} · {formatMoney(invoice.total)}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant={invoice.signed_at ? 'success' : 'secondary'}>{invoice.status || 'pending'}</Badge>
                          <Button variant="outline" size="sm" onClick={() => void downloadInvoice(invoice.id)}>
                            Open PDF
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-muted-foreground">No invoices are currently assigned to this driver.</div>
                )}
              </CardContent>
            </Card>
          ) : null}
        </main>
      </div>

      {signatureStopId ? (
        <SignatureModal
          canvasRef={sig.canvasRef}
          signatureSaving={signatureSaving}
          onBegin={sig.beginSignature}
          onMove={sig.moveSignature}
          onEnd={sig.endSignature}
          onClear={sig.clearSignature}
          onSave={() => void saveSignature()}
          onClose={() => setSignatureStopId('')}
        />
      ) : null}
    </div>
  );
}

function MetricCard({ icon: Icon, label, value }: { icon: typeof CheckCircle2; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 p-5">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="mt-2 text-2xl font-semibold text-foreground">{value}</div>
        </div>
        <div className="rounded-full bg-secondary p-3 text-muted-foreground">
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

type LocationStatusTone = 'neutral' | 'success' | 'warning' | 'error';

function LocationBadge({ tone, text }: { tone: LocationStatusTone; text: string }) {
  const className =
    tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' :
    tone === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-700' :
    tone === 'error'   ? 'border-rose-200 bg-rose-50 text-rose-700' :
                         'border-slate-200 bg-slate-50 text-slate-700';
  return <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${className}`}>{text}</span>;
}
