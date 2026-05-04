import { useMemo, useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { StatusBadge } from '../components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { getUserRole } from '../lib/api';
import { type Role, useAddUser, useChangeUserRole, useInviteUser, useRemoveUser, useUsers } from '../hooks/useUsers';

type RoleFilter = 'all' | Role;
type AuthRole = Role | 'unknown';
type UserStatus = 'active' | 'pending' | 'inactive' | 'other';

const statusColors = { active: 'green', pending: 'yellow', inactive: 'gray' } as const;

function normalizeRole(value: string | undefined): Role {
  const role = String(value || '').trim().toLowerCase();
  if (role === 'admin' || role === 'manager' || role === 'driver') return role;
  return 'driver';
}
function normalizeStatus(value: string | undefined): UserStatus {
  const s = String(value || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (s === 'active') return 'active';
  if (s === 'pending') return 'pending';
  if (s === 'inactive') return 'inactive';
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
  return Number.isNaN(parsed.getTime()) ? '-' : parsed.toLocaleDateString();
}
function inviteStatusMessage(result: { emailQueued?: boolean; emailSent?: boolean; emailError?: string | null }): string {
  if (result.emailQueued) return 'Invite created. Email dispatch is queued.';
  if (result.emailSent) return 'Invite created and email delivered.';
  if (result.emailError) return `Invite created, but email failed: ${result.emailError}`;
  return 'Invite created. No email provider configured; share the invite link manually.';
}
function readCurrentUser(): { id?: string; email?: string } {
  try {
    const raw = localStorage.getItem('nr_user');
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { id?: string; email?: string };
    return { id: parsed.id, email: parsed.email };
  } catch { return {}; }
}

export function UsersPage() {
  const actorRole = getUserRole() as AuthRole;
  const currentUser = useMemo(() => readCurrentUser(), []);
  const canAdminister = actorRole === 'admin';
  const canInvite = actorRole === 'admin' || actorRole === 'manager';
  const inviteRoleOptions: Role[] = canAdminister ? ['driver', 'manager', 'admin'] : ['driver', 'manager'];

  const { data: users = [], isLoading, isError, error } = useUsers();
  const inviteUser = useInviteUser();
  const addUser = useAddUser();
  const changeRole = useChangeUserRole();
  const removeUser = useRemoveUser();

  const [notice, setNotice] = useState('');
  const [inviteUrl, setInviteUrl] = useState('');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('driver');
  const [addName, setAddName] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addPassword, setAddPassword] = useState('');
  const [addRole, setAddRole] = useState<Role>('driver');

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== 'all' && normalizeRole(u.role) !== roleFilter) return false;
      if (!needle) return true;
      return String(u.name || '').toLowerCase().includes(needle) || String(u.email || '').toLowerCase().includes(needle);
    });
  }, [roleFilter, search, users]);

  const summary = useMemo(() => ({
    active: users.filter((u) => normalizeStatus(u.status) === 'active').length,
    pending: users.filter((u) => normalizeStatus(u.status) === 'pending').length,
    admins: users.filter((u) => normalizeRole(u.role) === 'admin').length,
  }), [users]);

  function isSelf(user: { id?: string; email?: string }) {
    if (user.id && currentUser.id && String(user.id) === String(currentUser.id)) return true;
    if (user.email && currentUser.email && String(user.email).toLowerCase() === String(currentUser.email).toLowerCase()) return true;
    return false;
  }

  async function submitInvite() {
    const name = inviteName.trim(); const email = inviteEmail.trim();
    if (!name || !email) return;
    try {
      const data = await inviteUser.mutateAsync({ name, email, role: inviteRole });
      setNotice(inviteStatusMessage(data));
      setInviteUrl(data.inviteUrl || '');
      setInviteName(''); setInviteEmail(''); setInviteRole('driver');
    } catch (err) { setNotice(String((err as Error)?.message || 'Failed to send invite')); }
  }

  async function submitAddUser() {
    const name = addName.trim(); const email = addEmail.trim(); const password = addPassword.trim();
    if (!name || !email || !password || password.length < 8) return;
    try {
      await addUser.mutateAsync({ name, email, password, role: addRole });
      setNotice(`User ${email} created and set to active.`);
      setAddName(''); setAddEmail(''); setAddPassword(''); setAddRole('driver');
    } catch (err) { setNotice(String((err as Error)?.message || 'Failed to create user')); }
  }

  async function copyInviteUrl() {
    if (!inviteUrl) return;
    try { await navigator.clipboard.writeText(inviteUrl); setNotice('Invite link copied to clipboard.'); }
    catch { setNotice('Invite link is available below; clipboard copy is not available in this browser context.'); }
  }

  return (
    <div className="space-y-5">
      {isLoading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading users...</div> : null}
      {isError ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{String((error as Error)?.message || 'Could not load users')}</div> : null}
      {notice ? <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Team Members" value={users.length.toLocaleString()} />
        <SummaryCard label="Active" value={summary.active.toLocaleString()} />
        <SummaryCard label="Pending Setup" value={summary.pending.toLocaleString()} />
        <SummaryCard label="Admins" value={summary.admins.toLocaleString()} />
      </div>

      {canAdminister ? (
        <Card>
          <CardHeader className="space-y-2"><CardTitle>Add User</CardTitle><CardDescription>Create an active account immediately with a set password.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-5">
              <Input placeholder="Full name" value={addName} onChange={(e) => setAddName(e.target.value)} disabled={addUser.isPending} />
              <Input type="email" placeholder="email@company.com" value={addEmail} onChange={(e) => setAddEmail(e.target.value)} disabled={addUser.isPending} />
              <Input type="password" placeholder="Password (min 8 chars)" value={addPassword} onChange={(e) => setAddPassword(e.target.value)} disabled={addUser.isPending} />
              <select value={addRole} onChange={(e) => setAddRole(e.target.value as Role)} disabled={addUser.isPending} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                {inviteRoleOptions.map((o) => <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
              </select>
              <Button onClick={submitAddUser} disabled={addUser.isPending}>{addUser.isPending ? 'Creating...' : 'Add User'}</Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="space-y-2"><CardTitle>Invite Team Member</CardTitle><CardDescription>Create secure invite links and assign a role before first sign-in.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-4">
            <Input placeholder="Full name" value={inviteName} onChange={(e) => setInviteName(e.target.value)} disabled={!canInvite || inviteUser.isPending} />
            <Input type="email" placeholder="work@email.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} disabled={!canInvite || inviteUser.isPending} />
            <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)} disabled={!canInvite || inviteUser.isPending} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
              {inviteRoleOptions.map((o) => <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
            </select>
            <Button onClick={submitInvite} disabled={!canInvite || inviteUser.isPending}>{inviteUser.isPending ? 'Sending Invite...' : 'Send Invite'}</Button>
          </div>
          {!canInvite && <div className="text-xs text-muted-foreground">Only admin and manager accounts can send invites.</div>}
          {inviteUrl && (
            <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
              <div className="font-medium text-foreground">Manual invite link</div>
              <div className="mt-1 break-all text-muted-foreground">{inviteUrl}</div>
              <div className="mt-2"><Button size="sm" variant="outline" onClick={copyInviteUrl}>Copy Link</Button></div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1"><CardTitle>Access Directory</CardTitle><CardDescription>Live team roster with role-scoped administration controls.</CardDescription></div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Role</span>
              <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as RoleFilter)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                <option value="all">All Roles</option>
                <option value="admin">Admin</option>
                <option value="manager">Manager</option>
                <option value="driver">Driver</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Search</span>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or email" />
            </label>
          </div>
        </CardHeader>
        <CardContent className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Role</TableHead>
                <TableHead>Status</TableHead><TableHead>Company</TableHead><TableHead>Location</TableHead>
                <TableHead>Joined</TableHead><TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length ? filtered.map((user) => {
                const role = normalizeRole(user.role);
                const status = normalizeStatus(user.status);
                const self = isSelf(user);
                const busy = changeRole.isPending || removeUser.isPending;
                return (
                  <TableRow key={user.id || `${user.email || ''}-${user.name || ''}`}>
                    <TableCell className="font-medium">{user.name || '-'}</TableCell>
                    <TableCell>{user.email || '-'}</TableCell>
                    <TableCell><Badge variant={roleVariant(role)}>{role.charAt(0).toUpperCase() + role.slice(1)}</Badge></TableCell>
                    <TableCell><StatusBadge status={status === 'other' ? 'unknown' : status} colorMap={statusColors} fallbackLabel="Unknown" /></TableCell>
                    <TableCell>{user.companyName || '-'}</TableCell>
                    <TableCell>{user.locationName || '-'}</TableCell>
                    <TableCell>{formatDate(user.createdAt)}</TableCell>
                    <TableCell>
                      {canAdminister && !self ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <select value={role} onChange={(e) => void changeRole.mutateAsync({ id: user.id, role: e.target.value as Role })} disabled={busy} className="h-9 rounded-md border border-input bg-background px-2 text-xs">
                            <option value="driver">Driver</option>
                            <option value="manager">Manager</option>
                            <option value="admin">Admin</option>
                          </select>
                          <Button size="sm" variant="outline" className="border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => { if (window.confirm(`Remove ${user.name || user.email}?`)) void removeUser.mutateAsync(user.id); }} disabled={busy}>Remove</Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">{self ? 'Signed-in account' : 'View only'}</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              }) : (
                <TableRow><TableCell colSpan={8} className="text-muted-foreground">No users found for the selected filters.</TableCell></TableRow>
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
    <Card><CardHeader className="space-y-1"><CardDescription>{label}</CardDescription><CardTitle className="text-2xl">{value}</CardTitle></CardHeader></Card>
  );
}
