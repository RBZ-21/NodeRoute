import { Section, SectionEyebrow, SectionHeading } from './Section';

export function Founder() {
  return (
    <Section id="about">
      <div className="divider mb-20" />
      <SectionEyebrow>Founder</SectionEyebrow>
      <SectionHeading>Why I’m building NodeRoute.</SectionHeading>

      <div className="mt-10 grid gap-10 md:grid-cols-12">
        <div className="md:col-span-8 space-y-5 text-[16px] leading-relaxed text-white/65 md:text-[17px]">
          <p>
            I’ve seen how messy delivery operations can get when important details are spread
            across calls, texts, paper notes, and spreadsheets.
          </p>
          <p>
            NodeRoute started from a simple idea: smaller delivery teams deserve a better way
            to manage the day without adding more complexity.
          </p>
          <p>
            I’m building it as an early-stage product for operators who need better visibility
            into routes, inventory, ETAs, and follow-through.
          </p>
        </div>

        <aside className="md:col-span-4">
          <div className="rounded-2xl border border-line bg-ink-100 p-6">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full border border-line-strong bg-ink-200 font-display text-[15px] font-semibold text-teal-light">
                R
              </span>
              <div>
                <div className="text-[14px] font-semibold text-white">Ryan</div>
                <div className="text-[12px] text-white/50">Founder — NodeRoute Systems</div>
              </div>
            </div>
            <p className="mt-5 text-[13px] leading-relaxed text-white/55">
              Built by a founder solving a problem he’s seen up close.
            </p>
            <a
              href="mailto:ryan@noderoutesystems.com?subject=NodeRoute%20-%20Talk%20to%20the%20Founder"
              className="mt-5 inline-flex items-center gap-1 text-[13px] font-semibold text-teal-light hover:text-teal"
            >
              Talk to the founder →
            </a>
          </div>
        </aside>
      </div>
    </Section>
  );
}
