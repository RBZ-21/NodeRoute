import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from './ui/button';
import {
  ensureSessionExpiryMarker,
  getSessionExpiresAt,
  redirectToLogin,
  renewSession,
  SESSION_RENEWED_EVENT,
  SESSION_WARNING_MS,
} from '../lib/api';

function remainingMinutes(expiresAt: number, now: number) {
  return Math.max(0, Math.ceil((expiresAt - now) / 60_000));
}

export function SessionExpiryBanner() {
  const [now, setNow] = useState(() => Date.now());
  const [renewing, setRenewing] = useState(false);
  const [renewed, setRenewed] = useState(false);

  useEffect(() => {
    ensureSessionExpiryMarker();
    const tick = window.setInterval(() => setNow(Date.now()), 15_000);
    const handleRenewed = () => {
      setRenewed(true);
      setNow(Date.now());
      window.setTimeout(() => setRenewed(false), 4_000);
    };
    window.addEventListener(SESSION_RENEWED_EVENT, handleRenewed);
    return () => {
      window.clearInterval(tick);
      window.removeEventListener(SESSION_RENEWED_EVENT, handleRenewed);
    };
  }, []);

  const expiresAt = getSessionExpiresAt();
  if (!expiresAt) return null;

  const remaining = expiresAt - now;
  const shouldWarn = remaining <= SESSION_WARNING_MS;
  if (!shouldWarn && !renewing && !renewed) return null;

  async function handleRenew() {
    setRenewing(true);
    setRenewed(false);
    const ok = await renewSession();
    setRenewing(false);
    if (!ok) {
      redirectToLogin('Your session expired. Please sign in again.');
    }
  }

  const minutes = remainingMinutes(expiresAt, now);
  const message = renewed
    ? 'Session renewed.'
    : minutes > 0
      ? `Your session will expire in ${minutes} minute${minutes === 1 ? '' : 's'}.`
      : 'Your session may have expired. Renew before continuing.';

  return (
    <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-amber-950 shadow-sm dark:border-amber-800 dark:bg-amber-950 dark:text-amber-50">
      <div className="mx-auto flex w-full max-w-[1420px] flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium" role="status" aria-live="polite">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{message}</span>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="self-start border-amber-500 bg-white text-amber-950 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-50 dark:hover:bg-amber-900 sm:self-auto"
          onClick={() => void handleRenew()}
          disabled={renewing}
        >
          <RefreshCw className={`h-4 w-4 ${renewing ? 'animate-spin' : ''}`} />
          <span className="ml-2">{renewing ? 'Renewing' : 'Renew'}</span>
        </Button>
      </div>
    </div>
  );
}
