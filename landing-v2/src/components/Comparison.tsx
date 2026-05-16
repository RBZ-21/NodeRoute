import { CheckCircle2, CircleSlash } from 'lucide-react';
import { Section, SectionEyebrow, SectionHeading, SectionLede } from './Section';

const rows = [
  {
    label: 'Catch-weight order workflow',
    nodeRoute: 'Built for requested vs actual weights, invoice handoff, and seafood order prep.',
    onfleet: 'Delivery-first workflow; catch-weight handoff usually needs external ops tools.',
    circuit: 'General route workflow with limited weight-entry coordination.',
  },
  {
    label: 'Mollusk lot traceability',
    nodeRoute: 'Lot-aware receiving, invoice lot forwarding, and FSMA-oriented fulfillment support.',
    onfleet: 'Proof-of-delivery focused, not a traceability platform.',
    circuit: 'No native seafood traceability workflow.',
  },
  {
    label: 'Purchasing and receiving',
    nodeRoute: 'Vendor POs, discrepancy logging, receipts, and historical lead-time tracking in one flow.',
    onfleet: 'Requires a separate ERP or ops stack.',
    circuit: 'Requires a separate purchasing workflow.',
  },
  {
    label: 'Cold-chain accountability',
    nodeRoute: 'Temperature logs can be tied to routes and stops, then exported for compliance review.',
    onfleet: 'Possible through notes/forms, but not seafood-specific by default.',
    circuit: 'Possible with process workarounds, not purpose-built.',
  },
  {
    label: 'Multi-company seafood ops',
    nodeRoute: 'Tenant-aware ops, location scoping, warehouse flow, and invoice linkage.',
    onfleet: 'Strong delivery engine, lighter warehouse/processing context.',
    circuit: 'Built primarily for dispatch and route simplicity.',
  },
];

const callouts = [
  'NodeRoute fits seafood distributors that need operations, receiving, invoicing, and route execution in one system.',
  'Onfleet and Circuit are strong route-delivery products, but most seafood-specific receiving and traceability flows still need extra software around them.',
];

function Cell({ tone, children }: { tone: 'highlight' | 'neutral' | 'muted'; children: string }) {
  const toneClass =
    tone === 'highlight'
      ? 'border-teal/25 bg-white text-ink-100'
      : tone === 'neutral'
        ? 'border-black/10 bg-cream text-ink-500'
        : 'border-black/10 bg-white/70 text-ink-500';

  return (
    <div className={`rounded-2xl border p-5 ${toneClass}`}>
      <p className="text-sm leading-relaxed">{children}</p>
    </div>
  );
}

export function Comparison() {
  return (
    <section className="bg-white">
      <Section>
        <div className="divider mb-20" />
        <SectionEyebrow>Competitive fit</SectionEyebrow>
        <SectionHeading className="text-ink-100">Why seafood operators choose NodeRoute over a generic route app.</SectionHeading>
        <SectionLede className="text-ink-400">
          Delivery visibility matters, but seafood teams also need catch-weight handling, receiving,
          cold-chain records, and lot traceability to survive the work after the truck leaves.
        </SectionLede>

        <div className="mt-10 grid gap-4 rounded-[2rem] border border-black/10 bg-cream-dim p-6 md:grid-cols-[1.25fr_1fr_1fr_1fr]">
          <div className="flex items-end">
            <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-400">Workflow</span>
          </div>
          <div className="rounded-2xl border border-teal/25 bg-white p-4">
            <p className="font-display text-[22px] font-semibold tracking-tight text-ink-100">NodeRoute</p>
            <p className="mt-1 text-sm text-ink-500">Seafood operations first</p>
          </div>
          <div className="rounded-2xl border border-black/10 bg-white p-4">
            <p className="font-display text-[22px] font-semibold tracking-tight text-ink-100">Onfleet</p>
            <p className="mt-1 text-sm text-ink-500">Excellent last-mile delivery platform</p>
          </div>
          <div className="rounded-2xl border border-black/10 bg-white p-4">
            <p className="font-display text-[22px] font-semibold tracking-tight text-ink-100">Circuit</p>
            <p className="mt-1 text-sm text-ink-500">Simple route optimization and dispatch</p>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          {rows.map((row) => (
            <div key={row.label} className="grid gap-4 md:grid-cols-[1.25fr_1fr_1fr_1fr]">
              <div className="rounded-2xl border border-black/10 bg-ink-100 p-5 text-white">
                <p className="font-display text-[20px] font-semibold tracking-tight">{row.label}</p>
              </div>
              <Cell tone="highlight">{row.nodeRoute}</Cell>
              <Cell tone="neutral">{row.onfleet}</Cell>
              <Cell tone="muted">{row.circuit}</Cell>
            </div>
          ))}
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {callouts.map((body, index) => (
            <div key={body} className="rounded-2xl border border-black/10 bg-cream p-6">
              <div className="flex items-center gap-3">
                {index === 0 ? (
                  <CheckCircle2 className="h-5 w-5 text-teal" />
                ) : (
                  <CircleSlash className="h-5 w-5 text-ink-400" />
                )}
                <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-400">
                  {index === 0 ? 'Best fit' : 'When generic route tools fall short'}
                </span>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-ink-500">{body}</p>
            </div>
          ))}
        </div>
      </Section>
    </section>
  );
}
