import { NavLink } from 'react-router-dom';
import { useDriverApp } from '@/hooks/useDriverApp';
import { classNames } from '@/lib/utils';

export function BottomNav() {
  const { queuedStopNoteCount, queuedTemperatureLogCount } = useDriverApp();
  const queuedTotal = queuedStopNoteCount + queuedTemperatureLogCount;
  const items = [
    { to: '/', label: 'Route' },
    { to: '/stops', label: 'Stops' },
    { to: '/invoices', label: 'Invoices' },
    { to: '/temperature', label: 'Log Temp' },
    { to: '/sync', label: 'Sync', badge: queuedTotal > 0 ? String(queuedTotal) : '' },
  ];

  return (
    <nav className="sticky bottom-0 z-30 border-t border-slate-200 bg-white/95 px-2 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-2 backdrop-blur">
      <div className="mx-auto grid max-w-md grid-cols-5 gap-2">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              classNames(
                'flex min-h-12 items-center justify-center rounded-2xl px-2 text-center text-sm font-semibold transition',
                isActive ? 'bg-ocean text-white shadow-card' : 'bg-slate-100 text-slate-700'
              )
            }
          >
            <span className="relative inline-flex items-center justify-center">
              {item.label}
              {item.badge ? (
                <span className="absolute -right-4 -top-2 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">
                  {item.badge}
                </span>
              ) : null}
            </span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
