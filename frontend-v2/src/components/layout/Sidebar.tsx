import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, GripVertical, SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { cn } from '../../lib/utils';
import { fetchWithAuth } from '../../lib/api';
import { useAiInsights } from '../../hooks/useAiInsights';
import { useNavigationPreference, useSaveNavigationPreference } from '../../hooks/useUserPreferences';
import {
  type NavGroup, type NavItem, type Role,
  defaultPath, findNavItem, navGroups,
  canAccess, canAccessGroup,
} from '../../lib/nav';

interface SidebarProps {
  role: Role;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function Sidebar({ role, mobileOpen, onMobileClose }: SidebarProps) {
  const location    = useLocation();
  const navigate    = useNavigate();
  const currentItem = findNavItem(location.pathname) ?? findNavItem(defaultPath);

  const { data: phoneOrderDraftCount = 0 } = useQuery({
    queryKey: ['phone-orders-draft-count'],
    queryFn: () =>
      fetchWithAuth<{ count: number }>('/api/phone-orders/draft-count').then((d) => d.count ?? 0),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  // Proactive AI insight counts surface as badges on the pages they concern.
  const { data: aiInsights = [] } = useAiInsights();
  const navigationPreference = useNavigationPreference();
  const saveNavigationPreference = useSaveNavigationPreference();
  const [customizing, setCustomizing] = useState(false);
  const [draftOrder, setDraftOrder] = useState<string[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const insightItemCount = (type: string) =>
    aiInsights
      .filter((i) => i.type === type)
      .reduce((sum, i) => sum + (typeof i.payload?.count === 'number' ? i.payload.count : 1), 0);

  const badgeCounts: Record<string, number> = {
    'phone-orders': phoneOrderDraftCount,
    dashboard: insightItemCount('anomaly'),
    inventory: insightItemCount('reorder'),
    invoices: insightItemCount('collections'),
  };

  useEffect(() => { onMobileClose(); }, [location.pathname, onMobileClose]);

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  // Split groups: bottom-pinned vs normal
  const allVisible = navGroups
    .filter((g) => canAccessGroup(g, role))
    .map((g) => ({
      ...g,
      items: g.items.filter((item) => canAccess(item, role)),
    }))
    .filter((g) => g.items.length > 0);

  const visibleItemIds = allVisible.flatMap((group) => group.items.map((item) => item.id));
  const orderedIds = useMemo(
    () => mergeNavOrder(visibleItemIds, navigationPreference.data?.nav_item_ids || []),
    [visibleItemIds.join('|'), navigationPreference.data?.nav_item_ids?.join('|')],
  );

  useEffect(() => {
    if (!customizing) setDraftOrder(orderedIds);
  }, [customizing, orderedIds]);

  const orderedVisible = applyNavOrder(allVisible, orderedIds);
  const topGroups    = orderedVisible.filter((g) => g.id !== 'bottom');
  const bottomGroups = orderedVisible.filter((g) => g.id === 'bottom');
  const itemsById = new Map(allVisible.flatMap((group) => group.items.map((item) => [item.id, item])));
  const draftItems = draftOrder.map((id) => itemsById.get(id)).filter(Boolean) as NavItem[];

  const activeId = currentItem?.id ?? 'dashboard';

  function startCustomize() {
    setDraftOrder(orderedIds);
    setCustomizing(true);
  }

  function cancelCustomize() {
    setDraftOrder(orderedIds);
    setCustomizing(false);
  }

  async function saveCustomize() {
    await saveNavigationPreference.mutateAsync(draftOrder);
    setCustomizing(false);
  }

  function moveDraftItem(itemId: string, direction: -1 | 1) {
    setDraftOrder((current) => {
      const index = current.indexOf(itemId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  }

  function dropDraftItem(targetId: string) {
    if (!draggingId || draggingId === targetId) return;
    setDraftOrder((current) => {
      const sourceIndex = current.indexOf(draggingId);
      const targetIndex = current.indexOf(targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const next = [...current];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
    setDraggingId(null);
  }

  const sidebarContent = (
    <aside className="flex h-full w-56 shrink-0 flex-col overflow-y-auto border-r border-border bg-card px-2 py-4">
      {/* Mobile close button */}
      <div className="flex items-center justify-between px-3 pb-2 md:hidden">
        <span className="text-xs font-bold uppercase tracking-widest text-primary">Menu</span>
        <button
          onClick={onMobileClose}
          aria-label="Close menu"
          className="rounded-md p-1 text-muted-foreground hover:bg-muted/60"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Scrollable top section */}
      <div className="mb-2 flex items-center justify-between gap-1 px-1">
        <button
          type="button"
          onClick={customizing ? cancelCustomize : startCustomize}
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-semibold text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        >
          {customizing ? <X className="h-3.5 w-3.5" /> : <SlidersHorizontal className="h-3.5 w-3.5" />}
          {customizing ? 'Cancel' : 'Customize'}
        </button>
        {customizing ? (
          <button
            type="button"
            onClick={() => void saveCustomize()}
            disabled={saveNavigationPreference.isPending}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2 text-xs font-semibold text-primary-foreground disabled:opacity-60"
          >
            <Check className="h-3.5 w-3.5" />
            {saveNavigationPreference.isPending ? 'Saving' : 'Save'}
          </button>
        ) : null}
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto">
        {customizing ? (
          <CustomizeNavList
            items={draftItems}
            draggingId={draggingId}
            onDragStart={setDraggingId}
            onDrop={dropDraftItem}
            onMove={moveDraftItem}
          />
        ) : topGroups.map((group) =>
          group.label === '' ? (
            // Flat items — no collapsible header
            <FlatItems
              key={group.id}
              group={group}
              activeId={activeId}
              onNavigate={navigate}
              badgeCounts={badgeCounts}
            />
          ) : (
            <SidebarGroup
              key={group.id}
              group={group}
              activeId={activeId}
              onNavigate={navigate}
              badgeCounts={badgeCounts}
            />
          )
        )}
        {saveNavigationPreference.error ? (
          <div className="mx-2 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-xs text-destructive">
            {(saveNavigationPreference.error as Error).message || 'Could not save menu order.'}
          </div>
        ) : null}
      </div>

      {/* Settings pinned to bottom */}
      {bottomGroups.length > 0 && (
        <div className="mt-2 border-t border-border pt-2">
          {bottomGroups.map((group) => (
            <FlatItems
              key={group.id}
              group={group}
              activeId={activeId}
              onNavigate={navigate}
              badgeCounts={badgeCounts}
            />
          ))}
        </div>
      )}
    </aside>
  );

  return (
    <>
      {/* Desktop: always visible */}
      <div className="hidden md:flex h-full">
        {sidebarContent}
      </div>

      {/* Mobile: slide-in drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={onMobileClose} aria-hidden="true" />
          <div className="relative flex h-full w-56 flex-col bg-card shadow-xl">
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  );
}

function mergeNavOrder(visibleIds: string[], preferredIds: string[]) {
  const visible = new Set(visibleIds);
  const preferred = preferredIds.filter((id, index, all) => visible.has(id) && all.indexOf(id) === index);
  const missing = visibleIds.filter((id) => !preferred.includes(id));
  return [...preferred, ...missing];
}

function applyNavOrder(groups: NavGroup[], orderedIds: string[]) {
  const order = new Map(orderedIds.map((id, index) => [id, index]));
  return groups.map((group) => ({
    ...group,
    items: [...group.items].sort((left, right) => {
      const leftOrder = order.get(left.id) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = order.get(right.id) ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder;
    }),
  }));
}

function CustomizeNavList({
  items,
  draggingId,
  onDragStart,
  onDrop,
  onMove,
}: {
  items: NavItem[];
  draggingId: string | null;
  onDragStart: (id: string | null) => void;
  onDrop: (targetId: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
}) {
  return (
    <ul className="space-y-1 px-1">
      {items.map((item, index) => {
        const Icon = item.icon;
        return (
          <li
            key={item.id}
            draggable
            onDragStart={() => onDragStart(item.id)}
            onDragEnd={() => onDragStart(null)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => onDrop(item.id)}
            className={cn(
              'flex min-h-10 items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5 text-sm shadow-sm',
              draggingId === item.id && 'opacity-60',
            )}
          >
            <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
            <button
              type="button"
              onClick={() => onMove(item.id, -1)}
              disabled={index === 0}
              className="rounded p-1 text-muted-foreground hover:bg-muted/60 disabled:opacity-30"
              aria-label={`Move ${item.label} up`}
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onMove(item.id, 1)}
              disabled={index === items.length - 1}
              className="rounded p-1 text-muted-foreground hover:bg-muted/60 disabled:opacity-30"
              aria-label={`Move ${item.label} down`}
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Renders items directly without a collapsible group header */
function FlatItems({
  group,
  activeId,
  onNavigate,
  badgeCounts = {},
}: {
  group: NavGroup;
  activeId: string;
  onNavigate: (path: string) => void;
  badgeCounts?: Record<string, number>;
}) {
  return (
    <ul className="mb-1 space-y-0.5">
      {group.items.map((item) => (
        <NavItemButton
          key={item.id}
          item={item}
          isActive={item.id === activeId}
          onNavigate={onNavigate}
          badge={badgeCounts[item.id]}
        />
      ))}
    </ul>
  );
}

function SidebarGroup({
  group,
  activeId,
  onNavigate,
  badgeCounts = {},
}: {
  group: NavGroup;
  activeId: string;
  onNavigate: (path: string) => void;
  badgeCounts?: Record<string, number>;
}) {
  const hasActive = group.items.some((i) => i.id === activeId);
  const [open, setOpen] = useState(hasActive);

  return (
    <div className="mb-1">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex w-full items-center justify-between rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors hover:bg-muted/50',
          group.id === 'superadmin'
            ? 'text-violet-500 dark:text-violet-400'
            : 'text-muted-foreground',
        )}
        aria-expanded={open}
      >
        {group.label}
        {open
          ? <ChevronDown className="h-3.5 w-3.5 shrink-0" />
          : <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        }
      </button>

      {open && (
        <ul className="mt-0.5 space-y-0.5">
          {group.items.map((item) => (
            <NavItemButton
              key={item.id}
              item={item}
              isActive={item.id === activeId}
              onNavigate={onNavigate}
              badge={badgeCounts[item.id]}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function NavItemButton({
  item,
  isActive,
  onNavigate,
  badge,
}: {
  item: NavItem;
  isActive: boolean;
  onNavigate: (path: string) => void;
  badge?: number;
}) {
  const Icon = item.icon;
  return (
    <li>
      <button
        onClick={() => onNavigate(item.path)}
        aria-current={isActive ? 'page' : undefined}
        className={cn(
          'group flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-sm transition-colors',
          isActive
            ? 'bg-primary/10 font-semibold text-primary'
            : 'text-foreground hover:bg-muted/60',
        )}
      >
        <Icon
          className={cn(
            'h-4 w-4 shrink-0 transition-colors',
            isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground',
          )}
          aria-hidden="true"
        />
        <span className="flex-1">{item.label}</span>
        {badge != null && badge > 0 && (
          <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-xs font-semibold leading-none text-white">
            {badge}
          </span>
        )}
      </button>
    </li>
  );
}
