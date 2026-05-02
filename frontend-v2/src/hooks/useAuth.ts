import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { clearSession, fetchCurrentUser, redirectToLogin, requireAuthToken } from '../lib/api';

const PUBLIC_PATHS = ['/login', '/portal', '/customer-portal', '/setup-password'];

function isPublicPath(pathname: string) {
  return (
    PUBLIC_PATHS.includes(pathname) ||
    pathname === '/track' ||
    pathname.startsWith('/track/')
  );
}

export type AuthState = 'checking' | 'ready' | 'redirecting';

/**
 * Validates the current session once on mount.
 * Optimistic: shell renders immediately if a token exists;
 * only hard-blocks if the token is completely missing or /auth/me returns 401.
 */
export function useAuth(): AuthState {
  const { pathname } = useLocation();
  const [state, setState] = useState<AuthState>(() =>
    isPublicPath(pathname) ? 'ready' : 'checking'
  );

  useEffect(() => {
    if (isPublicPath(pathname)) {
      setState('ready');
      return;
    }

    if (!requireAuthToken()) {
      setState('redirecting');
      redirectToLogin('Please sign in to continue.');
      return;
    }

    let cancelled = false;

    fetchCurrentUser()
      .then(() => { if (!cancelled) setState('ready'); })
      .catch(() => {
        if (!cancelled) {
          setState('redirecting');
          clearSession();
          redirectToLogin('Your session could not be verified. Please sign in again.');
        }
      });

    return () => { cancelled = true; };
  }, [pathname]);

  return state;
}
