import { Badge } from './badge';

type StatusTone = 'green' | 'gray' | 'yellow' | 'red' | 'blue';

type StatusBadgeProps = {
  status?: string | null;
  colorMap: Record<string, StatusTone>;
  labelMap?: Record<string, string>;
  fallbackLabel?: string;
};

const toneClassMap: Record<StatusTone, string> = {
  green: '',
  gray: '',
  yellow: '',
  red: 'bg-red-100 text-red-700',
  blue: 'bg-blue-100 text-blue-700',
};

function normalizeStatus(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
}

function titleCaseStatus(value: string): string {
  if (!value) return 'Unknown';
  return value
    .split('-')
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function toneVariant(tone: StatusTone): 'success' | 'neutral' | 'warning' | 'secondary' {
  if (tone === 'green') return 'success';
  if (tone === 'gray') return 'neutral';
  if (tone === 'yellow') return 'warning';
  return 'secondary';
}

export function StatusBadge({ status, colorMap, labelMap, fallbackLabel = 'Unknown' }: StatusBadgeProps) {
  const normalized = normalizeStatus(status);
  const tone = colorMap[normalized];
  const label = labelMap?.[normalized] || titleCaseStatus(normalized) || fallbackLabel;

  if (!tone) {
    return <Badge variant="secondary">{label || fallbackLabel}</Badge>;
  }

  return (
    <Badge variant={toneVariant(tone)} className={toneClassMap[tone]}>
      {label}
    </Badge>
  );
}
