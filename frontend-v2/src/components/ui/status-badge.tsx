import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { Badge } from './badge';

type StatusTone = 'green' | 'gray' | 'yellow' | 'red' | 'blue' | 'purple' | 'orange';

type StatusBadgeProps = {
  status?: string | null;
  colorMap: Record<string, StatusTone>;
  labelMap?: Record<string, string>;
  fallbackLabel?: string;
  className?: string;
  /** Overrides the computed label — for badges whose text includes data beyond the status itself (e.g. "High 82/100"). Color is still driven by `status`. */
  children?: ReactNode;
};

const toneClassMap: Record<StatusTone, string> = {
  green: '',
  gray: '',
  yellow: '',
  red: 'bg-red-100 text-red-700',
  blue: 'bg-blue-100 text-blue-700',
  purple: 'bg-violet-100 text-violet-700',
  orange: 'bg-orange-100 text-orange-700',
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

export function StatusBadge({ status, colorMap, labelMap, fallbackLabel = 'Unknown', className, children }: StatusBadgeProps) {
  const normalized = normalizeStatus(status);
  const tone = colorMap[normalized];
  const label = children ?? (labelMap?.[normalized] || titleCaseStatus(normalized) || fallbackLabel);

  if (!tone) {
    return <Badge variant="secondary" className={className}>{label || fallbackLabel}</Badge>;
  }

  return (
    <Badge variant={toneVariant(tone)} className={cn(toneClassMap[tone], className)}>
      {label}
    </Badge>
  );
}
