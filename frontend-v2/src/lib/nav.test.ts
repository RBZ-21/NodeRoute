import { describe, it, expect } from 'vitest';
import { canAccess, canAccessGroup, findNavItem, navGroups, navRedirects, allNavItems, defaultPath, NAV_ITEM_IDS } from './nav';

describe('findNavItem', () => {
  it('returns the correct item for a known path', () => {
    const item = findNavItem('/dashboard');
    expect(item?.id).toBe('dashboard');
  });

  it('returns the dashboard item for the default path', () => {
    const item = findNavItem(defaultPath);
    expect(item?.id).toBe('dashboard');
  });

  it('returns null for an unknown path', () => {
    expect(findNavItem('/does-not-exist')).toBeNull();
  });

  it('handles trailing slashes', () => {
    expect(findNavItem('/orders/')?.id).toBe('orders');
  });

  it('returns correct item for every defined path', () => {
    for (const item of allNavItems) {
      expect(findNavItem(item.path)?.id).toBe(item.id);
    }
  });
});

describe('navGroups integrity', () => {
  it('every item has a non-empty label and path', () => {
    for (const item of allNavItems) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.path.startsWith('/')).toBe(true);
    }
  });

  it('every item has an icon', () => {
    for (const item of allNavItems) {
      expect(item.icon).toBeDefined();
    }
  });

  it('no duplicate ids across all nav items', () => {
    const ids = allNavItems.map((i) => i.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('NAV_ITEM_IDS keys match sidebar nav item ids', () => {
    const navIds = allNavItems.map((i) => i.id).sort();
    const stableIds = Object.values(NAV_ITEM_IDS).sort();
    expect(stableIds).toEqual(navIds);
  });

  it('no duplicate paths across all nav items', () => {
    const paths = allNavItems.map((i) => i.path);
    const unique = new Set(paths);
    expect(unique.size).toBe(paths.length);
  });

  it('all groups have at least one item', () => {
    for (const group of navGroups) {
      expect(group.items.length).toBeGreaterThan(0);
    }
  });

  it('matches the consolidated group structure', () => {
    expect(navGroups.map((g) => g.label)).toEqual([
      '', 'Dispatch', 'Inventory', 'Customers', 'Financials', 'Insights', 'Admin',
    ]);
    // Dashboard is its own standalone (empty-label) group above Dispatch.
    const home = navGroups.find((g) => g.id === 'home');
    expect(home?.items.map((i) => i.id)).toEqual(['dashboard']);
    const dispatch = navGroups.find((g) => g.id === 'dispatch');
    expect(dispatch?.items.map((i) => i.id)).toEqual(['orders', 'routes', 'map']);
  });

  it('preserves role guards after the nav consolidation', () => {
    const phoneOrders = allNavItems.find((i) => i.id === 'phone-orders');
    expect(phoneOrders?.roles).toEqual(['admin', 'manager']);
    const companies = allNavItems.find((i) => i.id === 'companies');
    expect(companies?.roles).toEqual(['superadmin']);
  });
});

describe('navRedirects', () => {
  it('redirects retired Deliveries and Stops paths into Routes tabs', () => {
    const byFrom = Object.fromEntries(navRedirects.map((r) => [r.from, r]));
    expect(byFrom['/deliveries']).toMatchObject({ to: '/routes', tab: 'deliveries' });
    expect(byFrom['/stops']).toMatchObject({ to: '/routes', tab: 'stops' });
  });

  it('never shadows a live nav item path', () => {
    const livePaths = new Set(allNavItems.map((i) => i.path));
    for (const redirect of navRedirects) {
      expect(livePaths.has(redirect.from)).toBe(false);
    }
  });
});

describe('canAccess', () => {
  it('superadmin can access every nav item, including role-restricted ones', () => {
    for (const item of allNavItems) {
      expect(canAccess(item, 'superadmin')).toBe(true);
    }
  });

  it('items without a roles array are visible to any role', () => {
    const open = allNavItems.find((i) => !i.roles || i.roles.length === 0)!;
    expect(canAccess(open, 'driver')).toBe(true);
  });

  it('role-restricted items stay hidden from roles not in the list', () => {
    const restricted = allNavItems.find((i) => i.roles?.length && !i.roles.includes('driver'))!;
    expect(canAccess(restricted, 'driver')).toBe(false);
  });
});

describe('warehouse role scoping', () => {
  const inventoryGroupItemIds = ['inventory', 'kits', 'purchasing', 'warehouse', 'traceability'];
  const hiddenItemIds = [
    'orders', 'routes', 'map',
    'customers', 'vendors', 'sales-rep', 'phone-orders',
    'financials', 'pricing', 'invoices', 'credit-hold',
    'analytics', 'dashboard-builder', 'dsr', 'forecasting', 'reports', 'ai-help',
    'superadmin', 'users', 'companies', 'settings', 'integrations', 'compliance', 'planning', 'audit-log',
  ];

  it('can access Dashboard and every item in the Inventory group', () => {
    const dashboard = allNavItems.find((i) => i.id === 'dashboard')!;
    expect(canAccess(dashboard, 'warehouse')).toBe(true);
    for (const id of inventoryGroupItemIds) {
      const item = allNavItems.find((i) => i.id === id)!;
      expect(canAccess(item, 'warehouse')).toBe(true);
    }
  });

  it('cannot access Dispatch, Customers, Financials, Insights, or Admin items', () => {
    for (const id of hiddenItemIds) {
      const item = allNavItems.find((i) => i.id === id)!;
      expect(canAccess(item, 'warehouse')).toBe(false);
    }
  });

  it('sees only Dashboard and Inventory in the group listing', () => {
    const visibleGroupLabels = navGroups
      .filter((g) => canAccessGroup(g, 'warehouse'))
      .map((g) => g.label);
    expect(visibleGroupLabels).toEqual(['', 'Inventory']);
  });
});
