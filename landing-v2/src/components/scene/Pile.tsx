import type { CSSProperties } from 'react';
import {
  Check,
  ClipboardList,
  FileSpreadsheet,
  MessageSquare,
  PhoneMissed,
  StickyNote,
  Voicemail,
  type LucideIcon,
} from 'lucide-react';
import { fmtClock, type DayEvent, type PileKind } from '../../lib/day';

const ICON: Record<PileKind, LucideIcon> = {
  'Missed call': PhoneMissed,
  Text: MessageSquare,
  Voicemail: Voicemail,
  Spreadsheet: FileSpreadsheet,
  'Sticky note': StickyNote,
  Clipboard: ClipboardList,
};

// Hand-placed so the pile reads as dropped, not gridded. Percent of pile box.
const SPOTS = [
  { x: 2, y: 0, r: -3 },
  { x: 34, y: 5, r: 2.5 },
  { x: 12, y: 20, r: 1.5 },
  { x: 38, y: 27, r: -2 },
  { x: 0, y: 42, r: -1.5 },
  { x: 30, y: 49, r: 3 },
  { x: 14, y: 63, r: -2.5 },
  { x: 36, y: 70, r: 1 },
];

type Vars = CSSProperties & Record<`--${string}`, string | number>;

export function PileCard({
  event,
  index,
  at,
  fileAt,
}: {
  event: DayEvent;
  index: number;
  /** act progress at which the card lands */
  at: number;
  /** act progress at which it is filed across the divider (close act only) */
  fileAt?: number;
}) {
  const Icon = ICON[event.kind];
  const spot = SPOTS[index % SPOTS.length];
  const style: Vars = {
    '--at': at.toFixed(4),
    '--x': `${spot.x}%`,
    '--y': `${spot.y}%`,
    '--rot': `${spot.r}deg`,
  };
  if (fileAt !== undefined) style['--fat'] = fileAt.toFixed(4);
  return (
    <div className="nr-card" style={style}>
      <div className="nr-card__kind">
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {event.kind}
        <span className="nr-card__time">{fmtClock(event.t)}</span>
      </div>
      <div className="nr-card__from">{event.from}</div>
      <div className="nr-card__text">{event.pile}</div>
    </div>
  );
}

export function LogLine({ event, at, fileAt }: { event: DayEvent; at: number; fileAt?: number }) {
  const style: Vars = { '--at': at.toFixed(4) };
  if (fileAt !== undefined) style['--fat'] = fileAt.toFixed(4);
  return (
    <li style={style}>
      <time>{fmtClock(event.t)}</time>
      <span>{event.log}</span>
      <Check className="nr-log__tick h-4 w-4" aria-label={fileAt !== undefined ? 'Filed' : undefined} aria-hidden={fileAt === undefined} />
    </li>
  );
}
