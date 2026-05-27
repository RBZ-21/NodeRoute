/**
 * SuperadminGuard
 *
 * Wraps any superadmin-only page. Renders children only when the logged-in
 * user has role === 'superadmin' AND their email matches the owner email
 * baked in via the VITE_SUPERADMIN_EMAIL env variable.
 *
 * If either check fails the component redirects to /dashboard immediately.
 * No superadmin UI is rendered, no error message is shown — just a redirect.
 *
 * Usage:
 *   <SuperadminGuard><SuperadminPage /></SuperadminGuard>
 */
import { useEffect } from 'react';
import { getUserRole } from '../lib/api';

// Set VITE_SUPERADMIN_EMAIL in frontend-v2/.env (never commit the value).
// Example:  VITE_SUPERADMIN_EMAIL=admin@noderoutesystems.com
const OWNER_EMAIL = (import.meta.env.VITE_SUPERADMIN_EMAIL as string || '').trim().toLowerCase();

function getStoredEmail(): string {
  try {
    const raw = localStorage.getItem('nr_user');
    if (!raw) return '';
    const parsed = JSON.parse(raw);
    return (parsed?.email || parsed?.userEmail || '').trim().toLowerCase();
  } catch {
    return '';
  }
}

export function SuperadminGuard({ children }: { children: React.ReactNode }) {
  const role  = getUserRole();
  const email = getStoredEmail();

  const roleOk  = role === 'superadmin';
  // If env var is not set, OWNER_EMAIL will be '' and no one can pass.
  const emailOk = OWNER_EMAIL !== '' && email === OWNER_EMAIL;
  const allowed = roleOk && emailOk;

  useEffect(() => {
    if (!allowed) {
      window.location.replace('/dashboard');
    }
  }, [allowed]);

  if (!allowed) return null;

  return <>{children}</>;
}
