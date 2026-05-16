import { describe, it, expect } from 'vitest';
import { findNavItem, navGroups, allNavItems, defaultPath } from './nav';

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
});
