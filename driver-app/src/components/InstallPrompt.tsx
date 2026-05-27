import { useInstallPrompt } from '@/hooks/useInstallPrompt';

export function InstallPrompt() {
  const { canInstall, dismissPrompt, install, isIos } = useInstallPrompt();

  if (!canInstall) return null;

  return (
    <div className="rounded-3xl border border-teal-200 bg-seafoam p-4 text-sm text-ink shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">Install NodeRoute Driver</p>
          <p className="mt-1 text-slate-700">
            {isIos
              ? 'Use Share > Add to Home Screen for a full-screen driver experience.'
              : 'Add this app to your home screen for quicker launches and offline route access.'}
          </p>
        </div>
        <button
          type="button"
          onClick={dismissPrompt}
          className="min-h-12 rounded-2xl px-3 text-slate-600"
        >
          Later
        </button>
      </div>
      {!isIos && (
        <button
          type="button"
          onClick={() => void install()}
          className="mt-3 min-h-12 w-full rounded-2xl bg-ocean px-4 py-3 font-semibold text-white"
        >
          Add to Home Screen
        </button>
      )}
    </div>
  );
}
