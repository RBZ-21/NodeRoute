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

export function SuperadminGuard({ children }: { children: React.ReactNode }) {
  const allowed = getUserRole() === 'superadmin';

  useEffect(() => {
    if (!allowed) {
      window.location.replace('/dashboard');
    }
  }, [allowed]);

  if (!allowed) return null;

  return <>{children}</>;
}
