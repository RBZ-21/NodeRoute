import { ChevronDown, LayoutDashboard, LogOut, Moon, Sun } from 'lucide-react';
import type { ReactElement } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './components/ui/dropdown-menu';
import { clearSession, fetchCurrentUser, getUserRole, redirectToLogin, requireAuthToken } from './lib/api';
import { cn } from './lib/utils';
import { AIHelpPage } from './pages/AIHelpPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { DriverPage } from './pages/DriverPage';
import { CustomersPage } from './pages/CustomersPage';
import { DashboardPage } from './pages/DashboardPage';
import { DeliveriesPage } from './pages/DeliveriesPage';
import { DriversPage } from './pages/DriversPage';
import { ForecastingPage } from './pages/ForecastingPage';
import { FinancialsPage } from './pages/FinancialsPage';
import { IntegrationsPage } from './pages/IntegrationsPage';
import { InventoryPage } from './pages/InventoryPage';
import { InvoicesPage } from './pages/InvoicesPage';
import { OrdersPage } from './pages/OrdersPage';
import { PlanningPage } from './pages/PlanningPage';
import { PurchasingPage } from './pages/PurchasingPage';
import { RoutesPage } from './pages/RoutesPage';
import { SettingsPage } from './pages/SettingsPage';
import { StopsPage } from './pages/StopsPage';
import { CustomerPortalPage } from './pages/CustomerPortalPage';
import { UsersPage } from './pages/UsersPage';
import { VendorsPage } from './pages/VendorsPage';
import { MapPage } from './pages/MapPage';
import { WarehousePage } from './pages/WarehousePage';
import { LoginPage } from './pages/LoginPage';
import { TraceabilityPage } from './pages/TraceabilityPage';
import { TrackPage } from './pages/TrackPage';
import { SetupPasswordPage } from './pages/SetupPasswordPage';

type TabId =
  | 'dashboard'
  | 'orders'
  | 'deliveries'
  | 'map'
  | 'drivers'
  | 'routes'
  | 'stops'
  | 'customers'
  | 'users'
  | 'invoices'
  | 'analytics'
  | 'inventory'
  | 'forecast'
  | 'financials'
  | 'purchasing'
  | 'vendors'
  | 'warehouse'
  | 'planning'
  | 'integrations'
  | 'aihelp'
  | 'settings'
  | 'traceability';

type GroupId = 'core' | 'logistics' | 'people' | 'financials' | 'operations' | 'ai';
type Role = 'admin' | 'manager' | 'driver' | 'unknown';

type NavItem = {
  id: TabId;
  label: string;
  path: string;
  adminOnly?: boolean;
};

type NavGroup = {
  id: GroupId;
  label: string;
  items: NavItem[];
  adminOnly?: boolean;
};

const navGroups: NavGroup[] = [
  {
    id: 'core',
    label: 'Core',
    items: [
      { id: 'dashboard', label: 'Dashboard', path: '/dashboard' },
      { id: 'orders', label: 'Orders', path: '/orders' },
      { id: 'settings', label: 'Settings', path: '/settings' },
    ],
  },
  {
    id: 'logistics',
    label: 'Logistics',
    items: [
      { id: 'deliveries', label: 'Deliveries', path: '/deliveries' },
      { id: 'map', label: 'Live Map', path: '/map' },
      { id: 'drivers', label: 'Drivers', path: '/drivers' },
      { id: 'routes', label: 'Routes', path: '/routes' },
      { id: 'stops', label: 'Stops', path: '/stops' },
    ],
  },
  {
    id: 'people',
    label: 'People',
    items: [
      { id: 'customers', label: 'Customers', path: '/customers' },
      { id: 'users', label: 'Users', path: '/users', adminOnly: true },
    ],
  },
  {
    id: 'financials',
    label: 'Financials',
    items: [
      { id: 'financials', label: 'Financial Overview', path: '/financials' },
      { id: 'invoices', label: 'Invoices', path: '/invoices' },
      { id: 'analytics', label: 'Analytics', path: '/analytics' },
      { id: 'inventory', label: 'Inventory', path: '/inventory' },
      { id: 'forecast', label: 'Forecasting', path: '/forecast' },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    adminOnly: true,
    items: [
      { id: 'purchasing', label: 'Purchasing', path: '/purchasing', adminOnly: true },
      { id: 'traceability', label: 'FSMA Traceability', path: '/admin/traceability', adminOnly: true },
      { id: 'vendors', label: 'Vendors', path: '/vendors', adminOnly: true },
      { id: 'warehouse', label: 'Warehouse', path: '/warehouse', adminOnly: true },
      { id: 'planning', label: 'Planning & Rules', path: '/planning', adminOnly: true },
      { id: 'integrations', label: 'Integrations', path: '/integrations', adminOnly: true },
    ],
  },
  {
    id: 'ai',
    label: 'AI Help',
    items: [{ id: 'aihelp', label: 'Walkthroughs', path: '/aihelp' }],
  },
];

const defaultPath = '/dashboard';
const allNavItems = navGroups.flatMap((group) => group.items);

export function App() {
  const location = useLocation();
  const [sessionState, setSessionState] = useState<'checking' | 'ready'>('checking');

  const isLoginRoute = location.pathname === '/login';
  const isPortalRoute = location.pathname === '/portal' || location.pathname === '/customer-portal';
  const isDriverRoute = location.pathname === '/driver';
  const isTrackRoute = location.pathname === '/track' || location.pathname.startsWith('/track/');
  const isSetupPasswordRoute = location.pathname === '/setup-password';

  useEffect(() => {
    let cancelled = false;

    async function validateSession() {
      if (isLoginRoute || isPortalRoute || isTrackRoute || isSetupPasswordRoute) {
        if (!cancelled) setSessionState('ready');
        return;
      }

      if (!requireAuthToken()) {
        redirectToLogin('Please sign in to continue.');
        return;
      }

      try {
        await fetchCurrentUser();
        if (!cancelled) setSessionState('ready');
      } catch {
        clearSession();
        redirectToLogin('Your session could not be verified. Please sign in again.');
      }
    }

    void validateSession();

    return () => {
      cancelled = true;
    };
  }, [isLoginRoute, isPortalRoute, isTrackRoute, isSetupPasswordRoute]);

  if (isLoginRoute) {
    return <LoginPage />;
  }

  if (isPortalRoute) {
    return <CustomerPortalPage />;
  }

  if (isTrackRoute) {
    return <TrackPage />;
  }

  if (isSetupPasswordRoute) {
    return <SetupPasswordPage />;
  }

  if (sessionState === 'checking') {
    return (
      <div className="min-h-screen bg-enterprise-gradient">
        <div className="mx-auto flex min-h-screen max-w-[1420px] items-center justify-center p-4 md:p-6">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Verifying session</CardTitle>
              <CardDescription>Checking your NodeRoute access before loading the workspace.</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">Please wait a moment.</CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (isDriverRoute) {
    if (getUserRole() !== 'driver') {
      window.location.href = '/dashboard-v2';
      return null;
    }
    return <DriverPage />;
  }

  return <AppShell />;
}

function AppShell() {
  const role = getUserRole();
  const location = useLocation();
  const navigate = useNavigate();

  // Dark mode — persisted to localStorage, applied as class on <html>
  const [dark, setDark] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('nr_theme');
      if (stored) return stored === 'dark';
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch { return false; }
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try { localStorage.setItem('nr_theme', dark ? 'dark' : 'light'); } catch {}
  }, [dark]);

  const availableGroups = useMemo(
    () =>
      navGroups
        .filter((group) => !group.adminOnly || role === 'admin')
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => !item.adminOnly || role === 'admin'),
        })),
    [role]
  );

  const currentItem = useMemo(() => findNavItem(location.pathname) || findNavItem(defaultPath), [location.pathname]);

  return (
    <div className="min-h-screen bg-enterprise-gradient">
      <div className="mx-auto max-w-[1420px] p-4 md:p-6">
        <header className="rounded-xl border border-border bg-card shadow-panel">
          <div className="flex flex-col gap-4 border-b border-border p-5 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-primary">
                <LayoutDashboard className="h-4 w-4" />
                NodeRoute Enterprise UI (V2)
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Admin Command Center</h1>
              <p className="text-sm text-muted-foreground">
                Light enterprise redesign inspired by proven admin patterns, tailored for NodeRoute operations.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a href="/dashboard-legacy" className={cn('inline-flex', role === 'unknown' && 'pointer-events-none opacity-50')}>
                <Button variant="outline">Legacy Dashboard</Button>
              </a>
              <Button variant="outline" size="sm" onClick={() => setDark((d) => !d)} title={dark ? 'Switch to light mode' : 'Switch to dark mode'}>
                {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
              <Button onClick={() => { localStorage.removeItem('nr_token'); localStorage.removeItem('nr_user'); window.location.href = '/login'; }}>
                <LogOut className="mr-2 h-4 w-4" />
                Logout
              </Button>
            </div>
          </div>

          <nav className="flex flex-wrap items-center gap-2 p-4">
            {availableGroups.map((group) => (
              <DropdownMenu key={group.id}>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2">
                    {group.label}
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {group.items.map((item) => (
                    <DropdownMenuItem
                      key={item.id}
                      onSelect={() => navigate(item.path)}
                      className={cn(currentItem?.id === item.id && 'bg-accent')}
                    >
                      {item.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ))}
          </nav>
        </header>

        <main className="mt-4 rounded-xl border border-border bg-card p-4 shadow-panel md:p-6">
          <div className="mb-4 flex flex-col gap-1 border-b border-border pb-4 md:flex-row md:items-end md:justify-between">
            <h2 className="text-xl font-semibold text-foreground">{currentItem?.label || 'Dashboard'}</h2>
            <p className="text-sm font-medium text-muted-foreground">Signed in as {role.toUpperCase()}</p>
          </div>
          <Routes>
            <Route index element={<Navigate to={defaultPath} replace />} />
            {allNavItems.map((item) => (
              <Route
                key={item.id}
                path={routePath(item.path)}
                element={
                  item.adminOnly ? (
                    <AdminOnlyRoute role={role}>{pageElement(item, role)}</AdminOnlyRoute>
                  ) : (
                    pageElement(item, role)
                  )
                }
              />
            ))}
            <Route path="*" element={<Navigate to={defaultPath} replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function AdminOnlyRoute({ children, role }: { children: ReactElement; role: Role }) {
  if (role !== 'admin') {
    return <Navigate to={defaultPath} replace />;
  }

  return children;
}

function PlaceholderPage({ item, role }: { item: NavItem; role: Role }) {
  return (
    <Card className="bg-muted/20">
      <CardHeader>
        <CardTitle>{item.label}</CardTitle>
        <CardDescription>
          This section is queued for framework migration. Core APIs remain unchanged and this module will move to shared primitives next.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        {item.id === 'vendors' || item.id === 'warehouse' || item.id === 'planning' || item.id === 'integrations'
          ? role === 'admin'
            ? 'Operations scope is enabled for admin users in V2.'
            : 'Operations scope is admin-only and hidden for your role.'
          : 'This route has its own URL now and is ready for the next migration pass.'}
      </CardContent>
    </Card>
  );
}

function pageElement(item: NavItem, role: Role) {
  switch (item.id) {
    case 'dashboard':
      return <DashboardPage />;
    case 'analytics':
      return <AnalyticsPage />;
    case 'financials':
      return <FinancialsPage />;
    case 'inventory':
      return <InventoryPage />;
    case 'orders':
      return <OrdersPage />;
    case 'settings':
      return <SettingsPage />;
    case 'deliveries':
      return <DeliveriesPage />;
    case 'drivers':
      return <DriversPage />;
    case 'routes':
      return <RoutesPage />;
    case 'stops':
      return <StopsPage />;
    case 'customers':
      return <CustomersPage />;
    case 'users':
      return <UsersPage />;
    case 'invoices':
      return <InvoicesPage />;
    case 'forecast':
      return <ForecastingPage />;
    case 'purchasing':
      return <PurchasingPage />;
    case 'traceability':
      return <TraceabilityPage />;
    case 'vendors':
      return <VendorsPage />;
    case 'warehouse':
      return <WarehousePage />;
    case 'planning':
      return <PlanningPage />;
    case 'integrations':
      return <IntegrationsPage />;
    case 'aihelp':
      return <AIHelpPage />;
    case 'map':
      return <MapPage />;
    default:
      return <PlaceholderPage item={item} role={role} />;
  }
}

function findNavItem(pathname: string) {
  const normalizedPath = normalizePath(pathname);
  return allNavItems.find((item) => item.path === normalizedPath) || null;
}

function normalizePath(pathname: string) {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed || defaultPath;
}

function routePath(pathname: string) {
  return pathname.replace(/^\//, '');
}
