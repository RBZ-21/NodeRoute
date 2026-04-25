import {
  CheckCircle2,
  ClipboardList,
  FileSignature,
  Gauge,
  Loader2,
  LogOut,
  MapPin,
  Navigation,
  NotebookText,
  Route as RouteIcon,
  Satellite,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { fetchWithAuth, sendWithAuth } from '../lib/api';

type DriverTab = 'route' | 'analytics' | 'notes' | 'invoices';

type DriverStop = {
  id: string;
  position?: number;
  name?: string;
  address?: string;
  notes?: string;
  door_code?: string | null;
  invoice_id?: string | null;
  invoice_number?: string | null;
  invoice_status?: string | null;
  invoice_signed_at?: string | null;
  invoice_has_signature?: boolean;
};

type DriverRoute = {
  id: string;
  name?: string;
  driver?: string;
  stops?: DriverStop[];
};

type DwellRecord = {
  id: string;
  stopId: string;
  routeId?: string;
  arrivedAt?: string | null;
  departedAt?: string | null;
  dwellMs?: number | null;
};

type DeliverySummary = {
  id: number;
  orderId: string;
  restaurantName: string;
  status: string;
  distanceMiles?: number;
  stopDurationMinutes?: number | null;
  onTime?: boolean | null;
};

type DriverInvoice = {
  id: string;
  invoice_number?: string;
  customer_name?: string;
  customer_address?: string;
  total?: number | string;
  status?: string;
  created_at?: string;
  signed_at?: string | null;
};

type CompanySettings = {
  forceDriverSignature?: boolean;
};

type LocationStatusTone = 'neutral' | 'success' | 'warning' | 'error';

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Morning';
  if (hour < 17) return 'Afternoon';
  return 'Evening';
}

function asNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatMoney(value: number | string | undefined) {
  return asNumber(value, 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString();
}

function routeProgress(stops: DriverStop[], dwell: DwellRecord[], routeId: string) {
  const completed = stops.filter((stop) => {
    const record = dwell.find((item) => item.stopId === stop.id && String(item.routeId || '') === routeId && !!item.departedAt);
    return !!record;
  }).length;
  return {
    completed,
    total: stops.length,
    percent: stops.length ? Math.round((completed / stops.length) * 100) : 0,
  };
}

function dwellForStop(stopId: string, routeId: string, dwell: DwellRecord[]) {
  return dwell.find((item) => item.stopId === stopId && String(item.routeId || '') === routeId) || null;
}

function stopStatus(stop: DriverStop, routeId: string, dwell: DwellRecord[]) {
  const record = dwellForStop(stop.id, routeId, dwell);
  if (record?.departedAt) return 'completed';
  if (record?.arrivedAt) return 'arrived';
  if (stop.invoice_has_signature) return 'ready';
  return 'pending';
}

function stopBadgeVariant(status: string): 'warning' | 'secondary' | 'success' | 'neutral' {
  if (status === 'arrived') return 'secondary';
  if (status === 'completed') return 'success';
  if (status === 'ready') return 'success';
  return 'warning';
}

export function DriverPage() {
  const [activeTab, setActiveTab] = useState<DriverTab>('route');
  const [routes, setRoutes] = useState<DriverRoute[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState('');
  const [deliveries, setDeliveries] = useState<DeliverySummary[]>([]);
  const [dwellRecords, setDwellRecords] = useState<DwellRecord[]>([]);
  const [driverInvoices, setDriverInvoices] = useState<DriverInvoice[]>([]);
  const [companySettings, setCompanySettings] = useState<CompanySettings>({});
  const [driverName, setDriverName] = useState('Driver');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyStopId, setBusyStopId] = useState('');
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationStatus, setLocationStatus] = useState<{ text: string; tone: LocationStatusTone }>({
    text: 'Location sync idle',
    tone: 'neutral',
  });
  const [signatureStopId, setSignatureStopId] = useState('');
  const [signatureSaving, setSignatureSaving] = useState(false);

  const watchIdRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const hasSignatureRef = useRef(false);

  async function loadDriverWorkspace() {
    setLoading(true);
    setError('');
    const results = await Promise.allSettled([
      fetchWithAuth<DriverRoute[]>('/api/driver/routes'),
      fetchWithAuth<DwellRecord[]>('/api/dwell'),
      fetchWithAuth<DeliverySummary[]>('/api/deliveries'),
      fetchWithAuth<DriverInvoice[]>('/api/driver/invoices'),
      fetchWithAuth<CompanySettings>('/api/settings/company'),
    ]);

    const firstError = results.find((result) => result.status === 'rejected') as PromiseRejectedResult | undefined;
    if (firstError) {
      setError(String(firstError.reason?.message || 'Could not load the driver workspace.'));
    }

    if (results[0].status === 'fulfilled') {
      const loadedRoutes = Array.isArray(results[0].value) ? results[0].value : [];
      setRoutes(loadedRoutes);
      setSelectedRouteId((current) => current || loadedRoutes[0]?.id || '');
      setDriverName(loadedRoutes[0]?.driver || JSON.parse(localStorage.getItem('nr_user') || '{}')?.name || 'Driver');
    }
    if (results[1].status === 'fulfilled') setDwellRecords(Array.isArray(results[1].value) ? results[1].value : []);
    if (results[2].status === 'fulfilled') setDeliveries(Array.isArray(results[2].value) ? results[2].value : []);
    if (results[3].status === 'fulfilled') setDriverInvoices(Array.isArray(results[3].value) ? results[3].value : []);
    if (results[4].status === 'fulfilled') setCompanySettings(results[4].value || {});

    setLoading(false);
  }

  useEffect(() => {
    void loadDriverWorkspace();
    return () => stopLocationSharing();
  }, []);

  const activeRoute = useMemo(
    () => routes.find((route) => route.id === selectedRouteId) || routes[0] || null,
    [routes, selectedRouteId]
  );

  const activeStops = activeRoute?.stops || [];
  const progress = routeProgress(activeStops, dwellRecords, activeRoute?.id || '');
  const currentStop = activeStops.find((stop) => stopStatus(stop, activeRoute?.id || '', dwellRecords) === 'arrived')
    || activeStops.find((stop) => stopStatus(stop, activeRoute?.id || '', dwellRecords) === 'pending')
    || null;

  const analytics = useMemo(() => {
    const delivered = deliveries.filter((item) => item.status === 'delivered');
    return {
      completedStops: progress.completed,
      onTimeRate: delivered.length
        ? Math.round((delivered.filter((item) => item.onTime !== false).length / delivered.length) * 100)
        : 100,
      milesToday: deliveries.reduce((sum, item) => sum + asNumber(item.distanceMiles, 0), 0),
      avgStopMinutes: delivered.length
        ? Math.round(delivered.reduce((sum, item) => sum + asNumber(item.stopDurationMinutes, 0), 0) / delivered.length)
        : 0,
    };
  }, [deliveries, progress.completed]);

  function logout() {
    stopLocationSharing();
    localStorage.removeItem('nr_token');
    localStorage.removeItem('nr_user');
    sessionStorage.removeItem('drv_token');
    sessionStorage.removeItem('drv_user');
    window.location.href = '/login?next=%2Fdriver';
  }

  function updateStopInvoice(stopId: string, patch: Partial<DriverStop>) {
    setRoutes((currentRoutes) =>
      currentRoutes.map((route) => ({
        ...route,
        stops: (route.stops || []).map((stop) => (stop.id === stopId ? { ...stop, ...patch } : stop)),
      }))
    );
  }

  async function markArrive(stopId: string) {
    if (!activeRoute) return;
    setBusyStopId(stopId);
    try {
      const record = await sendWithAuth<DwellRecord>(`/api/stops/${stopId}/arrive`, 'POST', {
        routeId: activeRoute.id,
      } as never);
      setDwellRecords((current) => upsertDwell(current, record));
    } catch (arriveError) {
      setError(String((arriveError as Error).message || 'Could not mark arrival.'));
    } finally {
      setBusyStopId('');
    }
  }

  async function markDepart(stopId: string) {
    if (!activeRoute) return;
    const stop = activeStops.find((candidate) => candidate.id === stopId) || null;
    if (companySettings.forceDriverSignature && stop?.invoice_id && !stop.invoice_has_signature) {
      setSignatureStopId(stopId);
      return;
    }
    if (companySettings.forceDriverSignature && !stop?.invoice_id) {
      setError('Signature is required, but this stop has no invoice attached yet.');
      return;
    }

    setBusyStopId(stopId);
    try {
      const record = await sendWithAuth<DwellRecord>(`/api/stops/${stopId}/depart`, 'POST', {
        routeId: activeRoute.id,
      } as never);
      setDwellRecords((current) => upsertDwell(current, record));
    } catch (departError) {
      setError(String((departError as Error).message || 'Could not complete this stop.'));
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
    } catch (pdfError) {
      setError(String((pdfError as Error).message || 'Could not open invoice PDF.'));
    }
  }

  function startLocationSharing() {
    if (!navigator.geolocation) {
      setLocationStatus({ text: 'Geolocation is not available on this device.', tone: 'error' });
      return;
    }
    if (watchIdRef.current != null) return;

    setLocationBusy(true);
    setLocationStatus({ text: 'Waiting for location access...', tone: 'warning' });
    const watchId = navigator.geolocation.watchPosition(
      async (position) => {
        try {
          await sendWithAuth('/api/driver/location', 'PATCH', {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            heading: position.coords.heading || 0,
            speed_mph: (position.coords.speed || 0) * 2.23694,
          });
          setLocationStatus({
            text: `Location synced at ${new Date().toLocaleTimeString()}`,
            tone: 'success',
          });
          setLocationBusy(false);
        } catch (locationError) {
          setLocationStatus({
            text: String((locationError as Error).message || 'Could not sync location.'),
            tone: 'error',
          });
          setLocationBusy(false);
        }
      },
      (geoError) => {
        setLocationStatus({
          text: geoError.message || 'Location access was blocked.',
          tone: 'error',
        });
        watchIdRef.current = null;
        setLocationBusy(false);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 15_000 }
    );

    watchIdRef.current = watchId;
  }

  function stopLocationSharing() {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setLocationStatus({ text: 'Location sync idle', tone: 'neutral' });
    setLocationBusy(false);
  }

  function openSignature(stopId: string) {
    setSignatureStopId(stopId);
  }

  useEffect(() => {
    if (!signatureStopId) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    context.scale(ratio, ratio);
    context.clearRect(0, 0, rect.width, rect.height);
    context.lineWidth = 2.5;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = '#0f172a';
    hasSignatureRef.current = false;
  }, [signatureStopId]);

  function signaturePoint(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function beginSignature(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = signaturePoint(event);
    drawingRef.current = true;
    hasSignatureRef.current = true;
    context.beginPath();
    context.moveTo(point.x, point.y);
  }

  function moveSignature(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const point = signaturePoint(event);
    context.lineTo(point.x, point.y);
    context.stroke();
  }

  function endSignature(event: React.PointerEvent<HTMLCanvasElement>) {
    drawingRef.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function clearSignature() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    const rect = canvas.getBoundingClientRect();
    context.beginPath();
    context.rect(0, 0, rect.width, rect.height);
    context.fillStyle = '#ffffff';
    context.fill();
    context.clearRect(0, 0, rect.width, rect.height);
    hasSignatureRef.current = false;
  }

  async function saveSignature() {
    const stop = activeStops.find((candidate) => candidate.id === signatureStopId) || null;
    const canvas = canvasRef.current;
    if (!stop?.invoice_id || !canvas) {
      setError('This stop is missing an invoice, so the signature could not be saved.');
      return;
    }
    if (!hasSignatureRef.current) {
      setError('Please capture a customer signature first.');
      return;
    }

    setSignatureSaving(true);
    try {
      const payload = await sendWithAuth<{
        signed_at?: string;
        status?: string;
        emailSent?: boolean;
      }>(`/api/invoices/${stop.invoice_id}/sign`, 'POST', {
        signature: canvas.toDataURL('image/png'),
      } as never);
      updateStopInvoice(stop.id, {
        invoice_has_signature: true,
        invoice_signed_at: payload.signed_at || new Date().toISOString(),
        invoice_status: payload.status || 'signed',
      });
      setSignatureStopId('');
      setError(payload.emailSent ? 'Signature saved and invoice emailed to the customer.' : '');
    } catch (signError) {
      setError(String((signError as Error).message || 'Could not save the signature.'));
    } finally {
      setSignatureSaving(false);
    }
  }

  if (loading) {
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
                Good {greeting()}, {driverName}
              </h1>
              <p className="text-sm text-muted-foreground">
                Route execution, notes, invoices, and location updates in one dedicated driver screen.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <LocationBadge tone={locationStatus.tone} text={locationStatus.text} />
              {watchIdRef.current == null ? (
                <Button variant="outline" onClick={startLocationSharing} disabled={locationBusy}>
                  <Satellite className="mr-2 h-4 w-4" />
                  {locationBusy ? 'Starting...' : 'Start Location Sync'}
                </Button>
              ) : (
                <Button variant="outline" onClick={stopLocationSharing}>
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
            {routes.length > 1 ? (
              <select
                className="ml-auto h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
                value={activeRoute?.id || ''}
                onChange={(event) => setSelectedRouteId(event.target.value)}
              >
                {routes.map((route) => (
                  <option key={route.id} value={route.id}>
                    {route.name || `Route ${route.id.slice(0, 8)}`}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        </header>

        {error ? (
          <div className="mt-4 rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <main className="mt-4 space-y-4">
          {!activeRoute ? (
            <Card>
              <CardContent className="p-10 text-center">
                <div className="text-lg font-semibold text-foreground">No route assigned for today</div>
                <div className="mt-2 text-sm text-muted-foreground">Check with your dispatcher for route assignment details.</div>
              </CardContent>
            </Card>
          ) : null}

          {activeRoute && activeTab === 'route' ? (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <CardTitle>{activeRoute.name || `Route ${activeRoute.id.slice(0, 8)}`}</CardTitle>
                      <CardDescription>
                        {progress.completed} of {progress.total} stops completed
                      </CardDescription>
                    </div>
                    <Badge variant={progress.completed === progress.total && progress.total > 0 ? 'success' : 'secondary'}>
                      {progress.percent}% complete
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${progress.percent}%` }} />
                  </div>
                </CardContent>
              </Card>

              {activeStops.map((stop, index) => {
                const status = stopStatus(stop, activeRoute.id, dwellRecords);
                const record = dwellForStop(stop.id, activeRoute.id, dwellRecords);
                const isBusy = busyStopId === stop.id;
                return (
                  <Card key={stop.id} className={status === 'arrived' ? 'border-blue-300' : status === 'completed' ? 'border-emerald-300' : ''}>
                    <CardContent className="p-4">
                      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                        <div className="space-y-3">
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-semibold text-foreground">
                              {index + 1}
                            </div>
                            <div>
                              <div className="text-sm font-semibold text-foreground">{stop.name || `Stop ${index + 1}`}</div>
                              <div className="text-sm text-muted-foreground">{stop.address || 'Address unavailable'}</div>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Badge variant={stopBadgeVariant(status)}>{status}</Badge>
                            {stop.door_code ? <Badge variant="warning">Door code {stop.door_code}</Badge> : null}
                            {stop.invoice_number ? <Badge variant="neutral">Invoice {stop.invoice_number}</Badge> : null}
                          </div>
                          {stop.notes ? <div className="text-sm text-muted-foreground">Notes: {stop.notes}</div> : null}
                          {record?.arrivedAt ? (
                            <div className="text-xs text-muted-foreground">
                              Arrived: {formatDateTime(record.arrivedAt)}
                              {record.departedAt ? ` · Departed: ${formatDateTime(record.departedAt)}` : ''}
                            </div>
                          ) : null}
                          {companySettings.forceDriverSignature ? (
                            <div className={`rounded-md px-3 py-2 text-xs ${stop.invoice_has_signature ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                              {stop.invoice_has_signature
                                ? 'Signature captured. Driver can complete this stop.'
                                : 'Signature is required before the driver can move to the next field.'}
                            </div>
                          ) : null}
                        </div>

                        <div className="flex w-full flex-col gap-2 md:w-56">
                          {status === 'pending' ? (
                            <Button disabled={isBusy} onClick={() => void markArrive(stop.id)}>
                              <MapPin className="mr-2 h-4 w-4" />
                              {isBusy ? 'Saving...' : 'Arrive'}
                            </Button>
                          ) : null}
                          {status === 'arrived' ? (
                            <>
                              {stop.invoice_id ? (
                                <Button variant="outline" disabled={isBusy} onClick={() => openSignature(stop.id)}>
                                  <FileSignature className="mr-2 h-4 w-4" />
                                  {stop.invoice_has_signature ? 'View Signature Flow' : 'Capture Signature'}
                                </Button>
                              ) : null}
                              <Button disabled={isBusy} onClick={() => void markDepart(stop.id)}>
                                <CheckCircle2 className="mr-2 h-4 w-4" />
                                {isBusy ? 'Saving...' : 'Depart'}
                              </Button>
                            </>
                          ) : null}
                          {status === 'completed' && stop.invoice_id ? (
                            <Button variant="outline" onClick={() => void downloadInvoice(stop.invoice_id || '')}>
                              <ClipboardList className="mr-2 h-4 w-4" />
                              Open Invoice PDF
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : null}

          {activeRoute && activeTab === 'analytics' ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard icon={CheckCircle2} label="Completed Stops" value={`${analytics.completedStops}`} />
              <MetricCard icon={Gauge} label="On-Time Rate" value={`${analytics.onTimeRate}%`} />
              <MetricCard icon={Navigation} label="Miles Today" value={`${analytics.milesToday.toFixed(1)} mi`} />
              <MetricCard icon={NotebookText} label="Avg Stop" value={`${analytics.avgStopMinutes || 0} min`} />
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
                        {stopStatus(currentStop, activeRoute.id, dwellRecords) === 'arrived' ? 'Current Stop' : 'Next Stop'}
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
                      {stopStatus(currentStop, activeRoute.id, dwellRecords) === 'pending' ? (
                        <Button onClick={() => void markArrive(currentStop.id)}>Mark Arrived</Button>
                      ) : (
                        <Button onClick={() => void markDepart(currentStop.id)}>Mark Departed</Button>
                      )}
                      {currentStop.invoice_id ? (
                        <Button variant="outline" onClick={() => openSignature(currentStop.id)}>
                          Capture Signature
                        </Button>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground">There is no active stop right now. Once a route is assigned, notes will appear here.</div>
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
                {driverInvoices.length ? (
                  driverInvoices.map((invoice) => (
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-border bg-card shadow-panel">
            <div className="flex items-center justify-between border-b border-border p-5">
              <div>
                <div className="text-lg font-semibold text-foreground">Capture Customer Signature</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Save a signature before completing this stop.
                </div>
              </div>
              <Button variant="outline" onClick={() => setSignatureStopId('')}>
                Close
              </Button>
            </div>
            <div className="space-y-4 p-5">
              <div className="rounded-lg border border-dashed border-border bg-white p-3">
                <canvas
                  ref={canvasRef}
                  className="h-56 w-full cursor-crosshair rounded-md"
                  onPointerDown={beginSignature}
                  onPointerMove={moveSignature}
                  onPointerUp={endSignature}
                  onPointerLeave={endSignature}
                />
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" onClick={clearSignature}>
                  Clear
                </Button>
                <Button variant="outline" onClick={() => setSignatureStopId('')}>
                  Cancel
                </Button>
                <Button onClick={() => void saveSignature()} disabled={signatureSaving}>
                  {signatureSaving ? 'Saving...' : 'Save Signature'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function upsertDwell(list: DwellRecord[], record: DwellRecord) {
  const index = list.findIndex((item) => item.id === record.id);
  if (index >= 0) {
    const next = [...list];
    next[index] = record;
    return next;
  }
  return [...list, record];
}

function MetricCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CheckCircle2;
  label: string;
  value: string;
}) {
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

function LocationBadge({ tone, text }: { tone: LocationStatusTone; text: string }) {
  const className =
    tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : tone === 'warning'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : tone === 'error'
          ? 'border-rose-200 bg-rose-50 text-rose-700'
          : 'border-slate-200 bg-slate-50 text-slate-700';
  return <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${className}`}>{text}</span>;
}
