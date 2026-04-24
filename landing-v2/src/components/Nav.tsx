import { useEffect, useState } from 'react';
import { cn, CTA } from '../lib/utils';

const navLinks = [
  { href: '#product', label: 'Product' },
  { href: '#how', label: 'How it works' },
  { href: '#about', label: 'About' },
  { href: '#early', label: 'Early Access' },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={cn(
        'sticky top-0 z-50 transition-all duration-200',
        scrolled
          ? 'backdrop-blur-md bg-black/70 border-b border-line'
          : 'bg-transparent border-b border-transparent'
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <a href="#top" className="flex items-center gap-2">
          <Logo />
          <span className="hidden sm:inline font-display text-[15px] font-semibold tracking-tight text-white">
            NodeRoute
          </span>
          <span className="hidden sm:inline ml-1 rounded-md border border-line-strong px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-white/60">
            v2
          </span>
        </a>

        <nav className="hidden md:flex items-center gap-1">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="px-3 py-2 text-[13px] font-medium text-white/60 hover:text-white transition-colors"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <a
            href={CTA.login}
            className="hidden sm:inline-flex items-center rounded-lg px-3 py-2 text-[13px] font-medium text-white/70 hover:text-white transition-colors"
          >
            Login
          </a>
          <a
            href={CTA.earlyAccess}
            className="inline-flex items-center rounded-lg bg-teal px-3.5 py-2 text-[13px] font-semibold text-black hover:bg-teal-light transition-colors"
          >
            Request Early Access
          </a>
        </div>
      </div>
    </header>
  );
}

function Logo() {
  return (
    <span className="relative inline-flex h-7 w-7 items-center justify-center rounded-md border border-line-strong bg-ink-200">
      <span className="absolute inset-[5px] rounded-[3px] border border-teal/60" />
      <span className="relative h-1.5 w-1.5 rounded-full bg-teal animate-pulse-dot" />
    </span>
  );
}
