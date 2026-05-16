import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/utils';

export function Section({
  id,
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLElement> & { id?: string }) {
  return (
    <section
      id={id}
      className={cn('relative mx-auto max-w-6xl px-6 py-24 md:py-28', className)}
      {...rest}
    >
      {children}
    </section>
  );
}

export function SectionEyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-teal-light">
      <span className="h-px w-6 bg-teal/60" />
      {children}
    </div>
  );
}

export function SectionHeading({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={cn(
        'mt-4 max-w-3xl font-display text-[32px] leading-[1.05] tracking-tightest text-white md:text-[48px] text-balance',
        className
      )}
    >
      {children}
    </h2>
  );
}

export function SectionLede({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        'mt-5 max-w-3xl text-[16px] leading-relaxed text-white/60 md:text-[17px]',
        className
      )}
    >
      {children}
    </p>
  );
}
