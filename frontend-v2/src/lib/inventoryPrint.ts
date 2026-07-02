import type { CountSheetRow } from '../types/inventory.types';

type CountSheetGroup = { category: string; rows: CountSheetRow[] };

function sanitizeHtml(v: string): string {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Opens a print-ready popup window with a category-grouped inventory count
 * sheet (blank "Physical Count" column for manual entry). Calls `onError`
 * instead of throwing when the popup is blocked, since that's a user
 * action (allow pop-ups) rather than a code error.
 */
export function printInventoryCountSheet({
  groups,
  companyName,
  scopeLabel,
  onError,
}: {
  groups: CountSheetGroup[];
  companyName: string;
  scopeLabel: string;
  onError: (message: string) => void;
}): void {
  const popup = window.open('', '_blank', 'width=1100,height=800');
  if (!popup) { onError('Could not open the print view. Please allow pop-ups and try again.'); return; }

  const escapedCompanyName = sanitizeHtml(companyName);
  const printTitle = `${companyName} Inventory Count Sheet`;
  const escapedPrintTitle = sanitizeHtml(printTitle);
  const sections = groups
    .map((g) => `<section class="category-block"><h2>${sanitizeHtml(g.category)}</h2><table><thead><tr><th>Item Number</th><th>Description Line 1</th><th>On Hand Quantity</th><th>Unit</th><th>Physical Count</th></tr></thead><tbody>${g.rows.map((i) => `<tr><td>${sanitizeHtml(i.item_number || '-')}</td><td>${sanitizeHtml(i.description)}</td><td>${sanitizeHtml(i.on_hand_qty.toLocaleString())}</td><td>${sanitizeHtml(i.unit || '-')}</td><td class="blank-cell"></td></tr>`).join('')}</tbody></table></section>`)
    .join('');

  popup.document.write(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>${escapedPrintTitle}</title><style>body{font-family:Arial,sans-serif;margin:24px;color:#111827}h1{margin:0 0 6px;font-size:24px}.meta{margin-bottom:18px;color:#4b5563;font-size:12px}.category-block{margin-bottom:28px;page-break-inside:avoid}h2{margin:0 0 10px;font-size:18px;border-bottom:1px solid #d1d5db;padding-bottom:4px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #d1d5db;padding:8px 10px;font-size:12px;text-align:left}th{background:#f3f4f6}.blank-cell{min-width:140px;height:28px}.print-footer{display:none}@media print{body{margin:12px 12px 36px}.print-footer{display:block;position:fixed;bottom:0;left:0;font-size:10px;color:#4b5563}}</style></head><body><h1>Inventory Count Sheet</h1><div class="meta">${escapedCompanyName} · Class Name scope: ${sanitizeHtml(scopeLabel)} · Generated ${sanitizeHtml(new Date().toLocaleString())}</div>${sections || '<p>No inventory rows match the selected filters.</p>'}<div class="print-footer">${escapedCompanyName}</div></body></html>`);

  try {
    const companySlug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'company';
    popup.history?.replaceState?.(null, printTitle, `/print/${companySlug}/inventory-count-sheet`);
  } catch { /* history API not critical to printing */ }

  popup.document.close();
  popup.focus();
  popup.print();
}
