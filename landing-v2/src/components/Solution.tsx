import { MapPin, Clock, Users, Package, Receipt } from 'lucide-react';
import { Section, SectionEyebrow, SectionHeading, SectionLede } from './Section';

const features = [
  {
    icon: MapPin,
    title: 'Route visibility',
    body: 'Keep up with active routes and see where deliveries stand without constant check-ins.',
  },
  {
    icon: Clock,
    title: 'ETA tracking',
    body: 'Make it easier to track timing and respond when customers ask where an order is.',
  },
  {
    icon: Users,
    title: 'Driver coordination',
    body: 'Reduce confusion around handoffs, updates, and day-of delivery changes.',
  },
  {
    icon: Package,
    title: 'Inventory awareness',
    body: 'Keep order and product details tied to the work being delivered.',
  },
  {
    icon: Receipt,
    title: 'Invoices and records',
    body: 'Close the loop with cleaner delivery records and less end-of-day scrambling.',
  },
];

export function Solution() {
  return (
    <Section>
      <div className="divider mb-20" />
      <SectionEyebrow>The approach</SectionEyebrow>
      <SectionHeading>A simpler way to stay on top of the day.</SectionHeading>
      <SectionLede>
        NodeRoute is designed for teams that need better visibility without adding more
        complexity. It gives you one place to track what’s happening, what changed, and what
        still needs attention.
      </SectionLede>

      <div className="mt-12 flex items-center gap-3">
        <span className="h-px flex-1 bg-line" />
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/40">
          What NodeRoute helps you manage
        </span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <div className="mt-8 grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-3">
        {features.map((f) => (
          <div
            key={f.title}
            className="group relative flex flex-col gap-3 bg-ink-100 p-7 transition-colors hover:bg-ink-200"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-line-strong bg-ink-0 text-teal-light">
              <f.icon className="h-[18px] w-[18px]" />
            </span>
            <h3 className="font-display text-[19px] font-semibold leading-tight tracking-tight text-white">
              {f.title}
            </h3>
            <p className="text-[14px] leading-relaxed text-white/55">{f.body}</p>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-teal/0 to-transparent transition-all group-hover:via-teal/40" />
          </div>
        ))}
        <div className="flex flex-col justify-between bg-ink-100 p-7">
          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/50">
            One surface
          </span>
          <p className="mt-3 font-display text-[22px] font-semibold leading-snug tracking-tight text-white">
            Less juggling. More follow-through.
          </p>
          <p className="mt-3 text-[13px] text-white/50">
            Designed to reduce the end-of-day scramble, not add to it.
          </p>
        </div>
      </div>
    </Section>
  );
}
