import { useEffect, useMemo, useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { StatusBadge } from '../components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth, getUserRole, sendWithAuth } from '../lib/api';

type Role = 'admin' | 'manager' | 'driver';
type RoleFilter = 'all' | Role;
type AuthRole = Role | 'unknown';
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

type InviteResult = {
  message?: string;
  userId?: string;
  inviteUrl?: string;
  emailSent?: boolean;
  emailQueued?: boolean;
  emailError?: string | null;
  emailProvider?: string | null;
};

type CurrentUser = {
  id?: string;
  email?: string;
};

const statusColors = {
  active: 'green',
  pending: 'yellow',
  inactive: 'gray',
} as const;

function normalizeRole(value: string | undefined): Role {
  const role = String(value || '').trim().toLowerCase();
  if (role === 'admin' || role === 'manager' || role === 'driver') return role;
  return 'driver';
}

function normalizeStatus(value: string | undefined): UserStatus {
  const status = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
  if (status === 'active') return 'active';
  if (status === 'pending') return 'pending';
  if (status === 'inactive') return 'inactive';
  return 'other';
}

function roleVariant(role: Role): 'success' | 'secondary' | 'neutral' {
  if (role === 'admin') return 'success';
  if (role === 'manager') return 'secondary';
  return 'neutral';
}

function formatDate(value: string | undefined): string {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleDateString();
}

function readCurrentUser(): CurrentUser {
  try {
    const raw = localStorage.getItem('nr_user');
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { id?: string; email?: string };
    return { id: parsed.id, email: parsed.email };
  } catch {
    return {};
  }
}

function inviteStatusMessage(result: InviteResult): string {
  if (result.emailQueued) return 'Invite created. Email dispatch is queued.';
  if (result.emailSent) return 'Invite created and email delivered.';
  if (result.emailError) return `Invite created, but email failed: ${result.emailError}`;
  return 'Invite created. No email provider configured; share the invite link manually.';
}

export function UsersPage() {
  const actorRole = getUserRole() as AuthRole;
  const currentUser = useMemo(() => readCurrentUser(), []);
  const canAdminister = actorRole === 'admin';
  const canInvite = actorRole === 'admin' || actorRole === 'manager';
  const inviteRoleOptions: Role[] = canAdminister ? ['driver', 'manager', 'admin'] : ['driver', 'manager'];

  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('driver');
  const [submittingInvite, setSubmittingInvite] = useState(false);
  const [inviteUrl, setInviteUrl] = useState('');
  const [rowBusyUserId, setRowBusyUserId] = useState('');

  const [addName, setAddName] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addPassword, setAddPassword] = useState('');
  const [addRole, setAddRole] = useState<Role>('driver');
  const [submittingAdd, setSubmittingAdd] = useState(false);

  async function loadUsers() {
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
    void loadUsers();
  }, []);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return users.filter((user) => {
      const role = normalizeRole(user.role);
      if (roleFilter !== 'all' && role !== roleFilter) return false;
      if (!needle) return true;
      return (
        String(user.name || '')
          .toLowerCase()
          .includes(needle) ||
        String(user.email || '')
          .toLowerCase()
          .includes(needle)
      );
    });
  }, [roleFilter, search, users]);

  const summary = useMemo(() => {
    const active = users.filter((user) => normalizeStatus(user.status) === 'active').length;
    const pending = users.filter((user) => normalizeStatus(user.status) === 'pending').length;
    const admins = users.filter((user) => normalizeRole(user.role) === 'admin').length;
    return { active, pending, admins };
  }, [users]);

  async function submitInvite() {
    if (!canInvite) {
      setError('Only admin or manager users can invite team members.');
      return;
    }
    const name = inviteName.trim();
    const email = inviteEmail.trim();
    if (!name || !email) {
      setError('Name and email are required to create an invite.');
      return;
    }
    setSubmittingInvite(true);
    setError('');
    setNotice('');
    setInviteUrl('');
    try {
      const data = await sendWithAuth<InviteResult>('/api/users/invite', 'POST', {
        name,
        email,
        role: inviteRole,
      });
      setNotice(inviteStatusMessage(data));
      setInviteUrl(data.inviteUrl || '');
      setInviteName('');
      setInviteEmail('');
      setInviteRole('driver');
      await loadUsers();
    } catch (err) {
      setError(String((err as Error).message || 'Failed to send invite'));
    } finally {
      setSubmittingInvite(false);
    }
  }

  async function submitAddUser() {
    if (!canAdminister) { setError('Only admins can create users directly.'); return; }
    const name = addName.trim();
    const email = addEmail.trim();
    const password = addPassword.trim();
    if (!name || !email || !password) { setError('Name, email, and password are all required.'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    setSubmittingAdd(true);
    setError('');
    setNotice('');
    try {
      await sendWithAuth('/api/users', 'POST', { name, email, password, role: addRole });
      setNotice(`User ${email} created and set to active.`);
      setAddName('');
      setAddEmail('');
      setAddPassword('');
      setAddRole('driver');
      await loadUsers();
    } catch (err) {
      setError(String((err as Error).message || 'Failed to create user'));
    } finally {
      setSubmittingAdd(false);
    }
  }

  async function copyInviteUrl() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setNotice('Invite link copied to clipboard.');
    } catch {
      setNotice('Invite link is available below; clipboard copy is not available in this browser context.');
    }
  }

  async function changeRole(target: UserRecord, nextRole: Role) {
    if (!canAdminister || !target.id) return;
    setRowBusyUserId(target.id);
    setError('');
    setNotice('');
    try {
      await sendWithAuth(`/api/users/${target.id}/role`, 'PATCH', { role: nextRole });
      setNotice(`Role updated for ${target.name || target.email || target.id}.`);
      await loadUsers();
    } catch (err) {
      setError(String((err as Error).message || 'Failed to update role'));
    } finally {
      setRowBusyUserId('');
    }
  }

  async function removeUser(target: UserRecord) {
    if (!canAdminister || !target.id) return;
    const label = target.name || target.email || target.id;
    if (!window.confirm(`Remove ${label} from the system?`)) return;
    setRowBusyUserId(target.id);
    setError('');
    setNotice('');
    try {
      await sendWithAuth(`/api/users/${target.id}`, 'DELETE');
      setNotice(`Removed ${label}.`);
      await loadUsers();
    } catch (err) {
      setError(String((err as Error).message || 'Failed to remove user'));
    } finally {
      setRowBusyUserId('');
    }
  }

  function isSelf(user: UserRecord): boolean {
    if (!user) return false;
    if (user.id && currentUser.id && String(user.id) === String(currentUser.id)) return true;
    if (user.email && currentUser.email && String(user.email).toLowerCase() === String(currentUser.email).toLowerCase()) return true;
    return false;
  }

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading users...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}
      {notice ? <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Team Members" value={users.length.toLocaleString()} />
        <SummaryCard label="Active" value={summary.active.toLocaleString()} />
        <SummaryCard label="Pending Setup" value={summary.pending.toLocaleString()} />
        <SummaryCard label="Admins" value={summary.admins.toLocaleString()} />
      </div>

      {canAdminister ? (
        <Card>
          <CardHeader className="space-y-2">
            <CardTitle>Add User</CardTitle>
            <CardDescription>Create an active account immediately with a set password. Use Invite for self-service sign-up.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-5">
              <Input
                placeholder="Full name"
                value={addName}
                onChange={(event) => setAddName(event.target.value)}
                disabled={submittingAdd}
              />
              <Input
                type="email"
                placeholder="email@company.com"
                value={addEmail}
                onChange={(event) => setAddEmail(event.target.value)}
                disabled={submittingAdd}
              />
              <Input
                type="password"
                placeholder="Password (min 8 chars)"
                value={addPassword}
                onChange={(event) => setAddPassword(event.target.value)}
                disabled={submittingAdd}
              />
              <select
                value={addRole}
                onChange={(event) => setAddRole(event.target.value as Role)}
                disabled={submittingAdd}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                {inviteRoleOptions.map((option) => (
                  <option key={option} value={option}>
                    {option.charAt(0).toUpperCase() + option.slice(1)}
                  </option>
                ))}
              </select>
              <Button onClick={submitAddUser} disabled={submittingAdd}>
                {submittingAdd ? 'Creating...' : 'Add User'}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="space-y-2">
          <CardTitle>Invite Team Member</CardTitle>
          <CardDescription>Create secure invite links and assign a role before first sign-in.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-4">
            <Input
              placeholder="Full name"
              value={inviteName}
              onChange={(event) => setInviteName(event.target.value)}
              disabled={!canInvite || submittingInvite}
            />
            <Input
              type="email"
              placeholder="work@email.com"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              disabled={!canInvite || submittingInvite}
            />
            <select
              value={inviteRole}
              onChange={(event) => setInviteRole(event.target.value as Role)}
              disabled={!canInvite || submittingInvite}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              {inviteRoleOptions.map((option) => (
                <option key={option} value={option}>
                  {option.charAt(0).toUpperCase() + option.slice(1)}
                </option>
              ))}
            </select>
            <Button onClick={submitInvite} disabled={!canInvite || submittingInvite}>
              {submittingInvite ? 'Sending Invite...' : 'Send Invite'}
            </Button>
          </div>
          {!canInvite ? (
            <div className="text-xs text-muted-foreground">Only admin and manager accounts can send invites.</div>
          ) : null}
          {inviteUrl ? (
            <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
              <div className="font-medium text-foreground">Manual invite link</div>
              <div className="mt-1 break-all text-muted-foreground">{inviteUrl}</div>
              <div className="mt-2">
                <Button size="sm" variant="outline" onClick={copyInviteUrl}>
                  Copy Link
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <CardTitle>Access Directory</CardTitle>
            <CardDescription>Live team roster from `/api/users` with role-scoped administration controls.</CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Role</span>
              <select
                value={roleFilter}
                onChange={(event) => setRoleFilter(event.target.value as RoleFilter)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">All Roles</option>
                <option value="admin">Admin</option>
                <option value="manager">Manager</option>
                <option value="driver">Driver</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Search</span>
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name or email" />
            </label>
            <Button variant="outline" onClick={loadUsers}>
              Refresh
            </Button>
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
                <TableHead>Joined</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length ? (
                filtered.map((user) => {
                  const role = normalizeRole(user.role);
                  const status = normalizeStatus(user.status);
                  const self = isSelf(user);
                  const busy = rowBusyUserId === user.id;
                  return (
                    <TableRow key={user.id || `${user.email || ''}-${user.name || ''}`}>
                      <TableCell className="font-medium">{user.name || '-'}</TableCell>
                      <TableCell>{user.email || '-'}</TableCell>
                      <TableCell>
                        <Badge variant={roleVariant(role)}>{role.charAt(0).toUpperCase() + role.slice(1)}</Badge>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={status === 'other' ? 'unknown' : status} colorMap={statusColors} fallbackLabel="Unknown" />
                      </TableCell>
                      <TableCell>{user.companyName || '-'}</TableCell>
                      <TableCell>{user.locationName || '-'}</TableCell>
                      <TableCell>{formatDate(user.createdAt)}</TableCell>
                      <TableCell>
                        {canAdminister && !self ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <select
                              value={role}
                              onChange={(event) => void changeRole(user, event.target.value as Role)}
                              disabled={busy}
                              className="h-9 rounded-md border border-input bg-background px-2 text-xs"
                            >
                              <option value="driver">Driver</option>
                              <option value="manager">Manager</option>
                              <option value="admin">Admin</option>
                            </select>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700"
                              onClick={() => void removeUser(user)}
                              disabled={busy}
                            >
                              Remove
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">{self ? 'Signed-in account' : 'View only'}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={8} className="text-muted-foreground">
                    No users found for the selected filters.
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
