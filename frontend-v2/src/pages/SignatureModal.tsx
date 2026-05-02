import { useRef, useState } from 'react';
import { Button } from '../components/ui/button';
import { sendWithAuth } from '../lib/api';

interface SignatureModalProps {
  stopId: string | number;
  onClose: () => void;
  onSaved?: () => void;
}

export function SignatureModal({ stopId, onClose, onSaved }: SignatureModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [signerName, setSignerName] = useState('');
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  function getPos(e: React.MouseEvent | React.TouchEvent) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    if ('touches' in e) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function startDraw(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    setIsDrawing(true);
    lastPos.current = getPos(e);
  }

  function draw(e: React.MouseEvent | React.TouchEvent) {
    if (!isDrawing) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(lastPos.current!.x, lastPos.current!.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();
    lastPos.current = pos;
  }

  function stopDraw() { setIsDrawing(false); }

  function clearCanvas() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  async function handleSave() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const signatureData = canvas.toDataURL('image/png');
    // Check if canvas is blank
    const blank = document.createElement('canvas');
    blank.width = canvas.width;
    blank.height = canvas.height;
    if (signatureData === blank.toDataURL('image/png')) {
      setError('Please draw a signature before saving.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await sendWithAuth(`/api/stops/${stopId}/signature`, 'POST', {
        signature_data: signatureData,
        signer_name: signerName.trim() || undefined,
      });
      onSaved?.();
      onClose();
    } catch (err) {
      setError(String((err as Error).message || 'Failed to save signature'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm rounded-xl bg-background p-6 shadow-xl space-y-4">
        <h2 className="text-lg font-semibold">Delivery Signature</h2>
        <p className="text-sm text-muted-foreground">Sign below to confirm delivery for stop #{stopId}.</p>

        {error ? (
          <div className="rounded border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div>
        ) : null}

        <div>
          <label className="block text-sm font-medium mb-1">Recipient Name (optional)</label>
          <input
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder="e.g. John Smith"
            value={signerName}
            onChange={(e) => setSignerName(e.target.value)}
          />
        </div>

        <canvas
          ref={canvasRef}
          width={340}
          height={160}
          className="w-full rounded-lg border border-border bg-white cursor-crosshair touch-none"
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={stopDraw}
          onMouseLeave={stopDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={stopDraw}
        />

        <div className="flex justify-between gap-2">
          <Button variant="outline" size="sm" onClick={clearCanvas}>Clear</Button>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" disabled={saving} onClick={handleSave}>
              {saving ? 'Saving...' : 'Save Signature'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
