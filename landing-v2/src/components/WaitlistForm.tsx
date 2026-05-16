import { ArrowRight, CheckCircle, Loader2 } from 'lucide-react';
import { useState } from 'react';

type Status = 'idle' | 'loading' | 'success' | 'duplicate' | 'error';

interface Props {
  source?: string;
  className?: string;
}

export function WaitlistForm({ source = 'landing', className = '' }: Props) {
  const [email,   setEmail]   = useState('');
  const [name,    setName]    = useState('');
  const [company, setCompany] = useState('');
  const [status,  setStatus]  = useState<Status>('idle');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus('loading');

    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email:   email.trim().toLowerCase(),
          name:    name.trim()    || null,
          company: company.trim() || null,
          source,
        }),
      });

      const json = await res.json();

      if (json.status === 'duplicate') { setStatus('duplicate'); return; }
      if (!res.ok) { setStatus('error'); return; }
      setStatus('success');
    } catch {
      setStatus('error');
    }
  }

  if (status === 'success') {
    return (
      <div className={`flex items-center gap-3 rounded-lg border border-teal/40 bg-teal/10 px-5 py-4 text-teal-light ${className}`}>
        <CheckCircle className="h-5 w-5 shrink-0" />
        <span className="text-[14px] font-medium">You’re on the list — check your email for a confirmation.</span>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className={`w-full max-w-md space-y-3 ${className}`}>
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Your name"
          value={name}
          onChange={e => setName(e.target.value)}
          className="flex-1 min-w-0 rounded-lg border border-line-strong bg-ink-100 px-3.5 py-2.5 text-[14px] text-white placeholder:text-white/30 focus:border-teal/60 focus:outline-none transition-colors"
        />
        <input
          type="text"
          placeholder="Company (optional)"
          value={company}
          onChange={e => setCompany(e.target.value)}
          className="flex-1 min-w-0 rounded-lg border border-line-strong bg-ink-100 px-3.5 py-2.5 text-[14px] text-white placeholder:text-white/30 focus:border-teal/60 focus:outline-none transition-colors"
        />
      </div>
      <div className="flex gap-2">
        <input
          type="email"
          required
          placeholder="Work email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          className="flex-1 min-w-0 rounded-lg border border-line-strong bg-ink-100 px-3.5 py-2.5 text-[14px] text-white placeholder:text-white/30 focus:border-teal/60 focus:outline-none transition-colors"
        />
        <button
          type="submit"
          disabled={status === 'loading'}
          className="group inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-teal px-4 py-2.5 text-[14px] font-semibold text-black hover:bg-teal-light transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {status === 'loading'
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <><ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />Request Access</>}
        </button>
      </div>
      {status === 'duplicate' && (
        <p className="text-[13px] text-teal-light">You’re already on the list — I’ll be in touch soon.</p>
      )}
      {status === 'error' && (
        <p className="text-[13px] text-red-400">
          Something went wrong. Try again or email{' '}
          <a href="mailto:ryan@noderoutesystems.com" className="underline">ryan@noderoutesystems.com</a>.
        </p>
      )}
    </form>
  );
}
