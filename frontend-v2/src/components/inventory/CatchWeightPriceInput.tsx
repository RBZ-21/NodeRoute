import { useState } from 'react';
import { sendWithAuth } from '../../lib/api';
import type { InventoryItem } from '../../types/inventory.types';

export function CatchWeightPriceInput({ item, onSaved }: { item: InventoryItem; onSaved: (updated: { item_number: string; default_price_per_lb: number }) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(item.default_price_per_lb ?? ''));
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!item.item_number) return;
    const parsed = parseFloat(value);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    setSaving(true);
    try {
      const result = await sendWithAuth<{ item_number: string; default_price_per_lb: number }>(
        `/api/inventory/${encodeURIComponent(item.item_number)}`, 'PATCH', { default_price_per_lb: parsed }
      );
      onSaved({ item_number: result.item_number, default_price_per_lb: result.default_price_per_lb ?? parsed });
      setEditing(false);
    } catch { /* stays in edit mode */ } finally { setSaving(false); }
  }

  if (!editing) return (
    <button onClick={() => { setValue(String(item.default_price_per_lb ?? '')); setEditing(true); }} className="text-xs text-blue-600 underline underline-offset-2 hover:text-blue-800">
      {item.default_price_per_lb != null ? `$${Number(item.default_price_per_lb).toFixed(4)}` : 'Set'}
    </button>
  );

  return (
    <div className="flex items-center gap-1">
      <input type="number" min="0" step="0.0001" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }} className="h-7 w-20 rounded border border-input bg-background px-2 text-xs" autoFocus />
      <button onClick={save} disabled={saving} className="rounded bg-orange-500 px-2 py-0.5 text-xs font-medium text-white hover:bg-orange-600 disabled:opacity-50">{saving ? '…' : 'Save'}</button>
      <button onClick={() => setEditing(false)} className="text-xs text-muted-foreground hover:text-foreground">✕</button>
    </div>
  );
}
