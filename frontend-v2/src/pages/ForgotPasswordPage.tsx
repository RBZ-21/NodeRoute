import { MailCheck, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch('/auth/forgot-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(payload.error || 'Something went wrong. Please try again.');
      }
      // Response is intentionally generic — we always show the same confirmation.
      setSent(true);
    } catch (e) {
      setError(String((e as Error).message || 'Something went wrong. Please try again.'));
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
              {sent ? <MailCheck className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
              {sent ? 'Check Your Email' : 'Reset Password'}
            </div>
            <CardTitle>{sent ? 'Reset link on its way' : 'Forgot your password?'}</CardTitle>
            <CardDescription>
              {sent
                ? 'If an account exists for that email, we just sent a link to reset your password. The link expires in 1 hour.'
                : 'Enter the email associated with your account and we’ll send you a link to reset your password.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {sent ? (
              <a href="/login" className="inline-flex w-full">
                <Button className="w-full" variant="outline">Back to sign in</Button>
              </a>
            ) : (
              <>
                {error && (
                  <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">
                    {error}
                  </div>
                )}
                <form className="space-y-4" onSubmit={submit}>
                  <label className="space-y-1 text-sm">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Email</span>
                    <Input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@noderoute.com"
                      autoComplete="email"
                      required
                    />
                  </label>
                  <Button className="w-full" type="submit" disabled={submitting}>
                    {submitting ? 'Sending…' : 'Send reset link'}
                  </Button>
                </form>
                <div className="text-center text-sm text-muted-foreground">
                  Remembered it?{' '}
                  <a href="/login" className="font-medium text-primary hover:underline">
                    Back to sign in
                  </a>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
