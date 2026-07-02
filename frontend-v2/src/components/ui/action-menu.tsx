import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';
import { Button } from './button';

export type ActionMenuItem = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  hidden?: boolean;
};

type ActionMenuProps = {
  items: ActionMenuItem[];
  ariaLabel?: string;
};

function firstEnabledIndex(items: ActionMenuItem[]) {
  const index = items.findIndex((item) => !item.disabled);
  return index >= 0 ? index : 0;
}

export function ActionMenu({ items, ariaLabel = 'Actions' }: ActionMenuProps) {
  const visibleItems = useMemo(() => items.filter((item) => !item.hidden), [items]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  useEffect(() => {
    setHighlighted(firstEnabledIndex(visibleItems));
  }, [visibleItems]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        triggerRef.current &&
        !triggerRef.current.contains(target) &&
        !(menuRef.current && menuRef.current.contains(target))
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!open) return;
    function updateMenuPosition() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const menuWidth = 224;
      const left = Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8));
      setMenuStyle({ top: rect.bottom + 4, left });
    }
    updateMenuPosition();
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function moveHighlight(direction: 1 | -1) {
      if (!visibleItems.length) return;
      let next = highlighted;
      for (let i = 0; i < visibleItems.length; i += 1) {
        next = (next + direction + visibleItems.length) % visibleItems.length;
        if (!visibleItems[next]?.disabled) {
          setHighlighted(next);
          return;
        }
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveHighlight(1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveHighlight(-1);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const item = visibleItems[highlighted];
        if (item && !item.disabled) {
          item.onClick();
          setOpen(false);
        }
      } else if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [highlighted, open, visibleItems]);

  if (!visibleItems.length) return null;

  return (
    <>
      <Button
        ref={triggerRef}
        variant="ghost"
        size="sm"
        className="min-h-11 min-w-11 md:h-9 md:min-h-0 md:w-auto md:min-w-0"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </Button>
      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          role="menu"
          className="fixed z-[9999] w-56 overflow-hidden rounded-md border border-border bg-background py-1 shadow-lg"
          style={{ top: menuStyle.top, left: menuStyle.left }}
        >
          {visibleItems.map((item, index) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onMouseEnter={() => setHighlighted(index)}
              onClick={() => {
                if (item.disabled) return;
                item.onClick();
                setOpen(false);
              }}
              className={[
                'flex w-full min-h-11 items-center px-3 py-2 text-left text-sm transition-colors md:min-h-0',
                index === highlighted ? 'bg-accent text-accent-foreground' : 'hover:bg-accent hover:text-accent-foreground',
                item.destructive ? 'text-destructive' : '',
                item.disabled ? 'cursor-not-allowed opacity-50' : '',
              ].filter(Boolean).join(' ')}
            >
              {item.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
