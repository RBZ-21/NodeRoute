import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Phone } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { fetchWithAuth, sendWithAuth } from '../lib/api';
import { phoneOrderKeys } from './phone-order-keys';

// ── Types ──────────────────────────────────────────────────────────────────────

interface LineItem {
  product: string;
  quantity: number;
  unit: string;
  confidence: number;
  rawText: string;
}

interface PhoneOrder {
  id: string;
  customer_id?: string | null;
  business_name: string | null;
  customer_name: string | null;
  caller_phone: string | null;
  line_items: LineItem[] | null;
  order_guides?: Array<{ id: string; name: string; items?: Array<{ product_id: string; default_qty?: number | string | null; default_uom?: string | null }> }>;
  hot_messages?: Array<{ id?: string; message: string }>;
  needs_callback: boolean;
  status: string;
  transcript: string | null;
  notes: string | null;
  created_at: string;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function PhoneOrdersPage() {
  const { data: orders = [], isLoading, isError } = useQuery({
    queryKey: phoneOrderKeys.all,
    queryFn: () => fetchWithAuth<PhoneOrder[]>('/api/phone-orders'),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const draftCount = orders.filter((o) => o.status === 'draft').length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
        Loading phone orders…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        Failed to load phone orders.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Phone className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-semibold">Phone Orders</h1>
        {draftCount > 0 && (
          <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-semibold text-white">
            {draftCount} unreviewed
          </span>
        )}
      </div>

      {orders.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No phone orders yet. They will appear here after a Bland.ai call completes.
        </p>
      ) : (
        <div className="space-y-3">
          {orders.map((order) => (
            <PhoneOrderCard key={order.id} order={order} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────────

function PhoneOrderCard({ order }: { order: PhoneOrder }) {
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const updateMutation = useMutation({
    mutationFn: (updates: Partial<Pick<PhoneOrder, 'status' | 'needs_callback'>>) =>
      sendWithAuth<PhoneOrder>(`/api/phone-orders/${order.id}`, 'PATCH', updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: phoneOrderKeys.all });
      queryClient.invalidateQueries({ queryKey: phoneOrderKeys.draftCount });
    },
  });

  const header = order.business_name || order.customer_name || order.caller_phone || 'Unknown Caller';
  const items: LineItem[] = Array.isArray(order.line_items) ? order.line_items : [];
  const guides = Array.isArray(order.order_guides) ? order.order_guides : [];
  const hotMessages = Array.isArray(order.hot_messages) ? order.hot_messages : [];
  const isDraft = order.status === 'draft';

  return (
    <Card className={order.status === 'rejected' ? 'opacity-50' : ''}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base font-semibold">{header}</CardTitle>
          <div className="flex shrink-0 items-center gap-1.5">
            {order.needs_callback && (
              <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-400">
                CALLBACK NEEDED
              </span>
            )}
            <span className={[
              'rounded px-2 py-0.5 text-xs font-medium',
              order.status === 'confirmed'
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                : order.status === 'rejected'
                ? 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
            ].join(' ')}>
              {order.status}
            </span>
          </div>
        </div>
        {order.caller_phone && order.business_name && (
          <p className="text-xs text-muted-foreground">{order.caller_phone}</p>
        )}
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Line items */}
        {items.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {items.map((item, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="text-muted-foreground">{item.quantity} {item.unit}</span>
                <span className="font-medium">{item.product}</span>
                {item.confidence < 0.7 && (
                  <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-xs font-medium text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                    ⚠ low confidence
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground italic">No line items parsed.</p>
        )}

        {hotMessages.length > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
            {hotMessages.map((message) => (
              <div key={message.id || message.message}>{message.message}</div>
            ))}
          </div>
        )}

        {guides.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {guides.map((guide) => (
              <span key={guide.id} className="rounded border border-border bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
                {guide.name} · {(guide.items || []).length} items
              </span>
            ))}
          </div>
        )}

        {/* Notes */}
        {order.notes && (
          <p className="text-xs text-muted-foreground border-l-2 border-border pl-2">{order.notes}</p>
        )}

        {/* Collapsible transcript */}
        {order.transcript && (
          <div>
            <button
              onClick={() => setTranscriptOpen((o) => !o)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {transcriptOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {transcriptOpen ? 'Hide transcript' : 'Show transcript'}
            </button>
            {transcriptOpen && (
              <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap rounded border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                {order.transcript}
              </pre>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2 pt-1">
          {isDraft && (
            <>
              <Button
                size="sm"
                variant="default"
                disabled={updateMutation.isPending}
                onClick={() => updateMutation.mutate({ status: 'confirmed' })}
              >
                Confirm
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={updateMutation.isPending}
                onClick={() => updateMutation.mutate({ needs_callback: true })}
              >
                Needs Callback
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-destructive hover:text-destructive"
                disabled={updateMutation.isPending}
                onClick={() => updateMutation.mutate({ status: 'rejected' })}
              >
                Reject
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => navigate(`/orders?id=${order.id}`)}
          >
            View Full Order
          </Button>
        </div>

        {updateMutation.isError && (
          <p className="text-xs text-destructive">Failed to update order. Please try again.</p>
        )}
      </CardContent>
    </Card>
  );
}
