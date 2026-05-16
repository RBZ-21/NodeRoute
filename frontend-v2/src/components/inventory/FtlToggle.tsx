import { useState } from 'react';
import { sendWithAuth } from '../../lib/api';
import type { InventoryItem } from '../../types/inventory.types';

export function FtlToggle({ item, onToggled }: { item: InventoryItem; onToggled: (updated: { item_number: string; is_ftl_product: boolean }) => void }) {
  const [saving, setSaving] = useState(false);

  async function toggle() {
    if (!item.item_number) return;
    setSaving(true);
    try {
      const result = await sendWithAuth<{ item_number: string; is_ftl_product: boolean }>(
        `/api/lots/products/${encodeURIComponent(item.item_number)}/ftl`,
        'PATCH',
        { is_ftl_product: !item.is_ftl_product }
      );
      onToggled(result);
    } catch { /* reverts on failure */ } finally { setSaving(false); }
  }

  return (
    <button onClick={toggle} disabled={saving}
      title={item.is_ftl_product ? 'On FDA Traceability List — click to remove' : 'Not on FDA Traceability List — click to flag'}
      className={['inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1', item.is_ftl_product ? 'bg-blue-600 focus:ring-blue-500' : 'bg-gray-200 focus:ring-gray-400', saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'].join(' ')}>
      <span className={['inline-block h-4 w-4 rounded-full bg-white shadow transition-transform', item.is_ftl_product ? 'translate-x-6' : 'translate-x-1'].join(' ')} />
    </button>
  );
}
