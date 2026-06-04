import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  ensureSessionExpiryMarker,
  fetchCurrentUser,
  redirectToLogin,
  requireAuthToken,
} from '../lib/api';

const PUBLIC_PATHS = ['/login', '/signup', '/portal', '/customer-portal', '/setup-password'];

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
      .then(() => {
        if (cancelled) return;
        ensureSessionExpiryMarker();
        setState('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // parseResponse already clears the session and redirects on 401.
        // For other transient errors (429 rate-limit, 500, network) we should
        // NOT end the session — just mark ready so the shell stays rendered.
        const msg = err instanceof Error ? err.message : '';
        if (msg === 'Unauthorized') {
          setState('redirecting');
        } else {
          setState('ready');
        }
      });

    return () => { cancelled = true; };
  // Empty deps: validate session once on mount, not on every navigation click.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}
