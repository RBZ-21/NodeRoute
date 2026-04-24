import { useState } from 'react';
import { Plus } from 'lucide-react';
import { cn } from '../lib/utils';
import { Section, SectionEyebrow, SectionHeading } from './Section';

const faqs = [
  {
    q: 'Is NodeRoute live yet?',
    a: 'NodeRoute is in an early stage and currently focused on conversations with potential pilot users and early partners.',
  },
  {
    q: 'Who is it for?',
    a: 'It’s being built for small wholesale and local delivery teams that need better visibility into routes, ETAs, inventory, and delivery follow-through.',
  },
  {
    q: 'Can I see it if I’m interested?',
    a: 'Yes. If the problem sounds familiar, you can request early access or talk directly with the founder.',
  },
];

export function FAQ() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <Section>
      <div className="divider mb-20" />
      <SectionEyebrow>FAQ</SectionEyebrow>
      <SectionHeading>Questions you might have.</SectionHeading>

      <div className="mt-10 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-ink-100">
        {faqs.map((f, i) => {
          const isOpen = open === i;
          return (
            <button
              key={f.q}
              onClick={() => setOpen(isOpen ? null : i)}
              className={cn(
                'group flex w-full items-start justify-between gap-6 px-6 py-6 text-left transition-colors',
                isOpen ? 'bg-ink-200' : 'hover:bg-ink-200/60'
              )}
            >
              <div className="flex-1">
                <h3 className="font-display text-[18px] font-semibold tracking-tight text-white">
                  {f.q}
                </h3>
                <div
                  className={cn(
                    'grid transition-all duration-300',
                    isOpen ? 'mt-3 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                  )}
                >
                  <p className="overflow-hidden text-[14px] leading-relaxed text-white/60">
                    {f.a}
                  </p>
                </div>
              </div>
              <span
                className={cn(
                  'mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line-strong bg-ink-0 text-white/70 transition-transform',
                  isOpen && 'rotate-45 border-teal/50 text-teal-light'
                )}
              >
                <Plus className="h-4 w-4" />
              </span>
            </button>
          );
        })}
      </div>
    </Section>
  );
}
