import { NavLink } from 'react-router-dom';
import { classNames } from '@/lib/utils';

const items = [
  { to: '/', label: 'Route' },
  { to: '/stops', label: 'Stops' },
  { to: '/invoices', label: 'Invoices' },
  { to: '/temperature', label: 'Log Temp' },
];

export function BottomNav() {
  return (
    <nav className="sticky bottom-0 z-30 border-t border-slate-200 bg-white/95 px-2 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-2 backdrop-blur">
      <div className="mx-auto grid max-w-md grid-cols-4 gap-2">
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
            {item.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
