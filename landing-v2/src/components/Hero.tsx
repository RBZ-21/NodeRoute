import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { CTA } from '../lib/utils';

const stops = [
  { label: 'Active stops', value: '12' },
  { label: 'Routes in progress', value: '3' },
  { label: 'ETA updates pending', value: '2' },
  { label: 'Invoices ready to close', value: '1' },
];

export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-radial-teal opacity-70" />
      <div className="pointer-events-none absolute inset-0 bg-grid-faint [background-size:56px_56px] mask-fade-b opacity-60" />

      <div className="relative mx-auto max-w-6xl px-6 pt-20 pb-24 md:pt-28 md:pb-32">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex flex-col items-start"
        >
          <EyebrowTag />
          <h1 className="mt-6 max-w-4xl font-display text-[44px] leading-[1.02] tracking-tightest text-white md:text-[68px] text-balance">
            Delivery operations software
            <br className="hidden md:block" />{' '}
            <span className="gradient-text-teal">without the usual chaos.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-[17px] leading-relaxed text-white/60 md:text-[19px]">
            NodeRoute helps you manage routes, ETAs, drivers, inventory, and invoices in one
            place — so you’re not running the whole day through calls, texts, and spreadsheets.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href={CTA.earlyAccess}
              className="group inline-flex items-center gap-1.5 rounded-lg bg-teal px-4 py-2.5 text-[14px] font-semibold text-black transition-all hover:bg-teal-light"
            >
              Request Early Access
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </a>
            <a
              href={CTA.founder}
              className="inline-flex items-center rounded-lg border border-line-strong bg-ink-100 px-4 py-2.5 text-[14px] font-semibold text-white hover:border-white/30 transition-colors"
            >
              Talk to the Founder
            </a>
            <a
              href={CTA.login}
              className="inline-flex items-center rounded-lg px-4 py-2.5 text-[14px] font-semibold text-white/70 hover:text-white transition-colors"
            >
              Login →
            </a>
          </div>

          <p className="mt-5 text-[13px] text-white/45">
            Early-stage and built with real operators in mind.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.15 }}
          className="mt-16"
        >
          <LiveOpsCard />
        </motion.div>
      </div>
    </section>
  );
}

function EyebrowTag() {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-line-strong bg-ink-100/60 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-white/70 backdrop-blur">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full rounded-full bg-teal opacity-60 animate-ping" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-teal" />
      </span>
      Built for small wholesale and local delivery teams
    </div>
  );
}

function LiveOpsCard() {
  return (
    <div className="relative rounded-2xl border border-line-strong bg-ink-100/80 p-1.5 shadow-[0_30px_120px_-40px_rgba(61,186,127,0.25)]">
      <div className="rounded-xl border border-line bg-ink-200">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-teal animate-pulse-dot" />
            <span className="font-mono text-[11px] uppercase tracking-widest text-white/60">
              Live operations view
            </span>
          </div>
          <div className="hidden sm:flex items-center gap-3 font-mono text-[11px] text-white/40">
            <span>route · map · queue</span>
            <span className="h-1 w-1 rounded-full bg-white/20" />
            <span>today</span>
          </div>
        </div>

        <div className="grid grid-cols-2 divide-x divide-line md:grid-cols-4">
          {stops.map((s) => (
            <div key={s.label} className="p-5 md:p-6">
              <div className="font-display text-4xl font-semibold tracking-tight text-white md:text-5xl">
                {s.value}
              </div>
              <div className="mt-2 text-[13px] text-white/55">{s.label}</div>
            </div>
          ))}
        </div>

        <div className="border-t border-line px-5 py-4">
          <div className="flex flex-wrap items-center gap-3 text-[12px] text-white/50">
            <PillDot color="teal" label="On time" />
            <PillDot color="amber" label="Needs ETA update" />
            <PillDot color="white" label="Closed today" />
            <span className="ml-auto font-mono text-white/40">updated just now</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function PillDot({
  color,
  label,
}: {
  color: 'teal' | 'amber' | 'white';
  label: string;
}) {
  const cls =
    color === 'teal'
      ? 'bg-teal'
      : color === 'amber'
      ? 'bg-amber-400'
      : 'bg-white/70';
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1">
      <span className={`h-1.5 w-1.5 rounded-full ${cls}`} />
      {label}
    </div>
  );
}
