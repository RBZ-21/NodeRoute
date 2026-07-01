/// <reference types="vite/client" />
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../components/ui/button';
import { SelectInput } from '../components/ui/select-input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { LoadingSkeleton } from '../components/ui/data-state';
import { useToast } from '../components/ui/toast';
import {
  type RouteRecord,
  type StopRecord,
  useAllStops,
  useDrivers,
  useOptimizeRoute,
  useRoutes,
  useUpdateRoute,
} from '../hooks/useRoutes';
import { driverDisplayName } from './routes.helpers';

const ENV_MAP_KEY = (import.meta.env.VITE_GOOGLE_MAPS_KEY || import.meta.env.VITE_MAP_API_KEY) as string | undefined;

// Distinct colors for route polylines/pins.
const ROUTE_COLORS = ['#2367b5', '#16a34a', '#d97706', '#9333ea', '#dc2626', '#0891b2', '#db2777', '#65a30d'];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GAny = any;

function loadMapsScript(apiKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const w = window as unknown as { google?: { maps?: unknown } };
    if (w.google?.maps) { resolve(); return; }
    const existing = document.querySelector('script[data-maps-sdk]');
    if (existing) { existing.addEventListener('load', () => resolve()); existing.addEventListener('error', () => reject(new Error('maps failed'))); return; }
    const script = document.createElement('script');
    script.setAttribute('data-maps-sdk', '1');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&loading=async`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Maps'));
    document.head.appendChild(script);
  });
}

function routeStopIds(route: RouteRecord): string[] {
  return route.active_stop_ids || route.stop_ids || [];
}

function isDispatched(route: RouteRecord): boolean {
  const status = String(route.status || '').toLowerCase();
  return status === 'active' || !!route.dispatched_at;
}

export function DispatchBoard() {
  const { data: routes = [], isLoading } = useRoutes();
  const { data: allStops = [], refetch: refetchStops } = useAllStops();
  const { data: drivers = [] } = useDrivers();
  const updateRoute = useUpdateRoute();
  const optimizeRoute = useOptimizeRoute();

  const toast = useToast();
  const [dragStopId, setDragStopId] = useState<string | null>(null);
  const [dragFromRouteId, setDragFromRouteId] = useState<string | null>(null);
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [optimizingId, setOptimizingId] = useState<string | null>(null);

  const stopById = useMemo(() => new Map(allStops.map((s) => [String(s.id), s])), [allStops]);
  const driverById = useMemo(() => new Map(drivers.map((d) => [String(d.id), d])), [drivers]);

  // Stops referenced by any route are "assigned"; the rest are unassigned.
  const assignedStopIds = useMemo(() => {
    const set = new Set<string>();
    for (const route of routes) for (const id of routeStopIds(route)) set.add(String(id));
    return set;
  }, [routes]);

  const unassignedStops = useMemo(
    () => allStops.filter((s) => !assignedStopIds.has(String(s.id))),
    [allStops, assignedStopIds],
  );

  async function patchRouteStops(route: RouteRecord, nextIds: string[]) {
    const deduped = Array.from(new Set(nextIds));
    await updateRoute.mutateAsync({ id: route.id, patch: { stopIds: deduped, activeStopIds: deduped } });
    await refetchStops();
  }

  // Reassign a stop onto a target route (and remove from its source route if any).
  async function assignStopToRoute(stopId: string, targetRoute: RouteRecord, fromRouteId: string | null) {    try {
      // Dispatch rule: confirm before modifying a dispatched route.
      if (isDispatched(targetRoute) && !confirm(`"${targetRoute.name || targetRoute.id.slice(0, 8)}" is already dispatched. Add this stop anyway?`)) return;
      const fromRoute = fromRouteId ? routes.find((r) => r.id === fromRouteId) : null;
      if (fromRoute && isDispatched(fromRoute) && !confirm(`"${fromRoute.name || fromRoute.id.slice(0, 8)}" is dispatched. Move this stop off it anyway?`)) return;

      if (routeStopIds(targetRoute).map(String).includes(String(stopId))) {
        toast.success('Stop is already on that route.');
        return;
      }
      if (fromRoute) {
        await patchRouteStops(fromRoute, routeStopIds(fromRoute).filter((id) => String(id) !== String(stopId)));
      }
      await patchRouteStops(targetRoute, [...routeStopIds(targetRoute), stopId]);
      const stop = stopById.get(String(stopId));
      toast.success(`Moved "${stop?.name || stopId}" to ${targetRoute.name || targetRoute.id.slice(0, 8)}.`);
    } catch (err) {
      toast.error(String((err as Error).message || 'Could not reassign stop.'));
    }
  }

  async function removeStopFromRoute(stopId: string, route: RouteRecord) {    try {
      if (isDispatched(route) && !confirm(`"${route.name || route.id.slice(0, 8)}" is dispatched. Remove this stop anyway?`)) return;
      const stop = stopById.get(String(stopId));
      if (!confirm(`Remove "${stop?.name || stopId}" from ${route.name || route.id.slice(0, 8)}?`)) return;
      await patchRouteStops(route, routeStopIds(route).filter((id) => String(id) !== String(stopId)));
      toast.success('Stop returned to the unassigned list.');
    } catch (err) {
      toast.error(String((err as Error).message || 'Could not remove stop.'));
    }
  }

  function handleOptimize(route: RouteRecord) {
    setOptimizingId(route.id);    optimizeRoute.mutate(route.id, {
      onSuccess: (result) => {
        updateRoute.mutate(
          { id: route.id, patch: { stopIds: result.optimized_stop_ids, activeStopIds: result.optimized_stop_ids } },
          {
            onSuccess: () => { toast.success(`Optimized stop order for ${route.name || route.id.slice(0, 8)}.`); setOptimizingId(null); void refetchStops(); },
            onError: (err) => { toast.error(String((err as Error).message || 'Could not apply optimization.')); setOptimizingId(null); },
          },
        );
      },
      onError: (err) => { toast.error(String((err as Error).message || 'Optimization failed.')); setOptimizingId(null); },
    });
  }

  // ── Map ────────────────────────────────────────────────────────────────────
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<GAny>(null);
  const overlays = useRef<GAny[]>([]);
  const [mapError, setMapError] = useState('');

  const drawMap = useCallback(async () => {
    if (!mapRef.current) return;
    const apiKey = ENV_MAP_KEY || '';
    if (!apiKey) { setMapError('Set VITE_GOOGLE_MAPS_KEY to enable the map view. Drag-and-drop assignment works without it.'); return; }
    try {
      await loadMapsScript(apiKey);
      const G = (window as unknown as { google: { maps: GAny } }).google.maps;
      if (!mapInstance.current) {
        mapInstance.current = new G.Map(mapRef.current, { zoom: 11, center: { lat: 34.05, lng: -118.24 }, mapTypeControl: false, streetViewControl: false, fullscreenControl: false });
      }
      // Clear previous overlays.
      overlays.current.forEach((o) => o.setMap(null));
      overlays.current = [];
      const bounds = new G.LatLngBounds();
      let hasPoint = false;

      // Route polylines + colored pins.
      routes.forEach((route, idx) => {
        const color = ROUTE_COLORS[idx % ROUTE_COLORS.length];
        const path: GAny[] = [];
        routeStopIds(route).forEach((id) => {
          const stop = stopById.get(String(id));
          if (stop && Number.isFinite(stop.lat) && Number.isFinite(stop.lng)) {
            const pos = new G.LatLng(stop.lat, stop.lng);
            path.push(pos); bounds.extend(pos); hasPoint = true;
            const marker = new G.Marker({ map: mapInstance.current, position: pos, title: `${stop.name || ''} (${route.name || ''})`, icon: { path: G.SymbolPath.CIRCLE, scale: 6, fillColor: color, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 1.5 } });
            marker.addListener('click', () => setSelectedStopId(String(id)));
            overlays.current.push(marker);
          }
        });
        if (path.length > 1) {
          const line = new G.Polyline({ map: mapInstance.current, path, strokeColor: color, strokeOpacity: 0.8, strokeWeight: 3 });
          overlays.current.push(line);
        }
      });

      // Unassigned stop pins (hollow gray).
      unassignedStops.forEach((stop) => {
        if (Number.isFinite(stop.lat) && Number.isFinite(stop.lng)) {
          const pos = new G.LatLng(stop.lat, stop.lng);
          bounds.extend(pos); hasPoint = true;
          const marker = new G.Marker({ map: mapInstance.current, position: pos, title: stop.name || 'Unassigned stop', icon: { path: G.SymbolPath.CIRCLE, scale: 5, fillColor: '#94a3b8', fillOpacity: 0.9, strokeColor: '#475569', strokeWeight: 1 } });
          marker.addListener('click', () => setSelectedStopId(String(stop.id)));
          overlays.current.push(marker);
        }
      });

      if (hasPoint) mapInstance.current.fitBounds(bounds);
    } catch {
      setMapError('Map could not load. Drag-and-drop assignment still works.');
    }
  }, [routes, unassignedStops, stopById]);

  useEffect(() => { void drawMap(); }, [drawMap]);

  const selectedStop = selectedStopId ? stopById.get(selectedStopId) : null;
  const selectedStopRoute = selectedStopId ? routes.find((r) => routeStopIds(r).map(String).includes(selectedStopId)) : null;

  return (
    <div className="space-y-3">

      <div className="grid gap-3 lg:grid-cols-[320px_1fr]">
        {/* Left: unassigned stops */}
        <Card className="h-fit">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Unassigned Stops ({unassignedStops.length})</CardTitle>
            <CardDescription>Drag a stop onto a route to assign it.</CardDescription>
          </CardHeader>
          <CardContent
            className="max-h-[60vh] space-y-2 overflow-y-auto"
            onDragOver={(e) => { if (dragFromRouteId) e.preventDefault(); }}
            onDrop={() => {
              // Dropping back onto the unassigned panel removes the stop from its route.
              if (dragStopId && dragFromRouteId) {
                const route = routes.find((r) => r.id === dragFromRouteId);
                if (route) void removeStopFromRoute(dragStopId, route);
              }
              setDragStopId(null); setDragFromRouteId(null);
            }}
          >
            {isLoading ? <LoadingSkeleton rows={2} label="Loading unassigned stops" /> : null}
            {unassignedStops.map((stop) => (
              <div
                key={stop.id}
                draggable
                onDragStart={() => { setDragStopId(String(stop.id)); setDragFromRouteId(null); }}
                onClick={() => setSelectedStopId(String(stop.id))}
                className="cursor-grab rounded-md border border-border bg-background px-3 py-2 text-sm shadow-sm hover:border-primary/50 active:cursor-grabbing"
              >
                <div className="font-medium">{stop.name || 'Unnamed stop'}</div>
                <div className="truncate text-xs text-muted-foreground">{stop.address || 'No address'}</div>
              </div>
            ))}
            {!isLoading && unassignedStops.length === 0 ? <div className="text-sm text-muted-foreground">All stops are assigned.</div> : null}
          </CardContent>
        </Card>

        {/* Right: map + route cards */}
        <div className="space-y-3">
          <Card className="overflow-hidden">
            <CardContent className="p-0">
              {mapError ? (
                <div className="flex h-[320px] items-center justify-center bg-muted/20 p-6 text-center text-sm text-muted-foreground">{mapError}</div>
              ) : (
                <div ref={mapRef} className="h-[320px] w-full bg-muted/20" />
              )}
            </CardContent>
          </Card>

          {selectedStop ? (
            <Card className="border-primary/40">
              <CardContent className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <div className="flex-1">
                  <span className="font-semibold">{selectedStop.name}</span>
                  <span className="ml-2 text-muted-foreground">{selectedStop.address}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{selectedStopRoute ? `On ${selectedStopRoute.name || selectedStopRoute.id.slice(0, 8)}` : 'Unassigned'}</span>
                </div>
                {/* Touch fallback: assign via dropdown */}
                <SelectInput
                  className="h-9 px-2"
                  value={selectedStopRoute?.id || ''}
                  onChange={(e) => {
                    const target = routes.find((r) => r.id === e.target.value);
                    if (target) void assignStopToRoute(selectedStopId!, target, selectedStopRoute?.id || null);
                  }}
                >
                  <option value="">Assign to route…</option>
                  {routes.map((r) => <option key={r.id} value={r.id}>{r.name || r.id.slice(0, 8)}</option>)}
                </SelectInput>
                <Button size="sm" variant="ghost" onClick={() => setSelectedStopId(null)}>Close</Button>
              </CardContent>
            </Card>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {routes.map((route, idx) => {
              const color = ROUTE_COLORS[idx % ROUTE_COLORS.length];
              const stops = routeStopIds(route).map((id) => stopById.get(String(id))).filter(Boolean) as StopRecord[];
              const driverName = route.driver || driverDisplayName(driverById.get(String(route.driver_id || ''))) || 'Unassigned';
              return (
                <Card
                  key={route.id}
                  onDragOver={(e) => { if (dragStopId) e.preventDefault(); }}
                  onDrop={() => {
                    if (dragStopId) void assignStopToRoute(dragStopId, route, dragFromRouteId);
                    setDragStopId(null); setDragFromRouteId(null);
                  }}
                  className="border-l-4"
                  style={{ borderLeftColor: color }}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-sm">{route.name || route.id.slice(0, 8)}</CardTitle>
                      {isDispatched(route) ? <Badge variant="success">Dispatched</Badge> : <Badge variant="secondary">Planning</Badge>}
                    </div>
                    <CardDescription className="text-xs">
                      {stops.length} stop{stops.length !== 1 ? 's' : ''} · {driverName}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="max-h-40 space-y-1 overflow-y-auto">
                      {stops.map((stop) => (
                        <div
                          key={stop.id}
                          draggable
                          onDragStart={() => { setDragStopId(String(stop.id)); setDragFromRouteId(route.id); }}
                          onClick={() => setSelectedStopId(String(stop.id))}
                          className="flex cursor-grab items-center justify-between gap-2 rounded border border-border/60 bg-background px-2 py-1 text-xs hover:border-primary/50"
                        >
                          <span className="truncate">{stop.name || stop.address || stop.id.slice(0, 8)}</span>
                          <button type="button" className="shrink-0 text-destructive" onClick={(e) => { e.stopPropagation(); void removeStopFromRoute(String(stop.id), route); }} aria-label="Remove stop">✕</button>
                        </div>
                      ))}
                      {stops.length === 0 ? <div className="rounded border border-dashed border-border/60 px-2 py-3 text-center text-xs text-muted-foreground">Drop stops here</div> : null}
                    </div>
                    <Button size="sm" variant="outline" className="w-full" disabled={stops.length < 2 || (optimizeRoute.isPending && optimizingId === route.id)} onClick={() => handleOptimize(route)}>
                      {optimizeRoute.isPending && optimizingId === route.id ? 'Optimizing…' : '❆ Optimize'}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
            {routes.length === 0 ? <div className="text-sm text-muted-foreground sm:col-span-2 xl:col-span-3">No routes yet. Create a route to start dispatching.</div> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
