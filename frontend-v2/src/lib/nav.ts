/**
 * nav.ts — central navigation configuration.
 *
 * Each entry describes one item in the sidebar.
 * The `roles` array controls visibility (empty = all roles).
 */

import { lazy, type ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard, Package, Map, Globe2,
  Factory, ShoppingCart, Warehouse, Search,
  Users, Handshake, ClipboardList, Briefcase,
  DollarSign, Receipt, Lock,
  BarChart2, Sparkles, FileText, Bot,
  User, Building2, Settings, Plug, CheckSquare, Calendar, ScanSearch,
  Phone,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

export type Role = 'superadmin' | 'admin' | 'manager' | 'driver' | 'rep' | string;

export interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: LucideIcon;
  roles?: string[];
  badge?: string;
  component: ComponentType;
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

// ── Lazy page imports ─────────────────────────────────────────────────────────

function lazyNamed<TModule, TKey extends keyof TModule>(
  loader: () => Promise<TModule>,
  key: TKey,
) {
  return lazy(async () => {
    const mod = await loader();
    return { default: mod[key] as ComponentType };
  });
}

const DashboardPage    = lazyNamed(() => import('../pages/DashboardPage'), 'DashboardPage');
const DashboardBuilderPage = lazyNamed(() => import('../pages/DashboardBuilderPage'), 'DashboardBuilderPage');
const OrdersPage       = lazyNamed(() => import('../pages/OrdersPage'), 'OrdersPage');
const RoutesPage       = lazyNamed(() => import('../pages/RoutesPage'), 'RoutesPage');
const MapPage          = lazyNamed(() => import('../pages/MapPage'), 'MapPage');
const InventoryPage    = lazyNamed(() => import('../pages/InventoryPage'), 'InventoryPage');
const PurchasingPage   = lazyNamed(() => import('../pages/PurchasingPage'), 'PurchasingPage');
const WarehousePage    = lazyNamed(() => import('../pages/WarehousePage'), 'WarehousePage');
const TraceabilityPage = lazyNamed(() => import('../pages/TraceabilityPage'), 'TraceabilityPage');
const CustomersPage    = lazyNamed(() => import('../pages/CustomersPage'), 'CustomersPage');
const VendorsPage      = lazyNamed(() => import('../pages/VendorsPage'), 'VendorsPage');
const DSRPage          = lazyNamed(() => import('../pages/DSRPage'), 'DSRPage');
const SalesRepPage     = lazyNamed(() => import('../pages/SalesRepPage'), 'SalesRepPage');
const FinancialsPage   = lazyNamed(() => import('../pages/FinancialsPage'), 'FinancialsPage');
const InvoicesPage     = lazyNamed(() => import('../pages/InvoicesPage'), 'InvoicesPage');
const CreditHoldPage   = lazyNamed(() => import('../pages/CreditHoldPage'), 'CreditHoldPage');
const AnalyticsPage    = lazyNamed(() => import('../pages/AnalyticsPage'), 'AnalyticsPage');
const ForecastPage     = lazyNamed(() => import('../pages/ForecastingPage'), 'ForecastingPage');
const ReportsPage      = lazyNamed(() => import('../pages/ReportsPage'), 'ReportsPage');
const AIHelpPage       = lazyNamed(() => import('../pages/AIHelpPage'), 'AIHelpPage');
const UsersPage        = lazyNamed(() => import('../pages/UsersPage'), 'UsersPage');
const CompaniesPage    = lazyNamed(() => import('../pages/CompaniesPage'), 'CompaniesPage');
const SettingsPage     = lazyNamed(() => import('../pages/SettingsPage'), 'SettingsPage');
const IntegrationsPage = lazyNamed(() => import('../pages/IntegrationsPage'), 'IntegrationsPage');
const CompliancePage   = lazyNamed(() => import('../pages/ComplianceDashboardPage'), 'ComplianceDashboardPage');
const PlanningPage     = lazyNamed(() => import('../pages/PlanningPage'), 'PlanningPage');
const AuditLogPage     = lazyNamed(() => import('../pages/AuditLogPage'), 'AuditLogPage');
const PhoneOrdersPage  = lazyNamed(() => import('../pages/PhoneOrdersPage'), 'PhoneOrdersPage');

export const NAV_ITEM_IDS = {
  dashboard: 'dashboard',
  dashboardBuilder: 'dashboard-builder',
  orders: 'orders',
  routes: 'routes',
  map: 'map',
  inventory: 'inventory',
  purchasing: 'purchasing',
  warehouse: 'warehouse',
  traceability: 'traceability',
  customers: 'customers',
  vendors: 'vendors',
  salesRep: 'sales-rep',
  phoneOrders: 'phone-orders',
  financials: 'financials',
  invoices: 'invoices',
  creditHold: 'credit-hold',
  analytics: 'analytics',
  dsr: 'dsr',
  forecasting: 'forecasting',
  reports: 'reports',
  aiHelp: 'ai-help',
  users: 'users',
  companies: 'companies',
  settings: 'settings',
  integrations: 'integrations',
  compliance: 'compliance',
  planning: 'planning',
  auditLog: 'audit-log',
} as const;

// ── Nav groups ────────────────────────────────────────────────────────────────

export const navGroups: NavGroup[] = [
  {
    // Standalone top-level entry. Empty label → rendered header-less (FlatItems),
    // so Dashboard sits on its own just above the Dispatch group.
    id: 'home',
    label: '',
    items: [
      { id: NAV_ITEM_IDS.dashboard, label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard, component: DashboardPage },
    ],
  },
  {
    id: 'dispatch',
    label: 'Dispatch',
    items: [
      { id: NAV_ITEM_IDS.orders, label: 'Orders', path: '/orders', icon: Package, component: OrdersPage },
      { id: NAV_ITEM_IDS.routes, label: 'Routes', path: '/routes', icon: Map, component: RoutesPage },
      { id: NAV_ITEM_IDS.map, label: 'Map', path: '/map', icon: Globe2, component: MapPage },
    ],
  },
  {
    id: 'inventory',
    label: 'Inventory',
    items: [
      { id: NAV_ITEM_IDS.inventory, label: 'Inventory', path: '/inventory', icon: Factory, component: InventoryPage },
      { id: 'purchasing', label: 'Purchasing', path: '/purchasing', icon: ShoppingCart, component: PurchasingPage },
      { id: 'warehouse', label: 'Warehouse', path: '/warehouse', icon: Warehouse, component: WarehousePage },
      { id: NAV_ITEM_IDS.traceability, label: 'Traceability', path: '/traceability', icon: Search, component: TraceabilityPage },
    ],
  },
  {
    id: 'customers',
    label: 'Customers',
    items: [
      { id: NAV_ITEM_IDS.customers, label: 'Customers', path: '/customers', icon: Users, component: CustomersPage },
      { id: NAV_ITEM_IDS.vendors, label: 'Vendors', path: '/vendors', icon: Handshake, component: VendorsPage },
      { id: NAV_ITEM_IDS.salesRep, label: 'Sales Rep', path: '/sales-rep', icon: Briefcase, component: SalesRepPage },
      { id: NAV_ITEM_IDS.phoneOrders, label: 'Phone Orders', path: '/phone-orders', icon: Phone, component: PhoneOrdersPage, roles: ['admin', 'manager'] },
    ],
  },
  {
    id: 'financials',
    label: 'Financials',
    items: [
      { id: NAV_ITEM_IDS.financials, label: 'Financials', path: '/financials', icon: DollarSign, component: FinancialsPage },
      { id: NAV_ITEM_IDS.invoices, label: 'Invoices', path: '/invoices', icon: Receipt, component: InvoicesPage },
      { id: NAV_ITEM_IDS.creditHold, label: 'Credit Hold', path: '/credit-hold', icon: Lock, component: CreditHoldPage, roles: ['admin', 'manager'] },
    ],
  },
  {
    id: 'insights',
    label: 'Insights',
    items: [
      { id: NAV_ITEM_IDS.analytics, label: 'Analytics', path: '/analytics', icon: BarChart2, component: AnalyticsPage },
      { id: NAV_ITEM_IDS.dashboardBuilder, label: 'Dashboard Builder', path: '/dashboard/builder', icon: LayoutDashboard, component: DashboardBuilderPage, roles: ['admin', 'manager'] },
      { id: NAV_ITEM_IDS.dsr, label: 'DSR', path: '/dsr', icon: ClipboardList, component: DSRPage },
      { id: NAV_ITEM_IDS.forecasting, label: 'Forecasting', path: '/forecasting', icon: Sparkles, component: ForecastPage },
      { id: NAV_ITEM_IDS.reports, label: 'Reports', path: '/reports', icon: FileText, component: ReportsPage },
      { id: NAV_ITEM_IDS.aiHelp, label: 'AI Help', path: '/ai-help', icon: Bot, component: AIHelpPage },
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    items: [
      { id: NAV_ITEM_IDS.users, label: 'Users', path: '/users', icon: User, component: UsersPage, roles: ['admin', 'superadmin'] },
      { id: NAV_ITEM_IDS.companies, label: 'Companies', path: '/companies', icon: Building2, component: CompaniesPage, roles: ['superadmin'] },
      { id: NAV_ITEM_IDS.settings, label: 'Settings', path: '/settings', icon: Settings, component: SettingsPage },
      { id: 'integrations', label: 'Integrations', path: '/integrations', icon: Plug, component: IntegrationsPage, roles: ['admin'] },
      { id: NAV_ITEM_IDS.compliance, label: 'Compliance', path: '/compliance', icon: CheckSquare, component: CompliancePage, roles: ['admin', 'manager'] },
      { id: 'planning', label: 'Planning', path: '/planning', icon: Calendar, component: PlanningPage },
      { id: NAV_ITEM_IDS.auditLog, label: 'Audit Log', path: '/audit-log', icon: ScanSearch, component: AuditLogPage, roles: ['admin', 'superadmin'] },
    ],
  },
];

// ── Legacy path redirects ─────────────────────────────────────────────────────
// Deliveries and Stops now live as tabs inside the Routes page. Their old URLs
// keep resolving via these redirects (query params are preserved by AppShell).

export interface NavRedirect {
  id: string;
  /** Old path that should keep working. */
  from: string;
  /** Destination path. */
  to: string;
  /** Tab query param appended on redirect. */
  tab?: string;
}

export const navRedirects: NavRedirect[] = [
  { id: 'deliveries-redirect', from: '/deliveries', to: '/routes', tab: 'deliveries' },
  { id: 'stops-redirect',      from: '/stops',      to: '/routes', tab: 'stops' },
];

// ── Derived helpers ───────────────────────────────────────────────────────────

export const allNavItems: NavItem[] = navGroups.flatMap((g) => g.items);

export const defaultPath = '/dashboard';

export function routePath(path: string): string {
  return path.replace(/^\//, '') + '/*';
}

export function findNavItem(path: string): NavItem | null {
  const normalised = path.replace(/\/$/, '');
  return allNavItems.find((item) => item.path === normalised) ?? null;
}

export function canAccess(item: NavItem, role: Role): boolean {
  // Superadmin is the platform owner and can access every page, regardless of
  // an item's explicit roles list. Mirrors the backend requireRole bypass.
  if (role === 'superadmin') return true;
  if (!item.roles || item.roles.length === 0) return true;
  return item.roles.includes(role);
}

export function canAccessGroup(group: NavGroup, role: Role): boolean {
  return group.items.some((item) => canAccess(item, role));
}
