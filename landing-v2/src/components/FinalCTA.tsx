import { WaitlistForm } from './WaitlistForm';

export function FinalCTA() {
  return (
    <section className="relative mx-auto max-w-6xl px-6 pt-4 pb-28">
      <div className="relative overflow-hidden rounded-3xl border border-line-strong bg-ink-100 p-10 md:p-14">
        <div className="pointer-events-none absolute inset-0 bg-radial-teal opacity-60" />
        <div className="pointer-events-none absolute inset-0 bg-grid-faint [background-size:40px_40px] opacity-40" />
        <div className="relative">
          <div className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-teal-light">
            <span className="h-px w-6 bg-teal/60" />
            Still running deliveries through spreadsheets?
          </div>
          <h2 className="mt-5 max-w-3xl font-display text-[34px] leading-[1.05] tracking-tightest text-white md:text-[52px] text-balance">
            Still running deliveries through calls, texts, and spreadsheets?
          </h2>
          <p className="mt-5 max-w-2xl text-[16px] leading-relaxed text-white/65 md:text-[18px]">
            If that sounds familiar, NodeRoute may be a fit. I’m looking to work with a small
            number of early teams who want a better way to manage daily delivery operations.
          </p>
          <div className="mt-8">
            <WaitlistForm source="final-cta" />
          </div>
          <p className="mt-4 text-[13px] text-white/35">
            Prefer email?{' '}
            <a
              href="mailto:ryan@noderoutesystems.com?subject=NodeRoute%20-%20Talk%20to%20the%20Founder"
              className="underline hover:text-white/60 transition-colors"
            >
              Talk directly to the founder.
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}
