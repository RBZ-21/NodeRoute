import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { SignatureCaptureModal } from '@/components/SignatureCaptureModal';
import { StatusBadge } from '@/components/StatusBadge';
import { useDriverApp } from '@/hooks/useDriverApp';
import { useLocationUpdater } from '@/hooks/useLocationUpdater';
import { useToast } from '@/hooks/useToast';
import { clearStopDraft, loadStopDraft, saveStopDraft } from '@/lib/storage';
import { formatSchedule } from '@/lib/utils';
import type { DriverStop } from '@/types';

export const FAILURE_REASON_OPTIONS = [
  'Customer unavailable',
  'Site closed',
  'Access issue',
  'Customer rejected order',
  'Temperature exception',
  'Damaged product',
  'Vehicle issue',
  'Other',
] as const;

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
  const {
    captureSignature,
    companySettings,
    deferStopToEnd,
    isOnline,
    markArrived,
    markDelivered,
    markFailed,
    refreshOfflineDrafts,
    saveStopNotes,
    stopById,
    stopItems,
  } = useDriverApp();
  const { sendLocation } = useLocationUpdater(true);
  const { pushToast } = useToast();
  const stop = stopId ? stopById(stopId) : null;
  const initialDraft = stopId ? loadStopDraft(stopId) : null;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [proofImage, setProofImage] = useState<string | null>(initialDraft?.proofImage || null);
  const [autoDeliverAfterPhoto, setAutoDeliverAfterPhoto] = useState(false);
  const [autoDeliverAfterSignature, setAutoDeliverAfterSignature] = useState(false);
  const [showSignatureCapture, setShowSignatureCapture] = useState(false);
  const [submitting, setSubmitting] = useState<'arrived' | 'delivered' | 'failed' | 'notes' | 'skipped' | null>(null);
  const [notes, setNotes] = useState(initialDraft?.notes || stop?.driver_notes || '');
  const [failureReason, setFailureReason] = useState('');

  if (!stop) return <Navigate to="/stops" replace />;
  const activeStop = stop;

  const items = stopItems(activeStop);
  const signatureRequired = companySettings.forceDriverSignature && !activeStop.invoice_has_signature;
  const proofRequired = companySettings.forceDriverProofOfDelivery && !!activeStop.invoice_id && !activeStop.invoice_has_proof_of_delivery;
  const proofBlockedByMissingInvoice = companySettings.forceDriverProofOfDelivery && !activeStop.invoice_id;
  const needsProofBeforeDelivery = proofRequired && !proofImage;
  const deliveryButtonLabel = signatureRequired && needsProofBeforeDelivery
    ? 'Capture Signature + Photo + Deliver'
    : signatureRequired
      ? 'Capture Signature + Deliver'
      : needsProofBeforeDelivery
        ? 'Capture Photo + Deliver'
        : 'Mark Delivered';

  useEffect(() => {
    if (!stopId) return;
    const draft = loadStopDraft(stopId);
    setProofImage(draft?.proofImage || null);
    setNotes(draft?.notes || activeStop.driver_notes || '');
  }, [stopId, activeStop.id, activeStop.driver_notes]);

  useEffect(() => {
    if (!stopId) return;
    if (!notes.trim() && !proofImage) {
      clearStopDraft(stopId);
      refreshOfflineDrafts();
      return;
    }
    saveStopDraft({
      stopId,
      notes,
      proofImage,
      updatedAt: new Date().toISOString(),
    });
  }, [stopId, notes, proofImage, refreshOfflineDrafts]);

  async function onCapturePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      setAutoDeliverAfterPhoto(false);
      return;
    }

    try {
      const image = await fileToBase64(file);
      setProofImage(image);
      pushToast('Proof-of-delivery photo captured.', 'success');
      event.target.value = '';
      if (autoDeliverAfterPhoto) {
        setAutoDeliverAfterPhoto(false);
        await runAction('delivered', image);
      }
    } catch (error) {
      setAutoDeliverAfterPhoto(false);
      pushToast(error instanceof Error ? error.message : 'Unable to read the image.', 'error');
    }
  }

  function openPhotoCapture(autoDeliver = false) {
    setAutoDeliverAfterPhoto(autoDeliver);
    fileInputRef.current?.click();
  }

  function openSignatureCapture(autoDeliver = false) {
    setAutoDeliverAfterSignature(autoDeliver);
    setShowSignatureCapture(true);
  }

  async function onSaveNotes() {
    if (!stopId) return;
    setSubmitting('notes');
    try {
      await saveStopNotes(stopId, notes);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Unable to save stop notes.', 'error');
    } finally {
      setSubmitting(null);
    }
  }

  async function handleSignatureSaved(signatureData: string, signerName: string) {
    await captureSignature(activeStop, signatureData, signerName);
    setShowSignatureCapture(false);

    if (!autoDeliverAfterSignature) return;

    setAutoDeliverAfterSignature(false);
    const signedStop: DriverStop = {
      ...activeStop,
      invoice_has_signature: true,
    };

    if (proofBlockedByMissingInvoice) {
      pushToast('This stop requires an invoice before a proof-of-delivery photo can be saved.', 'error');
      return;
    }

    if (needsProofBeforeDelivery) {
      openPhotoCapture(true);
      return;
    }

    await runAction('delivered', proofImage, signedStop);
  }

  async function runAction(
    action: 'arrived' | 'delivered' | 'failed' | 'skipped',
    proofImageOverride: string | null = proofImage,
    stopOverride: DriverStop = activeStop,
  ) {
    if (action === 'failed' && !failureReason.trim()) {
      pushToast('Choose an exception reason before marking this stop failed.', 'error');
      return;
    }

    setSubmitting(action);

    try {
      if (action === 'arrived') {
        await markArrived(stopOverride);
      }

      if (action === 'skipped') {
        await deferStopToEnd(stopOverride);
      }

      if (action === 'delivered') {
        await markDelivered(stopOverride, proofImageOverride, notes);
        clearStopDraft(stopOverride.id);
        refreshOfflineDrafts();
        setProofImage(null);
      }

      if (action === 'failed') {
        await markFailed(stopOverride, failureReason, notes);
        clearStopDraft(stopOverride.id);
        refreshOfflineDrafts();
        setProofImage(null);
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
          Capture delivery evidence before you finish the stop so dispatch has what it needs the first time.
        </p>
        {(signatureRequired || proofRequired || proofBlockedByMissingInvoice) && (
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl bg-slate-50 px-3 py-3 text-sm text-slate-700">
              <p className="font-semibold text-slate-900">Signature</p>
              <p className="mt-1">
                {signatureRequired ? 'Required before delivery' : activeStop.invoice_has_signature ? 'Captured' : 'Optional'}
              </p>
            </div>
            <div className="rounded-2xl bg-slate-50 px-3 py-3 text-sm text-slate-700">
              <p className="font-semibold text-slate-900">Delivery photo</p>
              <p className="mt-1">
                {proofBlockedByMissingInvoice
                  ? 'Invoice required before upload'
                  : needsProofBeforeDelivery
                    ? 'Required before delivery'
                    : activeStop.invoice_has_proof_of_delivery || proofImage
                      ? 'Ready to deliver'
                      : 'Optional'}
              </p>
            </div>
            <div className="rounded-2xl bg-slate-50 px-3 py-3 text-sm text-slate-700">
              <p className="font-semibold text-slate-900">Temperature</p>
              <Link to="/temperature" className="mt-1 inline-block font-semibold text-ocean">
                Log temperature check
              </Link>
            </div>
          </div>
        )}
        {needsProofBeforeDelivery && (
          <p className="mt-3 rounded-2xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            Tap the deliver button once to open the camera. After you confirm the photo, the stop will finish automatically.
          </p>
        )}
        {proofBlockedByMissingInvoice && (
          <p className="mt-3 rounded-2xl bg-sand px-3 py-2 text-sm text-amber-900">
            Proof-of-delivery is required for this company, but this stop does not have an invoice attached yet.
          </p>
        )}
        {!isOnline && (
          <p className="mt-3 rounded-2xl bg-sand px-3 py-2 text-sm text-amber-900">
            You are offline. Proof photos and notes will stay on this device until you reconnect and finish the stop.
          </p>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onCapturePhoto}
          className="sr-only"
        />
        <button
          type="button"
          onClick={() => openPhotoCapture(false)}
          className="mt-4 min-h-12 w-full rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-left text-sm font-semibold text-slate-700"
        >
          {proofImage ? 'Retake proof photo' : activeStop.invoice_id ? 'Capture proof photo' : 'Add optional photo'}
        </button>
        <button
          type="button"
          onClick={() => openSignatureCapture(false)}
          className="mt-3 min-h-12 w-full rounded-2xl bg-white px-4 py-3 text-base font-semibold text-slate-800 ring-1 ring-slate-200"
        >
          {activeStop.invoice_has_signature ? 'Replace Signature' : 'Capture Signature'}
        </button>
        {proofImage && (
          <img
            src={proofImage}
            alt="Proof of delivery preview"
            className="mt-4 h-48 w-full rounded-3xl object-cover"
          />
        )}
      </div>

      <div className="rounded-[2rem] bg-white p-5 shadow-card">
        <h3 className="text-lg font-semibold text-ink">Driver notes and exceptions</h3>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={4}
          placeholder="Gate instructions, failed-delivery reason, or delivery notes"
          className="mt-4 w-full rounded-3xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-ocean focus:ring-2 focus:ring-ocean/20"
        />
        <label className="mt-4 block">
          <span className="mb-2 block text-sm font-medium text-slate-700">Exception reason</span>
          <select
            value={failureReason}
            onChange={(event) => setFailureReason(event.target.value)}
            className="min-h-12 w-full rounded-2xl border border-slate-200 px-4 text-base outline-none focus:border-ocean focus:ring-2 focus:ring-ocean/20"
          >
            <option value="">Choose a reason if this stop fails</option>
            {FAILURE_REASON_OPTIONS.map((reason) => (
              <option key={reason} value={reason}>{reason}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={submitting !== null}
          onClick={() => void onSaveNotes()}
          className="mt-4 min-h-12 w-full rounded-2xl bg-white px-4 py-3 text-base font-semibold text-slate-800 ring-1 ring-slate-200 disabled:opacity-60"
        >
          {submitting === 'notes' ? 'Saving notes...' : isOnline ? 'Save Notes' : 'Queue Notes for Sync'}
        </button>
      </div>

      {!isOnline && (
        <div className="rounded-[2rem] bg-white p-4 text-sm text-slate-700 shadow-card">
          Stop status changes still require a connection so arrival time, dwell tracking, and delivery completion stay accurate. You can keep capturing notes and proof offline.
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 pb-4">
        <button
          type="button"
          disabled={submitting !== null || !isOnline}
          onClick={() => void runAction('skipped')}
          className="min-h-12 rounded-2xl bg-white px-4 py-3 text-base font-semibold text-slate-800 ring-1 ring-slate-200 disabled:opacity-60"
        >
          {submitting === 'skipped' ? 'Skipping stop...' : 'Skip - move to end'}
        </button>
        <button
          type="button"
          disabled={submitting !== null || !isOnline}
          onClick={() => void runAction('arrived')}
          className="min-h-12 rounded-2xl bg-amber-400 px-4 py-3 text-base font-semibold text-amber-950 disabled:opacity-60"
        >
          {submitting === 'arrived' ? 'Saving arrival...' : 'Mark Arrived'}
        </button>
        <button
          type="button"
          disabled={submitting !== null || !isOnline}
          onClick={() => {
            if (proofBlockedByMissingInvoice) {
              pushToast('This stop requires an invoice before a proof-of-delivery photo can be saved.', 'error');
              return;
            }
            if (signatureRequired) {
              openSignatureCapture(true);
              return;
            }
            if (needsProofBeforeDelivery) {
              openPhotoCapture(true);
              return;
            }
            void runAction('delivered');
          }}
          className="min-h-12 rounded-2xl bg-emerald-500 px-4 py-3 text-base font-semibold text-white disabled:opacity-60"
        >
          {submitting === 'delivered' ? 'Completing stop...' : deliveryButtonLabel}
        </button>
        <button
          type="button"
          disabled={submitting !== null || !isOnline}
          onClick={() => void runAction('failed')}
          className="min-h-12 rounded-2xl bg-rose-500 px-4 py-3 text-base font-semibold text-white disabled:opacity-60"
        >
          {submitting === 'failed' ? 'Saving failure...' : 'Mark Failed'}
        </button>
      </div>

      {showSignatureCapture && (
        <SignatureCaptureModal
          stopName={activeStop.name}
          onClose={() => {
            setAutoDeliverAfterSignature(false);
            setShowSignatureCapture(false);
          }}
          onSave={handleSignatureSaved}
        />
      )}
    </section>
  );
}
