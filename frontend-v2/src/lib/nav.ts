/**
 * nav.ts — central navigation configuration.
 *
 * Each entry describes one item in the sidebar.
 * The `roles` array controls visibility (empty = all roles).
 */

export interface NavItem {
  label: string;
  path: string;
  icon: string;
  roles?: string[];
  badge?: string;
}

export interface NavGroup {
  group: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    group: 'Operations',
    items: [
      { label: 'Dashboard',    path: '/dashboard',    icon: '📊' },
      { label: 'Orders',       path: '/orders',       icon: '📦' },
      { label: 'Routes',       path: '/routes',       icon: '🗺️' },
      { label: 'Deliveries',   path: '/deliveries',   icon: '🚚' },
      { label: 'Stops',        path: '/stops',        icon: '📍' },
      { label: 'Map',          path: '/map',          icon: '🌍' },
    ],
  },
  {
    group: 'Inventory',
    items: [
      { label: 'Inventory',    path: '/inventory',    icon: '🏭' },
      { label: 'Purchasing',   path: '/purchasing',   icon: '🛒' },
      { label: 'Warehouse',    path: '/warehouse',    icon: '🏗️' },
      { label: 'Traceability', path: '/traceability', icon: '🔍' },
    ],
  },
  {
    group: 'Customers',
    items: [
      { label: 'Customers',    path: '/customers',    icon: '👥' },
      { label: 'Vendors',      path: '/vendors',      icon: '🤝' },
      { label: 'DSR',          path: '/dsr',          icon: '📋' },
      { label: 'Sales Rep',    path: '/sales-rep',    icon: '💼' },
    ],
  },
  {
    group: 'Financials',
    items: [
      { label: 'Financials',   path: '/financials',   icon: '💰' },
      { label: 'Invoices',     path: '/invoices',     icon: '🧾' },
      { label: 'Credit Hold',  path: '/credit-hold',  icon: '🔒', roles: ['admin', 'manager'] },
    ],
  },
  {
    group: 'Intelligence',
    items: [
      { label: 'Analytics',    path: '/analytics',    icon: '📈' },
      { label: 'Forecasting',  path: '/forecasting',  icon: '🔮' },
      { label: 'Reports',      path: '/reports',      icon: '📄' },
      { label: 'AI Help',      path: '/ai-help',      icon: '🤖' },
    ],
  },
  {
    group: 'Admin',
    items: [
      { label: 'Users',        path: '/users',        icon: '👤', roles: ['admin', 'superadmin'] },
      { label: 'Companies',    path: '/companies',    icon: '🏢', roles: ['superadmin'] },
      { label: 'Settings',     path: '/settings',     icon: '⚙️' },
      { label: 'Integrations', path: '/integrations', icon: '🔌', roles: ['admin'] },
      { label: 'Compliance',   path: '/compliance',   icon: '✅',      roles: ['admin', 'manager'] },
      { label: 'Planning',     path: '/planning',     icon: '📅' },
      { label: 'Audit Log',    path: '/audit-log',    icon: '🔎', roles: ['admin', 'superadmin'] },
    ],
  },
];
