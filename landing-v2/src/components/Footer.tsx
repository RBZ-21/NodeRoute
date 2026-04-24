export function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="flex flex-col gap-10 md:flex-row md:items-start md:justify-between">
          <div className="max-w-md">
            <div className="flex items-center gap-2">
              <span className="relative inline-flex h-7 w-7 items-center justify-center rounded-md border border-line-strong bg-ink-200">
                <span className="absolute inset-[5px] rounded-[3px] border border-teal/60" />
                <span className="relative h-1.5 w-1.5 rounded-full bg-teal" />
              </span>
              <span className="font-display text-[16px] font-semibold tracking-tight text-white">
                NodeRoute
              </span>
              <span className="rounded-md border border-line px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-white/50">
                Systems
              </span>
            </div>
            <p className="mt-4 text-[13px] leading-relaxed text-white/50">
              Delivery operations software for small wholesale and local distribution teams.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-10 md:grid-cols-3">
            <FooterCol
              title="Product"
              links={[
                { label: 'Overview', href: '#product' },
                { label: 'How it works', href: '#how' },
                { label: 'Early access', href: '#early' },
              ]}
            />
            <FooterCol
              title="Company"
              links={[
                { label: 'About', href: '#about' },
                { label: 'Talk to founder', href: 'mailto:ryan@noderoutesystems.com' },
              ]}
            />
            <FooterCol
              title="Account"
              links={[
                { label: 'Login', href: '/login' },
                {
                  label: 'Request access',
                  href: 'mailto:ryan@noderoutesystems.com?subject=NodeRoute%20-%20Request%20Early%20Access',
                },
              ]}
            />
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-line pt-6 md:flex-row md:items-center md:justify-between">
          <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/40">
            © {new Date().getFullYear()} NodeRoute Systems
          </div>
          <div className="text-[13px] text-white/50">
            Questions?{' '}
            <a
              href="mailto:ryan@noderoutesystems.com?subject=NodeRoute%20-%20Talk%20to%20the%20Founder"
              className="text-teal-light hover:text-teal"
            >
              Talk directly with the founder.
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({
  title,
  links,
}: {
  title: string;
  links: { label: string; href: string }[];
}) {
  return (
    <div>
      <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/40">
        {title}
      </div>
      <ul className="mt-4 space-y-2.5">
        {links.map((l) => (
          <li key={l.label}>
            <a
              href={l.href}
              className="text-[13px] text-white/70 hover:text-white transition-colors"
            >
              {l.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
