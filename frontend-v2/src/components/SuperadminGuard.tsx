/**
 * SuperadminGuard — client-side gate for the superadmin section.
 *
 * Passes only when BOTH:
 *   1. The stored user role equals 'superadmin'
 *   2. The stored user email matches VITE_SUPERADMIN_EMAIL (case-insensitive, trimmed)
 *
 * Fail-closed: if VITE_SUPERADMIN_EMAIL is empty or unset, NO user passes.
 *
 * On failure: window.location.replace('/dashboard') — not push — so Back
 * cannot return to the superadmin URL. The component renders null immediately
 * so there is zero flash of protected content.
 *
 * NOTE: this is a UX gate only. Real enforcement is on the backend via
 * requireSuperadmin (role + email double-check on every /api/superadmin/* route).
 */
import { useEffect, useRef, type ReactNode } from 'react';

const SUPERADMIN_EMAIL = (import.meta.env.VITE_SUPERADMIN_EMAIL ?? '').trim().toLowerCase();

function getStoredUser(): { role?: string; email?: string } | null {
  try {
    const raw = localStorage.getItem('nr_user');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function checkAccess(): boolean {
  // Fail-closed: if env var is empty, nobody passes.
  if (!SUPERADMIN_EMAIL) return false;

  const user = getStoredUser();
  if (!user) return false;

  const roleOk  = String(user.role  ?? '').toLowerCase() === 'superadmin';
  const emailOk = String(user.email ?? '').trim().toLowerCase() === SUPERADMIN_EMAIL;

  return roleOk && emailOk;
}

interface SuperadminGuardProps {
  children: ReactNode;
}

export function SuperadminGuard({ children }: SuperadminGuardProps) {
  const passed = checkAccess();
  const redirected = useRef(false);

  useEffect(() => {
    if (!passed && !redirected.current) {
      redirected.current = true;
      window.location.replace('/dashboard');
    }
  }, [passed]);

  // Render nothing while the redirect is in flight (or if access was denied).
  if (!passed) return null;

  return <>{children}</>;
}
