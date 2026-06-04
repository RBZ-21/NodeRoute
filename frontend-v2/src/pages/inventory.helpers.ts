import type { InventoryItem } from '../types/inventory.types';

export function asNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function inventoryActionLabel(item: Pick<InventoryItem, 'item_number' | 'description'> | null | undefined): string {
  if (!item) return '';
  const itemNumber = String(item.item_number || '').trim();
  const description = String(item.description || '').trim();
  if (itemNumber && description) return `${itemNumber} - ${description}`;
  return itemNumber || description || 'Unnamed item';
}
