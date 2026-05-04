import { ChangeEvent, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { StatusBadge } from '@/components/StatusBadge';
import { useDriverApp } from '@/hooks/useDriverApp';
import { useLocationUpdater } from '@/hooks/useLocationUpdater';
import { useToast } from '@/hooks/useToast';
import { formatSchedule } from '@/lib/utils';

async function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Unable to read image file.'));
    reader.readAsDataURL(file);
  });
}

export function StopDetailPage() {
  const { stopId } = useParams();
  const { markArrived, markDelivered, markFailed, stopById, stopItems } = useDriverApp();
  const { sendLocation } = useLocationUpdater(true);
  const { pushToast } = useToast();
  const stop = stopId ? stopById(stopId) : null;
  const [proofImage, setProofImage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<'arrived' | 'delivered' | 'failed' | null>(null);
  const [notes, setNotes] = useState(stop?.driver_notes || '');

  if (!stop) return <Navigate to="/stops" replace />;
  const activeStop = stop;

  const items = stopItems(activeStop);

  async function onCapturePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const image = await fileToBase64(file);
      setProofImage(image);
      pushToast('Proof-of-delivery photo captured.', 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Unable to read the image.', 'error');
    }
  }

  async function runAction(action: 'arrived' | 'delivered' | 'failed') {
    setSubmitting(action);

    try {
      if (action === 'arrived') {
        await markArrived(activeStop);
      }

      if (action === 'delivered') {
        await markDelivered(activeStop, proofImage, notes);
      }

      if (action === 'failed') {
        await markFailed(activeStop, notes);
      }

      await sendLocation();
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Unable to update the stop.', 'error');
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <section className="space-y-4">
      <Link to="/stops" className="inline-flex min-h-12 items-center rounded-2xl bg-white px-4 text-sm font-semibold text-slate-700 shadow-card">
        Back to stops
      </Link>

      <div className="rounded-[2rem] bg-white p-5 shadow-card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Customer</p>
            <h2 className="mt-2 text-2xl font-semibold text-ink">{activeStop.name || 'Customer stop'}</h2>
            <p className="mt-2 text-sm text-slate-600">{activeStop.address || 'Address unavailable'}</p>
          </div>
          <StatusBadge status={activeStop.status} />
        </div>

        <div className="mt-5 space-y-3 rounded-3xl bg-slate-50 p-4 text-sm text-slate-700">
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">Delivery window</span>
            <span>{formatSchedule(activeStop)}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">Door code</span>
            <span>{activeStop.door_code || 'No code on file'}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">Invoice</span>
            <span>{activeStop.invoice_number || 'Not linked'}</span>
          </div>
        </div>
      </div>

      <div className="rounded-[2rem] bg-white p-5 shadow-card">
        <h3 className="text-lg font-semibold text-ink">Items on order</h3>
        {items.length ? (
          <ul className="mt-4 space-y-3 text-sm text-slate-700">
            {items.map((item) => (
              <li key={item} className="rounded-2xl bg-slate-50 px-4 py-3">{item}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-slate-600">No line items were returned for this stop.</p>
        )}
      </div>

      <div className="rounded-[2rem] bg-white p-5 shadow-card">
        <h3 className="text-lg font-semibold text-ink">Proof of delivery</h3>
        <p className="mt-2 text-sm text-slate-600">
          Capture a delivery photo before marking the stop delivered when an invoice is attached.
        </p>
        <label className="mt-4 block">
          <span className="sr-only">Capture proof of delivery photo</span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onCapturePhoto}
            className="block min-h-12 w-full rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-600"
          />
        </label>
        {proofImage && (
          <img
            src={proofImage}
            alt="Proof of delivery preview"
            className="mt-4 h-48 w-full rounded-3xl object-cover"
          />
        )}
      </div>

      <div className="rounded-[2rem] bg-white p-5 shadow-card">
        <h3 className="text-lg font-semibold text-ink">Driver notes</h3>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={4}
          placeholder="Gate instructions, failed-delivery reason, or delivery notes"
          className="mt-4 w-full rounded-3xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-ocean focus:ring-2 focus:ring-ocean/20"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 pb-4">
        <button
          type="button"
          disabled={submitting !== null}
          onClick={() => void runAction('arrived')}
          className="min-h-12 rounded-2xl bg-amber-400 px-4 py-3 text-base font-semibold text-amber-950 disabled:opacity-60"
        >
          {submitting === 'arrived' ? 'Saving arrival...' : 'Mark Arrived'}
        </button>
        <button
          type="button"
          disabled={submitting !== null}
          onClick={() => void runAction('delivered')}
          className="min-h-12 rounded-2xl bg-emerald-500 px-4 py-3 text-base font-semibold text-white disabled:opacity-60"
        >
          {submitting === 'delivered' ? 'Completing stop...' : 'Mark Delivered'}
        </button>
        <button
          type="button"
          disabled={submitting !== null}
          onClick={() => void runAction('failed')}
          className="min-h-12 rounded-2xl bg-rose-500 px-4 py-3 text-base font-semibold text-white disabled:opacity-60"
        >
          {submitting === 'failed' ? 'Saving failure...' : 'Mark Failed'}
        </button>
      </div>
    </section>
  );
}
