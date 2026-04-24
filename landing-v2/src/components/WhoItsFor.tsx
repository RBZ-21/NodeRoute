import { Section, SectionEyebrow, SectionHeading, SectionLede } from './Section';

const tags = [
  'Seafood delivery',
  'Produce distribution',
  'Beverage delivery',
  'Local wholesale routes',
  'Multi-stop delivery teams',
];

export function WhoItsFor() {
  return (
    <Section>
      <div className="divider mb-20" />
      <SectionEyebrow>Who it’s for</SectionEyebrow>
      <SectionHeading>
        Built for operators who are still holding too much together by hand.
      </SectionHeading>
      <SectionLede>
        NodeRoute is for small wholesale and local delivery teams that need better visibility
        into routes, ETAs, inventory, and follow-through — without adding another complicated
        system to the mix.
      </SectionLede>

      <div className="mt-10 flex flex-wrap gap-2">
        {tags.map((t) => (
          <span
            key={t}
            className="rounded-full border border-line-strong bg-ink-100 px-3.5 py-1.5 text-[13px] text-white/75 hover:text-white hover:border-teal/50 transition-colors"
          >
            {t}
          </span>
        ))}
      </div>
    </Section>
  );
}
