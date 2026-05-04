import { Link } from 'react-router-dom';
import type { DriverStop } from '@/types';
import { formatSchedule } from '@/lib/utils';
import { StatusBadge } from '@/components/StatusBadge';

export function StopCard({ stop }: { stop: DriverStop }) {
  return (
    <Link
      to={`/stops/${stop.id}`}
      className="block rounded-3xl bg-white p-4 shadow-card transition active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            Stop {stop.position || '—'}
          </p>
          <h3 className="mt-2 text-lg font-semibold text-ink">{stop.name || 'Customer stop'}</h3>
          <p className="mt-2 text-sm text-slate-600">{stop.address || 'Address unavailable'}</p>
        </div>
        <StatusBadge status={stop.status} />
      </div>
      <div className="mt-4 flex items-center justify-between gap-2 rounded-2xl bg-slate-50 px-3 py-3 text-sm text-slate-600">
        <span>{formatSchedule(stop)}</span>
        <span>{stop.door_code ? `Door ${stop.door_code}` : 'No door code'}</span>
      </div>
    </Link>
  );
}
