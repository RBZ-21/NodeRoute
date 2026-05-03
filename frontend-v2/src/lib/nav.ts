import { lazy } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard, ShoppingCart, Settings,
  Truck, Map, UserCheck, Route, MapPin,
  Users, UserCog,
  DollarSign, FileText, BarChart2, Package, TrendingUp,
  ShoppingBag, ScanLine, Store, Warehouse, CalendarCog, Plug,
  ClipboardList, Bot, Building2,
} from 'lucide-react';
import type { Role } from './api';

// ── Types ─────────────────────────────────────────────────────────────────────
export type TabId =
  | 'dashboard' | 'orders' | 'deliveries' | 'reports' | 'map'
  | 'drivers' | 'routes' | 'stops' | 'customers' | 'users'
  | 'invoices' | 'analytics' | 'inventory' | 'forecast' | 'financials'
  | 'purchasing' | 'vendors' | 'warehouse' | 'planning' | 'integrations'
  | 'aihelp' | 'settings' | 'traceability' | 'companies';

export type GroupId =
  | 'core' | 'logistics' | 'people' | 'financials'
  | 'operations' | 'reports' | 'ai' | 'superadmin';

// Re-export so nav consumers don't need a separate import
export type { Role };

export type NavItem = {
  id: TabId;
  label: string;
  path: string;
  icon: LucideIcon;
  /**
   * Which roles can see and access this item.
   * Listed from least to most permissive.
   * If omitted, defaults to ['admin', 'manager', 'superadmin'].
   */
  allowedRoles?: Role[];
  component: React.ComponentType;
};

export type NavGroup = {
  id: GroupId;
  label: string;
  items: NavItem[];
  /** If set, the whole group is hidden unless the user has one of these roles. */
  allowedRoles?: Role[];
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

/**
 * Role access matrix
 * ─────────────────────────────────────────────────────────────────────────────
 * superadmin  All pages + Companies (cross-tenant)
 * admin       All pages except Companies
 * manager     Core + Logistics + People(customers only) + Financials(invoices only) + Reports + AI
 * driver      DriverPage only  (enforced in App.tsx routing, not here)
 */
const ALL:         Role[] = ['superadmin', 'admin', 'manager', 'driver'];
const SA_ONLY:     Role[] = ['superadmin'];
const SA_ADMIN:    Role[] = ['superadmin', 'admin'];
const SA_ADMIN_MGR:Role[] = ['superadmin', 'admin', 'manager'];

export const navGroups: NavGroup[] = [
  // ── SuperAdmin only ───────────────────────────────────────────────────────
  {
    id: 'superadmin',
    label: 'Platform',
    allowedRoles: SA_ONLY,
    items: [
      {
        id: 'companies',
        label: 'All Companies',
        path: '/superadmin/companies',
        icon: Building2,
        allowedRoles: SA_ONLY,
        component: lazyNamed(() => import('../pages/CompaniesPage'), 'CompaniesPage'),
      },
    ],
  },

  // ── Core ──────────────────────────────────────────────────────────────────
  {
    id: 'core',
    label: 'Core',
    items: [
      {
        id: 'dashboard',
        label: 'Dashboard',
        path: '/dashboard',
        icon: LayoutDashboard,
        allowedRoles: SA_ADMIN_MGR,
        component: lazyNamed(() => import('../pages/DashboardPage'), 'DashboardPage'),
      },
      {
        id: 'orders',
        label: 'Orders',
        path: '/orders',
        icon: ShoppingCart,
        allowedRoles: SA_ADMIN_MGR,
        component: lazyNamed(() => import('../pages/OrdersPage'), 'OrdersPage'),
      },
      {
        id: 'settings',
        label: 'Settings',
        path: '/settings',
        icon: Settings,
        allowedRoles: SA_ADMIN,
        component: lazyNamed(() => import('../pages/SettingsPage'), 'SettingsPage'),
      },
    ],
  },

  // ── Logistics ─────────────────────────────────────────────────────────────
  {
    id: 'logistics',
    label: 'Logistics',
    items: [
      { id: 'deliveries', label: 'Deliveries', path: '/deliveries', icon: Truck,     allowedRoles: SA_ADMIN_MGR, component: lazyNamed(() => import('../pages/DeliveriesPage'), 'DeliveriesPage') },
      { id: 'map',        label: 'Live Map',   path: '/map',        icon: Map,        allowedRoles: SA_ADMIN_MGR, component: lazyNamed(() => import('../pages/MapPage'),        'MapPage') },
      { id: 'drivers',    label: 'Drivers',    path: '/drivers',    icon: UserCheck,  allowedRoles: SA_ADMIN_MGR, component: lazyNamed(() => import('../pages/DriversPage'),    'DriversPage') },
      { id: 'routes',     label: 'Routes',     path: '/routes',     icon: Route,      allowedRoles: SA_ADMIN_MGR, component: lazyNamed(() => import('../pages/RoutesPage'),     'RoutesPage') },
      { id: 'stops',      label: 'Stops',      path: '/stops',      icon: MapPin,     allowedRoles: SA_ADMIN_MGR, component: lazyNamed(() => import('../pages/StopsPage'),      'StopsPage') },
    ],
  },

  // ── People ────────────────────────────────────────────────────────────────
  {
    id: 'people',
    label: 'People',
    items: [
      {
        id: 'customers',
        label: 'Customers',
        path: '/customers',
        icon: Users,
        allowedRoles: SA_ADMIN_MGR,
        component: lazyNamed(() => import('../pages/CustomersPage'), 'CustomersPage'),
      },
      {
        id: 'users',
        label: 'Users',
        path: '/users',
        icon: UserCog,
        allowedRoles: SA_ADMIN,       // managers cannot manage users
        component: lazyNamed(() => import('../pages/UsersPage'), 'UsersPage'),
      },
    ],
  },

  // ── Financials ────────────────────────────────────────────────────────────
  {
    id: 'financials',
    label: 'Financials',
    items: [
      { id: 'financials', label: 'Financial Overview', path: '/financials', icon: DollarSign, allowedRoles: SA_ADMIN,     component: lazyNamed(() => import('../pages/FinancialsPage'),   'FinancialsPage') },
      { id: 'invoices',   label: 'Invoices',           path: '/invoices',   icon: FileText,   allowedRoles: SA_ADMIN_MGR, component: lazyNamed(() => import('../pages/InvoicesPage'),     'InvoicesPage') },
      { id: 'analytics',  label: 'Analytics',          path: '/analytics',  icon: BarChart2,  allowedRoles: SA_ADMIN,     component: lazyNamed(() => import('../pages/AnalyticsPage'),    'AnalyticsPage') },
      { id: 'inventory',  label: 'Inventory',          path: '/inventory',  icon: Package,    allowedRoles: SA_ADMIN_MGR, component: lazyNamed(() => import('../pages/InventoryPage'),    'InventoryPage') },
      { id: 'forecast',   label: 'Forecasting',        path: '/forecast',   icon: TrendingUp, allowedRoles: SA_ADMIN,     component: lazyNamed(() => import('../pages/ForecastingPage'),  'ForecastingPage') },
    ],
  },

  // ── Operations (admin+ only — purchasing / vendors blocked from managers) ──
  {
    id: 'operations',
    label: 'Operations',
    allowedRoles: SA_ADMIN,
    items: [
      { id: 'purchasing',   label: 'Purchasing',       path: '/purchasing',         icon: ShoppingBag, allowedRoles: SA_ADMIN, component: lazyNamed(() => import('../pages/PurchasingPage'),    'PurchasingPage') },
      { id: 'traceability', label: 'FSMA Traceability',path: '/admin/traceability', icon: ScanLine,    allowedRoles: SA_ADMIN, component: lazyNamed(() => import('../pages/TraceabilityPage'),  'TraceabilityPage') },
      { id: 'vendors',      label: 'Vendors',          path: '/vendors',            icon: Store,       allowedRoles: SA_ADMIN, component: lazyNamed(() => import('../pages/VendorsPage'),       'VendorsPage') },
      { id: 'warehouse',    label: 'Warehouse',        path: '/warehouse',          icon: Warehouse,   allowedRoles: SA_ADMIN, component: lazyNamed(() => import('../pages/WarehousePage'),     'WarehousePage') },
      { id: 'planning',     label: 'Planning & Rules', path: '/planning',           icon: CalendarCog, allowedRoles: SA_ADMIN, component: lazyNamed(() => import('../pages/PlanningPage'),      'PlanningPage') },
      { id: 'integrations', label: 'Integrations',     path: '/integrations',       icon: Plug,        allowedRoles: SA_ADMIN, component: lazyNamed(() => import('../pages/IntegrationsPage'),  'IntegrationsPage') },
    ],
  },

  // ── Reports ───────────────────────────────────────────────────────────────
  {
    id: 'reports',
    label: 'Reports',
    items: [
      { id: 'reports', label: 'Reports', path: '/reports', icon: ClipboardList, allowedRoles: SA_ADMIN_MGR, component: lazyNamed(() => import('../pages/ReportsPage'), 'ReportsPage') },
    ],
  },

  // ── AI ────────────────────────────────────────────────────────────────────
  {
    id: 'ai',
    label: 'AI Help',
    items: [
      { id: 'aihelp', label: 'Walkthroughs', path: '/aihelp', icon: Bot, allowedRoles: SA_ADMIN_MGR, component: lazyNamed(() => import('../pages/AIHelpPage'), 'AIHelpPage') },
    ],
  },
];

export const allNavItems = navGroups.flatMap((g) => g.items);
export const defaultPath  = '/dashboard';

/** True if the given role is allowed to see/access this nav item. */
export function canAccess(item: NavItem, role: Role): boolean {
  const allowed = item.allowedRoles ?? SA_ADMIN_MGR;
  return allowed.includes(role);
}

/** True if the given role can see this group at all. */
export function canAccessGroup(group: NavGroup, role: Role): boolean {
  if (!group.allowedRoles) return true;
  return group.allowedRoles.includes(role);
}

export function findNavItem(pathname: string): NavItem | null {
  const trimmed = pathname.replace(/\/+$/, '') || defaultPath;
  return allNavItems.find((item) => item.path === trimmed) ?? null;
}

export function routePath(pathname: string) {
  return pathname.replace(/^\//, '');
}
