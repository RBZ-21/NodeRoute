import { Section, SectionEyebrow, SectionHeading } from './Section';

const steps = [
  {
    n: '01',
    title: 'Start with delivery details',
    body: 'Orders, route info, stops, and product details are organized in one place.',
  },
  {
    n: '02',
    title: 'Track the day as it happens',
    body: 'Follow route progress, manage updates, and keep a better handle on ETAs and changes.',
  },
  {
    n: '03',
    title: 'Finish with less cleanup',
    body: 'Keep records organized so invoicing and follow-up are easier to wrap up.',
  },
];

export function HowItWorks() {
  return (
    <Section id="how">
      <div className="divider mb-20" />
      <SectionEyebrow>How it works</SectionEyebrow>
      <SectionHeading>From ticket to invoice, in one flow.</SectionHeading>

      <div className="mt-14 relative">
        <div className="absolute left-0 right-0 top-[34px] hidden h-px bg-line md:block" />
        <ol className="grid gap-8 md:grid-cols-3">
          {steps.map((s) => (
            <li key={s.n} className="relative">
              <div className="flex items-center gap-4">
                <span className="relative flex h-[68px] w-[68px] items-center justify-center rounded-full border border-line bg-ink-100 font-mono text-[13px] text-white/60">
                  <span className="absolute inset-[6px] rounded-full border border-line" />
                  <span className="relative">{s.n}</span>
                </span>
              </div>
              <h3 className="mt-6 font-display text-[22px] font-semibold tracking-tight text-white">
                {s.title}
              </h3>
              <p className="mt-2 text-[14px] leading-relaxed text-white/55">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </Section>
  );
}
