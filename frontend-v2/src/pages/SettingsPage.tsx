import { useEffect, useState } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { fetchCurrentUser, fetchWithAuth, sendWithAuth } from '../lib/api';

type CompanySettings = {
  forceDriverSignature: boolean;
};

type CurrentUser = {
  id: string;
  name?: string;
  email?: string;
  role?: string;
  companyName?: string;
  locationName?: string;
};

export function SettingsPage() {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [settings, setSettings] = useState<CompanySettings>({ forceDriverSignature: false });
  const [profileName, setProfileName] = useState('');
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [user, companySettings] = await Promise.all([
        fetchCurrentUser<CurrentUser>(),
        fetchWithAuth<CompanySettings>('/api/settings/company'),
      ]);
      setCurrentUser(user);
      setProfileName(user.name || '');
      setSettings(companySettings);
    } catch (err) {
      setError(String((err as Error).message || 'Could not load settings'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentUser) return;
    setSaving('profile');
    setError('');
    setNotice('');
    try {
      await sendWithAuth(`/api/users/${encodeURIComponent(currentUser.id)}`, 'PATCH', { name: profileName });
      setNotice('Profile name updated.');
      await load();
    } catch (err) {
      setError(String((err as Error).message || 'Could not update profile'));
    } finally {
      setSaving('');
    }
  }

  async function saveCompanySettings() {
    setSaving('company');
    setError('');
    setNotice('');
    try {
      const response = await sendWithAuth<CompanySettings>('/api/settings/company', 'PATCH', settings);
      setSettings(response);
      setNotice('Company settings updated.');
    } catch (err) {
      setError(String((err as Error).message || 'Could not update company settings'));
    } finally {
      setSaving('');
    }
  }

  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving('password');
    setError('');
    setNotice('');
    try {
      await sendWithAuth('/auth/change-password', 'POST', passwords);
      setPasswords({ currentPassword: '', newPassword: '' });
      setNotice('Password updated.');
    } catch (err) {
      setError(String((err as Error).message || 'Could not update password'));
    } finally {
      setSaving('');
    }
  }

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading settings...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}
      {notice ? <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>{currentUser?.email || 'Signed-in user'}{currentUser?.role ? ` · ${currentUser.role}` : ''}</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={saveProfile}>
              <label className="space-y-1 text-sm font-medium text-muted-foreground">
                Display Name
                <Input value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="Display name" />
              </label>
              <div className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
                <div>Company: <span className="font-medium text-foreground">{currentUser?.companyName || 'Default'}</span></div>
                <div>Location: <span className="font-medium text-foreground">{currentUser?.locationName || 'All locations'}</span></div>
              </div>
              <Button type="submit" disabled={saving === 'profile'}>Save Profile</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Security</CardTitle>
            <CardDescription>Update the password used by `/auth/change-password`.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={changePassword}>
              <Input required type="password" value={passwords.currentPassword} onChange={(event) => setPasswords((current) => ({ ...current, currentPassword: event.target.value }))} placeholder="Current password" />
              <Input required minLength={8} type="password" value={passwords.newPassword} onChange={(event) => setPasswords((current) => ({ ...current, newPassword: event.target.value }))} placeholder="New password" />
              <Button type="submit" disabled={saving === 'password'}>Change Password</Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Company Operations</CardTitle>
          <CardDescription>Controls stored in `/api/settings/company` for the active company context.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-start gap-3 rounded-lg border border-border bg-muted/20 p-4">
            <input
              type="checkbox"
              checked={settings.forceDriverSignature}
              onChange={(event) => setSettings((current) => ({ ...current, forceDriverSignature: event.target.checked }))}
              className="mt-1 h-4 w-4"
            />
            <span>
              <span className="block text-sm font-semibold text-foreground">Require driver signature</span>
              <span className="block text-sm text-muted-foreground">Drivers must capture a signature before completing deliveries.</span>
            </span>
          </label>
          <Button onClick={saveCompanySettings} disabled={saving === 'company'}>Save Company Settings</Button>
        </CardContent>
      </Card>
    </div>
  );
}
