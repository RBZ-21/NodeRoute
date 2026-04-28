import { KeyRound, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';

type SetupResponse = {
  token: string;
  user: Record<string, unknown>;
};

function getInviteToken(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get('token') || '';
}

export function SetupPasswordPage() {
  const inviteToken = useMemo(() => getInviteToken(), []);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  if (!inviteToken) {
    return (
      <div className="min-h-screen bg-enterprise-gradient">
        <div className="mx-auto flex min-h-screen max-w-md items-center justify-center p-4">
          <Card className="w-full border-border/80 bg-card/95 shadow-panel">
            <CardHeader>
              <CardTitle>Invalid invitation link</CardTitle>
              <CardDescription>
                This setup link is missing a token. Please use the link from your invitation email.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </div>
    );
  }

  async function submitSetup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/auth/setup-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: inviteToken, password }),
      });
      const payload = (await res.json()) as Partial<SetupResponse> & { error?: string };
      if (!res.ok || !payload.token) {
        throw new Error(payload.error || 'Setup failed. The link may have expired.');
      }

      localStorage.setItem('nr_token', payload.token);
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
              {success ? 'Account Ready' : 'Set Your Password'}
            </div>
            <CardTitle>{success ? 'Welcome to NodeRoute' : 'Create your password'}</CardTitle>
            <CardDescription>
              {success
                ? 'Your account is set up. Redirecting to the dashboard…'
                : 'Choose a secure password to activate your NodeRoute account.'}
            </CardDescription>
          </CardHeader>
          {!success && (
            <CardContent className="space-y-4">
              {error && (
                <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}
              <form className="space-y-4" onSubmit={submitSetup}>
                <label className="space-y-1 text-sm">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">New Password</span>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
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
                  {submitting ? 'Setting up…' : 'Activate Account'}
                </Button>
              </form>
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}
