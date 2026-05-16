import { LayoutDashboard, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import * as Sentry from '@sentry/react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { clearSession, readAndClearAuthError } from '../lib/api';

type LoginResponse = {
  token: string;
  user: {
    role?: string;
  };
};

function nextDestination(search: string) {
  const params = new URLSearchParams(search);
  const next = params.get('next') || '';
  if (!next || !next.startsWith('/')) return '';
  if (next.startsWith('//')) return '';
  return next;
}

function landingFor(role: string | undefined, next: string) {
  if (next) return next;
  return String(role || '').toLowerCase() === 'driver' ? '/driver' : '/dashboard';
}

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const next = useMemo(() => nextDestination(window.location.search), []);
  const showSentryTestButton = useMemo(
    () => import.meta.env.DEV || new URLSearchParams(window.location.search).has('sentry-test'),
    []
  );

  useEffect(() => {
    const authError = readAndClearAuthError();
    if (authError) setError(authError);

    // Session check: use nr_user as the lightweight indicator (token is HttpOnly cookie)
    const rawUser = localStorage.getItem('nr_user');
    if (!rawUser) return;

    try {
      const parsed = JSON.parse(rawUser) as { role?: string };
      window.location.href = landingFor(parsed.role, next);
    } catch {
      clearSession();
    }
  }, [next]);

  async function submitLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      const response = await fetch('/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const payload = (await response.json()) as Partial<LoginResponse> & { error?: string };
      if (!response.ok || !payload.user) {
        throw new Error(payload.error || 'Login failed');
      }

      // Verify session via cookie (no Authorization header needed)
      const me = await fetch('/auth/me', { credentials: 'include' });
      const mePayload = await me.json();
      if (!me.ok) {
        throw new Error(mePayload?.error || 'Session verification failed');
      }

      // Store user profile for role-based UI — NOT the token
      localStorage.setItem('nr_user', JSON.stringify(mePayload));
      window.location.href = landingFor(mePayload?.role, next);
    } catch (loginError) {
      clearSession();
      setError(String((loginError as Error).message || 'Login failed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-enterprise-gradient">
      <div className="mx-auto flex min-h-screen max-w-[1420px] items-center justify-center p-4 md:p-6">
        <div className="grid w-full max-w-5xl gap-6 lg:grid-cols-[1.1fr_420px]">
          <Card className="hidden border-border/80 bg-card/95 shadow-panel lg:block">
            <CardHeader className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-primary">
                <LayoutDashboard className="h-4 w-4" />
                NodeRoute Enterprise UI
              </div>
              <CardTitle className="max-w-xl text-4xl leading-tight">
                Dispatch, finance, customers, and drivers in one operations workspace.
              </CardTitle>
              <CardDescription className="max-w-lg text-base">
                Sign in to manage routes, invoices, purchasing, reporting, and the new V2 admin shell from the same session.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border bg-muted/20 p-4">
                <div className="text-sm font-semibold text-foreground">Unified Access</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Login now routes cleanly into the active V2 workspace instead of bouncing across legacy screens.
                </div>
              </div>
              <div className="rounded-lg border border-border bg-muted/20 p-4">
                <div className="text-sm font-semibold text-foreground">Role-Aware Routing</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Drivers go to their driver flow, while office and admin users land in the dashboard.
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/80 bg-card/95 shadow-panel">
            <CardHeader className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-primary">
                <ShieldCheck className="h-4 w-4" />
                Secure Sign In
              </div>
              <CardTitle>Welcome back</CardTitle>
              <CardDescription>
                Enter your NodeRoute credentials to continue.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error ? (
                <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">
                  {error}
                </div>
              ) : null}

              <form className="space-y-4" onSubmit={submitLogin}>
                <label className="space-y-1 text-sm">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Email</span>
                  <Input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@noderoute.com"
                    autoComplete="email"
                    required
                  />
                </label>

                <label className="space-y-1 text-sm">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Password</span>
                  <Input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    required
                  />
                </label>

                <Button className="w-full" type="submit" disabled={submitting}>
                  {submitting ? 'Signing In...' : 'Sign In'}
                </Button>
                {showSentryTestButton ? <SentryTestButton /> : null}
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function SentryTestButton() {
  return (
    <Button
      className="w-full"
      variant="outline"
      type="button"
      onClick={() => {
        const error = new Error('This is your first error!');
        const eventId = Sentry.captureException(error);
        void Sentry.flush(2000).then((sent) => {
          console.info('[Sentry login test] event', eventId, sent ? 'flushed' : 'not flushed');
        });
        window.setTimeout(() => {
          throw error;
        }, 0);
      }}
    >
      Break the world
    </Button>
  );
}
