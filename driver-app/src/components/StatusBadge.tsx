import { formatStatusLabel, statusTone } from '@/lib/utils';

export function StatusBadge({ status }: { status?: string | null }) {
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ring-1 ${statusTone(status)}`}>
      {formatStatusLabel(status)}
    </span>
  );
}
