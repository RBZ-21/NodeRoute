import { Bell, BellOff, CheckCircle2, Clock, Loader2, MapPin, Navigation, Package, Truck } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';

type TrackingData = {
  orderId: string;
  orderNumber: string;
  status: string;
  deliveryAddress: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  stopsBeforeYou: number;
  totalRouteStops: number;
  driver: {
    name: string;
    lat: number;
    lng: number;
    heading: number;
    speed_mph: number;
    updatedAt: string | null;
  };
  destination: { lat: number | null; lng: number | null };
  eta: {
    totalMinutes: number;
    driveMinutes: number;
    dwellMinutes: number;
    etaTime: string;
  } | null;
};

type FetchState = 'loading' | 'error' | 'expired' | 'notfound' | 'ready';

function getToken(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get('t') || params.get('token') || '';
}

function statusLabel(status: string, delivered: boolean): string {
  if (delivered) return 'Delivered';
  switch (status) {
    case 'in_process':
    case 'processed':
      return 'Out for Delivery';
    case 'pending':
      return 'Preparing';
    default:
      return 'On the Way';
  }
}

function statusColor(status: string, delivered: boolean): string {
  if (delivered) return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
  if (status === 'pending') return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300';
  return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
}

function freshnessLabel(updatedAt: string | null): string {
  if (!updatedAt) return 'Location unknown';
  const seconds = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 1000);
  if (seconds < 30) return 'Just updated';
  if (seconds < 120) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return 'Over an hour ago';
}

function formatEtaTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function etaCountdown(etaIso: string): string {
  const diffMs = new Date(etaIso).getTime() - Date.now();
  if (diffMs <= 0) return 'Arriving now';
  const totalMin = Math.ceil(diffMs / 60000);
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

declare global {
  interface Window {
    google?: {
      maps: {
        Map: new (el: HTMLElement, opts: object) => GoogleMap;
        Marker: new (opts: object) => GoogleMarker;
        Polyline: new (opts: object) => GooglePolyline;
        LatLng: new (lat: number, lng: number) => object;
        SymbolPath: { FORWARD_CLOSED_ARROW: number };
      };
    };
  }
}

type GoogleMap = {
  setCenter: (latlng: object) => void;
  fitBounds: (bounds: GoogleBounds) => void;
};
type GoogleMarker = {
  setPosition: (latlng: object) => void;
  setMap: (map: GoogleMap | null) => void;
};
type GooglePolyline = {
  setPath: (path: object[]) => void;
  setMap: (map: GoogleMap | null) => void;
};
type GoogleBounds = {
  extend: (latlng: object) => void;
};

function loadMapsScript(apiKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.maps) { resolve(); return; }
    const existing = document.querySelector('script[data-maps-sdk]');
    if (existing) { existing.addEventListener('load', () => resolve()); return; }
    const script = document.createElement('script');
    script.setAttribute('data-maps-sdk', '1');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Maps'));
    document.head.appendChild(script);
  });
}

const TIMELINE_STEPS = ['Order Placed', 'Preparing', 'Out for Delivery', 'Delivered'];

function timelineStep(status: string, delivered: boolean): number {
  if (delivered) return 3;
  if (status === 'in_process' || status === 'processed') return 2;
  if (status === 'pending') return 1;
  return 2;
}

export function TrackPage() {
  const token = getToken();
  const [state, setState] = useState<FetchState>(token ? 'loading' : 'notfound');
  const [errorMsg, setErrorMsg] = useState('');
  const [data, setData] = useState<TrackingData | null>(null);
  const [countdown, setCountdown] = useState('');
  const [notify, setNotify] = useState<boolean>(() => {
    try { return localStorage.getItem(`nr-track-notify:${token}`) === 'true'; } catch { return false; }
  });

  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<GoogleMap | null>(null);
  const driverMarker = useRef<GoogleMarker | null>(null);
  const destMarker = useRef<GoogleMarker | null>(null);
  const routeLine = useRef<GooglePolyline | null>(null);
  const mapsApiKey = useRef<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`/api/track/${encodeURIComponent(token)}`);
      if (res.status === 410) { setState('expired'); return; }
      if (res.status === 404) { setState('notfound'); return; }
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErrorMsg((j as { error?: string }).error || 'Unexpected error'); setState('error'); return; }
      const json = (await res.json()) as TrackingData;
      setData(json);
      setState('ready');
    } catch (e) {
      setErrorMsg(String((e as Error).message || 'Network error'));
      setState('error');
    }
  }, [token]);

  // Initial load + 30s polling
  useEffect(() => {
    void fetchData();
    const id = setInterval(() => void fetchData(), 30000);
    return () => clearInterval(id);
  }, [fetchData]);

  // ETA countdown ticker
  useEffect(() => {
    if (!data?.eta?.etaTime) { setCountdown(''); return; }
    setCountdown(etaCountdown(data.eta.etaTime));
    const id = setInterval(() => setCountdown(etaCountdown(data!.eta!.etaTime)), 10000);
    return () => clearInterval(id);
  }, [data?.eta?.etaTime]);

  // Initialise / update map
  useEffect(() => {
    if (state !== 'ready' || !data || !mapRef.current) return;

    async function setupMap() {
      try {
        if (!mapsApiKey.current) {
          const res = await fetch('/api/config/maps-key');
          if (!res.ok) return;
          const j = await res.json() as { key?: string };
          mapsApiKey.current = j.key || '';
        }
        if (!mapsApiKey.current) return;
        await loadMapsScript(mapsApiKey.current);
        const G = window.google!.maps;

        const dLat = data!.driver.lat;
        const dLng = data!.driver.lng;
        const destLat = data!.destination.lat ?? dLat;
        const destLng = data!.destination.lng ?? dLng;

        if (!mapInstance.current) {
          mapInstance.current = new G.Map(mapRef.current!, {
            zoom: 13,
            center: { lat: dLat, lng: dLng },
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
          });
          driverMarker.current = new G.Marker({
            map: mapInstance.current,
            title: data!.driver.name,
            icon: { path: G.SymbolPath.FORWARD_CLOSED_ARROW, scale: 6, fillColor: '#3b82f6', fillOpacity: 1, strokeColor: '#1d4ed8', strokeWeight: 2, rotation: data!.driver.heading },
          });
          destMarker.current = new G.Marker({
            map: mapInstance.current,
            title: data!.deliveryAddress,
          });
          routeLine.current = new G.Polyline({
            map: mapInstance.current,
            strokeColor: '#3b82f6',
            strokeOpacity: 0.7,
            strokeWeight: 3,
          });
        }

        const driverPos = new G.LatLng(dLat, dLng);
        const destPos = new G.LatLng(destLat, destLng);

        driverMarker.current!.setPosition(driverPos);
        destMarker.current!.setPosition(destPos);
        routeLine.current!.setPath([driverPos, destPos]);

        const bounds = { extend: () => {} } as unknown as GoogleBounds;
        const nativeBounds = new (window.google!.maps as unknown as { LatLngBounds: new () => GoogleBounds }).LatLngBounds();
        nativeBounds.extend(driverPos);
        nativeBounds.extend(destPos);
        mapInstance.current!.fitBounds(nativeBounds);
        void bounds;
      } catch { /* map is optional — silently skip */ }
    }

    void setupMap();
  }, [state, data]);

  function toggleNotify() {
    const next = !notify;
    setNotify(next);
    try { localStorage.setItem(`nr-track-notify:${token}`, next ? 'true' : 'false'); } catch {}
  }

  if (!token) {
    return <ErrorScreen title="No tracking token" body="This tracking link appears to be incomplete. Please check your delivery confirmation message for the correct link." />;
  }

  if (state === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-enterprise-gradient">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (state === 'expired') {
    return <ErrorScreen title="Tracking link expired" body="This tracking link is no longer active. Please contact your supplier if you need an updated status." />;
  }

  if (state === 'notfound') {
    return <ErrorScreen title="Tracking link not found" body="This tracking link is invalid or the order could not be found. Please check the link in your delivery confirmation." />;
  }

  if (state === 'error') {
    return <ErrorScreen title="Unable to load tracking" body={errorMsg || 'An unexpected error occurred. Please try refreshing the page.'} />;
  }

  const d = data!;
  const delivered = d.status === 'delivered' || d.status === 'invoiced';
  const step = timelineStep(d.status, delivered);
  const progressPct = d.totalRouteStops > 1 && !delivered
    ? Math.round(((d.totalRouteStops - d.stopsBeforeYou - 1) / (d.totalRouteStops - 1)) * 100)
    : delivered ? 100 : 0;

  return (
    <div className="min-h-screen bg-enterprise-gradient">
      <div className="mx-auto max-w-2xl space-y-4 p-4 pb-12">

        {/* Header */}
        <div className="flex items-center justify-between pt-2">
          <div className="text-sm font-semibold uppercase tracking-wider text-primary">NodeRoute Delivery Tracker</div>
          <button
            onClick={toggleNotify}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"
            title={notify ? 'Notifications on' : 'Notifications off'}
          >
            {notify ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
            {notify ? 'Notify me' : 'Notify off'}
          </button>
        </div>

        {/* Status + ETA card */}
        <Card className="border-border/80 bg-card/95 shadow-panel">
          <CardContent className="space-y-4 pt-5">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Order #{d.orderNumber}</p>
                <h1 className="text-2xl font-semibold tracking-tight text-foreground">{d.customerName}</h1>
                <div className={`inline-flex items-center gap-1.5 rounded-full px-3 py-0.5 text-sm font-medium ${statusColor(d.status, delivered)}`}>
                  {!delivered && <span className="h-2 w-2 animate-pulse rounded-full bg-current" />}
                  {statusLabel(d.status, delivered)}
                </div>
              </div>
              {!delivered && d.eta ? (
                <div className="text-right">
                  <p className="text-3xl font-bold tabular-nums text-foreground">{countdown || etaCountdown(d.eta.etaTime)}</p>
                  <p className="text-xs text-muted-foreground">Est. arrival {formatEtaTime(d.eta.etaTime)}</p>
                </div>
              ) : delivered ? (
                <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                  <CheckCircle2 className="h-8 w-8" />
                  <span className="text-sm font-medium">Delivered</span>
                </div>
              ) : null}
            </div>

            {/* Timeline */}
            <div className="pt-2">
              <div className="relative flex items-center justify-between">
                <div className="absolute left-0 right-0 top-3 h-0.5 bg-border" />
                <div
                  className="absolute left-0 top-3 h-0.5 bg-primary transition-all duration-700"
                  style={{ width: `${(step / (TIMELINE_STEPS.length - 1)) * 100}%` }}
                />
                {TIMELINE_STEPS.map((label, i) => (
                  <div key={label} className="relative flex flex-col items-center gap-1.5">
                    <div className={`z-10 flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs font-bold transition-colors ${i <= step ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground'}`}>
                      {i < step ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
                    </div>
                    <span className={`text-center text-[10px] font-medium leading-tight ${i <= step ? 'text-foreground' : 'text-muted-foreground'}`}>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Stop progress */}
        {!delivered && d.totalRouteStops > 1 && (
          <Card className="border-border/80 bg-card/95 shadow-panel">
            <CardContent className="space-y-3 pt-5">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-foreground">Stops before yours</span>
                <Badge variant="outline" className="font-mono">{d.stopsBeforeYou}</Badge>
              </div>
              <div className="relative h-2 overflow-hidden rounded-full bg-muted">
                <div className="absolute left-0 top-0 h-full rounded-full bg-primary transition-all duration-700" style={{ width: `${progressPct}%` }} />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Route start</span>
                <span>{d.totalRouteStops} stops total</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Driver info */}
        <Card className="border-border/80 bg-card/95 shadow-panel">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Truck className="h-4 w-4 text-primary" />
              Driver
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium text-foreground">{d.driver.name}</span>
              <span className="text-xs text-muted-foreground">{freshnessLabel(d.driver.updatedAt)}</span>
            </div>
            {!delivered && d.eta && (
              <div className="grid grid-cols-2 gap-2 pt-1">
                <div className="rounded-md border border-border bg-muted/20 p-2 text-center">
                  <div className="text-lg font-semibold tabular-nums text-foreground">{d.eta.driveMinutes}m</div>
                  <div className="text-xs text-muted-foreground">Drive time</div>
                </div>
                <div className="rounded-md border border-border bg-muted/20 p-2 text-center">
                  <div className="text-lg font-semibold tabular-nums text-foreground">{d.eta.dwellMinutes}m</div>
                  <div className="text-xs text-muted-foreground">Stop time</div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Delivery address */}
        <Card className="border-border/80 bg-card/95 shadow-panel">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPin className="h-4 w-4 text-primary" />
              Delivery Address
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p className="font-medium text-foreground">{d.deliveryAddress || 'Address on file'}</p>
            {!delivered && d.eta && (
              <div className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                Estimated delivery by {formatEtaTime(d.eta.etaTime)}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Map */}
        {d.destination.lat !== null && d.destination.lng !== null && (
          <Card className="overflow-hidden border-border/80 bg-card/95 shadow-panel">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Navigation className="h-4 w-4 text-primary" />
                Live Map
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div ref={mapRef} className="h-64 w-full bg-muted/40">
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  <Package className="mr-2 h-4 w-4" />
                  Loading map…
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <p className="text-center text-xs text-muted-foreground">Updates automatically every 30 seconds.</p>
      </div>
    </div>
  );
}

function ErrorScreen({ title, body }: { title: string; body: string }) {
  return (
    <div className="min-h-screen bg-enterprise-gradient">
      <div className="mx-auto flex min-h-screen max-w-md items-center justify-center p-4">
        <Card className="w-full border-border/80 bg-card/95 shadow-panel">
          <CardHeader>
            <CardTitle>{title}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">{body}</CardContent>
        </Card>
      </div>
    </div>
  );
}
