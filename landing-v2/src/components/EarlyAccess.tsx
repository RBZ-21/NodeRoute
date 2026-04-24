import { ArrowRight } from 'lucide-react';
import { CTA } from '../lib/utils';
import { Section, SectionEyebrow, SectionHeading, SectionLede } from './Section';

export function EarlyAccess() {
  return (
    <Section id="early">
      <div className="divider mb-20" />
      <SectionEyebrow>Early access</SectionEyebrow>
      <SectionHeading>Early stage, on purpose.</SectionHeading>
      <SectionLede>
        NodeRoute is still early. I’m focused on working with a small number of teams who deal
        with real delivery coordination problems and want to help shape the product.
      </SectionLede>
      <p className="mt-4 max-w-3xl text-[16px] leading-relaxed text-white/60 md:text-[17px]">
        If you’re looking for something simpler, more practical, and built around real
        operational pain, I’d love to talk.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <a
          href={CTA.earlyAccess}
          className="group inline-flex items-center gap-1.5 rounded-lg bg-teal px-4 py-2.5 text-[14px] font-semibold text-black hover:bg-teal-light transition-colors"
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
      </div>
    </Section>
  );
}
