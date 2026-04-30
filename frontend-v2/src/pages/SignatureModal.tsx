import { Button } from '../components/ui/button';

type Props = {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  signatureSaving: boolean;
  onBegin: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  onMove: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  onEnd: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  onClear: () => void;
  onSave: () => void;
  onClose: () => void;
};

export function SignatureModal({
  canvasRef, signatureSaving,
  onBegin, onMove, onEnd, onClear, onSave, onClose,
}: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl rounded-xl border border-border bg-card shadow-panel">
        <div className="flex items-center justify-between border-b border-border p-5">
          <div>
            <div className="text-lg font-semibold text-foreground">Capture Customer Signature</div>
            <div className="mt-1 text-sm text-muted-foreground">Save a signature before completing this stop.</div>
          </div>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </div>
        <div className="space-y-4 p-5">
          <div className="rounded-lg border border-dashed border-border bg-white p-3">
            <canvas
              ref={canvasRef}
              className="h-56 w-full cursor-crosshair rounded-md"
              onPointerDown={onBegin}
              onPointerMove={onMove}
              onPointerUp={onEnd}
              onPointerLeave={onEnd}
            />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={onClear}>Clear</Button>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={onSave} disabled={signatureSaving}>
              {signatureSaving ? 'Saving...' : 'Save Signature'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
