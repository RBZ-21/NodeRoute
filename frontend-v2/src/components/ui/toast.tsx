import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Toast / transient feedback system.
 *
 * Use for transient action feedback — "Order created", "Could not save", etc.
 * Do NOT use for persistent messages that must stay on screen: data-fetch
 * errors with a retry, or inline form-field validation. Those belong inline.
 *
 *   const toast = useToast();
 *   toast.success('Order created.');
 *   toast.error('Could not save order.');
 *
 * The context has a no-op default, so components using `useToast()` outside a
 * <ToastProvider> (e.g. in unit tests) never crash — the toasts simply don't
 * render. Mount <ToastProvider> once at the app root to enable them.
 */

type ToastVariant = 'success' | 'error' | 'info';
type ToastItem = { id: string; variant: ToastVariant; message: string };

export type ToastApi = {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  dismiss: (id: string) => void;
};

const noop: ToastApi = { success: () => {}, error: () => {}, info: () => {}, dismiss: () => {} };
const ToastContext = createContext<ToastApi>(noop);

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `toast-${counter}-${Date.now()}`;
}

const DURATION: Record<ToastVariant, number> = { success: 4000, info: 4500, error: 6000 };
const MAX_STACK = 4;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Clear any pending auto-dismiss timers on unmount (avoids setState-after-unmount).
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const id of Object.keys(pending)) clearTimeout(pending[id]);
    };
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const timer = timers.current[id];
    if (timer) {
      clearTimeout(timer);
      delete timers.current[id];
    }
  }, []);

  const push = useCallback((variant: ToastVariant, message: string) => {
    const text = String(message ?? '').trim();
    if (!text) return;
    const id = nextId();
    setToasts((list) => [...list.slice(-(MAX_STACK - 1)), { id, variant, message: text }]);
    timers.current[id] = setTimeout(() => dismiss(id), DURATION[variant]);
  }, [dismiss]);

  const api = useMemo<ToastApi>(() => ({
    success: (m) => push('success', m),
    error: (m) => push('error', m),
    info: (m) => push('info', m),
    dismiss,
  }), [push, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

const VARIANT_STYLES: Record<ToastVariant, string> = {
  success: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
  error: 'border-destructive/30 bg-destructive/10 text-destructive',
  info: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200',
};

const VARIANT_ICON: Record<ToastVariant, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

function Toaster({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: string) => void }) {
  if (typeof document === 'undefined' || toasts.length === 0) return null;
  return createPortal(
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2" aria-live="polite">
      {toasts.map((toast) => {
        const Icon = VARIANT_ICON[toast.variant];
        return (
          <div
            key={toast.id}
            role={toast.variant === 'error' ? 'alert' : 'status'}
            className={cn(
              'pointer-events-auto flex items-start gap-3 rounded-md border px-4 py-3 text-sm shadow-lg',
              VARIANT_STYLES[toast.variant],
            )}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1 whitespace-pre-wrap">{toast.message}</span>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => onDismiss(toast.id)}
              className="shrink-0 rounded p-0.5 opacity-70 transition-opacity hover:opacity-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
