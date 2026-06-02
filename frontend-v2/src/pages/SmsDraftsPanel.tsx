import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { useApproveDraftMutation, useDiscardDraftMutation, useSmsDraftsQuery } from '../hooks/useOrders';
import type { Order, OrderItem } from './orders.types';

function formatPhone(phone: string | undefined | null) {
  if (!phone) return 'Unknown sender';
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits[0] === '1') return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return phone;
}

function extractOriginalMessage(notes: string | undefined | null): string {
  if (!notes) return '';
  const match = notes.match(/Original message: (.+?)(?:\n|$)/s);
  return match ? match[1].trim() : '';
}

function DraftCard({ order, onApprove, onDiscard }: { order: Order; onApprove: () => void; onDiscard: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const originalMessage = extractOriginalMessage(order.notes);
  const items: OrderItem[] = order.items || [];

  return (
    <div className="border rounded-lg p-4 bg-yellow-50 border-yellow-200 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium text-sm">{formatPhone(order.customer_phone)}</p>
          <p className="text-xs text-gray-500">{order.order_number} · {order.created_at ? new Date(order.created_at).toLocaleString() : ''}</p>
        </div>
        <span className="text-xs bg-yellow-200 text-yellow-800 px-2 py-0.5 rounded-full font-medium whitespace-nowrap">SMS Draft</span>
      </div>

      {originalMessage && (
        <blockquote className="text-sm text-gray-700 bg-white border-l-4 border-yellow-300 pl-3 py-1 rounded italic">
          {originalMessage}
        </blockquote>
      )}

      {items.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Parsed items</p>
          <ul className="space-y-0.5">
            {items.map((item, i) => {
              const qty = item.requested_weight ?? item.requested_qty ?? item.quantity ?? 1;
              const unit = item.unit || 'ea';
              const name = item.name || item.description || item.item_number || 'Unknown item';
              return (
                <li key={i} className="text-sm flex gap-2">
                  <span className="text-gray-400 w-4 text-right shrink-0">{i + 1}.</span>
                  <span>{String(qty)} {unit} — {name}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {items.length === 0 && (
        <p className="text-sm text-gray-500 italic">No items could be parsed — review the message and add items manually after approving.</p>
      )}

      <div className="flex gap-2 pt-1">
        <Button size="sm" onClick={onApprove}>
          Approve
        </Button>
        {!confirming ? (
          <Button size="sm" variant="outline" className="text-red-600 border-red-300 hover:bg-red-50" onClick={() => setConfirming(true)}>
            Discard
          </Button>
        ) : (
          <>
            <Button size="sm" variant="outline" className="text-red-600 border-red-500 bg-red-50" onClick={onDiscard}>
              Confirm discard
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export function SmsDraftsPanel() {
  const { data: drafts = [], isLoading } = useSmsDraftsQuery();
  const approveMutation = useApproveDraftMutation();
  const discardMutation = useDiscardDraftMutation();

  if (isLoading || drafts.length === 0) return null;

  return (
    <Card className="border-yellow-300 bg-yellow-50/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <span>SMS Order Drafts</span>
          <span className="text-xs bg-yellow-400 text-yellow-900 rounded-full px-2 py-0.5 font-bold">{drafts.length}</span>
        </CardTitle>
        <p className="text-sm text-gray-600">Orders received by text message — review and approve or discard each one.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {drafts.map((draft) => (
          <DraftCard
            key={draft.id}
            order={draft}
            onApprove={() => approveMutation.mutate(draft.id)}
            onDiscard={() => discardMutation.mutate(draft.id)}
          />
        ))}
      </CardContent>
    </Card>
  );
}
