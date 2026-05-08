import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { sendWithAuth } from '../lib/api';
import type { CountSheetRow, InventoryItem, LedgerEntry, LedgerSummary } from '../types/inventory.types';
import { ActiveToggle, CatchWeightPriceInput, CatchWeightToggle, FtlToggle, InventoryLedger } from '../components/inventory';
import {
  type LedgerParams,
  useAdjustMutation,
  useInventoryQuery,
  useLedgerQuery,
  useRecentSoldQuery,
  useRestockMutation,
  useSpoilageMutation,
  useTransferMutation,
} from '../hooks/useInventory';

function asNumber(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function money(v: number) { return v.toLocaleString('en-US', { style: 'currency', currency: 'USD' }); }
function csvEscape(v: string) { return `"${String(v).replace(/"/g, '""')}`; }
function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((r) => r.map(csvEscape).join(',')).join('\n');
  const href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = href; a.download = filename; a.click(); URL.revokeObjectURL(href);
}
function sanitizeHtml(v: string) { return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function inventoryActionLabel(item: Pick<InventoryItem, 'item_number' | 'description'> | null | undefined): string {
  if (!item) return '';
  const itemNumber = String(item.item_number || '').trim();
  const description = String(item.description || '').trim();
  if (itemNumber && description) return `${itemNumber} - ${description}`;
  return itemNumber || description || 'Unnamed item';
}
function SummaryCard({ label, value }: { label: string; value: string }) {
  return <Card><CardHeader className="space-y-1"><CardDescription>{label}</CardDescription><CardTitle className="text-2xl">{value}</CardTitle></CardHeader></Card>;
}
function itemCategoryCompare(a: CountSheetRow, b: CountSheetRow) { return a.category.localeCompare(b.category); }
function countSheetEmptyMessage({
  countCategoryFilter,
  recentSalesExclusionWindow,
  includeZeroStockInCounts,
}: {
  countCategoryFilter: string;
  recentSalesExclusionWindow: string;
  includeZeroStockInCounts: boolean;
}) {
  const reasons: string[] = [];
  if (countCategoryFilter !== 'all') reasons.push(`category scope is limited to ${countCategoryFilter}`);
  if (recentSalesExclusionWindow !== 'all') reasons.push(`items not sold in the last ${recentSalesExclusionWindow} days are excluded`);
  if (!includeZeroStockInCounts) reasons.push('zero-stock items are hidden');
  if (!reasons.length) return 'No inventory rows are available for a count sheet yet.';
  return `No inventory rows match the current count-sheet filters because ${reasons.join(', ')}.`;
}

// ── AI Health Analysis types ──────────────────────────────────────────────────
type AiActionItem = {
  priority: 'CRITICAL' | 'WARNING' | 'INFO';
  action: string;
  product_id: string;
  product_name: string;
  current_stock: number;
  reason: string;
  suggested_action: string;
};
type AiAnalysis = {
  analysis_date: string;
  total_skus_analyzed: number;
  summary: { critical_items: number; warning_items: number; overstocked_items: number; healthy_items: number };
  action_items: AiActionItem[];
};

const PRIORITY_COLORS: Record<string, string> = {
  CRITICAL: 'text-red-700 bg-red-50 border-red-200',
  WARNING:  'text-yellow-700 bg-yellow-50 border-yellow-200',
  INFO:     'text-blue-700 bg-blue-50 border-blue-200',
};

export function InventoryPage() {
  const queryClient = useQueryClient();

  // ── Queries ───────────────────────────────────────────────────────────────
  const inventoryQuery = useInventoryQuery();
  const items = inventoryQuery.data ?? [];

  const [ledgerCommitted, setLedgerCommitted] = useState<LedgerParams>({
    itemFilter: '',
    typeFilter: '',
    limit: '75',
  });
  const ledgerQuery = useLedgerQuery(ledgerCommitted);
  const ledgerSummary: LedgerSummary | null = ledgerQuery.data?.summary ?? null;
  const ledgerEntries: LedgerEntry[] = ledgerQuery.data?.entries ?? [];

  const [recentSalesExclusionWindow, setRecentSalesExclusionWindow] = useState('all');
  const recentSoldQuery = useRecentSoldQuery(
    recentSalesExclusionWindow === 'all' ? null : (recentSalesExclusionWindow as '30' | '60' | '90'),
  );
  const recentSoldItemKeys: Set<string> | null = recentSoldQuery.data ?? null;

  // ── Mutations ─────────────────────────────────────────────────────────────
  const restockMutation  = useRestockMutation();
  const adjustMutation   = useAdjustMutation();
  const transferMutation = useTransferMutation();
  const spoilageMutation = useSpoilageMutation();

  // ── Local UI state ────────────────────────────────────────────────────────
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // Inline feedback for the Inventory Actions card specifically
  const [actionError, setActionError] = useState('');
  const [actionNotice, setActionNotice] = useState('');
  const [selectedItemId, setSelectedItemId] = useState('');
  const [restockQty, setRestockQty] = useState('');
  const [adjustDelta, setAdjustDelta] = useState('');
  const [actionNotes, setActionNotes] = useState('');
  const [transferFromId, setTransferFromId] = useState('');
  const [transferToId, setTransferToId] = useState('');
  const [transferQty, setTransferQty] = useState('');
  const [transferNotes, setTransferNotes] = useState('');
  const [spoilageItemId, setSpoilageItemId] = useState('');
  const [spoilageQty, setSpoilageQty] = useState('');
  const [spoilageReason, setSpoilageReason] = useState('');
  const [spoilageNotes, setSpoilageNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [countCategoryFilter, setCountCategoryFilter] = useState('all');
  const [includeZeroStockInCounts, setIncludeZeroStockInCounts] = useState(true);

  const [ledgerItemFilter, setLedgerItemFilter] = useState('');
  const [ledgerTypeFilter, setLedgerTypeFilter] = useState('');
  const [ledgerLimit, setLedgerLimit] = useState('75');

  // AI Health Analysis state
  const [aiAnalysis, setAiAnalysis] = useState<AiAnalysis | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const aiRef = useRef<HTMLDivElement>(null);

  // AI Markdown Recommendations
  type MarkdownRec = { product_id: string; product_name: string; lot_number: string | null; days_until_expiry: number; current_stock: number; suggested_discount_pct: number; urgency: string; message: string; suggested_action: string };
  const [markdownRecs, setMarkdownRecs] = useState<MarkdownRec[] | null>(null);
  const [markdownLoading, setMarkdownLoading] = useState(false);
  const [markdownSummary, setMarkdownSummary] = useState('');

  // Initialise selector dropdowns once the first inventory load completes.
  // Use the first item whose item_number is truthy so we never silently
  // pre-select a blank value and disable the action buttons unexpectedly.
  const selectorInitialized = useRef(false);
  useEffect(() => {
    if (selectorInitialized.current || !items.length) return;
    selectorInitialized.current = true;
    const firstItem = items[0];
    setSelectedItemId(firstItem?.id || '');
    setSpoilageItemId(firstItem?.id || '');
    setTransferFromId(firstItem?.id || '');
    const secondItem = items.find((i) => i.id !== firstItem?.id);
    if (secondItem) setTransferToId(secondItem.id);
  }, [items]);

  // ── AI calls ──────────────────────────────────────────────────────────────
  async function runAiHealthAnalysis() {
    setAiLoading(true); setAiError(''); setAiAnalysis(null);
    try {
      const data = await sendWithAuth<AiAnalysis>('/api/ai/inventory-analysis', 'POST', {});
      setAiAnalysis(data);
      setTimeout(() => aiRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    } catch (err) {
      setAiError(String((err as Error).message || 'AI analysis failed'));
    } finally {
      setAiLoading(false);
    }
  }

  async function runMarkdownRecommendations() {
    setMarkdownLoading(true);
    try {
      type MarkdownResult = { recommendations: MarkdownRec[]; summary: string };
      const result = await sendWithAuth<MarkdownResult>('/api/ai/markdown-recommendations', 'POST', { window_days: 10 });
      setMarkdownRecs(result.recommendations || []);
      setMarkdownSummary(result.summary || '');
    } catch (err) { setError(String((err as Error).message || 'Markdown recommendations failed')); }
    finally { setMarkdownLoading(false); }
  }

  // ── Inventory action helpers ───────────────────────────────────────────────
  function patchCachedItem(updated: Pick<InventoryItem, 'item_number'> & Partial<InventoryItem>) {
    queryClient.setQueryData<InventoryItem[]>(['inventory'], (old) =>
      old?.map((it) => it.item_number === updated.item_number ? { ...it, ...updated } : it) ?? old,
    );
  }

  function commitLedgerFilters() {
    setLedgerCommitted({ itemFilter: ledgerItemFilter, typeFilter: ledgerTypeFilter, limit: ledgerLimit });
  }

  // Helper to reset inline action feedback before each submission
  function clearActionFeedback() { setActionError(''); setActionNotice(''); }

  function requireItemNumber(item: InventoryItem | null, actionLabel: string) {
    if (!item) {
      setActionError(`Please select an item before ${actionLabel}.`);
      return null;
    }
    const itemNumber = String(item.item_number || '').trim();
    if (!itemNumber) {
      setActionError(`"${inventoryActionLabel(item)}" is missing an item number, so ${actionLabel} cannot be posted yet.`);
      return null;
    }
    return itemNumber;
  }

  // ── Mutations ─────────────────────────────────────────────────────────────
  async function submitRestock() {
    clearActionFeedback();
    const itemNumber = requireItemNumber(selectedItem, 'restocking');
    if (!itemNumber) return;
    const qty = asNumber(restockQty);
    if (qty <= 0) { setActionError('Restock quantity must be greater than 0.'); return; }
    setSubmitting(true);
    try {
      await restockMutation.mutateAsync({ itemNumber, qty, notes: actionNotes || undefined });
      setRestockQty(''); setActionNotes('');
      setActionNotice(`Restocked ${inventoryActionLabel(selectedItem)} by ${qty.toLocaleString()}.`);
    } catch (err) { setActionError(String((err as Error).message || 'Restock failed')); }
    finally { setSubmitting(false); }
  }

  async function submitAdjustment() {
    clearActionFeedback();
    const itemNumber = requireItemNumber(selectedItem, 'applying an adjustment');
    if (!itemNumber) return;
    const delta = asNumber(adjustDelta);
    if (delta === 0) { setActionError('Adjustment delta must be non-zero.'); return; }
    setSubmitting(true);
    try {
      await adjustMutation.mutateAsync({ itemNumber, delta, notes: actionNotes || undefined });
      setAdjustDelta(''); setActionNotes('');
      setActionNotice(`Adjusted ${inventoryActionLabel(selectedItem)} by ${delta > 0 ? '+' : ''}${delta.toLocaleString()}.`);
    } catch (err) { setActionError(String((err as Error).message || 'Adjustment failed')); }
    finally { setSubmitting(false); }
  }

  async function submitTransfer() {
    const qty = asNumber(transferQty);
    const fromItem = items.find((item) => item.id === transferFromId) ?? null;
    const toItem = items.find((item) => item.id === transferToId) ?? null;
    if (!fromItem || !toItem) { setError('Select both source and destination items.'); return; }
    if (transferFromId === transferToId) { setError('Source and destination must be different.'); return; }
    if (qty <= 0) { setError('Transfer quantity must be greater than 0.'); return; }
    const fromItemNumber = String(fromItem.item_number || '').trim();
    const toItemNumber = String(toItem.item_number || '').trim();
    if (!fromItemNumber || !toItemNumber) {
      setError('Both transfer items must have item numbers before stock can be moved.');
      return;
    }
    setSubmitting(true); setError(''); setNotice('');
    try {
      const res = await transferMutation.mutateAsync({ fromItem: fromItemNumber, toItem: toItemNumber, qty, notes: transferNotes || undefined });
      setTransferQty(''); setTransferNotes('');
      setNotice(`Transfer completed for ${inventoryActionLabel(fromItem)} -> ${inventoryActionLabel(toItem)} (${res.transfer_ref ?? 'ref unavailable'}).`);
    } catch (err) { setError(String((err as Error).message || 'Transfer failed')); }
    finally { setSubmitting(false); }
  }

  async function submitSpoilage() {
    const qty = asNumber(spoilageQty);
    const spoilageItem = items.find((item) => item.id === spoilageItemId) ?? null;
    if (!spoilageItem) { setError('Select an item for spoilage.'); return; }
    if (qty <= 0) { setError('Spoilage quantity must be greater than 0.'); return; }
    const itemNumber = String(spoilageItem.item_number || '').trim();
    if (!itemNumber) {
      setError(`"${inventoryActionLabel(spoilageItem)}" is missing an item number, so spoilage cannot be posted yet.`);
      return;
    }
    setSubmitting(true); setError(''); setNotice('');
    try {
      await spoilageMutation.mutateAsync({ itemNumber, qty, reason: spoilageReason || undefined, notes: spoilageNotes || undefined });
      setSpoilageQty(''); setSpoilageReason(''); setSpoilageNotes('');
      setNotice(`Spoilage recorded for ${inventoryActionLabel(spoilageItem)}.`);
    } catch (err) { setError(String((err as Error).message || 'Could not record spoilage')); }
    finally { setSubmitting(false); }
  }

  // ── Count sheet helpers ───────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const n = search.trim().toLowerCase();
    return items
      .filter((i) => showInactive || i.is_active !== false)
      .filter((i) => !n || [i.item_number, i.description, i.category].filter(Boolean).some((p) => String(p).toLowerCase().includes(n)));
  }, [items, search, showInactive]);
  const summary = useMemo(() => ({ totalSkus: items.length, lowStock: items.filter((i) => asNumber(i.on_hand_qty) > 0 && asNumber(i.on_hand_qty) <= 10).length, outOfStock: items.filter((i) => asNumber(i.on_hand_qty) <= 0).length, inventoryValue: items.reduce((s, i) => s + asNumber(i.on_hand_qty) * asNumber(i.cost), 0) }), [items]);
  const selectedItem = useMemo(() => items.find((i) => i.id === selectedItemId) ?? null, [items, selectedItemId]);
  const countSheetRows = useMemo(() => {
    const rows = items.map((item) => ({ id: item.id, item_number: String(item.item_number || '').trim(), description: String(item.description || '').trim() || 'Unnamed item', category: String(item.category || 'Uncategorized').trim() || 'Uncategorized', on_hand_qty: asNumber(item.on_hand_qty), unit: String(item.unit || '').trim() })).filter((i) => i.item_number || i.description);
    return rows.filter((i) => countCategoryFilter === 'all' || i.category === countCategoryFilter).filter((i) => includeZeroStockInCounts || i.on_hand_qty > 0).filter((i) => { if (recentSalesExclusionWindow === 'all' || !recentSoldItemKeys) return true; return recentSoldItemKeys.has(i.item_number.trim().toLowerCase()) || recentSoldItemKeys.has(i.description.trim().toLowerCase()); }).sort((a, b) => itemCategoryCompare(a, b) || a.description.localeCompare(b.description) || a.item_number.localeCompare(b.item_number));
  }, [items, countCategoryFilter, includeZeroStockInCounts, recentSalesExclusionWindow, recentSoldItemKeys]);
  const countCategories = useMemo(() => [...new Set(items.map((i) => String(i.category || 'Uncategorized').trim() || 'Uncategorized'))].sort((a, b) => a.localeCompare(b)), [items]);
  const countSheetGroups = useMemo(() => { const g = new Map<string, CountSheetRow[]>(); for (const r of countSheetRows) { const l = g.get(r.category) ?? []; l.push(r); g.set(r.category, l); } return [...g.entries()].map(([category, rows]) => ({ category, rows })); }, [countSheetRows]);
  const countSheetEmptyState = useMemo(() => countSheetEmptyMessage({
    countCategoryFilter,
    recentSalesExclusionWindow,
    includeZeroStockInCounts,
  }), [countCategoryFilter, recentSalesExclusionWindow, includeZeroStockInCounts]);

  function exportCountSheetCsv() {
    const scope = countCategoryFilter === 'all' ? 'all-categories' : countCategoryFilter.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    downloadCsv(`inventory-count-sheet-${scope}.csv`, [['Category','Item #','Description','Current On Hand','Unit','Physical Count'], ...countSheetRows.map((i) => [i.category, i.item_number, i.description, i.on_hand_qty.toLocaleString(), i.unit, ''])]);
  }
  function printCountSheet() {
    const popup = window.open('', '_blank', 'width=1100,height=800');
    if (!popup) { setError('Could not open the print view. Please allow pop-ups and try again.'); return; }
    const scopeLabel = countCategoryFilter === 'all' ? 'All Categories' : countCategoryFilter;
    const sections = countSheetGroups.map((g) => `<section class="category-block"><h2>${sanitizeHtml(g.category)}</h2><table><thead><tr><th>Item #</th><th>Description</th><th>Current On Hand</th><th>Unit</th><th>Physical Count</th></tr></thead><tbody>${g.rows.map((i) => `<tr><td>${sanitizeHtml(i.item_number||'-')}</td><td>${sanitizeHtml(i.description)}</td><td>${sanitizeHtml(i.on_hand_qty.toLocaleString())}</td><td>${sanitizeHtml(i.unit||'-')}</td><td class="blank-cell"></td></tr>`).join('')}</tbody></table></section>`).join('');
    popup.document.write(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>Inventory Count Sheet</title><style>body{font-family:Arial,sans-serif;margin:24px;color:#111827}h1{margin:0 0 6px;font-size:24px}.meta{margin-bottom:18px;color:#4b5563;font-size:12px}.category-block{margin-bottom:28px;page-break-inside:avoid}h2{margin:0 0 10px;font-size:18px;border-bottom:1px solid #d1d5db;padding-bottom:4px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #d1d5db;padding:8px 10px;font-size:12px;text-align:left}th{background:#f3f4f6}.blank-cell{min-width:140px;height:28px}@media print{body{margin:12px}}</style></head><body><h1>Inventory Count Sheet</h1><div class="meta">Category scope: ${sanitizeHtml(scopeLabel)} · Generated ${sanitizeHtml(new Date().toLocaleString())}</div>${sections||'<p>No inventory rows match the selected filters.</p>'}</body></html>`);
    popup.document.close(); popup.focus(); popup.print();
  }

  const fetchError = inventoryQuery.error
    ? String((inventoryQuery.error as Error)?.message || 'Could not load inventory')
    : '';
  const displayError = error || fetchError;

  return (
    <div className="space-y-5">
      {inventoryQuery.isPending && <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading inventory...</div>}
      {displayError && <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{displayError}</div>}
      {notice && <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="SKUs" value={summary.totalSkus.toLocaleString()} />
        <SummaryCard label="Low Stock" value={summary.lowStock.toLocaleString()} />
        <SummaryCard label="Out Of Stock" value={summary.outOfStock.toLocaleString()} />
        <SummaryCard label="Inventory Value" value={money(summary.inventoryValue)} />
      </div>

      {/* ── AI Health Analysis ─────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>AI Inventory Health Analysis</CardTitle>
            <CardDescription>
              Analyzes stock levels, expiring lots, and recent usage patterns to surface critical reorder and spoilage alerts.
            </CardDescription>
          </div>
          <Button onClick={runAiHealthAnalysis} disabled={aiLoading}>
            {aiLoading ? 'Analyzing…' : 'Run AI Analysis'}
          </Button>
        </CardHeader>
        {aiError && (
          <CardContent>
            <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{aiError}</div>
          </CardContent>
        )}
        {aiAnalysis && (
          <CardContent className="space-y-4" ref={aiRef}>
            <div className="grid gap-3 sm:grid-cols-4">
              {[
                { label: 'SKUs Analyzed', value: aiAnalysis.total_skus_analyzed },
                { label: 'Critical', value: aiAnalysis.summary.critical_items },
                { label: 'Warnings', value: aiAnalysis.summary.warning_items },
                { label: 'Healthy', value: aiAnalysis.summary.healthy_items },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-md border border-border bg-muted/30 px-4 py-3 text-sm">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
                  <div className="mt-1 text-2xl font-bold">{value}</div>
                </div>
              ))}
            </div>
            {aiAnalysis.action_items.length > 0 ? (
              <div className="space-y-2">
                {aiAnalysis.action_items.map((item, idx) => (
                  <div
                    key={idx}
                    className={`rounded-md border px-4 py-3 text-sm ${PRIORITY_COLORS[item.priority] ?? 'bg-muted border-border'}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold">[{item.priority}]</span>
                      <span className="font-semibold">{item.product_name}</span>
                      <span className="text-xs text-muted-foreground">#{item.product_id}</span>
                      <span className="ml-auto text-xs">Stock: {item.current_stock.toLocaleString()}</span>
                    </div>
                    <div className="mt-1">{item.reason}</div>
                    <div className="mt-1 font-medium">→ {item.suggested_action}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                All inventory items look healthy — no immediate action required.
              </div>
            )}
            <p className="text-xs text-muted-foreground">Analysis run: {new Date(aiAnalysis.analysis_date).toLocaleString()}</p>
          </CardContent>
        )}
      </Card>

      {/* ── AI Markdown Recommendations ── */}
      <Card>
        <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">✦ AI Spoilage Markdown Recommendations</CardTitle>
            <CardDescription>{markdownSummary || 'Identify expiring lots and get AI-suggested discount pricing to move product before it spoils.'}</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => void runMarkdownRecommendations()} disabled={markdownLoading}>
            {markdownLoading ? 'Analyzing…' : markdownRecs ? 'Re-run' : 'Get Recommendations'}
          </Button>
        </CardHeader>
        {markdownRecs && (
          <CardContent>
            {markdownRecs.length === 0 ? (
              <p className="text-sm text-emerald-600">No lots approaching expiry within the next 10 days.</p>
            ) : (
              <div className="space-y-2">
                {markdownRecs.map((rec, i) => (
                  <div key={i} className={`rounded-lg border px-4 py-3 ${rec.urgency === 'immediate' ? 'border-red-200 bg-red-50' : rec.urgency === 'soon' ? 'border-yellow-200 bg-yellow-50' : 'border-border bg-muted/20'}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <span className={`mr-2 rounded-full px-2 py-0.5 text-xs font-semibold ${rec.urgency === 'immediate' ? 'bg-red-100 text-red-700' : rec.urgency === 'soon' ? 'bg-yellow-100 text-yellow-700' : 'bg-muted text-muted-foreground'}`}>{rec.urgency}</span>
                        <span className="font-medium text-sm">{rec.product_name}</span>
                        {rec.lot_number && <span className="ml-2 text-xs text-muted-foreground">Lot: {rec.lot_number}</span>}
                        <div className="mt-1 text-xs text-muted-foreground">{rec.days_until_expiry}d left · {rec.current_stock} units on hand</div>
                      </div>
                      <div className="rounded-lg bg-background border border-border px-3 py-2 text-center">
                        <div className="text-xl font-bold text-primary">{rec.suggested_discount_pct}%</div>
                        <div className="text-xs text-muted-foreground">off</div>
                      </div>
                    </div>
                    <p className="mt-2 text-xs italic text-muted-foreground">"{rec.message}"</p>
                    <p className="mt-1 text-xs font-medium">→ {rec.suggested_action}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* ── Inventory Actions ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader><CardTitle>Inventory Actions</CardTitle><CardDescription>Select by item name, then post restocks and adjustments against the matching inventory SKU.</CardDescription></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          {/* Inline feedback — shown right here in the card, not at the top of the page */}
          {actionError && (
            <div className="md:col-span-4 rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">
              {actionError}
            </div>
          )}
          {actionNotice && (
            <div className="md:col-span-4 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
              {actionNotice}
            </div>
          )}
          <label className="space-y-1 text-sm"><span className="font-semibold text-muted-foreground">Item</span>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={selectedItemId}
              onChange={(e) => { setSelectedItemId(e.target.value); clearActionFeedback(); }}
            >
              <option value="">Select item...</option>{items.map((i) => <option key={i.id} value={i.id}>{inventoryActionLabel(i)}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm"><span className="font-semibold text-muted-foreground">Restock Qty</span><Input type="number" min="0" step="0.01" value={restockQty} onChange={(e) => setRestockQty(e.target.value)} placeholder="e.g. 25" /></label>
          <label className="space-y-1 text-sm"><span className="font-semibold text-muted-foreground">Adjustment Delta</span><Input type="number" step="0.01" value={adjustDelta} onChange={(e) => setAdjustDelta(e.target.value)} placeholder="e.g. -2.5" /></label>
          <label className="space-y-1 text-sm md:col-span-4"><span className="font-semibold text-muted-foreground">Notes</span><Input value={actionNotes} onChange={(e) => setActionNotes(e.target.value)} placeholder="Optional movement notes" /></label>
          <div className="md:col-span-4 flex flex-wrap gap-2">
            <Button onClick={submitRestock} disabled={submitting}>Restock Item</Button>
            <Button variant="secondary" onClick={submitAdjustment} disabled={submitting}>Apply Adjustment</Button>
            {selectedItem && <div className="ml-auto rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">Current: <strong>{asNumber(selectedItem.on_hand_qty).toLocaleString()}</strong> {selectedItem.unit || ''}</div>}
          </div>
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Inventory Count Reports</CardTitle><CardDescription>Print or export count sheets grouped by category.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-3">
              <label className="space-y-1 text-sm"><span className="font-semibold text-muted-foreground">Category Scope</span>
                <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={countCategoryFilter} onChange={(e) => setCountCategoryFilter(e.target.value)}>
                  <option value="all">All Categories</option>{countCategories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-sm"><span className="font-semibold text-muted-foreground">Recent Sales Filter</span>
                <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={recentSalesExclusionWindow} onChange={(e) => setRecentSalesExclusionWindow(e.target.value)}>
                  <option value="all">Include all items</option>
                  <option value="30">Exclude items not sold in 30 days</option>
                  <option value="60">Exclude items not sold in 60 days</option>
                  <option value="90">Exclude items not sold in 90 days</option>
                </select>
              </label>
              <label className="flex items-end gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-sm"><input type="checkbox" checked={includeZeroStockInCounts} onChange={(e) => setIncludeZeroStockInCounts(e.target.checked)} /><span>Include zero-stock items</span></label>
              <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-sm"><div className="font-semibold text-muted-foreground">Rows In Sheet</div><div className="mt-1 text-lg font-semibold">{countSheetRows.length.toLocaleString()}</div></div>
            </div>
            {recentSalesExclusionWindow !== 'all' && <div className="text-sm text-muted-foreground">{recentSoldQuery.isFetching ? `Checking sold items from the last ${recentSalesExclusionWindow} days...` : `Excluding items not sold in the last ${recentSalesExclusionWindow} days.`}</div>}
            {!recentSoldQuery.isFetching && !countSheetRows.length && (
              <div className="rounded-md border border-amber-300/80 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <div className="font-semibold">No count-sheet rows match the current filters.</div>
                <div className="mt-1">{countSheetEmptyState}</div>
                <div className="mt-1">Try switching Category Scope to `All Categories`, re-enabling zero-stock items, or widening the recent-sales filter.</div>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={printCountSheet} disabled={!countSheetRows.length || recentSoldQuery.isFetching}>Print Count Sheet</Button>
              <Button variant="outline" onClick={exportCountSheetCsv} disabled={!countSheetRows.length || recentSoldQuery.isFetching}>Export Count Sheet CSV</Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Transfer Inventory</CardTitle><CardDescription>Move stock between inventory SKUs.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {([['From Item', transferFromId, setTransferFromId], ['To Item', transferToId, setTransferToId]] as const).map(([label, val, setter]) => (
              <label key={label} className="space-y-1 text-sm"><span className="font-semibold text-muted-foreground">{label}</span>
                <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={val} onChange={(e) => setter(e.target.value)}>
                  <option value="">Select...</option>{items.map((i) => <option key={i.id} value={i.id}>{inventoryActionLabel(i)}</option>)}
                </select>
              </label>
            ))}
            <label className="space-y-1 text-sm"><span className="font-semibold text-muted-foreground">Quantity</span><Input type="number" min="0" step="0.01" value={transferQty} onChange={(e) => setTransferQty(e.target.value)} placeholder="e.g. 5" /></label>
            <label className="space-y-1 text-sm"><span className="font-semibold text-muted-foreground">Notes</span><Input value={transferNotes} onChange={(e) => setTransferNotes(e.target.value)} placeholder="Optional transfer notes" /></label>
            <Button onClick={submitTransfer} disabled={submitting}>Transfer Stock</Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Record Spoilage</CardTitle><CardDescription>Post waste/spoilage movements with reason and notes.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <label className="space-y-1 text-sm"><span className="font-semibold text-muted-foreground">Item</span>
              <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={spoilageItemId} onChange={(e) => setSpoilageItemId(e.target.value)}>
                <option value="">Select item...</option>{items.map((i) => <option key={i.id} value={i.id}>{inventoryActionLabel(i)}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm"><span className="font-semibold text-muted-foreground">Quantity</span><Input type="number" min="0" step="0.01" value={spoilageQty} onChange={(e) => setSpoilageQty(e.target.value)} placeholder="e.g. 2" /></label>
            <label className="space-y-1 text-sm"><span className="font-semibold text-muted-foreground">Reason</span><Input value={spoilageReason} onChange={(e) => setSpoilageReason(e.target.value)} placeholder="Temperature excursion" /></label>
            <label className="space-y-1 text-sm"><span className="font-semibold text-muted-foreground">Notes</span><Input value={spoilageNotes} onChange={(e) => setSpoilageNotes(e.target.value)} placeholder="Optional spoilage notes" /></label>
            <Button variant="secondary" onClick={submitSpoilage} disabled={submitting}>Post Spoilage</Button>
          </CardContent>
        </Card>
      </div>
      <InventoryLedger
        ledgerLoading={ledgerQuery.isFetching}
        ledgerSummary={ledgerSummary}
        ledgerEntries={ledgerEntries}
        ledgerItemFilter={ledgerItemFilter}
        ledgerTypeFilter={ledgerTypeFilter}
        ledgerLimit={ledgerLimit}
        onItemFilterChange={setLedgerItemFilter}
        onTypeFilterChange={setLedgerTypeFilter}
        onLimitChange={setLedgerLimit}
        onApplyFilters={commitLedgerFilters}
        onRefresh={() => void ledgerQuery.refetch()}
      />
      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div><CardTitle>Inventory Overview</CardTitle><CardDescription>Live stock visibility. Toggle <strong>FTL</strong> (FDA Traceability List) to require lot assignment on every order for that product.</CardDescription></div>
          <div className="flex flex-wrap gap-2 items-center">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search item/category" className="w-56" />
            <Button
              variant={showInactive ? 'secondary' : 'outline'}
              onClick={() => setShowInactive((v) => !v)}
              title={showInactive ? 'Currently showing all items including inactive — click to hide inactive' : 'Inactive (seasonal/off-season) items are hidden — click to show them'}
            >
              {showInactive ? '🙈 Hide Inactive' : '👁 Show Inactive'}
            </Button>
            {showInactive && (
              <span className="text-xs text-muted-foreground">
                {items.filter((i) => i.is_active === false).length} inactive item{items.filter((i) => i.is_active === false).length !== 1 ? 's' : ''} visible
              </span>
            )}
            <Button variant="outline" onClick={() => void inventoryQuery.refetch()} className="ml-auto">Refresh</Button>
          </div>
        </CardHeader>
        <CardContent className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader><TableRow><TableHead>Item #</TableHead><TableHead>Description</TableHead><TableHead>Category</TableHead><TableHead>On Hand</TableHead><TableHead>Cost</TableHead><TableHead>Status</TableHead><TableHead title="Active items appear in orders and counts; inactive = seasonal/off-season">Active</TableHead><TableHead title="FDA Food Traceability List">FTL</TableHead><TableHead title="Sold by actual measured weight">Catch Wt</TableHead><TableHead title="Default price per pound">$/lb</TableHead></TableRow></TableHeader>
            <TableBody>
              {filtered.length ? filtered.map((item) => {
                const qty = asNumber(item.on_hand_qty);
                const isInactive = item.is_active === false;
                const status = qty <= 0 ? <Badge variant="warning">Out</Badge> : qty <= 10 ? <Badge variant="secondary">Low</Badge> : <Badge variant="success">Healthy</Badge>;
                return (
                  <TableRow key={item.id} className={isInactive ? 'opacity-50' : ''}>
                    <TableCell className="font-medium">
                      {item.item_number ?? '-'}
                      {isInactive && <span className="ml-1.5 rounded bg-gray-200 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">Inactive</span>}
                    </TableCell>
                    <TableCell>{item.description ?? '-'}</TableCell>
                    <TableCell>{item.category ?? '-'}</TableCell>
                    <TableCell>{qty.toLocaleString()} {item.unit ?? ''}</TableCell>
                    <TableCell>{money(asNumber(item.cost))}</TableCell>
                    <TableCell>{status}</TableCell>
                    <TableCell><ActiveToggle item={item} onToggled={patchCachedItem} /></TableCell>
                    <TableCell><FtlToggle item={item} onToggled={patchCachedItem} /></TableCell>
                    <TableCell><CatchWeightToggle item={item} onToggled={patchCachedItem} /></TableCell>
                    <TableCell>{item.is_catch_weight ? <CatchWeightPriceInput item={item} onSaved={patchCachedItem} /> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                  </TableRow>
                );
              }) : <TableRow><TableCell colSpan={9} className="text-muted-foreground">No inventory rows available.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
