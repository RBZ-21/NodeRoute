import { LogOut, Menu, Moon, Sun } from 'lucide-react';
import { useEffect, useState, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Button } from '../ui/button';
import { Sidebar } from './Sidebar';
import { PageSkeleton } from './PageSkeleton';
import { getUserRole } from '../../lib/api';
import { allNavItems, defaultPath, findNavItem, routePath } from '../../lib/nav';

const showSentryTestButton =
  import.meta.env.DEV || new URLSearchParams(window.location.search).has('sentry-test');

export function AppShell() {
  const role        = getUserRole();
  const location    = useLocation();
  const currentItem = findNavItem(location.pathname) ?? findNavItem(defaultPath);

  const [dark, setDark] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('nr_theme');
      if (stored) return stored === 'dark';
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch { return false; }
  });

  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try { localStorage.setItem('nr_theme', dark ? 'dark' : 'light'); } catch {}
  }, [dark]);

  const availableItems = allNavItems.filter(
    (item) => !item.adminOnly || role === 'admin'
  );

  function handleLogout() {
    localStorage.removeItem('nr_token');
    localStorage.removeItem('nr_user');
    window.location.href = '/login';
  }

  return (
    // Use 100dvh — accounts for iOS browser chrome, avoids bottom clip
    <div className="flex min-h-[100dvh] flex-col bg-enterprise-gradient">
      <div className="mx-auto flex w-full max-w-[1420px] flex-1 flex-col">

        {/* ── Top header ── */}
        <header className="flex items-center justify-between border-b border-border bg-card px-4 py-3 shadow-sm">
          <div className="flex items-center gap-3">
            {/* Hamburger — mobile only */}
            <button
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted/60 md:hidden"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>

            <span className="text-sm font-bold uppercase tracking-widest text-primary">NodeRoute</span>
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
            >
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>

            {/* Role badge — hidden on small screens */}
            <span className="text-xs text-muted-foreground hidden sm:inline">{role.toUpperCase()}</span>

            {/* Logout — icon only on mobile, icon + text on sm+ */}
            <Button size="sm" variant="outline" onClick={handleLogout} aria-label="Logout">
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
            onMobileClose={() => setMobileNavOpen(false)}
          />

          <main className="flex-1 overflow-y-auto p-4 md:p-6">
            <Routes>
              <Route index element={<Navigate to={defaultPath} replace />} />
              {allNavItems.map((item) => {
                if (item.adminOnly && role !== 'admin') {
                  return (
                    <Route
                      key={item.id}
                      path={routePath(item.path)}
                      element={<Navigate to={defaultPath} replace />}
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
              <Route path="*" element={<Navigate to={defaultPath} replace />} />
            </Routes>
          </main>
        </div>

      </div>
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
