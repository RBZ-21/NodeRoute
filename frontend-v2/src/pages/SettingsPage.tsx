import { useEffect, useMemo, useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { fetchCurrentUser, fetchWithAuth, getUserRole, sendWithAuth } from '../lib/api';

type Role = 'admin' | 'manager' | 'driver' | 'unknown';

type CurrentUser = {
  id?: string;
  name?: string;
  email?: string;
  role?: string;
  companyName?: string;
  locationName?: string;
};

type CompanySettings = {
  forceDriverSignature?: boolean;
};

type MutationResult = {
  message?: string;
};

function roleVariant(role: Role): 'success' | 'secondary' | 'neutral' {
  if (role === 'admin') return 'success';
  if (role === 'manager') return 'secondary';
  return 'neutral';
}

function normalizeRole(value: string | undefined): Role {
  const role = String(value || '').trim().toLowerCase();
  if (role === 'admin' || role === 'manager' || role === 'driver') return role;
  return 'unknown';
}

function updateLocalUserName(nextName: string) {
  try {
    const raw = localStorage.getItem('nr_user');
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    parsed.name = nextName;
    localStorage.setItem('nr_user', JSON.stringify(parsed));
  } catch {
    // Ignore local storage errors and continue.
  }
}

export function SettingsPage() {
  const role = getUserRole() as Role;
  const canManageCompanySettings = role === 'admin' || role === 'manager';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [user, setUser] = useState<CurrentUser>({});
  const [displayName, setDisplayName] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const [forceDriverSignature, setForceDriverSignature] = useState(false);
  const [initialForceDriverSignature, setInitialForceDriverSignature] = useState(false);
  const [companySettingsLoading, setCompanySettingsLoading] = useState(false);
  const [savingCompanySettings, setSavingCompanySettings] = useState(false);

  const companySettingsDirty = forceDriverSignature !== initialForceDriverSignature;

  async function fetchCompanySettings(): Promise<CompanySettings> {
    return fetchWithAuth<CompanySettings>('/api/settings/company');
  }

  async function loadSettings() {
    setLoading(true);
    setError('');
    setNotice('');
    setCompanySettingsLoading(true);

    const [userResult, companyResult] = await Promise.allSettled([fetchCurrentUser<CurrentUser>(), fetchCompanySettings()]);

    if (userResult.status === 'fulfilled') {
      const me = userResult.value || {};
      setUser(me);
      setDisplayName(String(me.name || ''));
    } else {
      setError(String(userResult.reason?.message || 'Could not load user profile'));
    }

    if (companyResult.status === 'fulfilled') {
      const nextValue = !!companyResult.value.forceDriverSignature;
      setForceDriverSignature(nextValue);
      setInitialForceDriverSignature(nextValue);
    } else {
      const message = String(companyResult.reason?.message || 'Could not load company settings');
      setError((prev) => prev || message);
    }

    setCompanySettingsLoading(false);
    setLoading(false);
  }

  useEffect(() => {
    void loadSettings();
  }, []);

  const userRole = useMemo(() => normalizeRole(user.role), [user.role]);

  async function saveProfile() {
    const name = displayName.trim();
    if (!name) {
      setError('Display name is required.');
      return;
    }
    if (!user.id) {
      setError('Could not determine current user id for profile update.');
      return;
    }

    setSavingProfile(true);
    setError('');
    setNotice('');
    try {
      await sendWithAuth(`/api/users/${user.id}`, 'PATCH', { name });
      setUser((prev) => ({ ...prev, name }));
      updateLocalUserName(name);
      setNotice('Profile updated.');
    } catch (err) {
      setError(String((err as Error).message || 'Failed to update profile'));
    } finally {
      setSavingProfile(false);
    }
  }

  async function savePassword() {
    if (!currentPassword || !newPassword || !confirmPassword) {
      setError('Please complete all password fields.');
      return;
    }
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }

    setSavingPassword(true);
    setError('');
    setNotice('');
    try {
      const response = await sendWithAuth<MutationResult>('/auth/change-password', 'POST', {
        currentPassword,
        newPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setNotice(response.message || 'Password updated.');
    } catch (err) {
      setError(String((err as Error).message || 'Failed to update password'));
    } finally {
      setSavingPassword(false);
    }
  }

  async function saveCompanySettings() {
    if (!canManageCompanySettings) {
      setError('Only admin and manager roles can update company settings.');
      return;
    }
    setSavingCompanySettings(true);
    setError('');
    setNotice('');
    try {
      const response = await sendWithAuth<CompanySettings>('/api/settings/company', 'PATCH', {
        forceDriverSignature,
      });
      const nextValue = !!response.forceDriverSignature;
      setForceDriverSignature(nextValue);
      setInitialForceDriverSignature(nextValue);
      setNotice('Company settings saved.');
    } catch (err) {
      setError(String((err as Error).message || 'Failed to save company settings'));
    } finally {
      setSavingCompanySettings(false);
    }
  }

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading settings...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}
      {notice ? <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Signed In As" value={String(user.name || '—')} />
        <SummaryCard label="Email" value={String(user.email || '—')} compact />
        <SummaryBadgeCard label="Role" role={userRole} />
        <SummaryCard label="Company" value={String(user.companyName || '—')} compact />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="space-y-1">
            <CardTitle>Profile</CardTitle>
            <CardDescription>Update your display identity used across operations workflows.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Display Name</span>
              <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Your name" />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <ReadonlyField label="Email" value={String(user.email || '—')} />
              <ReadonlyField label="Location" value={String(user.locationName || '—')} />
            </div>
            <Button onClick={saveProfile} disabled={savingProfile}>
              {savingProfile ? 'Saving Profile...' : 'Save Profile'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-1">
            <CardTitle>Security</CardTitle>
            <CardDescription>Rotate your password with immediate effect for this account.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Current Password</span>
              <Input
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                placeholder="Current password"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">New Password</span>
              <Input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder="At least 8 characters"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Confirm New Password</span>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Repeat new password"
              />
            </label>
            <Button onClick={savePassword} disabled={savingPassword}>
              {savingPassword ? 'Updating Password...' : 'Update Password'}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="space-y-1">
          <CardTitle>Company Controls</CardTitle>
          <CardDescription>Operational policy controls aligned with dispatch and delivery compliance.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/20 p-4">
            <div>
              <div className="text-sm font-semibold text-foreground">Force Driver Signature</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Require signature capture before proof-of-delivery completion.
              </div>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Off</span>
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-input"
                checked={forceDriverSignature}
                onChange={(event) => setForceDriverSignature(event.target.checked)}
                disabled={!canManageCompanySettings || companySettingsLoading || savingCompanySettings}
              />
              <span className="text-xs font-medium text-muted-foreground">On</span>
            </label>
          </div>
          {!canManageCompanySettings ? (
            <div className="text-xs text-muted-foreground">Only admin and manager roles can save company controls.</div>
          ) : null}
          <Button
            variant="outline"
            onClick={saveCompanySettings}
            disabled={!canManageCompanySettings || !companySettingsDirty || savingCompanySettings || companySettingsLoading}
          >
            {savingCompanySettings ? 'Saving Company Controls...' : 'Save Company Controls'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({ label, value, compact }: { label: string; value: string; compact?: boolean }) {
  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardDescription>{label}</CardDescription>
        <CardTitle className={compact ? 'text-base' : 'text-2xl'}>{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

function SummaryBadgeCard({ label, role }: { label: string; role: Role }) {
  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardDescription>{label}</CardDescription>
        <div>
          <Badge variant={roleVariant(role)}>{role === 'unknown' ? 'Unknown' : role.charAt(0).toUpperCase() + role.slice(1)}</Badge>
        </div>
      </CardHeader>
    </Card>
  );
}

function ReadonlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm text-foreground">{value}</div>
    </div>
  );
}
