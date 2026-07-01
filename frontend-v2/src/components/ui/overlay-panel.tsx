import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * SlideOver — right-side drawer for large forms / record detail panels.
 * Modal — centered dialog for compact forms and confirmations.
 *
 * Both:
 *   - call `onClose` for every dismissal path (X button, backdrop click, Escape)
 *   - trap keyboard focus inside the panel and restore focus to the previously
 *     focused element on close (accessibility)
 *   - accept an optional `actions` node rendered in the header (left of the
 *     close button) for record-level actions (Edit / Delete / Save, etc.)
 *   - accept `widthClassName` to override the panel width
 *
 * Callers that need an unsaved-changes warning should perform the confirm()
 * inside their onClose handler so all paths share the same guard.
 */

function useEscapeKey(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active, onClose]);
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Traps Tab focus within `containerRef` while `active`, moves focus inside the
 * panel on open, and restores focus to the previously focused element on close.
 * The container must be focusable (tabIndex={-1}).
 */
export function useFocusTrap(active: boolean, containerRef: RefObject<HTMLElement>) {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusables = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );

    // Move focus into the dialog so keyboard users start inside it.
    const first = focusables()[0];
    (first ?? container).focus({ preventScroll: true });

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        container?.focus({ preventScroll: true });
        return;
      }
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      const activeEl = document.activeElement;
      if (event.shiftKey) {
        if (activeEl === firstEl || activeEl === container || !container?.contains(activeEl)) {
          event.preventDefault();
          lastEl.focus({ preventScroll: true });
        }
      } else if (activeEl === lastEl || !container?.contains(activeEl)) {
        event.preventDefault();
        firstEl.focus({ preventScroll: true });
      }
    }

    container.addEventListener('keydown', onKeyDown);
    return () => {
      container.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, [active, containerRef]);
}

export function SlideOver({
  open,
  title,
  description,
  onClose,
  children,
  actions,
  widthClassName = 'max-w-3xl',
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
  widthClassName?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEscapeKey(open, onClose);
  useFocusTrap(open, panelRef);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/45" onClick={onClose} />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          'absolute inset-y-0 right-0 flex w-full flex-col border-l border-border bg-background shadow-xl outline-none',
          widthClassName,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0 space-y-0.5">
            <h2 className="text-lg font-semibold">{title}</h2>
            {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            <button
              type="button"
              aria-label="Close panel"
              onClick={onClose}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  actions,
  widthClassName = 'max-w-2xl',
  align = 'center',
  contentClassName,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
  widthClassName?: string;
  /** 'bottom' renders as a bottom sheet on mobile, centered from sm up. */
  align?: 'center' | 'bottom';
  contentClassName?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEscapeKey(open, onClose);
  useFocusTrap(open, panelRef);
  if (!open) return null;
  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex justify-center p-4',
        align === 'bottom' ? 'items-end sm:items-center' : 'items-center',
      )}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="absolute inset-0 bg-black/45" onClick={onClose} />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn('relative w-full rounded-xl border border-border bg-background shadow-xl outline-none', widthClassName)}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0 space-y-0.5">
            <h2 className="text-lg font-semibold">{title}</h2>
            {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            <button
              type="button"
              aria-label="Close dialog"
              onClick={onClose}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className={cn('max-h-[75vh] overflow-y-auto px-5 py-4', contentClassName)}>{children}</div>
      </div>
    </div>
  );
}
