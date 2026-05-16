import { FormEvent, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useDriverApp } from '@/hooks/useDriverApp';
import { useToast } from '@/hooks/useToast';

export function LoginPage() {
  const { login, token, user } = useDriverApp();
  const { pushToast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  if (token && user) return <Navigate to="/" replace />;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);

    try {
      await login(email, password);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Unable to sign in.', 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,_#d3f3ef_0%,_#f4f7f8_45%,_#f4f7f8_100%)] px-4 py-8">
      <div className="mx-auto max-w-md rounded-[2rem] bg-white p-6 shadow-card">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Driver sign in</p>
        <h1 className="mt-3 text-3xl font-semibold text-ink">NodeRoute Driver</h1>
        <p className="mt-3 text-sm text-slate-600">
          Sign in with your driver account to sync routes, invoices, and delivery updates.
        </p>

        <form className="mt-8 space-y-4" onSubmit={onSubmit}>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Email</span>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              autoComplete="email"
              required
              className="min-h-12 w-full rounded-2xl border border-slate-200 px-4 text-base outline-none transition focus:border-ocean focus:ring-2 focus:ring-ocean/20"
              placeholder="driver@noderoute.com"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Password</span>
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              autoComplete="current-password"
              required
              className="min-h-12 w-full rounded-2xl border border-slate-200 px-4 text-base outline-none transition focus:border-ocean focus:ring-2 focus:ring-ocean/20"
              placeholder="Enter password"
            />
          </label>

          <button
            type="submit"
            disabled={loading}
            className="min-h-12 w-full rounded-2xl bg-ocean px-4 py-3 text-base font-semibold text-white disabled:opacity-60"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
