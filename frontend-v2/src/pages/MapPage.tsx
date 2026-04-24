/// <reference types="vite/client" />
import { useCallback, useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { StatusBadge } from '../components/ui/status-badge';
import { fetchWithAuth } from '../lib/api';

// Set VITE_MAP_API_KEY in your .env file.
// If not set, the app will attempt to fetch the key from /api/config/maps-key.
const ENV_MAP_KEY = import.meta.env.VITE_MAP_API_KEY as string | undefined;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GMaps = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GMarker = any;

type DriverLocation = {
  id?: string | number;
  driver_id?: string;
  driverId?: string;
  name?: string;
  full_name?: string;
  fullName?: string;
  lat?: number | string | null;
  lng?: number | string | null;
  status?: string;
  current_stop?: string;
  currentStop?: string;
  route_id?: string;
  routeId?: string;
};

type StopMarker = {
  id?: string | number;
  stop_id?: string;
  stopId?: string;
  address?: string;
  lat?: number | string | null;
  lng?: number | string | null;
  status?: string;
  driver?: string;
};

const stopStatusColors: Record<string, 'yellow' | 'blue' | 'green' | 'red'> = {
  pending: 'yellow',
  arrived: 'blue',
  completed: 'green',
  failed: 'red',
};

const stopColorHex: Record<string, string> = {
  pending: '#f59e0b',
  arrived: '#3b82f6',
  completed: '#22c55e',
  failed: '#ef4444',
};

const MAP_STYLES = [
  { elementType: 'geometry', stylers: [{ color: '#0d1b3e' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8899bb' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#050d2a' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1a2f5e' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#243d6e' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#050d2a' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
];

function driverName(d: DriverLocation) {
  return d.name || d.full_name || d.fullName || '—';
}

function driverId(d: DriverLocation, i: number) {
  return String(d.driver_id || d.driverId || d.id || `DRV-${i + 1}`);
}

function currentStop(d: DriverLocation) {
  return d.current_stop || d.currentStop || '—';
}

function toLatLng(val: number | string | null | undefined): number | null {
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

async function resolveMapKey(): Promise<string> {
  if (ENV_MAP_KEY) return ENV_MAP_KEY;
  try {
    const data = await fetchWithAuth<{ key?: string; api_key?: string }>('/api/config/maps-key');
    return data.key || data.api_key || '';
  } catch {
    return '';
  }
}

function loadGoogleMapsScript(apiKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const g = (window as GMaps).google;
    if (g && g.maps) { resolve(); return; }
    const existing = document.getElementById('gmaps-script');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', reject);
      return;
    }
    const script = document.createElement('script');
    script.id = 'gmaps-script';
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

export function MapPage() {
  const mapRef = useRef<HTMLDivElement>(null);
  const googleMapRef = useRef<GMaps>(null);
  const markersRef = useRef<GMarker[]>([]);

  const [drivers, setDrivers] = useState<DriverLocation[]>([]);
  const [stops, setStops] = useState<StopMarker[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [selectedDriver, setSelectedDriver] = useState<DriverLocation | null>(null);

  const clearMarkers = useCallback(() => {
    markersRef.current.forEach((m: GMarker) => m.setMap(null));
    markersRef.current = [];
  }, []);

  const plotMarkers = useCallback(
    (driverList: DriverLocation[], stopList: StopMarker[]) => {
      if (!googleMapRef.current) return;
      clearMarkers();
      const gm = (window as GMaps).google.maps;

      // Stop markers
      stopList.forEach((s) => {
        const lat = toLatLng(s.lat);
        const lng = toLatLng(s.lng);
        if (lat === null || lng === null) return;
        const normalized = String(s.status || '').toLowerCase().replace(/[\s_]+/g, '-');
        const color = stopColorHex[normalized] || '#6b7280';
        const marker = new gm.Marker({
          position: { lat, lng },
          map: googleMapRef.current,
          icon: {
            path: gm.SymbolPath.CIRCLE,
            scale: 7,
            fillColor: color,
            fillOpacity: 0.9,
            strokeColor: '#ffffff',
            strokeWeight: 2,
          },
          title: s.address || `Stop ${s.stop_id || s.stopId || s.id || ''}`,
          zIndex: 1,
        });
        const info = new gm.InfoWindow({
          content: `<div style="font-family:Inter,sans-serif;padding:4px;min-width:140px">
            <b>${s.address || 'Stop'}</b><br>
            <span style="color:#666">Status: ${s.status || 'unknown'}</span>
            ${s.driver ? `<br><span style="color:#666">Driver: ${s.driver}</span>` : ''}
          </div>`,
        });
        marker.addListener('click', () => info.open(googleMapRef.current, marker));
        markersRef.current.push(marker);
      });

      // Driver markers (SVG avatar with initials)
      driverList.forEach((d) => {
        const lat = toLatLng(d.lat);
        const lng = toLatLng(d.lng);
        if (lat === null || lng === null) return;
        const name = driverName(d);
        const initials = name
          .split(' ')
          .filter(Boolean)
          .map((n) => n[0])
          .join('')
          .toUpperCase()
          .slice(0, 2);
        const status = String(d.status || '').toLowerCase();
        const color = status === 'active' || status === 'on-duty' ? '#3dba7f' : '#8899bb';
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44">
          <circle cx="22" cy="22" r="20" fill="${color}" stroke="#fff" stroke-width="3"/>
          <text x="22" y="27" text-anchor="middle" font-size="13" font-weight="700" font-family="Inter,sans-serif" fill="#fff">${initials}</text>
        </svg>`;
        const marker = new gm.Marker({
          position: { lat, lng },
          map: googleMapRef.current,
          icon: {
            url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
            scaledSize: new gm.Size(44, 44),
            anchor: new gm.Point(22, 22),
          },
          title: name,
          zIndex: 10,
          cursor: 'pointer',
        });
        marker.addListener('click', () => setSelectedDriver(d));
        markersRef.current.push(marker);
      });

      setLastUpdated(new Date().toLocaleTimeString());
    },
    [clearMarkers]
  );

  const fetchData = useCallback(async () => {
    try {
      const [driverData, stopData] = await Promise.allSettled([
        fetchWithAuth<DriverLocation[]>('/api/drivers'),
        fetchWithAuth<StopMarker[]>('/api/stops'),
      ]);
      const newDrivers =
        driverData.status === 'fulfilled' && Array.isArray(driverData.value) ? driverData.value : [];
      const newStops =
        stopData.status === 'fulfilled' && Array.isArray(stopData.value) ? stopData.value : [];
      setDrivers(newDrivers);
      setStops(newStops);
      plotMarkers(newDrivers, newStops);
    } catch {
      // non-fatal; keep existing data
    }
  }, [plotMarkers]);

  // Init map
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const apiKey = await resolveMapKey();
        if (!apiKey) {
          setMapError(
            'Map API key is not configured. Set VITE_MAP_API_KEY in .env or ensure /api/config/maps-key is accessible.'
          );
          return;
        }
        await loadGoogleMapsScript(apiKey);
        if (cancelled || !mapRef.current) return;
        const gm = (window as GMaps).google.maps;
        googleMapRef.current = new gm.Map(mapRef.current, {
          center: { lat: 32.7765, lng: -79.9311 },
          zoom: 13,
          mapTypeId: 'roadmap',
          styles: MAP_STYLES,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: true,
          zoomControl: true,
        });
        setMapReady(true);
      } catch (err) {
        if (!cancelled) {
          setMapError('Failed to load Google Maps. Check the API key and network connection.');
          console.error('MapPage: Google Maps init error', err);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Fetch data after map is ready, auto-refresh every 30s
  useEffect(() => {
    if (!mapReady) return;
    fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, [mapReady, fetchData]);

  const activeDrivers = drivers.filter((d) => {
    const status = String(d.status || '').toLowerCase();
    return status === 'active' || status === 'on-duty';
  });

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      {/* Map canvas */}
      <div className="flex-1 min-w-0">
        <Card className="overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between py-3 px-4">
            <CardTitle className="text-base">Live Map</CardTitle>
            {lastUpdated && (
              <span className="text-xs text-muted-foreground">Updated {lastUpdated}</span>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {mapError ? (
              <div className="flex h-[520px] items-center justify-center bg-muted/20 p-6 text-center">
                <p className="text-sm text-muted-foreground max-w-sm">{mapError}</p>
              </div>
            ) : (
              <div ref={mapRef} className="h-[520px] w-full" />
            )}
          </CardContent>
        </Card>

        {/* Legend */}
        <div className="mt-2 flex flex-wrap gap-3 px-1">
          {Object.entries(stopColorHex).map(([status, color]) => (
            <div key={status} className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-xs capitalize text-muted-foreground">{status}</span>
            </div>
          ))}
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-4 w-4 rounded-full bg-[#3dba7f] border-2 border-white" />
            <span className="text-xs text-muted-foreground">Active driver</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-4 w-4 rounded-full bg-[#8899bb] border-2 border-white" />
            <span className="text-xs text-muted-foreground">Off-duty driver</span>
          </div>
        </div>
      </div>

      {/* Sidebar */}
      <div className="w-full lg:w-72 space-y-4">
        {/* Selected driver detail */}
        {selectedDriver && (
          <Card>
            <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
              <CardTitle className="text-sm">Driver Detail</CardTitle>
              <button
                onClick={() => setSelectedDriver(null)}
                className="text-muted-foreground hover:text-foreground text-lg leading-none"
              >
                ×
              </button>
            </CardHeader>
            <CardContent className="pt-0 px-4 pb-4 space-y-2 text-sm">
              <p className="font-semibold">{driverName(selectedDriver)}</p>
              <p className="text-muted-foreground capitalize">Status: {selectedDriver.status || '—'}</p>
              <p className="text-muted-foreground">Current stop: {currentStop(selectedDriver)}</p>
              {(selectedDriver.route_id || selectedDriver.routeId) && (
                <p className="text-muted-foreground">
                  Route: {selectedDriver.route_id || selectedDriver.routeId}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Active drivers list */}
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm">Active Drivers ({activeDrivers.length})</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 px-2 pb-2">
            {activeDrivers.length === 0 ? (
              <p className="px-2 py-2 text-xs text-muted-foreground">No active drivers.</p>
            ) : (
              <ul className="divide-y divide-border">
                {activeDrivers.map((d, i) => (
                  <li
                    key={driverId(d, i)}
                    className="flex items-start justify-between gap-2 px-2 py-2 hover:bg-muted/40 cursor-pointer rounded"
                    onClick={() => setSelectedDriver(d)}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{driverName(d)}</p>
                      <p className="text-xs text-muted-foreground truncate">{currentStop(d)}</p>
                    </div>
                    <StatusBadge
                      status={d.status}
                      colorMap={{ active: 'green', 'on-duty': 'green', 'off-duty': 'gray', 'on-break': 'yellow' }}
                    />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Stop summary */}
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm">Stop Summary</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 px-4 pb-4">
            {Object.keys(stopStatusColors).map((s) => {
              const count = stops.filter(
                (stop) => String(stop.status || '').toLowerCase().replace(/[\s_]+/g, '-') === s
              ).length;
              return (
                <div key={s} className="flex items-center justify-between py-1">
                  <StatusBadge status={s} colorMap={stopStatusColors} />
                  <span className="text-sm font-medium">{count}</span>
                </div>
              );
            })}
            {stops.length === 0 && (
              <p className="text-xs text-muted-foreground">No stop data.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
