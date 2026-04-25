import { useEffect, useMemo, useState } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { StatusBadge } from '../components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth, sendWithAuth } from '../lib/api';

type UserRole = 'admin' | 'manager' | 'driver' | 'other';
type UserStatus = 'active' | 'pending' | 'inactive' | 'other';

type UserRecord = {
  id: string;
  name?: string;
  email?: string;
  role?: string;
  status?: string;
  createdAt?: string;
  companyName?: string;
  locationName?: string;
};

const statusColors = {
  active: 'green',
  pending: 'yellow',
  inactive: 'gray',
} as const;

function normalizeRole(value: string | undefined): UserRole {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'admin' || normalized === 'manager' || normalized === 'driver') return normalized;
  return 'other';
}

function normalizeStatus(value: string | undefined): UserStatus {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'active' || normalized === 'pending' || normalized === 'inactive') return normalized;
  return 'other';
}

export function UsersPage() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');
  const [invite, setInvite] = useState({ name: '', email: '', role: 'driver' });
  const [pendingId, setPendingId] = useState('');

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
    return users.filter((user) => {
      const role = normalizeRole(user.role);
      if (roleFilter !== 'all' && role !== roleFilter) return false;
      if (!needle) return true;
      return [user.name, user.email, user.companyName, user.locationName].some((value) =>
        String(value || '').toLowerCase().includes(needle)
      );
    });
  }, [users, roleFilter, search]);

  const summary = useMemo(() => {
    return {
      total: users.length,
      admins: users.filter((user) => normalizeRole(user.role) === 'admin').length,
      managers: users.filter((user) => normalizeRole(user.role) === 'manager').length,
      drivers: users.filter((user) => normalizeRole(user.role) === 'driver').length,
      pending: users.filter((user) => normalizeStatus(user.status) === 'pending').length,
    };
  }, [users]);

  async function sendInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    try {
      const response = await sendWithAuth<{ message?: string; inviteUrl?: string; emailSent?: boolean; emailError?: string }>(
        '/api/users/invite',
        'POST',
        invite
      );
      setNotice(
        `${response.message || `Invite created for ${invite.email}`}${response.emailSent ? ' and email was sent.' : ''}${
          response.emailError ? ` Email note: ${response.emailError}.` : ''
        }`
      );
      setInvite({ name: '', email: '', role: 'driver' });
      await load();
    } catch (err) {
      setError(String((err as Error).message || 'Could not create invite'));
    }
  }

  async function changeRole(user: UserRecord, role: UserRole) {
    if (role === 'other') return;
    setPendingId(user.id);
    setError('');
    setNotice('');
    try {
      await sendWithAuth(`/api/users/${encodeURIComponent(user.id)}/role`, 'PATCH', { role });
      setNotice(`${user.name || user.email || user.id} is now ${role}.`);
      await load();
    } catch (err) {
      setError(String((err as Error).message || 'Could not update role'));
    } finally {
      setPendingId('');
    }
  }

  async function deleteUser(user: UserRecord) {
    if (!confirm(`Delete ${user.name || user.email || user.id}?`)) return;
    setPendingId(user.id);
    setError('');
    setNotice('');
    try {
      await sendWithAuth(`/api/users/${encodeURIComponent(user.id)}`, 'DELETE');
      setNotice(`${user.name || user.email || user.id} was deleted.`);
      await load();
    } catch (err) {
      setError(String((err as Error).message || 'Could not delete user'));
    } finally {
      setPendingId('');
    }
  }

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading users...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}
      {notice ? <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryCard label="Users" value={summary.total.toLocaleString()} />
        <SummaryCard label="Admins" value={summary.admins.toLocaleString()} />
        <SummaryCard label="Managers" value={summary.managers.toLocaleString()} />
        <SummaryCard label="Drivers" value={summary.drivers.toLocaleString()} />
        <SummaryCard label="Pending" value={summary.pending.toLocaleString()} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Invite User</CardTitle>
          <CardDescription>Create an invite through `/api/users/invite` using the active company scope.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 md:grid-cols-[1fr_1fr_180px_auto]" onSubmit={sendInvite}>
            <Input required value={invite.name} onChange={(event) => setInvite((current) => ({ ...current, name: event.target.value }))} placeholder="Name" />
            <Input required type="email" value={invite.email} onChange={(event) => setInvite((current) => ({ ...current, email: event.target.value }))} placeholder="Email" />
            <select
              value={invite.role}
              onChange={(event) => setInvite((current) => ({ ...current, role: event.target.value }))}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="driver">Driver</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
            </select>
            <Button type="submit">Send Invite</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <CardTitle>User Directory</CardTitle>
            <CardDescription>Role, invite status, and scoped account access from `/api/users`.</CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Role</span>
              <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as 'all' | UserRole)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                <option value="all">All</option>
                <option value="admin">Admin</option>
                <option value="manager">Manager</option>
                <option value="driver">Driver</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Search</span>
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, email, company" />
            </label>
            <Button variant="outline" onClick={load}>Refresh</Button>
          </div>
        </CardHeader>
        <CardContent className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length ? (
                filtered.map((user) => {
                  const disabled = pendingId === user.id;
                  return (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{user.name || '-'}</TableCell>
                      <TableCell>{user.email || '-'}</TableCell>
                      <TableCell className="capitalize">{normalizeRole(user.role)}</TableCell>
                      <TableCell><StatusBadge status={normalizeStatus(user.status)} colorMap={statusColors} fallbackLabel="Unknown" /></TableCell>
                      <TableCell>{user.companyName || '-'}</TableCell>
                      <TableCell>{user.locationName || '-'}</TableCell>
                      <TableCell>{user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '-'}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {(['admin', 'manager', 'driver'] as const).map((role) => (
                            <Button key={role} variant="ghost" size="sm" disabled={disabled || normalizeRole(user.role) === role} onClick={() => changeRole(user, role)}>
                              {role}
                            </Button>
                          ))}
                          <Button variant="ghost" size="sm" disabled={disabled || normalizeRole(user.role) === 'admin'} onClick={() => deleteUser(user)}>
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={8} className="text-muted-foreground">No users found for the selected filters.</TableCell>
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
