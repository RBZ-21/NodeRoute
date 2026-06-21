import type { InventoryItem } from '../types/inventory.types';

export function asNumber(v: unknown): number {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function inventoryActionLabel(item: Pick<InventoryItem, 'item_number' | 'description' | 'description_line_1' | 'name'> | null | undefined): string {
  if (!item) return '';
  const itemNumber = String(item.item_number || '').trim();
  const description = String(item.description_line_1 || item.description || item.name || '').trim();
  if (itemNumber && description) return `${itemNumber} - ${description}`;
  return itemNumber || description || 'Unnamed item';
}
