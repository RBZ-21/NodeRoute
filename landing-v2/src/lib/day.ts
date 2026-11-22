// A sample delivery day. Every event here is illustrative and labelled
// "Sample day" on the page: these are not customer figures.
//
// Each event appears twice on the page: as a card on the left pile (how it
// lands when the day runs through calls, texts and spreadsheets) and as one
// resolved line on the right log (the same moment handled on NodeRoute).

export type PileKind =
  | 'Missed call'
  | 'Text'
  | 'Voicemail'
  | 'Spreadsheet'
  | 'Sticky note'
  | 'Clipboard';

export interface DayEvent {
  /** minutes after midnight */
  t: number;
  kind: PileKind;
  from: string;
  pile: string;
  log: string;
}

const hm = (h: number, m: number) => h * 60 + m;

/** Timeline anchors, in minutes after midnight. */
export const DAY = {
  start: hm(4, 12), // load-out
  morningEnd: hm(11, 30), // end of act 2
  closeStart: hm(13, 30), // start of act 6
  end: hm(17, 40), // books closed
} as const;

export const MORNING: DayEvent[] = [
  {
    t: hm(5, 2),
    kind: 'Missed call',
    from: 'Driver 2',
    pile: 'Running 20 minutes behind. Can someone call Harbor Grill?',
    log: 'Route 2 running late. Harbor Grill ETA moved to 6:20.',
  },
  {
    t: hm(6, 15),
    kind: 'Missed call',
    from: 'Bayside Market (2 calls)',
    pile: 'Where is our order?',
    log: 'Bayside Market asked for an ETA. Answered from the route: stop 4, about 25 minutes.',
  },
  {
    t: hm(6, 48),
    kind: 'Text',
    from: 'Warehouse',
    pile: 'Do we have 40 lb of littlenecks for today or not?',
    log: 'Littlenecks checked against today’s orders. 40 lb allocated to stop 7.',
  },
  {
    t: hm(7, 30),
    kind: 'Spreadsheet',
    from: 'routes_FINAL_v3.xlsx',
    pile: 'Two versions open. Which one did Route 3 get?',
    log: 'Route 3 stop order changed. The driver sees the new order.',
  },
  {
    t: hm(8, 55),
    kind: 'Voicemail',
    from: 'The Oyster Bar',
    pile: 'Add two cases of cod to today, if the truck hasn’t left.',
    log: 'Oyster Bar order edited mid-route. Stop 9 updated.',
  },
  {
    t: hm(10, 40),
    kind: 'Sticky note',
    from: 'Front desk',
    pile: 'Driver 3 says stop 11 is closed?? Call back.',
    log: 'Stop 11 marked closed. Route 3 continues to stop 12.',
  },
];

export const AFTERNOON: DayEvent[] = [
  {
    t: hm(14, 10),
    kind: 'Text',
    from: 'Driver 1',
    pile: 'Halibut came in at 38.6, not 40. Fix the invoice?',
    log: 'Halibut invoiced at actual catch weight: 38.6 lb.',
  },
  {
    t: hm(16, 5),
    kind: 'Clipboard',
    from: 'Cooler log',
    pile: 'Truck 2 temp for stop 5. Write it down somewhere.',
    log: 'Truck 2 temperature logged against stop 5.',
  },
];

export const ALL_EVENTS = [...MORNING, ...AFTERNOON];

export function fmtClock(min: number) {
  const m = Math.round(min);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Fraction of the morning act at which an event lands (0..1). */
export const morningAt = (t: number) => (t - DAY.start) / (DAY.morningEnd - DAY.start);

/** In the close act the clock runs over the first CLOSE_CLOCK of progress. */
export const CLOSE_CLOCK = 0.32;
export const closeAt = (t: number) =>
  ((t - DAY.closeStart) / (DAY.end - DAY.closeStart)) * CLOSE_CLOCK;

/** The collapse (divider sweep + filing) runs between these progress values. */
export const SWEEP = { from: 0.36, to: 0.74 } as const;

/** Progress at which pile card i is filed across the divider. */
export const fileAt = (i: number, n: number) =>
  SWEEP.from + (i / Math.max(1, n)) * (SWEEP.to - SWEEP.from - 0.06);
