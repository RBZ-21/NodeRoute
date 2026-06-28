import { useRef, useState } from 'react';

type SignatureCaptureModalProps = {
  stopName?: string | null;
  onClose: () => void;
  onSave: (signatureData: string, signerName: string) => Promise<void>;
};

function emptyCanvas(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d');
  if (!context) return;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
}

export function SignatureCaptureModal({ stopName, onClose, onSave }: SignatureCaptureModalProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [signerName, setSignerName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function getPoint(event: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    // The canvas is displayed at CSS size (w-full) but draws into a fixed
    // 360x180 buffer. Scale pointer coordinates from displayed space into
    // buffer space so strokes are not offset or distorted on any screen width.
    const scaleX = rect.width ? canvas.width / rect.width : 1;
    const scaleY = rect.height ? canvas.height / rect.height : 1;
    const source = 'touches' in event ? event.touches[0] : event;
    return {
      x: (source.clientX - rect.left) * scaleX,
      y: (source.clientY - rect.top) * scaleY,
    };
  }

  function ensureCanvasReady() {
    const canvas = canvasRef.current;
    if (canvas) emptyCanvas(canvas);
  }

  function startDrawing(event: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    event.preventDefault();
    ensureCanvasReady();
    setIsDrawing(true);
    lastPointRef.current = getPoint(event);
  }

  function continueDrawing(event: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    if (!isDrawing) return;
    event.preventDefault();
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context || !lastPointRef.current) return;

    const nextPoint = getPoint(event);
    context.beginPath();
    context.moveTo(lastPointRef.current.x, lastPointRef.current.y);
    context.lineTo(nextPoint.x, nextPoint.y);
    context.strokeStyle = '#0f172a';
    context.lineWidth = 2;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.stroke();

    lastPointRef.current = nextPoint;
    setHasSignature(true);
    setError('');
  }

  function stopDrawing() {
    setIsDrawing(false);
    lastPointRef.current = null;
  }

  function clearSignature() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    emptyCanvas(canvas);
    setHasSignature(false);
    setError('');
  }

  async function handleSave() {
    const canvas = canvasRef.current;
    if (!canvas || !hasSignature) {
      setError('Please capture a customer signature first.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      await onSave(canvas.toDataURL('image/png'), signerName);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save the signature.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <button
        type="button"
        aria-label="Close signature capture"
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/45"
      />
      <div className="relative z-10 w-full max-w-md rounded-[2rem] bg-white p-5 shadow-card">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Customer signature</p>
          <h3 className="text-xl font-semibold text-ink">{stopName || 'Delivery stop'}</h3>
          <p className="text-sm text-slate-600">
            Capture the receiver’s signature before finishing the delivery.
          </p>
        </div>

        {error ? (
          <div className="mt-4 rounded-2xl bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {error}
          </div>
        ) : null}

        <label className="mt-4 block">
          <span className="mb-2 block text-sm font-medium text-slate-700">Recipient name</span>
          <input
            value={signerName}
            onChange={(event) => setSignerName(event.target.value)}
            placeholder="Optional"
            className="min-h-12 w-full rounded-2xl border border-slate-200 px-4 text-base outline-none focus:border-ocean focus:ring-2 focus:ring-ocean/20"
          />
        </label>

        <canvas
          ref={canvasRef}
          width={360}
          height={180}
          className="mt-4 w-full rounded-[1.5rem] border border-slate-200 bg-white touch-none"
          onMouseDown={startDrawing}
          onMouseMove={continueDrawing}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={continueDrawing}
          onTouchEnd={stopDrawing}
        />

        <div className="mt-4 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={clearSignature}
            className="min-h-12 rounded-2xl bg-white px-4 py-3 text-base font-semibold text-slate-800 ring-1 ring-slate-200"
          >
            Clear
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="min-h-12 rounded-2xl bg-ocean px-4 py-3 text-base font-semibold text-white disabled:opacity-60"
          >
            {saving ? 'Saving...' : 'Save Signature'}
          </button>
        </div>
      </div>
    </div>
  );
}
