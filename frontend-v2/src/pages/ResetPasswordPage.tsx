import { KeyRound, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';

const MIN_PASSWORD_LENGTH = 12;

type ResetResponse = {
  user: Record<string, unknown>;
};

function getResetToken(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get('token') || '';
}

export function ResetPasswordPage() {
  const token = useMemo(() => getResetToken(), []);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  if (!token) {
    return (
      <div className="min-h-screen bg-enterprise-gradient">
        <div className="mx-auto flex min-h-screen max-w-md items-center justify-center p-4">
          <Card className="w-full border-border/80 bg-card/95 shadow-panel">
            <CardHeader>
              <CardTitle>Invalid reset link</CardTitle>
              <CardDescription>
                This password reset link is missing a token. Request a new link from the{' '}
                <a href="/forgot-password" className="font-medium text-primary hover:underline">forgot password</a> page.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </div>
    );
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/auth/reset-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const payload = (await res.json()) as Partial<ResetResponse> & { error?: string };
      if (!res.ok) {
        throw new Error(payload.error || 'Reset failed. The link may have expired.');
      }

      // Backend signs the user in on success — store the profile for role-based UI.
      localStorage.setItem('nr_user', JSON.stringify(payload.user || {}));
      setSuccess(true);
      setTimeout(() => { window.location.href = '/dashboard'; }, 1200);
    } catch (e) {
      setError(String((e as Error).message || 'An error occurred. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-enterprise-gradient">
      <div className="mx-auto flex min-h-screen max-w-md items-center justify-center p-4">
        <Card className="w-full border-border/80 bg-card/95 shadow-panel">
          <CardHeader className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-primary">
              {success ? <KeyRound className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
              {success ? 'Password Updated' : 'Choose a New Password'}
            </div>
            <CardTitle>{success ? 'You’re all set' : 'Reset your password'}</CardTitle>
            <CardDescription>
              {success
                ? 'Your password has been updated. Redirecting to the dashboard…'
                : 'Choose a new secure password for your NodeRoute account.'}
            </CardDescription>
          </CardHeader>
          {!success && (
            <CardContent className="space-y-4">
              {error && (
                <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}
              <form className="space-y-4" onSubmit={submit}>
                <label className="space-y-1 text-sm">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">New Password</span>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                    autoComplete="new-password"
                    required
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Confirm Password</span>
                  <Input
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Repeat your password"
                    autoComplete="new-password"
                    required
                  />
                </label>
                <Button className="w-full" type="submit" disabled={submitting}>
                  {submitting ? 'Updating…' : 'Update Password'}
                </Button>
              </form>
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}
