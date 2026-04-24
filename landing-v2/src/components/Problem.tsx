import { PhoneCall, MessageSquare, FileSpreadsheet, Route as RouteIcon } from 'lucide-react';
import { Section, SectionEyebrow, SectionHeading, SectionLede } from './Section';

const signals = [
  {
    icon: PhoneCall,
    title: 'Drivers go quiet',
    body: 'Know where routes stand without constantly calling to check in.',
  },
  {
    icon: MessageSquare,
    title: 'Customers want answers now',
    body: 'Keep ETAs and delivery status easier to track and communicate.',
  },
  {
    icon: FileSpreadsheet,
    title: 'Too many moving parts',
    body: 'Route details, inventory, and invoicing shouldn’t live in five different places.',
  },
  {
    icon: RouteIcon,
    title: 'Orders change mid-route',
    body: 'Changes happen all day — they shouldn’t derail the rest of the run.',
  },
];

export function Problem() {
  return (
    <Section id="product">
      <SectionEyebrow>The problem</SectionEyebrow>
      <SectionHeading>Delivery gets messy fast.</SectionHeading>
      <SectionLede>
        When route updates, customer ETAs, inventory changes, and invoicing all live in
        different places, the day gets harder than it needs to be. Drivers go quiet. Customers
        call for updates. Orders change mid-route. Someone still has to make sure the paperwork
        gets done.
      </SectionLede>

      <div className="mt-10 grid gap-6 md:grid-cols-12">
        <div className="rounded-2xl border border-line bg-ink-100 p-7 md:col-span-7">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-teal-light">
            The pattern
          </p>
          <h3 className="mt-3 font-display text-2xl leading-tight tracking-tight text-white md:text-[28px]">
            If you run deliveries all day, the problems stack up fast.
          </h3>
          <p className="mt-4 text-[15px] leading-relaxed text-white/60">
            You know the pattern. A driver goes quiet. A customer wants an ETA. Inventory
            changes mid-route. Someone needs an invoice. Now you’re bouncing between calls,
            texts, notes, and whatever spreadsheet is still open.
          </p>
          <p className="mt-4 text-[15px] leading-relaxed text-white/60">
            NodeRoute is being built to bring those moving parts into one place, so day-to-day
            operations feel less reactive and more manageable.
          </p>
        </div>

        <div className="grid gap-3 md:col-span-5">
          {signals.map((s) => (
            <div
              key={s.title}
              className="group flex items-start gap-4 rounded-xl border border-line bg-ink-100/60 p-4 transition-colors hover:border-line-strong"
            >
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-ink-200 text-teal-light">
                <s.icon className="h-4 w-4" />
              </span>
              <div>
                <div className="text-[14px] font-semibold text-white">{s.title}</div>
                <div className="mt-1 text-[13px] text-white/55">{s.body}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}
