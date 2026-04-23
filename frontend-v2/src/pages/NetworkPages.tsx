import { useEffect, useMemo, useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth, sendWithAuth } from '../lib/api';

type RouteRecord = {
  id: string;
  name?: string;
  driver?: string;
  stop_ids?: string[];
  active_stop_ids?: string[];
  notes?: string;
  created_at?: string;
};

type StopRecord = {
  id: string;
  name?: string;
  address?: string;
  lat?: number | string;
  lng?: number | string;
  notes?: string;
  created_at?: string;
};

type UserRecord = {
  id: string;
  name?: string;
  email?: string;
  role?: 'admin' | 'manager' | 'driver' | string;
  status?: string;
  createdAt?: string;
  company_name?: string;
  location_name?: string;
};

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function RoutesPage() {
  const [routes, setRoutes] = useState<RouteRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState('');
  const [driverName, setDriverName] = useState('');
  const [notes, setNotes] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await fetchWithAuth<RouteRecord[]>('/api/routes');
      setRoutes(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(String((err as Error).message || 'Could not load routes'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createRoute() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Route name is required.');
      return;
    }
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      await sendWithAuth<RouteRecord>('/api/routes', 'POST', {
        name: trimmed,
        driverName: driverName.trim() || '',
        notes: notes.trim() || '',
        stopIds: [],
      });
      setName('');
      setDriverName('');
      setNotes('');
      setNotice(`Created route ${trimmed}.`);
      await load();
    } catch (err) {
      setError(String((err as Error).message || 'Could not create route'));
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteRoute(route: RouteRecord) {
    if (!confirm(`Delete route ${route.name || route.id.slice(0, 8)}?`)) return;
    setError('');
    setNotice('');
    try {
      await sendWithAuth(`/api/routes/${route.id}`, 'DELETE');
      setNotice(`Deleted route ${route.name || route.id.slice(0, 8)}.`);
      await load();
    } catch (err) {
      setError(String((err as Error).message || 'Could not delete route'));
    }
  }

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading routes...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}
      {notice ? <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div> : null}

      <Card>
        <CardHeader>
          <CardTitle>Create Route</CardTitle>
          <CardDescription>Route setup in v2 using existing `/api/routes` contracts.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-muted-foreground">Route Name</span>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Downtown Loop" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-muted-foreground">Driver</span>
            <Input value={driverName} onChange={(event) => setDriverName(event.target.value)} placeholder="Dana Driver" />
          </label>
          <label className="space-y-1 text-sm md:col-span-2">
            <span className="font-semibold text-muted-foreground">Notes</span>
            <Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Shift notes or constraints" />
          </label>
          <div className="md:col-span-4 flex gap-2">
            <Button onClick={createRoute} disabled={submitting}>
              Add Route
            </Button>
            <Button variant="outline" onClick={load}>
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Routes</CardTitle>
          <CardDescription>Template and active stop references with driver assignments.</CardDescription>
        </CardHeader>
        <CardContent className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Route</TableHead>
                <TableHead>Driver</TableHead>
                <TableHead>Template Stops</TableHead>
                <TableHead>Active Stops</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {routes.length ? (
                routes.map((route) => (
                  <TableRow key={route.id}>
                    <TableCell className="font-medium">{route.name || route.id.slice(0, 8)}</TableCell>
                    <TableCell>{route.driver || '-'}</TableCell>
                    <TableCell>{(route.stop_ids || []).length.toLocaleString()}</TableCell>
                    <TableCell>{(route.active_stop_ids || []).length.toLocaleString()}</TableCell>
                    <TableCell>{route.notes || '-'}</TableCell>
                    <TableCell>{route.created_at ? new Date(route.created_at).toLocaleDateString() : '-'}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => deleteRoute(route)}>
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground">
                    No routes found.
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

export function StopsPage() {
  const [stops, setStops] = useState<StopRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [editingStopId, setEditingStopId] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [notes, setNotes] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await fetchWithAuth<StopRecord[]>('/api/stops');
      setStops(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(String((err as Error).message || 'Could not load stops'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function resetForm() {
    setEditingStopId(null);
    setName('');
    setAddress('');
    setLat('');
    setLng('');
    setNotes('');
  }

  function editStop(stop: StopRecord) {
    setEditingStopId(stop.id);
    setName(stop.name || '');
    setAddress(stop.address || '');
    setLat(String(stop.lat ?? ''));
    setLng(String(stop.lng ?? ''));
    setNotes(stop.notes || '');
    setNotice(`Editing stop ${stop.name || stop.id.slice(0, 8)}.`);
  }

  async function submitStop() {
    const trimmedName = name.trim();
    const trimmedAddress = address.trim();
    if (!trimmedName || !trimmedAddress) {
      setError('Stop name and address are required.');
      return;
    }
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      const payload = {
        name: trimmedName,
        address: trimmedAddress,
        lat: lat.trim() || 0,
        lng: lng.trim() || 0,
        notes: notes.trim() || '',
      };
      if (editingStopId) {
        await sendWithAuth(`/api/stops/${editingStopId}`, 'PATCH', payload);
        setNotice('Stop updated.');
      } else {
        await sendWithAuth('/api/stops', 'POST', payload);
        setNotice('Stop added.');
      }
      resetForm();
      await load();
    } catch (err) {
      setError(String((err as Error).message || 'Could not save stop'));
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteStop(stop: StopRecord) {
    if (!confirm(`Delete stop ${stop.name || stop.id.slice(0, 8)}?`)) return;
    setError('');
    setNotice('');
    try {
      await sendWithAuth(`/api/stops/${stop.id}`, 'DELETE');
      if (editingStopId === stop.id) resetForm();
      setNotice(`Deleted stop ${stop.name || stop.id.slice(0, 8)}.`);
      await load();
    } catch (err) {
      setError(String((err as Error).message || 'Could not delete stop'));
    }
  }

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading stops...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}
      {notice ? <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div> : null}

      <Card>
        <CardHeader>
          <CardTitle>{editingStopId ? 'Edit Stop' : 'Create Stop'}</CardTitle>
          <CardDescription>Stop CRUD parity on top of existing `/api/stops` endpoints.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-muted-foreground">Stop Name</span>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Harbor Market" />
          </label>
          <label className="space-y-1 text-sm md:col-span-2">
            <span className="font-semibold text-muted-foreground">Address</span>
            <Input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="123 Dockside Ave" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-muted-foreground">Notes</span>
            <Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Dock code or access notes" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-muted-foreground">Latitude</span>
            <Input value={lat} onChange={(event) => setLat(event.target.value)} placeholder="32.7765" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-muted-foreground">Longitude</span>
            <Input value={lng} onChange={(event) => setLng(event.target.value)} placeholder="-79.9311" />
          </label>
          <div className="md:col-span-2 flex items-end gap-2">
            <Button onClick={submitStop} disabled={submitting}>
              {editingStopId ? 'Save Stop' : 'Add Stop'}
            </Button>
            {editingStopId ? (
              <Button variant="ghost" onClick={resetForm}>
                Cancel Edit
              </Button>
            ) : null}
            <Button variant="outline" onClick={load}>
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stops</CardTitle>
          <CardDescription>Current route stops and geocoordinates.</CardDescription>
        </CardHeader>
        <CardContent className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Stop</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>Lat</TableHead>
                <TableHead>Lng</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stops.length ? (
                stops.map((stop) => (
                  <TableRow key={stop.id}>
                    <TableCell className="font-medium">{stop.name || stop.id.slice(0, 8)}</TableCell>
                    <TableCell>{stop.address || '-'}</TableCell>
                    <TableCell>{asNumber(stop.lat).toFixed(5)}</TableCell>
                    <TableCell>{asNumber(stop.lng).toFixed(5)}</TableCell>
                    <TableCell>{stop.notes || '-'}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => editStop(stop)}>
                          Edit
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => deleteStop(stop)}>
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    No stops found.
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

export function UsersPage() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'manager' | 'driver'>('driver');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await fetchWithAuth<UserRecord[]>('/api/users');
      setUsers(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(String((err as Error).message || 'Could not load users'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return users;
    return users.filter((user) =>
      [user.name, user.email, user.role, user.status, user.company_name, user.location_name]
        .filter(Boolean)
        .some((part) => String(part).toLowerCase().includes(needle))
    );
  }, [users, search]);

  async function inviteUser() {
    const name = inviteName.trim();
    const email = inviteEmail.trim();
    if (!name || !email) {
      setError('Invite name and email are required.');
      return;
    }
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      await sendWithAuth('/api/users/invite', 'POST', { name, email, role: inviteRole });
      setInviteName('');
      setInviteEmail('');
      setInviteRole('driver');
      setNotice(`Invite queued for ${email}.`);
      await load();
    } catch (err) {
      setError(String((err as Error).message || 'Could not invite user'));
    } finally {
      setSubmitting(false);
    }
  }

  async function updateRole(user: UserRecord, role: 'admin' | 'manager' | 'driver') {
    setBusyUserId(user.id);
    setError('');
    setNotice('');
    try {
      await sendWithAuth(`/api/users/${user.id}/role`, 'PATCH', { role });
      setNotice(`Updated ${user.name || user.email || user.id.slice(0, 8)} to ${role}.`);
      await load();
    } catch (err) {
      setError(String((err as Error).message || 'Could not update role'));
    } finally {
      setBusyUserId(null);
    }
  }

  async function deleteUser(user: UserRecord) {
    if (!confirm(`Delete user ${user.name || user.email || user.id.slice(0, 8)}?`)) return;
    setBusyUserId(user.id);
    setError('');
    setNotice('');
    try {
      await sendWithAuth(`/api/users/${user.id}`, 'DELETE');
      setNotice(`Deleted ${user.name || user.email || user.id.slice(0, 8)}.`);
      await load();
    } catch (err) {
      setError(String((err as Error).message || 'Could not delete user'));
    } finally {
      setBusyUserId(null);
    }
  }

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading users...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}
      {notice ? <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div> : null}

      <Card>
        <CardHeader>
          <CardTitle>Invite User</CardTitle>
          <CardDescription>Create onboarding invite links using `/api/users/invite`.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-muted-foreground">Name</span>
            <Input value={inviteName} onChange={(event) => setInviteName(event.target.value)} placeholder="Taylor Manager" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-muted-foreground">Email</span>
            <Input value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="user@example.com" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-muted-foreground">Role</span>
            <select
              value={inviteRole}
              onChange={(event) => setInviteRole(event.target.value as 'admin' | 'manager' | 'driver')}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="driver">driver</option>
              <option value="manager">manager</option>
              <option value="admin">admin</option>
            </select>
          </label>
          <div className="flex items-end gap-2">
            <Button onClick={inviteUser} disabled={submitting}>
              Send Invite
            </Button>
            <Button variant="outline" onClick={load}>
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <CardTitle>User Directory</CardTitle>
            <CardDescription>Role administration and active account roster.</CardDescription>
          </div>
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search users, role, email, scope" />
        </CardHeader>
        <CardContent className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length ? (
                filtered.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.name || '-'}</TableCell>
                    <TableCell>{user.email || '-'}</TableCell>
                    <TableCell>
                      <Badge variant={user.role === 'admin' ? 'warning' : user.role === 'manager' ? 'secondary' : 'neutral'}>
                        {String(user.role || 'unknown')}
                      </Badge>
                    </TableCell>
                    <TableCell>{user.status || '-'}</TableCell>
                    <TableCell>
                      {[user.company_name, user.location_name].filter(Boolean).join(' / ') || '-'}
                    </TableCell>
                    <TableCell>{user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '-'}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <select
                          value={String(user.role || 'driver')}
                          onChange={(event) => updateRole(user, event.target.value as 'admin' | 'manager' | 'driver')}
                          disabled={busyUserId === user.id}
                          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                        >
                          <option value="driver">driver</option>
                          <option value="manager">manager</option>
                          <option value="admin">admin</option>
                        </select>
                        <Button variant="ghost" size="sm" onClick={() => deleteUser(user)} disabled={busyUserId === user.id}>
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground">
                    No users found.
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
