import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { cn } from '../../lib/utils';
import { type NavGroup, type Role, defaultPath, findNavItem, navGroups } from '../../lib/nav';

interface SidebarProps {
  role: Role;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function Sidebar({ role, mobileOpen, onMobileClose }: SidebarProps) {
  const location    = useLocation();
  const navigate    = useNavigate();
  const currentItem = findNavItem(location.pathname) ?? findNavItem(defaultPath);

  // Close drawer on route change
  useEffect(() => { onMobileClose(); }, [location.pathname]);

  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  const visibleGroups = navGroups
    .filter((g) => !g.adminOnly || role === 'admin')
    .map((g) => ({
      ...g,
      items: g.items.filter((item) => !item.adminOnly || role === 'admin'),
    }));

  const sidebarContent = (
    <aside className="flex h-full w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-card px-2 py-4">
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

      {visibleGroups.map((group) => (
        <SidebarGroup
          key={group.id}
          group={group}
          activeId={currentItem?.id ?? 'dashboard'}
          onNavigate={navigate}
        />
      ))}
    </aside>
  );

  return (
    <>
      {/* Desktop: always visible */}
      <div className="hidden md:flex h-full">
        {sidebarContent}
      </div>

      {/* Mobile: slide-in drawer with backdrop */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={onMobileClose}
            aria-hidden="true"
          />
          {/* Drawer panel */}
          <div className="relative flex h-full w-56 flex-col bg-card shadow-xl">
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  );
}

function SidebarGroup({
  group,
  activeId,
  onNavigate,
}: {
  group: NavGroup;
  activeId: string;
  onNavigate: (path: string) => void;
}) {
  const hasActive = group.items.some((i) => i.id === activeId);
  const [open, setOpen] = useState(hasActive || group.id === 'core');

  return (
    <div className="mb-1">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:bg-muted/50 transition-colors"
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
          {group.items.map((item) => {
            const Icon     = item.icon;
            const isActive = item.id === activeId;
            return (
              <li key={item.id}>
                <button
                  onClick={() => onNavigate(item.path)}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'group flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-sm transition-colors',
                    isActive
                      ? 'bg-primary/10 font-semibold text-primary'
                      : 'text-foreground hover:bg-muted/60'
                  )}
                >
                  <Icon
                    className={cn(
                      'h-4 w-4 shrink-0 transition-colors',
                      isActive
                        ? 'text-primary'
                        : 'text-muted-foreground group-hover:text-foreground'
                    )}
                    aria-hidden="true"
                  />
                  {item.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
