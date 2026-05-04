import { FormEvent, useState } from 'react';
import { useDriverApp } from '@/hooks/useDriverApp';
import { useToast } from '@/hooks/useToast';

export function TemperatureLogPage() {
  const { currentRoute, stopById, submitLog } = useDriverApp();
  const { pushToast } = useToast();
  const currentStop = currentRoute?.stops.find((stop) => stop.status !== 'completed' && stop.status !== 'failed') || currentRoute?.stops[0] || null;
  const [temperature, setTemperature] = useState('');
  const [storageArea, setStorageArea] = useState('Cabin');
  const [checkType, setCheckType] = useState('route');
  const [unit, setUnit] = useState('F');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);

    try {
      const stop = currentStop ? stopById(currentStop.id) : null;
      const contextualNotes = [
        notes.trim(),
        stop?.id ? `stop_id:${stop.id}` : '',
        currentRoute?.id ? `route_id:${currentRoute.id}` : '',
        stop?.name ? `stop_name:${stop.name}` : '',
      ].filter(Boolean).join(' | ');

      await submitLog({
        temperature,
        storage_area: storageArea,
        unit,
        check_type: checkType,
        notes: contextualNotes,
      });

      setTemperature('');
      setNotes('');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Unable to save the temperature log.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="rounded-[2rem] bg-sand p-4 text-sm text-amber-900 shadow-card">
        Logs are submitted to `/api/temperature-logs`. If the backend keeps its current role guard, driver submissions will return a permissions error until that API is opened to drivers.
      </div>

      <div className="rounded-[2rem] bg-white p-5 shadow-card">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Current context</p>
        <h2 className="mt-2 text-xl font-semibold text-ink">{currentRoute?.name || 'No active route'}</h2>
        <p className="mt-2 text-sm text-slate-600">
          {currentStop?.name ? `${currentStop.name} · ${currentStop.address || 'Address unavailable'}` : 'No current stop selected'}
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4 rounded-[2rem] bg-white p-5 shadow-card">
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-slate-700">Temperature</span>
          <input
            value={temperature}
            onChange={(event) => setTemperature(event.target.value)}
            type="number"
            step="0.1"
            required
            className="min-h-12 w-full rounded-2xl border border-slate-200 px-4 text-base outline-none focus:border-ocean focus:ring-2 focus:ring-ocean/20"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-slate-700">Storage area</span>
          <input
            value={storageArea}
            onChange={(event) => setStorageArea(event.target.value)}
            required
            className="min-h-12 w-full rounded-2xl border border-slate-200 px-4 text-base outline-none focus:border-ocean focus:ring-2 focus:ring-ocean/20"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Unit</span>
            <select
              value={unit}
              onChange={(event) => setUnit(event.target.value)}
              className="min-h-12 w-full rounded-2xl border border-slate-200 px-4 text-base outline-none focus:border-ocean focus:ring-2 focus:ring-ocean/20"
            >
              <option value="F">F</option>
              <option value="C">C</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Check type</span>
            <select
              value={checkType}
              onChange={(event) => setCheckType(event.target.value)}
              className="min-h-12 w-full rounded-2xl border border-slate-200 px-4 text-base outline-none focus:border-ocean focus:ring-2 focus:ring-ocean/20"
            >
              <option value="route">Route</option>
              <option value="pickup">Pickup</option>
              <option value="delivery">Delivery</option>
            </select>
          </label>
        </div>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-slate-700">Notes</span>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={4}
            className="w-full rounded-3xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-ocean focus:ring-2 focus:ring-ocean/20"
            placeholder="Include cooler condition, stop issue, or anything operations should see."
          />
        </label>

        <button
          type="submit"
          disabled={submitting}
          className="min-h-12 w-full rounded-2xl bg-ocean px-4 py-3 text-base font-semibold text-white disabled:opacity-60"
        >
          {submitting ? 'Saving log...' : 'Save temperature log'}
        </button>
      </form>
    </section>
  );
}
