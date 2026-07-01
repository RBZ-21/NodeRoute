/**
 * ImpersonationBanner — shown whenever the superadmin is viewing the app
 * through an impersonated company session.
 *
 * Detection: the server sets an `sa_session` HttpOnly cookie alongside the
 * impersonation cookie. We can't read HttpOnly cookies from JS, so we detect
 * the impersonated state by checking localStorage `nr_user` for an
 * `impersonated_by` field (set by the frontend during the impersonate flow).
 *
 * "Return to SuperAdmin" button calls POST /api/superadmin/restore-session,
 * which swaps the `token` cookie back to the saved `sa_session` and clears it.
 * The page then reloads to /superadmin.
 */
import { useState } from 'react';
import { sendWithAuth } from '../lib/api';

function getImpersonatedCompany(): string | null {
  try {
    const raw = localStorage.getItem('nr_impersonating');
    return raw ?? null;
  } catch { return null; }
}

export function ImpersonationBanner() {
  const company = getImpersonatedCompany();
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState('');

  if (!company) return null;

  async function restore() {
    setRestoring(true);
    try {
      setError('');
      await sendWithAuth('/api/superadmin/restore-session', 'POST');
      localStorage.removeItem('nr_impersonating');
      localStorage.removeItem('nr_user');
      window.location.replace('/companies');
    } catch (err) {
      setError(`Could not restore superadmin session: ${(err as Error).message}`);
      setRestoring(false);
    }
  }

  return (
    <>
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}
      <div className="flex items-center justify-between gap-3 bg-violet-600 px-4 py-2 text-sm text-white">
        <span>
          <strong>Inspecting:</strong> {company} — you are viewing this tenant as their admin.
        </span>
        <button
          type="button"
          disabled={restoring}
          onClick={restore}
          className="rounded border border-white/40 bg-white/10 px-3 py-1 text-xs font-semibold hover:bg-white/20 disabled:opacity-60 transition-colors"
        >
          {restoring ? 'Restoring…' : '← Return to SuperAdmin'}
        </button>
      </div>
    </>
  );
}
