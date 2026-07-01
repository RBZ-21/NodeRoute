import { useState } from 'react';
import { sendWithAuth } from '../../lib/api';
import type { InventoryItem } from '../../types/inventory.types';

export function ActiveToggle({
  item,
  onToggled,
}: {
  item: InventoryItem;
  onToggled: (updated: { item_number: string; is_active: boolean }) => void;
}) {
  const [saving, setSaving] = useState(false);
  const isActive = item.is_active !== false; // default true when undefined

  async function toggle() {
    if (!item.item_number) return;
    setSaving(true);
    try {
      const result = await sendWithAuth<{ item_number: string; is_active: boolean }>(
        `/api/inventory/${encodeURIComponent(item.item_number)}`,
        'PATCH',
        { is_active: !isActive },
      );
      onToggled(result);
    } catch { /* reverts on failure */ } finally {
      setSaving(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={saving}
      aria-label={isActive ? 'Mark item inactive' : 'Restore item as active'}
      title={isActive ? 'Active — click to mark inactive (seasonal/off-season)' : 'Inactive — click to restore as active'}
      className={[
        'inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1',
        isActive ? 'bg-emerald-500 focus:ring-emerald-400' : 'bg-gray-300 focus:ring-gray-400',
        saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
      ].join(' ')}
    >
      <span
        className={[
          'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
          isActive ? 'translate-x-6' : 'translate-x-1',
        ].join(' ')}
      />
      <span className="sr-only">{isActive ? 'Active' : 'Inactive'}</span>
    </button>
  );
}
