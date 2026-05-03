/**
 * App.tsx — thin entry point (~50 lines).
 *
 * Responsibilities:
 *   1. Detect route type (public vs. app shell vs. driver)
 *   2. Run session check via useAuth
 *   3. Render the correct top-level component
 *
 * All nav config  → src/lib/nav.ts
 * Auth logic      → src/hooks/useAuth.ts
 * Layout & shell  → src/components/layout/AppShell.tsx
 * Sidebar         → src/components/layout/Sidebar.tsx
 * Skeleton loader → src/components/layout/PageSkeleton.tsx
 */
import { lazy, Suspense } from 'react';
import { useLocation } from 'react-router-dom';
import { getUserRole } from './lib/api';
import { useAuth } from './hooks/useAuth';
import { AppShell } from './components/layout/AppShell';
import { PageSkeleton } from './components/layout/PageSkeleton';

const LoginPage          = lazy(() => import('./pages/LoginPage').then(m => ({ default: m.LoginPage })));
const CustomerPortalPage = lazy(() => import('./pages/CustomerPortalPage').then(m => ({ default: m.CustomerPortalPage })));
const TrackPage          = lazy(() => import('./pages/TrackPage').then(m => ({ default: m.TrackPage })));
const SetupPasswordPage  = lazy(() => import('./pages/SetupPasswordPage').then(m => ({ default: m.SetupPasswordPage })));
const DriverPage         = lazy(() => import('./pages/DriverPage').then(m => ({ default: m.DriverPage })));

export function App() {
  const { pathname } = useLocation();
  const authState    = useAuth();

  // ── Public / standalone routes ────────────────────────────────────────────
  const isTrackRoute         = pathname === '/track' || pathname.startsWith('/track/');
  const isSetupPasswordRoute = pathname === '/setup-password';

  if (pathname === '/login')
    return <Suspense fallback={<PageSkeleton />}><LoginPage /></Suspense>;
  if (pathname === '/portal' || pathname === '/customer-portal')
    return <Suspense fallback={<PageSkeleton />}><CustomerPortalPage /></Suspense>;
  if (isTrackRoute)
    return <Suspense fallback={<PageSkeleton />}><TrackPage /></Suspense>;
  if (isSetupPasswordRoute)
    return <Suspense fallback={<PageSkeleton />}><SetupPasswordPage /></Suspense>;

  // ── Session in flight ─────────────────────────────────────────────────────
  if (authState === 'checking')
    return (
      <div className="min-h-screen bg-enterprise-gradient flex items-center justify-center p-6">
        <div className="w-full max-w-lg"><PageSkeleton /></div>
      </div>
    );

  if (authState === 'redirecting') return null;

  // ── Driver workspace ──────────────────────────────────────────────────────
  if (pathname === '/driver') {
    if (getUserRole() !== 'driver') { window.location.href = '/dashboard'; return null; }
    return <Suspense fallback={<PageSkeleton />}><DriverPage /></Suspense>;
  }

  // ── Main app shell ────────────────────────────────────────────────────────
  return <AppShell />;
}
