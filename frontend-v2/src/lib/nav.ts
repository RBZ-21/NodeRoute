/**
 * nav.ts — central navigation configuration.
 *
 * Each entry describes one item in the sidebar.
 * The `roles` array controls visibility (empty = all roles).
 */

import { lazy, type ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard, Package, Map, Truck, MapPin, Globe2,
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
const OrdersPage       = lazyNamed(() => import('../pages/OrdersPage'), 'OrdersPage');
const RoutesPage       = lazyNamed(() => import('../pages/RoutesPage'), 'RoutesPage');
const DeliveriesPage   = lazyNamed(() => import('../pages/DeliveriesPage'), 'DeliveriesPage');
const StopsPage        = lazyNamed(() => import('../pages/StopsPage'), 'StopsPage');
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

// ── Nav groups ────────────────────────────────────────────────────────────────

export const navGroups: NavGroup[] = [
  {
    id: 'operations',
    label: 'Operations',
    items: [
      { id: 'dashboard',    label: 'Dashboard',    path: '/dashboard',    icon: LayoutDashboard, component: DashboardPage },
      { id: 'orders',       label: 'Orders',       path: '/orders',       icon: Package,         component: OrdersPage },
      { id: 'phone-orders', label: 'Phone Orders', path: '/phone-orders', icon: Phone,           component: PhoneOrdersPage, roles: ['admin', 'manager'] },
      { id: 'routes',       label: 'Routes',       path: '/routes',       icon: Map,             component: RoutesPage },
      { id: 'deliveries',   label: 'Deliveries',   path: '/deliveries',   icon: Truck,           component: DeliveriesPage },
      { id: 'stops',        label: 'Stops',        path: '/stops',        icon: MapPin,          component: StopsPage },
      { id: 'map',          label: 'Map',          path: '/map',          icon: Globe2,          component: MapPage },
    ],
  },
  {
    id: 'inventory',
    label: 'Inventory',
    items: [
      { id: 'inventory',    label: 'Inventory',    path: '/inventory',    icon: Factory,         component: InventoryPage },
      { id: 'purchasing',   label: 'Purchasing',   path: '/purchasing',   icon: ShoppingCart,    component: PurchasingPage },
      { id: 'warehouse',    label: 'Warehouse',    path: '/warehouse',    icon: Warehouse,       component: WarehousePage },
      { id: 'traceability', label: 'Traceability', path: '/traceability', icon: Search,          component: TraceabilityPage },
    ],
  },
  {
    id: 'customers',
    label: 'Customers',
    items: [
      { id: 'customers',    label: 'Customers',    path: '/customers',    icon: Users,           component: CustomersPage },
      { id: 'vendors',      label: 'Vendors',      path: '/vendors',      icon: Handshake,       component: VendorsPage },
      { id: 'dsr',          label: 'DSR',          path: '/dsr',          icon: ClipboardList,   component: DSRPage },
      { id: 'sales-rep',    label: 'Sales Rep',    path: '/sales-rep',    icon: Briefcase,       component: SalesRepPage },
    ],
  },
  {
    id: 'financials',
    label: 'Financials',
    items: [
      { id: 'financials',   label: 'Financials',   path: '/financials',   icon: DollarSign,      component: FinancialsPage },
      { id: 'invoices',     label: 'Invoices',     path: '/invoices',     icon: Receipt,         component: InvoicesPage },
      { id: 'credit-hold',  label: 'Credit Hold',  path: '/credit-hold',  icon: Lock,            component: CreditHoldPage,  roles: ['admin', 'manager'] },
    ],
  },
  {
    id: 'intelligence',
    label: 'Intelligence',
    items: [
      { id: 'analytics',    label: 'Analytics',    path: '/analytics',    icon: BarChart2,       component: AnalyticsPage },
      { id: 'forecasting',  label: 'Forecasting',  path: '/forecasting',  icon: Sparkles,        component: ForecastPage },
      { id: 'reports',      label: 'Reports',      path: '/reports',      icon: FileText,        component: ReportsPage },
      { id: 'ai-help',      label: 'AI Help',      path: '/ai-help',      icon: Bot,             component: AIHelpPage },
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    items: [
      { id: 'users',        label: 'Users',        path: '/users',        icon: User,            component: UsersPage,        roles: ['admin', 'superadmin'] },
      { id: 'companies',    label: 'Companies',    path: '/companies',    icon: Building2,       component: CompaniesPage,    roles: ['superadmin'] },
      { id: 'settings',     label: 'Settings',     path: '/settings',     icon: Settings,        component: SettingsPage },
      { id: 'integrations', label: 'Integrations', path: '/integrations', icon: Plug,            component: IntegrationsPage, roles: ['admin'] },
      { id: 'compliance',   label: 'Compliance',   path: '/compliance',   icon: CheckSquare,     component: CompliancePage,   roles: ['admin', 'manager'] },
      { id: 'planning',     label: 'Planning',     path: '/planning',     icon: Calendar,        component: PlanningPage },
      { id: 'audit-log',    label: 'Audit Log',    path: '/audit-log',    icon: ScanSearch,      component: AuditLogPage,     roles: ['admin', 'superadmin'] },
    ],
  },
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
