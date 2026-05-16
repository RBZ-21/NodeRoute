import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import type { ToastMessage, ToastTone } from '@/types';
import { classNames } from '@/lib/utils';

type ToastContextValue = {
  pushToast: (title: string, tone?: ToastTone) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const toneClasses: Record<ToastTone, string> = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  error: 'border-rose-200 bg-rose-50 text-rose-900',
  info: 'border-slate-200 bg-white text-slate-800',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  function pushToast(title: string, tone: ToastTone = 'info') {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((current) => [...current, { id, title, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3500);
  }

  return (
    <ToastContext.Provider value={{ pushToast }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-4 z-50 mx-auto flex w-full max-w-sm flex-col gap-2 px-4">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={classNames(
              'pointer-events-auto rounded-2xl border px-4 py-3 text-sm font-medium shadow-card backdrop-blur',
              toneClasses[toast.tone]
            )}
          >
            {toast.title}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}
