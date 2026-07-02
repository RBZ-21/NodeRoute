import { Modal } from '../components/ui/overlay-panel';

export function OrderIntakeModal({
  visible,
  open,
  text,
  setText,
  parsing,
  error,
  onOpen,
  onClose,
  onSubmit,
}: {
  /** Whether the intake feature (button + modal) should render at all — gated by role in the parent. */
  visible: boolean;
  open: boolean;
  text: string;
  setText: (value: string) => void;
  parsing: boolean;
  error: string;
  onOpen: () => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  if (!visible) return null;

  return (
    <div>
      <button
        onClick={onOpen}
        className="rounded-md border border-dashed border-primary/40 bg-primary/5 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/10 transition-colors"
      >
        ✦ Parse Customer Message → Order
      </button>
      {open && (
        <Modal
          open
          title="Parse Customer Message"
          description="Paste a customer email, text, or fax. AI will extract line items and pre-fill the order form."
          onClose={onClose}
          widthClassName="max-w-lg"
        >
          <div className="space-y-3">
            {error && <div className="rounded border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</div>}
            <textarea
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              rows={7}
              placeholder={"e.g. Hi, can I get 10 lbs of salmon, 2 cases of shrimp, and 5 lbs of tuna? – Joe's Seafood"}
              aria-label="Customer message to parse into an order"
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={parsing}
            />
          </div>
          <div className="mt-4 flex justify-end gap-2 border-t border-border pt-3">
            <button onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted" disabled={parsing}>Cancel</button>
            <button onClick={onSubmit} disabled={parsing || !text.trim()} className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {parsing ? 'Parsing...' : 'Parse & Fill'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
