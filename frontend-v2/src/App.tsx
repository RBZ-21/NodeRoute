import { ChevronDown, LayoutDashboard, LogOut } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './components/ui/dropdown-menu';
import { getUserRole, requireAuthToken } from './lib/api';
import { cn } from './lib/utils';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { AIHelpPage, ForecastPage, IntegrationsPage, PlanningPage, SettingsPage, VendorsPage, WarehousePage } from './pages/ControlPages';
import { DashboardPage, DriversPage, LiveMapPage } from './pages/DispatchPages';
import { CustomersPage } from './pages/CustomersPage';
import { DeliveriesPage } from './pages/DeliveriesPage';
import { FinancialsPage } from './pages/FinancialsPage';
import { InventoryPage } from './pages/InventoryPage';
import { InvoicesPage } from './pages/InvoicesPage';
import { RoutesPage, StopsPage, UsersPage } from './pages/NetworkPages';
import { OrdersPage } from './pages/OrdersPage';
import { PurchasingPage } from './pages/PurchasingPage';

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
  | 'settings';

type GroupId = 'core' | 'logistics' | 'people' | 'financials' | 'operations' | 'ai';
type Role = 'admin' | 'manager' | 'driver' | 'unknown';

type NavItem = {
  id: TabId;
  label: string;
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
      { id: 'dashboard', label: 'Dashboard' },
      { id: 'orders', label: 'Orders' },
      { id: 'settings', label: 'Settings' },
    ],
  },
  {
    id: 'logistics',
    label: 'Logistics',
    items: [
      { id: 'deliveries', label: 'Deliveries' },
      { id: 'map', label: 'Live Map' },
      { id: 'drivers', label: 'Drivers' },
      { id: 'routes', label: 'Routes' },
      { id: 'stops', label: 'Stops' },
    ],
  },
  {
    id: 'people',
    label: 'People',
    items: [
      { id: 'customers', label: 'Customers' },
      { id: 'users', label: 'Users', adminOnly: true },
    ],
  },
  {
    id: 'financials',
    label: 'Financials',
    items: [
      { id: 'financials', label: 'Financial Overview' },
      { id: 'invoices', label: 'Invoices' },
      { id: 'analytics', label: 'Analytics' },
      { id: 'inventory', label: 'Inventory' },
      { id: 'forecast', label: 'Forecasting' },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    adminOnly: true,
    items: [
      { id: 'purchasing', label: 'Purchasing' },
      { id: 'vendors', label: 'Vendors' },
      { id: 'warehouse', label: 'Warehouse' },
      { id: 'planning', label: 'Planning & Rules' },
      { id: 'integrations', label: 'Integrations' },
    ],
  },
  {
    id: 'ai',
    label: 'AI Help',
    items: [{ id: 'aihelp', label: 'Walkthroughs' }],
  },
];

export function App() {
  const role = getUserRole();
  const [tab, setTab] = useState<TabId>('dashboard');

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

  if (!requireAuthToken()) {
    window.location.href = '/login';
    return null;
  }

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
              <a href="/dashboard" className={cn('inline-flex', role === 'unknown' && 'pointer-events-none opacity-50')}>
                <Button variant="outline">Legacy Dashboard</Button>
              </a>
              <Button onClick={() => (window.location.href = '/auth/logout')}>
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
                    <DropdownMenuItem key={item.id} onSelect={() => setTab(item.id)} className={cn(tab === item.id && 'bg-accent')}>
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
            <h2 className="text-xl font-semibold text-foreground">{pageTitle(tab)}</h2>
            <p className="text-sm font-medium text-muted-foreground">Signed in as {role.toUpperCase()}</p>
          </div>
          <PageContent tab={tab} role={role} />
        </main>
      </div>
    </div>
  );
}

function PageContent({ tab, role }: { tab: TabId; role: Role }) {
  if (tab === 'dashboard') return <DashboardPage />;
  if (tab === 'deliveries') return <DeliveriesPage />;
  if (tab === 'map') return <LiveMapPage />;
  if (tab === 'drivers') return <DriversPage />;
  if (tab === 'routes') return <RoutesPage />;
  if (tab === 'stops') return <StopsPage />;
  if (tab === 'customers') return <CustomersPage />;
  if (tab === 'users') return <UsersPage />;
  if (tab === 'financials') return <FinancialsPage />;
  if (tab === 'invoices') return <InvoicesPage />;
  if (tab === 'orders') return <OrdersPage />;
  if (tab === 'analytics') return <AnalyticsPage />;
  if (tab === 'inventory') return <InventoryPage />;
  if (tab === 'forecast') return <ForecastPage />;
  if (tab === 'purchasing') return <PurchasingPage />;
  if (tab === 'vendors') return <VendorsPage />;
  if (tab === 'warehouse') return <WarehousePage />;
  if (tab === 'planning') return <PlanningPage />;
  if (tab === 'integrations') return <IntegrationsPage />;
  if (tab === 'aihelp') return <AIHelpPage />;
  if (tab === 'settings') return <SettingsPage />;
  return (
    <Card className="bg-muted/20">
      <CardHeader>
        <CardTitle>{pageTitle(tab)}</CardTitle>
        <CardDescription>
          This section does not have a mapped renderer yet in v2.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">Signed in as {role.toUpperCase()}</CardContent>
    </Card>
  );
}

function pageTitle(tab: TabId): string {
  switch (tab) {
    case 'financials':
      return 'Financial Overview';
    case 'orders':
      return 'Orders';
    case 'aihelp':
      return 'AI Help';
    case 'map':
      return 'Live Map';
    default:
      return tab.charAt(0).toUpperCase() + tab.slice(1);
  }
}
