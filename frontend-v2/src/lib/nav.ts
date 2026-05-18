/**
 * nav.ts — central navigation configuration.
 *
 * Each entry describes one item in the sidebar.
 * The `roles` array controls visibility (empty = all roles).
 */

import { lazy, type ComponentType } from 'react';
import {
  LayoutDashboard, Package, Map, Truck, MapPin, Globe2,
  Factory, ShoppingCart, Warehouse, Search,
  Users, Handshake, ClipboardList, Briefcase,
  DollarSign, Receipt, Lock,
  BarChart2, Sparkles, FileText, Bot,
  User, Building2, Settings, Plug, CheckSquare, Calendar, ScanSearch,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

export type Role = 'superadmin' | 'admin' | 'manager' | 'driver' | 'rep' | string;

export interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: ComponentType<{ className?: string; 'aria-hidden'?: string }>;
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

const DashboardPage    = lazy(() => import('../pages/DashboardPage').then((m) => ({ default: m.DashboardPage ?? m.default })));
const OrdersPage       = lazy(() => import('../pages/OrdersPage').then((m) => ({ default: m.OrdersPage ?? m.default })));
const RoutesPage       = lazy(() => import('../pages/RoutesPage').then((m) => ({ default: m.RoutesPage ?? m.default })));
const DeliveriesPage   = lazy(() => import('../pages/DeliveriesPage').then((m) => ({ default: m.DeliveriesPage ?? m.default })));
const StopsPage        = lazy(() => import('../pages/StopsPage').then((m) => ({ default: m.StopsPage ?? m.default })));
const MapPage          = lazy(() => import('../pages/MapPage').then((m) => ({ default: m.MapPage ?? m.default })));
const InventoryPage    = lazy(() => import('../pages/InventoryPage').then((m) => ({ default: m.InventoryPage ?? m.default })));
const PurchasingPage   = lazy(() => import('../pages/PurchasingPage').then((m) => ({ default: m.PurchasingPage ?? m.default })));
const WarehousePage    = lazy(() => import('../pages/WarehousePage').then((m) => ({ default: m.WarehousePage ?? m.default })));
const TraceabilityPage = lazy(() => import('../pages/TraceabilityPage').then((m) => ({ default: m.TraceabilityPage ?? m.default })));
const CustomersPage    = lazy(() => import('../pages/CustomersPage').then((m) => ({ default: m.CustomersPage ?? m.default })));
const VendorsPage      = lazy(() => import('../pages/VendorsPage').then((m) => ({ default: m.VendorsPage ?? m.default })));
const DSRPage          = lazy(() => import('../pages/DSRPage').then((m) => ({ default: m.DSRPage ?? m.default })));
const SalesRepPage     = lazy(() => import('../pages/SalesRepPage').then((m) => ({ default: m.SalesRepPage ?? m.default })));
const FinancialsPage   = lazy(() => import('../pages/FinancialsPage').then((m) => ({ default: m.FinancialsPage ?? m.default })));
const InvoicesPage     = lazy(() => import('../pages/InvoicesPage').then((m) => ({ default: m.InvoicesPage ?? m.default })));
const CreditHoldPage   = lazy(() => import('../pages/CreditHoldPage').then((m) => ({ default: m.CreditHoldPage ?? m.default })));
const AnalyticsPage    = lazy(() => import('../pages/AnalyticsPage').then((m) => ({ default: m.AnalyticsPage ?? m.default })));
const ForecastPage     = lazy(() => import('../pages/ForecastPage').then((m) => ({ default: m.ForecastPage ?? m.default })));
const ReportsPage      = lazy(() => import('../pages/ReportsPage').then((m) => ({ default: m.ReportsPage ?? m.default })));
const AIHelpPage       = lazy(() => import('../pages/AIHelpPage').then((m) => ({ default: m.AIHelpPage ?? m.default })));
const UsersPage        = lazy(() => import('../pages/UsersPage').then((m) => ({ default: m.UsersPage ?? m.default })));
const CompaniesPage    = lazy(() => import('../pages/CompaniesPage').then((m) => ({ default: m.CompaniesPage ?? m.default })));
const SettingsPage     = lazy(() => import('../pages/SettingsPage').then((m) => ({ default: m.SettingsPage ?? m.default })));
const IntegrationsPage = lazy(() => import('../pages/IntegrationsPage').then((m) => ({ default: m.IntegrationsPage ?? m.default })));
const CompliancePage   = lazy(() => import('../pages/CompliancePage').then((m) => ({ default: m.CompliancePage ?? m.default })));
const PlanningPage     = lazy(() => import('../pages/PlanningPage').then((m) => ({ default: m.PlanningPage ?? m.default })));
const AuditLogPage     = lazy(() => import('../pages/AuditLogPage').then((m) => ({ default: m.AuditLogPage ?? m.default })));

// ── Nav groups ────────────────────────────────────────────────────────────────

export const navGroups: NavGroup[] = [
  {
    id: 'operations',
    label: 'Operations',
    items: [
      { id: 'dashboard',    label: 'Dashboard',    path: '/dashboard',    icon: LayoutDashboard, component: DashboardPage },
      { id: 'orders',       label: 'Orders',       path: '/orders',       icon: Package,         component: OrdersPage },
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
  if (!item.roles || item.roles.length === 0) return true;
  return item.roles.includes(role);
}

export function canAccessGroup(group: NavGroup, role: Role): boolean {
  return group.items.some((item) => canAccess(item, role));
}
