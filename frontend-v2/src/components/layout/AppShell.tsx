import { LogOut, Menu, Moon, Sun } from 'lucide-react';
import { useCallback, useEffect, useState, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Button } from '../ui/button';
import { Sidebar } from './Sidebar';
import { PageSkeleton } from './PageSkeleton';
import { ImpersonationBanner } from '../ImpersonationBanner';
import { SessionExpiryBanner } from '../SessionExpiryBanner';
import { AIAskBar } from './AIAskBar';
import { CommandPalette } from './CommandPalette';
import { getUserRole, logoutSession } from '../../lib/api';
import { allNavItems, defaultPathFor, findNavItem, navRedirects, routePath, canAccess, type NavRedirect } from '../../lib/nav';

/** Redirects a legacy path (e.g. /stops) to its new home (e.g. /routes?tab=stops),
 *  preserving any existing query params such as routeId. */
function LegacyRedirect({ redirect }: { redirect: NavRedirect }) {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  if (redirect.tab) params.set('tab', redirect.tab);
  const query = params.toString();
  return <Navigate to={`${redirect.to}${query ? `?${query}` : ''}`} replace />;
}

const showSentryTestButton =
  import.meta.env.DEV || new URLSearchParams(window.location.search).has('sentry-test');
const brandLogoSrc = `${import.meta.env.BASE_URL}NodeRoute_Logo.svg`;

/** Role badge colours */
const roleBadgeClass: Record<string, string> = {
  superadmin: 'text-violet-500 font-bold',
  admin:      'text-primary',
  manager:    'text-emerald-600 dark:text-emerald-400',
  driver:     'text-amber-600 dark:text-amber-400',
};

export function AppShell() {
  const role        = getUserRole();
  const location    = useLocation();
  const homePath    = defaultPathFor(role);
  const currentItem = findNavItem(location.pathname) ?? findNavItem(homePath);

  const [dark, setDark] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('nr_theme');
      if (stored) return stored === 'dark';
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch { return false; }
  });

  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Stable identity so Sidebar's route-change effect can depend on it without re-firing every render.
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try { localStorage.setItem('nr_theme', dark ? 'dark' : 'light'); } catch {}
  }, [dark]);

  async function handleLogout() {
    await logoutSession();
    window.location.href = '/login';
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-enterprise-gradient">
      {/* Impersonation banner — visible only when superadmin has switched into a tenant */}
      <ImpersonationBanner />
      <SessionExpiryBanner />

      <div className="mx-auto flex w-full max-w-[1420px] flex-1 flex-col">

        {/* ── Top header ── */}
        <header className="flex items-center justify-between border-b border-border bg-card px-4 py-3 shadow-sm">
          <div className="flex items-center gap-3">
            <button
              className="flex min-h-11 min-w-11 items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-muted/60 md:hidden"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <img
              src={brandLogoSrc}
              alt="NodeRoute"
              className="nr-brand-logo h-7 w-auto max-w-[11.5rem] object-contain"
            />
            <span className="hidden text-muted-foreground sm:inline">|</span>
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {currentItem?.label ?? 'Dashboard'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {showSentryTestButton && <SentryTestButton />}

            <Button
              variant="ghost" size="sm"
              onClick={() => setDark((d) => !d)}
              aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
              className="min-h-11 min-w-11 md:min-h-0 md:min-w-0"
            >
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>

            {/* Role badge with colour coding */}
            <span className={`text-xs hidden sm:inline ${roleBadgeClass[role] ?? 'text-muted-foreground'}`}>
              {role.toUpperCase()}
            </span>

            <Button size="sm" variant="outline" onClick={handleLogout} aria-label="Logout" className="min-h-11 md:min-h-0">
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline ml-2">Logout</span>
            </Button>
          </div>
        </header>

        {/* ── Body: sidebar + content ── */}
        <div className="flex flex-1 overflow-hidden">
          <Sidebar
            role={role}
            mobileOpen={mobileNavOpen}
            onMobileClose={closeMobileNav}
          />

          <main className="flex-1 overflow-y-auto p-4 md:p-6">
            <Routes>
              <Route index element={<Navigate to={homePath} replace />} />
              {navRedirects.map((redirect) => (
                <Route
                  key={redirect.id}
                  path={routePath(redirect.from)}
                  element={<LegacyRedirect redirect={redirect} />}
                />
              ))}
              {allNavItems.map((item) => {
                // Route-level guard: redirect unauthorised users
                if (!canAccess(item, role)) {
                  return (
                    <Route
                      key={item.id}
                      path={routePath(item.path)}
                      element={<Navigate to={homePath} replace />}
                    />
                  );
                }
                const Page = item.component;
                return (
                  <Route
                    key={item.id}
                    path={routePath(item.path)}
                    element={
                      <Suspense fallback={<PageSkeleton />}>
                        <Page />
                      </Suspense>
                    }
                  />
                );
              })}
              <Route path="*" element={<Navigate to={homePath} replace />} />
            </Routes>
          </main>
        </div>

      </div>

      {role !== 'driver' && <AIAskBar />}
      <CommandPalette />
    </div>
  );
}

function SentryTestButton() {
  return (
    <Button
      variant="outline" size="sm"
      onClick={async () => {
        const { captureException, flush } = await import('@sentry/react');
        const error = new Error('This is your first error!');
        const eventId = captureException(error);
        void flush(2000).then((sent: boolean) => {
          console.info('[Sentry test] event', eventId, sent ? 'flushed' : 'not flushed');
        });
        window.setTimeout(() => { throw error; }, 0);
      }}
    >
      Break the world
    </Button>
  );
}
