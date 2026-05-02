import { lazy } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard, ShoppingCart, Settings,
  Truck, Map, UserCheck, Route, MapPin,
  Users, UserCog,
  DollarSign, FileText, BarChart2, Package, TrendingUp,
  ShoppingBag, ScanLine, Store, Warehouse, CalendarCog, Plug,
  ClipboardList, Bot,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────
export type TabId =
  | 'dashboard' | 'orders' | 'deliveries' | 'reports' | 'map'
  | 'drivers' | 'routes' | 'stops' | 'customers' | 'users'
  | 'invoices' | 'analytics' | 'inventory' | 'forecast' | 'financials'
  | 'purchasing' | 'vendors' | 'warehouse' | 'planning' | 'integrations'
  | 'aihelp' | 'settings' | 'traceability';

export type GroupId = 'core' | 'logistics' | 'people' | 'financials' | 'operations' | 'reports' | 'ai';
export type Role    = 'admin' | 'manager' | 'driver' | 'unknown';

export type NavItem = {
  id: TabId;
  label: string;
  path: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  /** Lazy-loaded page component — single source of truth, no separate switch needed */
  component: React.ComponentType;
};

export type NavGroup = {
  id: GroupId;
  label: string;
  items: NavItem[];
  adminOnly?: boolean;
};

// ── Lazy helper ───────────────────────────────────────────────────────────────
function lazyNamed<TModule, TKey extends keyof TModule>(
  loader: () => Promise<TModule>,
  key: TKey,
) {
  return lazy(async () => {
    const mod = await loader();
    return { default: mod[key] as React.ComponentType };
  });
}

// ── Nav definition ────────────────────────────────────────────────────────────
export const navGroups: NavGroup[] = [
  {
    id: 'core',
    label: 'Core',
    items: [
      { id: 'dashboard', label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard, component: lazyNamed(() => import('./pages/DashboardPage'),   'DashboardPage') },
      { id: 'orders',    label: 'Orders',    path: '/orders',    icon: ShoppingCart,    component: lazyNamed(() => import('./pages/OrdersPage'),      'OrdersPage') },
      { id: 'settings',  label: 'Settings',  path: '/settings',  icon: Settings,        component: lazyNamed(() => import('./pages/SettingsPage'),     'SettingsPage') },
    ],
  },
  {
    id: 'logistics',
    label: 'Logistics',
    items: [
      { id: 'deliveries', label: 'Deliveries', path: '/deliveries', icon: Truck,     component: lazyNamed(() => import('./pages/DeliveriesPage'), 'DeliveriesPage') },
      { id: 'map',        label: 'Live Map',   path: '/map',        icon: Map,       component: lazyNamed(() => import('./pages/MapPage'),        'MapPage') },
      { id: 'drivers',    label: 'Drivers',    path: '/drivers',    icon: UserCheck, component: lazyNamed(() => import('./pages/DriversPage'),    'DriversPage') },
      { id: 'routes',     label: 'Routes',     path: '/routes',     icon: Route,     component: lazyNamed(() => import('./pages/RoutesPage'),     'RoutesPage') },
      { id: 'stops',      label: 'Stops',      path: '/stops',      icon: MapPin,    component: lazyNamed(() => import('./pages/StopsPage'),      'StopsPage') },
    ],
  },
  {
    id: 'people',
    label: 'People',
    items: [
      { id: 'customers', label: 'Customers', path: '/customers', icon: Users,   component: lazyNamed(() => import('./pages/CustomersPage'), 'CustomersPage') },
      { id: 'users',     label: 'Users',     path: '/users',     icon: UserCog, adminOnly: true, component: lazyNamed(() => import('./pages/UsersPage'), 'UsersPage') },
    ],
  },
  {
    id: 'financials',
    label: 'Financials',
    items: [
      { id: 'financials', label: 'Financial Overview', path: '/financials', icon: DollarSign, component: lazyNamed(() => import('./pages/FinancialsPage'),   'FinancialsPage') },
      { id: 'invoices',   label: 'Invoices',           path: '/invoices',   icon: FileText,   component: lazyNamed(() => import('./pages/InvoicesPage'),     'InvoicesPage') },
      { id: 'analytics',  label: 'Analytics',          path: '/analytics',  icon: BarChart2,  component: lazyNamed(() => import('./pages/AnalyticsPage'),    'AnalyticsPage') },
      { id: 'inventory',  label: 'Inventory',          path: '/inventory',  icon: Package,    component: lazyNamed(() => import('./pages/InventoryPage'),    'InventoryPage') },
      { id: 'forecast',   label: 'Forecasting',        path: '/forecast',   icon: TrendingUp, component: lazyNamed(() => import('./pages/ForecastingPage'),  'ForecastingPage') },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    adminOnly: true,
    items: [
      { id: 'purchasing',   label: 'Purchasing',        path: '/purchasing',         icon: ShoppingBag, adminOnly: true, component: lazyNamed(() => import('./pages/PurchasingPage'),    'PurchasingPage') },
      { id: 'traceability', label: 'FSMA Traceability', path: '/admin/traceability', icon: ScanLine,    adminOnly: true, component: lazyNamed(() => import('./pages/TraceabilityPage'),  'TraceabilityPage') },
      { id: 'vendors',      label: 'Vendors',           path: '/vendors',            icon: Store,       adminOnly: true, component: lazyNamed(() => import('./pages/VendorsPage'),       'VendorsPage') },
      { id: 'warehouse',    label: 'Warehouse',         path: '/warehouse',          icon: Warehouse,   adminOnly: true, component: lazyNamed(() => import('./pages/WarehousePage'),     'WarehousePage') },
      { id: 'planning',     label: 'Planning & Rules',  path: '/planning',           icon: CalendarCog, adminOnly: true, component: lazyNamed(() => import('./pages/PlanningPage'),      'PlanningPage') },
      { id: 'integrations', label: 'Integrations',      path: '/integrations',       icon: Plug,        adminOnly: true, component: lazyNamed(() => import('./pages/IntegrationsPage'),  'IntegrationsPage') },
    ],
  },
  {
    id: 'reports',
    label: 'Reports',
    items: [
      { id: 'reports', label: 'Reports', path: '/reports', icon: ClipboardList, component: lazyNamed(() => import('./pages/ReportsPage'), 'ReportsPage') },
    ],
  },
  {
    id: 'ai',
    label: 'AI Help',
    items: [
      { id: 'aihelp', label: 'Walkthroughs', path: '/aihelp', icon: Bot, component: lazyNamed(() => import('./pages/AIHelpPage'), 'AIHelpPage') },
    ],
  },
];

export const allNavItems = navGroups.flatMap((g) => g.items);
export const defaultPath  = '/dashboard';

export function findNavItem(pathname: string): NavItem | null {
  const trimmed = pathname.replace(/\/+$/, '') || defaultPath;
  return allNavItems.find((item) => item.path === trimmed) ?? null;
}

export function routePath(pathname: string) {
  return pathname.replace(/^\//, '');
}
