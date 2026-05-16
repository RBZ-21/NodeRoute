import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

const ALLOWED_EMAIL = 'rdbrown211@gmail.com';

interface Props {
  onClose: () => void;
}

export function SignupGate({ onClose }: Props) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'denied'>('idle');
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (email.trim().toLowerCase() === ALLOWED_EMAIL) {
      window.location.href = '/login';
    } else {
      setStatus('denied');
    }
  }

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="w-full max-w-md rounded-2xl border border-line-strong bg-ink-200 p-8 shadow-2xl">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="font-display text-[20px] font-semibold text-white">
              Create your account
            </h2>
            <p className="mt-1 text-[13px] text-white/50">
              Enter your email to get started.
            </p>
          </div>
          <button
            onClick={onClose}
            className="ml-4 flex h-7 w-7 items-center justify-center rounded-md text-white/40 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            ref={inputRef}
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setStatus('idle'); }}
            placeholder="you@example.com"
            className="w-full rounded-lg border border-line-strong bg-ink-100 px-4 py-2.5 text-[14px] text-white placeholder-white/30 focus:outline-none focus:border-teal transition-colors"
            required
          />

          {status === 'denied' && (
            <p className="text-[13px] text-amber-400">
              We're not accepting new signups yet. Check back soon or{' '}
              <a
                href="mailto:ryan@noderoutesystems.com?subject=NodeRoute%20-%20Request%20Early%20Access"
                className="underline hover:text-amber-300"
              >
                request early access
              </a>
              .
            </p>
          )}

          <button
            type="submit"
            className="w-full rounded-lg bg-teal py-2.5 text-[14px] font-semibold text-black hover:bg-teal-light transition-colors"
          >
            Continue
          </button>
        </form>
      </div>
    </div>
  );
}
