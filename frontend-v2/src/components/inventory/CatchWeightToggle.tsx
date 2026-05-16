import { useState } from 'react';
import { sendWithAuth } from '../../lib/api';
import type { InventoryItem } from '../../types/inventory.types';

export function CatchWeightToggle({ item, onToggled }: { item: InventoryItem; onToggled: (updated: { item_number: string; is_catch_weight: boolean }) => void }) {
  const [saving, setSaving] = useState(false);

  async function toggle() {
    if (!item.item_number) return;
    setSaving(true);
    try {
      const result = await sendWithAuth<{ item_number: string; is_catch_weight: boolean }>(
        `/api/inventory/${encodeURIComponent(item.item_number)}`,
        'PATCH',
        { is_catch_weight: !item.is_catch_weight }
      );
      onToggled({ item_number: result.item_number, is_catch_weight: result.is_catch_weight ?? !item.is_catch_weight });
    } catch { /* reverts on failure */ } finally { setSaving(false); }
  }

  return (
    <button onClick={toggle} disabled={saving}
      title={item.is_catch_weight ? 'Catch weight ON — click to turn off' : 'Not catch weight — click to enable'}
      className={['inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1', item.is_catch_weight ? 'bg-orange-500 focus:ring-orange-400' : 'bg-gray-200 focus:ring-gray-400', saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'].join(' ')}>
      <span className={['inline-block h-4 w-4 rounded-full bg-white shadow transition-transform', item.is_catch_weight ? 'translate-x-6' : 'translate-x-1'].join(' ')} />
    </button>
  );
}
