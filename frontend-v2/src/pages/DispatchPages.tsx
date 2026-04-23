import { useEffect, useMemo, useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth, sendWithAuth } from '../lib/api';

type Delivery = {
  orderDbId?: string;
  orderId?: string;
  restaurantName?: string;
  driverName?: string;
  status?: string;
  address?: string;
  distanceMiles?: number | string;
  speedMph?: number | string;
  createdAt?: string;
  lat?: number | string | null;
  lng?: number | string | null;
  driverLat?: number | string | null;
  driverLng?: number | string | null;
  items?: string[];
};

type Driver = {
  id: string;
  name?: string;
  status?: string;
  onTimeRate?: number | string;
  totalStopsToday?: number | string;
  milesToday?: number | string;
  avgStopMinutes?: number | string;
  avgSpeedMph?: number | string;
  lat?: number | string | null;
  lng?: number | string | null;
  updatedAt?: string | null;
};

type DeliveryStats = {
  totalDeliveries?: number;
  completedToday?: number;
  onTimeRate?: number;
  activeDrivers?: number;
  totalDrivers?: number;
  failed?: number;
  pendingCount?: number;
  inTransitCount?: number;
};

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function statusVariant(status: string | undefined): 'warning' | 'secondary' | 'success' | 'neutral' {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'pending') return 'warning';
  if (normalized === 'in-transit' || normalized === 'in_process') return 'secondary';
  if (normalized === 'delivered' || normalized === 'invoiced') return 'success';
  return 'neutral';
}

function titleCase(value: string | undefined): string {
  const normalized = String(value || '').replace(/_/g, ' ').trim();
  if (!normalized) return 'Unknown';
  return normalized
    .split(' ')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function DashboardPage() {
  const [stats, setStats] = useState<DeliveryStats | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [statsData, deliveriesData] = await Promise.all([
        fetchWithAuth<DeliveryStats>('/api/stats'),
        fetchWithAuth<Delivery[]>('/api/deliveries'),
      ]);
      setStats(statsData || null);
      setDeliveries(Array.isArray(deliveriesData) ? deliveriesData : []);
    } catch (err) {
      setError(String((err as Error).message || 'Could not load dashboard metrics'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const recent = useMemo(() => deliveries.slice(0, 8), [deliveries]);

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading dashboard metrics...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Total Deliveries" value={asNumber(stats?.totalDeliveries).toLocaleString()} />
        <SummaryCard label="Completed Today" value={asNumber(stats?.completedToday).toLocaleString()} />
        <SummaryCard label="On-Time Rate" value={`${asNumber(stats?.onTimeRate).toFixed(0)}%`} />
        <SummaryCard label="Active Drivers" value={`${asNumber(stats?.activeDrivers).toLocaleString()} / ${asNumber(stats?.totalDrivers).toLocaleString()}`} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <CardTitle>Dispatch Snapshot</CardTitle>
            <CardDescription>Live operational pulse for today’s deliveries and assignment flow.</CardDescription>
          </div>
          <Button variant="outline" onClick={load}>
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Restaurant</TableHead>
                <TableHead>Driver</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Distance</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent.length ? (
                recent.map((row, idx) => (
                  <TableRow key={`${row.orderDbId || row.orderId || idx}`}>
                    <TableCell className="font-medium">{row.orderId || '-'}</TableCell>
                    <TableCell>{row.restaurantName || '-'}</TableCell>
                    <TableCell>{row.driverName || '-'}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(row.status)}>{titleCase(row.status)}</Badge>
                    </TableCell>
                    <TableCell>{asNumber(row.distanceMiles).toFixed(1)} mi</TableCell>
                    <TableCell>{row.createdAt ? new Date(row.createdAt).toLocaleString() : '-'}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    No delivery rows available.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export function DeliveriesPage() {
  const [stats, setStats] = useState<DeliveryStats | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'in-transit' | 'delivered'>('all');
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [statsData, deliveriesData] = await Promise.all([
        fetchWithAuth<DeliveryStats>('/api/stats'),
        fetchWithAuth<Delivery[]>('/api/deliveries'),
      ]);
      setStats(statsData || null);
      setDeliveries(Array.isArray(deliveriesData) ? deliveriesData : []);
    } catch (err) {
      setError(String((err as Error).message || 'Could not load deliveries'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return deliveries.filter((row) => {
      const status = String(row.status || '').toLowerCase();
      if (statusFilter !== 'all' && status !== statusFilter) return false;
      if (!needle) return true;
      return (
        String(row.orderId || '').toLowerCase().includes(needle) ||
        String(row.restaurantName || '').toLowerCase().includes(needle) ||
        String(row.driverName || '').toLowerCase().includes(needle)
      );
    });
  }, [deliveries, search, statusFilter]);

  async function updateStatus(row: Delivery, status: 'pending' | 'in-transit' | 'delivered') {
    if (!row.orderDbId) return;
    setUpdatingId(row.orderDbId);
    setError('');
    setNotice('');
    try {
      await sendWithAuth(`/api/deliveries/${row.orderDbId}/status`, 'PATCH', { status });
      setNotice(`Updated ${row.orderId || row.orderDbId.slice(0, 8)} to ${titleCase(status)}.`);
      await load();
    } catch (err) {
      setError(String((err as Error).message || 'Could not update delivery status'));
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading deliveries...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}
      {notice ? <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Deliveries Today" value={asNumber(stats?.totalDeliveries).toLocaleString()} />
        <SummaryCard label="In Transit" value={asNumber(stats?.inTransitCount).toLocaleString()} />
        <SummaryCard label="Pending" value={asNumber(stats?.pendingCount).toLocaleString()} />
        <SummaryCard label="Failed" value={asNumber(stats?.failed).toLocaleString()} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <CardTitle>Delivery Board</CardTitle>
            <CardDescription>Track status, driver assignment, and route progress from current delivery APIs.</CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Search</span>
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Order, restaurant, driver" />
            </div>
            <div className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as 'all' | 'pending' | 'in-transit' | 'delivered')}
                className="flex h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">All</option>
                <option value="pending">Pending</option>
                <option value="in-transit">In Transit</option>
                <option value="delivered">Delivered</option>
              </select>
            </div>
            <Button variant="outline" onClick={load}>
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Restaurant</TableHead>
                <TableHead>Driver</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Distance</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length ? (
                filtered.map((row, idx) => (
                  <TableRow key={`${row.orderDbId || row.orderId || idx}`}>
                    <TableCell className="font-medium">{row.orderId || '-'}</TableCell>
                    <TableCell>{row.restaurantName || '-'}</TableCell>
                    <TableCell>{row.driverName || '-'}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(row.status)}>{titleCase(row.status)}</Badge>
                    </TableCell>
                    <TableCell>{asNumber(row.distanceMiles).toFixed(1)} mi</TableCell>
                    <TableCell>{row.address || '-'}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => updateStatus(row, 'pending')}
                          disabled={!row.orderDbId || updatingId === row.orderDbId}
                        >
                          Pending
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => updateStatus(row, 'in-transit')}
                          disabled={!row.orderDbId || updatingId === row.orderDbId}
                        >
                          In Transit
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => updateStatus(row, 'delivered')}
                          disabled={!row.orderDbId || updatingId === row.orderDbId}
                        >
                          Delivered
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground">
                    No delivery rows match current filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export function DriversPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await fetchWithAuth<Driver[]>('/api/drivers');
      setDrivers(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(String((err as Error).message || 'Could not load drivers'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const summary = useMemo(() => {
    const onDuty = drivers.filter((driver) => String(driver.status || '').toLowerCase() === 'on-duty').length;
    const avgOnTime = drivers.length
      ? drivers.reduce((sum, driver) => sum + asNumber(driver.onTimeRate), 0) / drivers.length
      : 0;
    const totalMiles = drivers.reduce((sum, driver) => sum + asNumber(driver.milesToday), 0);
    return { onDuty, avgOnTime, totalMiles };
  }, [drivers]);

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading drivers...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Drivers" value={drivers.length.toLocaleString()} />
        <SummaryCard label="On Duty" value={summary.onDuty.toLocaleString()} />
        <SummaryCard label="Avg On-Time" value={`${summary.avgOnTime.toFixed(1)}%`} />
        <SummaryCard label="Miles Today" value={summary.totalMiles.toFixed(1)} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <CardTitle>Driver Performance</CardTitle>
            <CardDescription>Driver status, route pace, and day-of-delivery performance metrics.</CardDescription>
          </div>
          <Button variant="outline" onClick={load}>
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>On-Time</TableHead>
                <TableHead>Stops Today</TableHead>
                <TableHead>Miles</TableHead>
                <TableHead>Avg Stop (min)</TableHead>
                <TableHead>Avg Speed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {drivers.length ? (
                drivers.map((driver) => (
                  <TableRow key={driver.id}>
                    <TableCell className="font-medium">{driver.name || '-'}</TableCell>
                    <TableCell>
                      <Badge variant={String(driver.status || '').toLowerCase() === 'on-duty' ? 'success' : 'neutral'}>
                        {titleCase(driver.status)}
                      </Badge>
                    </TableCell>
                    <TableCell>{asNumber(driver.onTimeRate).toFixed(1)}%</TableCell>
                    <TableCell>{asNumber(driver.totalStopsToday).toLocaleString()}</TableCell>
                    <TableCell>{asNumber(driver.milesToday).toFixed(1)}</TableCell>
                    <TableCell>{asNumber(driver.avgStopMinutes).toFixed(1)}</TableCell>
                    <TableCell>{asNumber(driver.avgSpeedMph).toFixed(1)} mph</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground">
                    No driver rows available.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export function LiveMapPage() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [deliveryData, driverData] = await Promise.all([
        fetchWithAuth<Delivery[]>('/api/deliveries'),
        fetchWithAuth<Driver[]>('/api/drivers'),
      ]);
      setDeliveries(Array.isArray(deliveryData) ? deliveryData : []);
      setDrivers(Array.isArray(driverData) ? driverData : []);
    } catch (err) {
      setError(String((err as Error).message || 'Could not load live map data'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading live map feed...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}

      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <CardTitle>Driver Coordinates</CardTitle>
            <CardDescription>Operational map feed with quick external map launch links.</CardDescription>
          </div>
          <Button variant="outline" onClick={load}>
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Driver</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Coordinates</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead>Open</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {drivers.length ? (
                drivers.map((driver) => {
                  const lat = asNumber(driver.lat);
                  const lng = asNumber(driver.lng);
                  const mapsHref = `https://maps.google.com/?q=${encodeURIComponent(`${lat},${lng}`)}`;
                  return (
                    <TableRow key={driver.id}>
                      <TableCell className="font-medium">{driver.name || '-'}</TableCell>
                      <TableCell>
                        <Badge variant={String(driver.status || '').toLowerCase() === 'on-duty' ? 'success' : 'neutral'}>
                          {titleCase(driver.status)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {lat.toFixed(5)}, {lng.toFixed(5)}
                      </TableCell>
                      <TableCell>{driver.updatedAt ? new Date(driver.updatedAt).toLocaleString() : '-'}</TableCell>
                      <TableCell>
                        <a href={mapsHref} target="_blank" rel="noreferrer" className="text-sm font-semibold text-primary underline-offset-4 hover:underline">
                          Open Map
                        </a>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    No driver coordinates available.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Destination Coordinates</CardTitle>
          <CardDescription>Delivery-level coordinate feed from active dispatch records.</CardDescription>
        </CardHeader>
        <CardContent className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Restaurant</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead>Driver Position</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deliveries.length ? (
                deliveries.slice(0, 50).map((row, idx) => (
                  <TableRow key={`${row.orderDbId || row.orderId || idx}`}>
                    <TableCell className="font-medium">{row.orderId || '-'}</TableCell>
                    <TableCell>{row.restaurantName || '-'}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(row.status)}>{titleCase(row.status)}</Badge>
                    </TableCell>
                    <TableCell>
                      {asNumber(row.lat).toFixed(5)}, {asNumber(row.lng).toFixed(5)}
                    </TableCell>
                    <TableCell>
                      {asNumber(row.driverLat).toFixed(5)}, {asNumber(row.driverLng).toFixed(5)}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    No active destination rows available.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
