import { Section, SectionEyebrow, SectionHeading, SectionLede } from './Section';
import { WaitlistForm } from './WaitlistForm';

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
      <div className="mt-8">
        <WaitlistForm source="early-access" />
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
    </Section>
  );
}
