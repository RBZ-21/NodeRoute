import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useCompanyConfig } from '../hooks/useCompanyConfig';
import { useCompanySettings } from '../hooks/useSettings';
import { useQueryClient } from '@tanstack/react-query';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { getUserRole, hasRole } from '../lib/api';
import type { CountSheetRow, InventoryItem, InventoryLotSummary, LedgerEntry, LedgerSummary } from '../types/inventory.types';
import { ActiveToggle, CatchWeightPriceInput, CatchWeightToggle, FtlToggle, InventoryLedger } from '../components/inventory';
import {
  useActiveInventoryLotsQuery,
  type LedgerParams,
  useInventoryQuery,
  useLedgerQuery,
  useAddInventoryItemMutation,
  useEditInventoryItemMutation,
  useLowStockQuery,
  useRecentSoldQuery,
  useSetReorderPointMutation,
  useSpoilageMutation,
  useTransferMutation,
} from '../hooks/useInventory';
import { SmartReorderAlertsCard } from './SmartReorderAlertsCard';
import { InventoryAiHealthCard } from './InventoryAiHealthCard';
import { InventoryMarkdownRecsCard } from './InventoryMarkdownRecsCard';
import { InventoryActionsCard } from './InventoryActionsCard';
import { NegativeStockQty } from '../components/inventory/NegativeStock';
import { AiInsightBanner } from '../components/ui/ai-insight-banner';
import { asNumber, inventoryActionLabel } from './inventory.helpers';

function money(v: number) { return v.toLocaleString('en-US', { style: 'currency', currency: 'USD' }); }
function reportNumber(v: unknown) { return asNumber(v).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
function reportDescription(item: InventoryItem) { return item.description_line_1 || item.description || item.name || ''; }
function reportClassName(item: InventoryItem) { return item.class_name || item.category || ''; }
function reportCostBase(item: InventoryItem) { return item.cost_base ?? item.base_cost ?? item.cost; }
function reportCostReal(item: InventoryItem) { return item.cost_real ?? item.real_cost ?? item.cost; }
function reportOnHandQuantity(item: InventoryItem) { return item.on_hand_quantity ?? item.on_hand_qty; }
function csvEscape(v: string) { return `"${String(v).replace(/"/g, '""')}"`; }
function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((r) => r.map(csvEscape).join(',')).join('\n');
  const href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = href; a.download = filename; a.click(); URL.revokeObjectURL(href);
}
function sanitizeHtml(v: string) { return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function storedCompanyName() {
  try {
    const user = JSON.parse(localStorage.getItem('nr_user') || '{}');
    return String(user.companyName || user.company_name || '').trim();
  } catch {
    return '';
  }
}
function formatInventoryLotDate(value: unknown) {
  if (!value) return '';
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString();
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
  if (countCategoryFilter !== 'all') reasons.push(`class name scope is limited to ${countCategoryFilter}`);
  if (recentSalesExclusionWindow !== 'all') reasons.push(`items not sold in the last ${recentSalesExclusionWindow} days are excluded`);
  if (!includeZeroStockInCounts) reasons.push('zero-stock items are hidden');
  if (!reasons.length) return 'No inventory rows are available for a count sheet yet.';
  return `No inventory rows match the current count-sheet filters because ${reasons.join(', ')}.`;
}
function InventoryLotsCell({ lots, isFtlProduct }: { lots: InventoryLotSummary[]; isFtlProduct?: boolean }) {
  if (!lots.length) {
    return <span className="text-xs text-muted-foreground">{isFtlProduct ? 'No active lots' : '—'}</span>;
  }

  const visibleLots = lots.slice(0, 2);
  return (
    <div className="space-y-1">
      {visibleLots.map((lot) => (
        <div key={lot.id || lot.lot_number} className="leading-tight">
          <div className="font-mono text-xs font-semibold text-foreground">{lot.lot_number}</div>
          <div className="text-[11px] text-muted-foreground">
            {lot.expiration_date
              ? `Exp ${formatInventoryLotDate(lot.expiration_date)}`
              : lot.received_date
                ? `Received ${formatInventoryLotDate(lot.received_date)}`
                : 'Active lot'}
          </div>
        </div>
      ))}
      {lots.length > visibleLots.length && (
        <div className="text-[11px] text-muted-foreground">+{lots.length - visibleLots.length} more active lot{lots.length - visibleLots.length === 1 ? '' : 's'}</div>
      )}
    </div>
  );
}

type InventoryWorkflowTab = 'overview' | 'costs' | 'cycle-counts' | 'kits' | 'availability' | 'returns';

const INVENTORY_WORKFLOW_TABS: { id: InventoryWorkflowTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'costs', label: 'Costs' },
  { id: 'cycle-counts', label: 'Cycle Counts' },
  { id: 'kits', label: 'Kits' },
  { id: 'availability', label: 'Availability' },
  { id: 'returns', label: 'Returns' },
];

function InventoryWorkflowPanel({ tab, onOpenKits }: { tab: InventoryWorkflowTab; onOpenKits: () => void }) {
  if (tab === 'overview') return null;
  const content: Record<Exclude<InventoryWorkflowTab, 'overview'>, { title: string; description: string; action?: JSX.Element }> = {
    costs: {
      title: 'Costs',
      description: 'Base, landed, lot, market, and real cost fields are available on item edit and lot workflows.',
    },
    'cycle-counts': {
      title: 'Cycle Counts',
      description: 'Cycle count APIs are ready for count creation, variance submission, and ledger-backed commit.',
    },
    kits: {
      title: 'Kits',
      description: 'Run in-house kit recipes and review processing runs from the Kits workspace.',
      action: <Button variant="outline" onClick={onOpenKits}>Open Kits</Button>,
    },
    availability: {
      title: 'Availability',
      description: '30-day projection data is available through the inventory projection endpoint.',
    },
    returns: {
      title: 'Returns',
      description: 'Inventory returns can be recorded and optionally restocked through the returns workflow.',
    },
  };
  const selected = content[tab];
  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle>{selected.title}</CardTitle>
          <CardDescription>{selected.description}</CardDescription>
        </div>
        {selected.action}
      </CardHeader>
    </Card>
  );
}

export function InventoryPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { features } = useCompanyConfig();
  const { data: companySettings } = useCompanySettings();

  // "Fix" requests jump into the Inventory Actions adjustment flow pre-filled
  // with the SKU. Also honoured via /inventory?fix=<item_number> deep links.
  const [fixRequest, setFixRequest] = useState<{ itemId: string; nonce: number } | null>(null);
  const requestFix = useCallback((itemId: string) => {
    setFixRequest({ itemId, nonce: Date.now() });
  }, []);

  // ── Queries ───────────────────────────────────────────────────────────────
  const inventoryQuery = useInventoryQuery();
  const items = useMemo(() => inventoryQuery.data ?? [], [inventoryQuery.data]);
  const activeLotsQuery = useActiveInventoryLotsQuery();
  const activeLots = useMemo(() => activeLotsQuery.data ?? [], [activeLotsQuery.data]);

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

  const lowStockQuery = useLowStockQuery();
  const lowStockItems = lowStockQuery.data ?? [];

  // Deep link: /inventory?fix=<item_number> (used by dashboard negative-stock alerts)
  const fixParam = String(searchParams.get('fix') || '').trim();
  useEffect(() => {
    if (!fixParam || !items.length) return;
    const target = items.find((i) => String(i.item_number || '').trim().toLowerCase() === fixParam.toLowerCase());
    if (target) requestFix(target.id);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('fix');
    setSearchParams(nextParams, { replace: true });
  }, [fixParam, items, requestFix, searchParams, setSearchParams]);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const addItemMutation        = useAddInventoryItemMutation();
  const editItemMutation       = useEditInventoryItemMutation();
  const transferMutation       = useTransferMutation();
  const spoilageMutation       = useSpoilageMutation();
  const setReorderPointMutation = useSetReorderPointMutation();

  // ── Local UI state ────────────────────────────────────────────────────────
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [addForm, setAddForm] = useState({ item_number: '', description: '', category: '', unit: 'lb', cost: '', on_hand_qty: '0', reorder_point: '', barcode: '' });
  const [addItemError, setAddItemError] = useState('');

  type EditForm = { item_number: string; description: string; category: string; unit: string; cost: string; base_cost: string; landed_cost: string; lot_cost: string; market_cost: string; real_cost: string; reorder_point: string; barcode: string };
  const [editingItemNumber, setEditingItemNumber] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ item_number: '', description: '', category: '', unit: 'lb', cost: '', base_cost: '', landed_cost: '', lot_cost: '', market_cost: '', real_cost: '', reorder_point: '', barcode: '' });
  const [editItemError, setEditItemError] = useState('');
  const canEditCosts = hasRole(getUserRole(), 'manager');

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
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

  // Initialise selector dropdowns once the first inventory load completes.
  // Use the first item whose item_number is truthy so we never silently
  // pre-select a blank value and disable the action buttons unexpectedly.
  const selectorInitialized = useRef(false);
  useEffect(() => {
    if (selectorInitialized.current || !items.length) return;
    selectorInitialized.current = true;
    const firstItem = items[0];
    setSpoilageItemId(firstItem?.id || '');
    setTransferFromId(firstItem?.id || '');
    const secondItem = items.find((i) => i.id !== firstItem?.id);
    if (secondItem) setTransferToId(secondItem.id);
  }, [items]);

  // ── Inventory action helpers ───────────────────────────────────────────────
  async function handleAddItem(e: React.FormEvent) {
    e.preventDefault();
    setAddItemError('');
    if (!addForm.item_number.trim()) { setAddItemError('Item number is required.'); return; }
    if (!addForm.description.trim()) { setAddItemError('Description is required.'); return; }
    try {
      await addItemMutation.mutateAsync({
        item_number: addForm.item_number.trim(),
        description: addForm.description.trim(),
        description_line_1: addForm.description.trim(),
        category: addForm.category.trim() || 'Other',
        class_name: addForm.category.trim() || 'Other',
        unit: addForm.unit.trim() || 'lb',
        cost: addForm.cost !== '' ? Number(addForm.cost) : undefined,
        base_cost: addForm.cost !== '' ? Number(addForm.cost) : undefined,
        cost_base: addForm.cost !== '' ? Number(addForm.cost) : undefined,
        real_cost: addForm.cost !== '' ? Number(addForm.cost) : undefined,
        cost_real: addForm.cost !== '' ? Number(addForm.cost) : undefined,
        on_hand_qty: Number(addForm.on_hand_qty) || 0,
        on_hand_quantity: Number(addForm.on_hand_qty) || 0,
        reorder_point: addForm.reorder_point !== '' ? Number(addForm.reorder_point) : null,
        barcode: addForm.barcode.trim() || null,
      });
      setAddForm({ item_number: '', description: '', category: '', unit: 'lb', cost: '', on_hand_qty: '0', reorder_point: '', barcode: '' });
      setAddItemOpen(false);
      setNotice('Item added successfully.');
    } catch (err) {
      setAddItemError((err as Error).message || 'Failed to add item.');
    }
  }

  function openEditItem(item: InventoryItem) {
    setEditingItemNumber(item.item_number ?? '');
    setEditForm({
      item_number:   String(item.item_number ?? ''),
      description:   String(reportDescription(item)),
      category:      String(reportClassName(item)),
      unit:          String(item.unit ?? 'lb'),
      cost:          item.cost != null ? String(asNumber(item.cost)) : '',
      base_cost:     reportCostBase(item) != null ? String(asNumber(reportCostBase(item))) : '',
      landed_cost:   item.landed_cost != null ? String(asNumber(item.landed_cost)) : '',
      lot_cost:      item.lot_cost    != null ? String(asNumber(item.lot_cost))    : '',
      market_cost:   item.market_cost != null ? String(asNumber(item.market_cost)) : '',
      real_cost:     reportCostReal(item) != null ? String(asNumber(reportCostReal(item))) : '',
      reorder_point: item.reorder_point != null ? String(asNumber(item.reorder_point)) : '',
      barcode:       String(item.barcode ?? ''),
    });
    setEditItemError('');
  }

  async function handleEditItem(e: React.FormEvent) {
    e.preventDefault();
    if (!editingItemNumber) return;
    setEditItemError('');
    if (!editForm.item_number.trim()) { setEditItemError('Item number is required.'); return; }
    if (!editForm.description.trim()) { setEditItemError('Description is required.'); return; }
    try {
      await editItemMutation.mutateAsync({
        itemNumber: editingItemNumber,
        patch: {
          item_number:   editForm.item_number.trim(),
          description:   editForm.description.trim(),
          description_line_1: editForm.description.trim(),
          category:      editForm.category.trim() || undefined,
          class_name:    editForm.category.trim() || undefined,
          unit:          editForm.unit || undefined,
          cost:          editForm.cost !== '' ? Number(editForm.cost) : undefined,
          ...(canEditCosts ? {
            base_cost:   editForm.base_cost   !== '' ? Number(editForm.base_cost)   : undefined,
            cost_base:   editForm.base_cost   !== '' ? Number(editForm.base_cost)   : undefined,
            landed_cost: editForm.landed_cost !== '' ? Number(editForm.landed_cost) : undefined,
            lot_cost:    editForm.lot_cost    !== '' ? Number(editForm.lot_cost)    : undefined,
            market_cost: editForm.market_cost !== '' ? Number(editForm.market_cost) : undefined,
            real_cost:   editForm.real_cost   !== '' ? Number(editForm.real_cost)   : undefined,
            cost_real:   editForm.real_cost   !== '' ? Number(editForm.real_cost)   : undefined,
          } : {}),
          reorder_point: editForm.reorder_point !== '' ? Number(editForm.reorder_point) : null,
          barcode:       editForm.barcode.trim() || null,
        },
      });
      setEditingItemNumber(null);
      setNotice('Item updated.');
    } catch (err) {
      setEditItemError((err as Error).message || 'Failed to update item.');
    }
  }

  function patchCachedItem(updated: Pick<InventoryItem, 'item_number'> & Partial<InventoryItem>) {
    queryClient.setQueryData<InventoryItem[]>(['inventory'], (old) =>
      old?.map((it) => it.item_number === updated.item_number ? { ...it, ...updated } : it) ?? old,
    );
  }

  function commitLedgerFilters() {
    setLedgerCommitted({ itemFilter: ledgerItemFilter, typeFilter: ledgerTypeFilter, limit: ledgerLimit });
  }

  // ── Mutations ─────────────────────────────────────────────────────────────
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
      .filter((i) => !n || [i.item_number, reportDescription(i), reportClassName(i)].filter(Boolean).some((p) => String(p).toLowerCase().includes(n)));
  }, [items, search, showInactive]);
  // Out Of Stock intentionally excludes inactive (seasonal/discontinued) SKUs —
  // they are not expected to have stock, so counting them inflates the KPI.
  const summary = useMemo(() => ({ totalSkus: items.length, lowStock: items.filter((i) => asNumber(reportOnHandQuantity(i)) > 0 && asNumber(reportOnHandQuantity(i)) <= 10).length, outOfStock: items.filter((i) => i.is_active !== false && asNumber(reportOnHandQuantity(i)) <= 0).length, inventoryValue: items.reduce((s, i) => s + (asNumber(i.value_at_cost) || asNumber(reportOnHandQuantity(i)) * asNumber(reportCostBase(i))), 0) }), [items]);
  const countSheetRows = useMemo(() => {
    const rows = items.map((item) => ({ id: item.id, item_number: String(item.item_number || '').trim(), description: String(reportDescription(item)).trim() || 'Unnamed item', category: String(reportClassName(item) || 'Uncategorized').trim() || 'Uncategorized', on_hand_qty: asNumber(reportOnHandQuantity(item)), unit: String(item.unit || '').trim() })).filter((i) => i.item_number || i.description);
    return rows.filter((i) => countCategoryFilter === 'all' || i.category === countCategoryFilter).filter((i) => includeZeroStockInCounts || i.on_hand_qty > 0).filter((i) => { if (recentSalesExclusionWindow === 'all' || !recentSoldItemKeys) return true; return recentSoldItemKeys.has(i.item_number.trim().toLowerCase()) || recentSoldItemKeys.has(i.description.trim().toLowerCase()); }).sort((a, b) => itemCategoryCompare(a, b) || a.description.localeCompare(b.description) || a.item_number.localeCompare(b.item_number));
  }, [items, countCategoryFilter, includeZeroStockInCounts, recentSalesExclusionWindow, recentSoldItemKeys]);
  const countCategories = useMemo(() => [...new Set(items.map((i) => String(reportClassName(i) || 'Uncategorized').trim() || 'Uncategorized'))].sort((a, b) => a.localeCompare(b)), [items]);
  const countSheetGroups = useMemo(() => { const g = new Map<string, CountSheetRow[]>(); for (const r of countSheetRows) { const l = g.get(r.category) ?? []; l.push(r); g.set(r.category, l); } return [...g.entries()].map(([category, rows]) => ({ category, rows })); }, [countSheetRows]);
  const countSheetEmptyState = useMemo(() => countSheetEmptyMessage({
    countCategoryFilter,
    recentSalesExclusionWindow,
    includeZeroStockInCounts,
  }), [countCategoryFilter, recentSalesExclusionWindow, includeZeroStockInCounts]);
  const activeLotsByProduct = useMemo(() => {
    const grouped = new Map<string, InventoryLotSummary[]>();
    for (const lot of activeLots) {
      const productId = String(lot.product_id || '').trim();
      if (!productId) continue;
      const existing = grouped.get(productId) ?? [];
      existing.push(lot);
      grouped.set(productId, existing);
    }
    for (const [productId, lots] of grouped.entries()) {
      grouped.set(productId, [...lots].sort((a, b) => {
        const aDate = new Date(String(a.received_date || a.created_at || 0)).getTime();
        const bDate = new Date(String(b.received_date || b.created_at || 0)).getTime();
        return bDate - aDate;
      }));
    }
    return grouped;
  }, [activeLots]);

  function exportCountSheetCsv() {
    const scope = countCategoryFilter === 'all' ? 'all-categories' : countCategoryFilter.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    downloadCsv(`inventory-count-sheet-${scope}.csv`, [['Class Name','Item Number','Description Line 1','On Hand Quantity','Unit','Physical Count'], ...countSheetRows.map((i) => [i.category, i.item_number, i.description, i.on_hand_qty.toLocaleString(), i.unit, ''])]);
  }
  function printCountSheet() {
    const popup = window.open('', '_blank', 'width=1100,height=800');
    if (!popup) { setError('Could not open the print view. Please allow pop-ups and try again.'); return; }
    const scopeLabel = countCategoryFilter === 'all' ? 'All Class Names' : countCategoryFilter;
    const companyName = String(companySettings?.businessName || storedCompanyName() || 'NodeRoute Systems').trim() || 'NodeRoute Systems';
    const escapedCompanyName = sanitizeHtml(companyName);
    const printTitle = `${companyName} Inventory Count Sheet`;
    const escapedPrintTitle = sanitizeHtml(printTitle);
    const sections = countSheetGroups.map((g) => `<section class="category-block"><h2>${sanitizeHtml(g.category)}</h2><table><thead><tr><th>Item Number</th><th>Description Line 1</th><th>On Hand Quantity</th><th>Unit</th><th>Physical Count</th></tr></thead><tbody>${g.rows.map((i) => `<tr><td>${sanitizeHtml(i.item_number||'-')}</td><td>${sanitizeHtml(i.description)}</td><td>${sanitizeHtml(i.on_hand_qty.toLocaleString())}</td><td>${sanitizeHtml(i.unit||'-')}</td><td class="blank-cell"></td></tr>`).join('')}</tbody></table></section>`).join('');
    popup.document.write(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>${escapedPrintTitle}</title><style>body{font-family:Arial,sans-serif;margin:24px;color:#111827}h1{margin:0 0 6px;font-size:24px}.meta{margin-bottom:18px;color:#4b5563;font-size:12px}.category-block{margin-bottom:28px;page-break-inside:avoid}h2{margin:0 0 10px;font-size:18px;border-bottom:1px solid #d1d5db;padding-bottom:4px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #d1d5db;padding:8px 10px;font-size:12px;text-align:left}th{background:#f3f4f6}.blank-cell{min-width:140px;height:28px}.print-footer{display:none}@media print{body{margin:12px 12px 36px}.print-footer{display:block;position:fixed;bottom:0;left:0;font-size:10px;color:#4b5563}}</style></head><body><h1>Inventory Count Sheet</h1><div class="meta">${escapedCompanyName} · Class Name scope: ${sanitizeHtml(scopeLabel)} · Generated ${sanitizeHtml(new Date().toLocaleString())}</div>${sections||'<p>No inventory rows match the selected filters.</p>'}<div class="print-footer">${escapedCompanyName}</div></body></html>`);
    try {
      const companySlug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'company';
      popup.history?.replaceState?.(null, printTitle, `/print/${companySlug}/inventory-count-sheet`);
    } catch {}
    popup.document.close(); popup.focus(); popup.print();
  }

  const fetchError = inventoryQuery.error
    ? String((inventoryQuery.error as Error)?.message || 'Could not load inventory')
    : '';
  const displayError = error || fetchError;
  const tabParam = String(searchParams.get('tab') || 'overview') as InventoryWorkflowTab;
  const inventoryWorkflowTab = INVENTORY_WORKFLOW_TABS.some((tab) => tab.id === tabParam) ? tabParam : 'overview';

  function setInventoryWorkflowTab(tab: InventoryWorkflowTab) {
    const next = new URLSearchParams(searchParams);
    if (tab === 'overview') next.delete('tab'); else next.set('tab', tab);
    setSearchParams(next);
  }

  return (
    <div className="space-y-5">
      {inventoryQuery.isPending && <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading inventory...</div>}
      {displayError && <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{displayError}</div>}
      {notice && <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div>}
      <AiInsightBanner types={['reorder']} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="SKUs" value={summary.totalSkus.toLocaleString()} />
        <SummaryCard label="Low Stock" value={summary.lowStock.toLocaleString()} />
        <SummaryCard label="Out Of Stock" value={summary.outOfStock.toLocaleString()} />
        <SummaryCard label="Inventory Value" value={money(summary.inventoryValue)} />
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border">
        {INVENTORY_WORKFLOW_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setInventoryWorkflowTab(tab.id)}
            className={[
              'border-b-2 px-4 py-2 text-sm font-medium transition-colors -mb-px',
              inventoryWorkflowTab === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <InventoryWorkflowPanel tab={inventoryWorkflowTab} onOpenKits={() => navigate('/kits')} />

      {/* ── Low-Stock Alert Banner ─────────────────────────────────────── */}
      {lowStockItems.length > 0 && (
        <Card className="border-rose-200 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/30">
          <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between py-3">
            <div>
              <CardTitle className="text-base text-rose-700 dark:text-rose-300">{lowStockItems.length} Item{lowStockItems.length !== 1 ? 's' : ''} Below Reorder Threshold</CardTitle>
              <CardDescription className="text-rose-600 dark:text-rose-300">These items have fallen at or below their set reorder points. Create purchase orders to replenish stock.</CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={() => navigate('/purchasing')}>Open Purchasing</Button>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {lowStockItems.map((item) => (
                <div key={item.item_number} className="flex items-center justify-between rounded-lg border border-rose-200 bg-white px-3 py-2 dark:border-rose-800 dark:bg-rose-950/40">
                  <div>
                    <div className="text-sm font-medium text-foreground">{reportDescription(item) || item.item_number}</div>
                    <div className="text-xs text-muted-foreground">
                      On Hand Quantity: {asNumber(reportOnHandQuantity(item)) < 0
                        ? <NegativeStockQty qty={asNumber(reportOnHandQuantity(item))} onFix={() => { const match = items.find((i) => String(i.item_number || '').trim() === String(item.item_number || '').trim()); if (match) requestFix(match.id); }} />
                        : <strong className="text-foreground">{asNumber(reportOnHandQuantity(item)).toFixed(1)}</strong>} · Reorder at: {asNumber(item.reorder_point).toFixed(1)} · Short by: <strong className="text-rose-600 dark:text-rose-300">{item.deficit.toFixed(1)}</strong> {item.unit || ''}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-2 shrink-0 text-xs"
                    onClick={() => navigate(`/purchasing?item=${encodeURIComponent(item.item_number || '')}&qty=${Math.ceil(item.deficit)}`)}
                  >
                    Order
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── AI Health Analysis ─────────────────────────────────────────── */}
      <InventoryAiHealthCard />

      {/* ── AI Markdown Recommendations ── */}
      <InventoryMarkdownRecsCard />

      {/* ── Smart Reorder Alerts ──────────────────────────────────────────── */}
      <SmartReorderAlertsCard />

      {/* ── Inventory Actions ─────────────────────────────────────────────── */}
      <InventoryActionsCard items={items} fixRequest={fixRequest} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Inventory Count Reports</CardTitle><CardDescription>Print or export count sheets grouped by class name.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-3">
              <label className="space-y-1 text-sm"><span className="font-semibold text-muted-foreground">Class Name Scope</span>
                <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={countCategoryFilter} onChange={(e) => setCountCategoryFilter(e.target.value)}>
                  <option value="all">All Class Names</option>{countCategories.map((c) => <option key={c} value={c}>{c}</option>)}
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
                <div className="mt-1">Try switching Class Name Scope to `All Class Names`, re-enabling zero-stock items, or widening the recent-sales filter.</div>
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
            <Button
              variant="outline"
              onClick={() => {
                void inventoryQuery.refetch();
                void activeLotsQuery.refetch();
              }}
            >
              Refresh
            </Button>
            <Button onClick={() => { setAddItemOpen((v) => !v); setAddItemError(''); }}>
              {addItemOpen ? 'Cancel' : '+ Add Item'}
            </Button>
          </div>
        </CardHeader>

        {addItemOpen && (
          <div className="border-b border-border bg-muted/30 px-4 py-4">
            <form onSubmit={(e) => { void handleAddItem(e); }} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="space-y-1 text-sm">
                <span className="font-semibold">Item Number <span className="text-destructive">*</span></span>
                <Input value={addForm.item_number} onChange={(e) => setAddForm((f) => ({ ...f, item_number: e.target.value }))} placeholder="e.g. SALMON-001" required />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-semibold">Description Line 1 <span className="text-destructive">*</span></span>
                <Input value={addForm.description} onChange={(e) => setAddForm((f) => ({ ...f, description: e.target.value }))} placeholder="e.g. Atlantic Salmon Fillet" required />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-semibold">Class Name</span>
                <Input value={addForm.category} onChange={(e) => setAddForm((f) => ({ ...f, category: e.target.value }))} placeholder="e.g. Seafood" list="inv-category-list" />
                <datalist id="inv-category-list">
                  {[...new Set(items.map((i) => reportClassName(i)).filter(Boolean))].sort().map((c) => <option key={c as string} value={c as string} />)}
                </datalist>
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-semibold">Unit</span>
                <select
                  value={addForm.unit}
                  onChange={(e) => setAddForm((f) => ({ ...f, unit: e.target.value }))}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="each">each</option>
                  <option value="lb">lb</option>
                  <option value="kg">kg</option>
                  <option value="oz">oz</option>
                  <option value="case">case</option>
                  <option value="gal">gal</option>
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-semibold">Cost: Base ($)</span>
                <Input type="number" min="0" step="0.01" value={addForm.cost} onChange={(e) => setAddForm((f) => ({ ...f, cost: e.target.value }))} placeholder="0.00" />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-semibold">On Hand Quantity</span>
                <Input type="number" min="0" step="0.01" value={addForm.on_hand_qty} onChange={(e) => setAddForm((f) => ({ ...f, on_hand_qty: e.target.value }))} placeholder="0" />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-semibold">Reorder point</span>
                <Input type="number" min="0" step="1" value={addForm.reorder_point} onChange={(e) => setAddForm((f) => ({ ...f, reorder_point: e.target.value }))} placeholder="e.g. 20" />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-semibold">Barcode (UPC/EAN)</span>
                <Input value={addForm.barcode} onChange={(e) => setAddForm((f) => ({ ...f, barcode: e.target.value }))} placeholder="optional" />
              </label>
              {addItemError && <div className="sm:col-span-2 lg:col-span-4 text-sm text-destructive">{addItemError}</div>}
              <div className="sm:col-span-2 lg:col-span-4 flex gap-2">
                <Button type="submit" disabled={addItemMutation.isPending}>
                  {addItemMutation.isPending ? 'Saving…' : 'Save Item'}
                </Button>
                <Button type="button" variant="outline" onClick={() => { setAddItemOpen(false); setAddItemError(''); }}>Cancel</Button>
              </div>
            </form>
          </div>
        )}

        <CardContent className="rounded-lg border border-border bg-card p-2">
          <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Item Number</TableHead>
              <TableHead>Description Line 1</TableHead>
              <TableHead>Class Name</TableHead>
              {features.fsmaLotTracking && <TableHead>Active Lots</TableHead>}
              <TableHead>Allocated Quantity</TableHead>
              <TableHead>On Hand Weight</TableHead>
              <TableHead>On Hand Quantity</TableHead>
              <TableHead>Cost: Base</TableHead>
              <TableHead>Cost: Real</TableHead>
              <TableHead>Value at Cost</TableHead>
              <TableHead>Value at Level 1</TableHead>
              <TableHead>Status</TableHead>
              <TableHead title="Stock level that triggers a reorder alert">Reorder Pt</TableHead>
              <TableHead title="Active items appear in orders and counts; inactive = seasonal/off-season">Active</TableHead>
              <TableHead />
              {features.fsmaLotTracking && <TableHead title="FDA Food Traceability List">FTL</TableHead>}
              {features.catchWeight     && <TableHead title="Sold by actual measured weight">Catch Wt</TableHead>}
              {features.catchWeight     && <TableHead title="Default price per pound">$/lb</TableHead>}
            </TableRow></TableHeader>
            <TableBody>
              {filtered.length ? filtered.map((item) => {
                const qty = asNumber(reportOnHandQuantity(item));
                const itemLots = activeLotsByProduct.get(String(item.item_number || '').trim()) ?? [];
                const isInactive = item.is_active === false;
                const status = qty < 0 ? <Badge variant="destructive">Negative</Badge> : qty <= 0 ? <Badge variant="warning">Out</Badge> : qty <= 10 ? <Badge variant="secondary">Low</Badge> : <Badge variant="success">Healthy</Badge>;
                return (
                  <Fragment key={item.id}>
                  <TableRow className={isInactive ? 'opacity-50' : ''}>
                    <TableCell className="font-medium">
                      {item.item_number ?? '-'}
                      {isInactive && <span className="ml-1.5 rounded bg-gray-200 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">Inactive</span>}
                    </TableCell>
                    <TableCell>{reportDescription(item) || '-'}</TableCell>
                    <TableCell>{reportClassName(item) || '-'}</TableCell>
                    {features.fsmaLotTracking && <TableCell><InventoryLotsCell lots={itemLots} isFtlProduct={item.is_ftl_product} /></TableCell>}
                    <TableCell>{reportNumber(item.allocated_quantity)}</TableCell>
                    <TableCell>{reportNumber(item.on_hand_weight)}</TableCell>
                    <TableCell>
                      {qty < 0
                        ? <NegativeStockQty qty={qty} unit={item.unit ?? ''} onFix={() => requestFix(item.id)} />
                        : <>{qty.toLocaleString()} {item.unit ?? ''}</>}
                    </TableCell>
                    <TableCell>{money(asNumber(reportCostBase(item)))}</TableCell>
                    <TableCell>{money(asNumber(reportCostReal(item)))}</TableCell>
                    <TableCell>{money(asNumber(item.value_at_cost))}</TableCell>
                    <TableCell>{money(asNumber(item.value_at_level_1))}</TableCell>
                    <TableCell>{status}</TableCell>
                    <TableCell><ReorderPointCell item={item} onSaved={(val) => { setReorderPointMutation.mutate({ itemNumber: item.item_number ?? '', reorderPoint: val }); patchCachedItem({ ...item, reorder_point: val }); }} /></TableCell>
                    <TableCell><ActiveToggle item={item} onToggled={patchCachedItem} /></TableCell>
                    {features.fsmaLotTracking && <TableCell><FtlToggle item={item} onToggled={patchCachedItem} /></TableCell>}
                    {features.catchWeight     && <TableCell><CatchWeightToggle item={item} onToggled={patchCachedItem} /></TableCell>}
                    {features.catchWeight     && <TableCell>{item.is_catch_weight ? <CatchWeightPriceInput item={item} onSaved={patchCachedItem} /> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>}
                    <TableCell>
                      <Button size="sm" variant="ghost" className="text-xs h-7 px-2" onClick={() => openEditItem(item)}>Edit</Button>
                    </TableCell>
                  </TableRow>
                  {editingItemNumber === item.item_number && (
                    <TableRow>
                      <TableCell colSpan={14 + (features.fsmaLotTracking ? 2 : 0) + (features.catchWeight ? 2 : 0)} className="bg-muted/30 p-0">
                        <form onSubmit={(e) => { void handleEditItem(e); }} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 px-4 py-4">
                          <label className="space-y-1 text-sm">
                            <span className="font-semibold">Item Number <span className="text-destructive">*</span></span>
                            <Input value={editForm.item_number} onChange={(e) => setEditForm((f) => ({ ...f, item_number: e.target.value }))} required />
                          </label>
                          <label className="space-y-1 text-sm">
                            <span className="font-semibold">Description Line 1 <span className="text-destructive">*</span></span>
                            <Input value={editForm.description} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))} required />
                          </label>
                          <label className="space-y-1 text-sm">
                            <span className="font-semibold">Class Name</span>
                            <Input value={editForm.category} onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))} list="inv-category-list" />
                          </label>
                          <label className="space-y-1 text-sm">
                            <span className="font-semibold">Unit</span>
                            <select value={editForm.unit} onChange={(e) => setEditForm((f) => ({ ...f, unit: e.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                              <option value="each">each</option>
                              <option value="lb">lb</option>
                              <option value="kg">kg</option>
                              <option value="oz">oz</option>
                              <option value="case">case</option>
                              <option value="gal">gal</option>
                            </select>
                          </label>
                          <label className="space-y-1 text-sm">
                            <span className="font-semibold">Cost: Base ($)</span>
                            <Input type="number" min="0" step="0.01" value={editForm.cost} onChange={(e) => setEditForm((f) => ({ ...f, cost: e.target.value }))} />
                          </label>
                          <label className="space-y-1 text-sm">
                            <span className="font-semibold">Reorder point</span>
                            <Input type="number" min="0" step="1" value={editForm.reorder_point} onChange={(e) => setEditForm((f) => ({ ...f, reorder_point: e.target.value }))} />
                          </label>
                          <label className="space-y-1 text-sm">
                            <span className="font-semibold">Barcode (UPC/EAN)</span>
                            <Input value={editForm.barcode} onChange={(e) => setEditForm((f) => ({ ...f, barcode: e.target.value }))} />
                          </label>
                          {canEditCosts && (
                            <div className="sm:col-span-2 lg:col-span-4 mt-2 rounded-md border border-border bg-background p-3">
                              <div className="mb-2 flex items-baseline justify-between">
                                <h4 className="text-sm font-semibold">Cost Tracking</h4>
                                <span className="text-xs text-muted-foreground">Admin / Manager only</span>
                              </div>
                              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                                <label className="space-y-1 text-sm">
                                  <span className="font-semibold" title="Standard purchase cost from the vendor">Cost: Base ($)</span>
                                  <Input type="number" min="0" step="0.0001" value={editForm.base_cost} onChange={(e) => setEditForm((f) => ({ ...f, base_cost: e.target.value }))} />
                                </label>
                                <label className="space-y-1 text-sm">
                                  <span className="font-semibold" title="Base + freight, duties, handling to warehouse">Landed Cost ($)</span>
                                  <Input type="number" min="0" step="0.0001" value={editForm.landed_cost} onChange={(e) => setEditForm((f) => ({ ...f, landed_cost: e.target.value }))} />
                                </label>
                                <label className="space-y-1 text-sm">
                                  <span className="font-semibold" title="Actual cost tied to the most recent lot/batch received">Lot Cost ($)</span>
                                  <Input type="number" min="0" step="0.0001" value={editForm.lot_cost} onChange={(e) => setEditForm((f) => ({ ...f, lot_cost: e.target.value }))} />
                                </label>
                                <label className="space-y-1 text-sm">
                                  <span className="font-semibold" title="Current market reference price (for repricing)">Market Cost ($)</span>
                                  <Input type="number" min="0" step="0.0001" value={editForm.market_cost} onChange={(e) => setEditForm((f) => ({ ...f, market_cost: e.target.value }))} />
                                </label>
                                <label className="space-y-1 text-sm">
                                  <span className="font-semibold" title="True all-in cost after overrides / catch-weight reconciliation">Cost: Real ($)</span>
                                  <Input type="number" min="0" step="0.0001" value={editForm.real_cost} onChange={(e) => setEditForm((f) => ({ ...f, real_cost: e.target.value }))} />
                                </label>
                              </div>
                            </div>
                          )}
                          {editItemError && <div className="sm:col-span-2 lg:col-span-4 text-sm text-destructive">{editItemError}</div>}
                          <div className="sm:col-span-2 lg:col-span-4 flex gap-2">
                            <Button type="submit" disabled={editItemMutation.isPending}>{editItemMutation.isPending ? 'Saving…' : 'Save Changes'}</Button>
                            <Button type="button" variant="outline" onClick={() => setEditingItemNumber(null)}>Cancel</Button>
                          </div>
                        </form>
                      </TableCell>
                    </TableRow>
                  )}
                  </Fragment>
                );
              }) : <TableRow><TableCell colSpan={14 + (features.fsmaLotTracking ? 2 : 0) + (features.catchWeight ? 2 : 0)} className="text-muted-foreground">No inventory rows available.</TableCell></TableRow>}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ReorderPointCell({ item, onSaved }: { item: InventoryItem; onSaved: (val: number | null) => void }) {
  const current = item.reorder_point != null ? asNumber(item.reorder_point) : null;
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(current !== null ? String(current) : '');

  function commit() {
    setEditing(false);
    const num = val.trim() === '' ? null : Number(val);
    if (num !== null && !Number.isFinite(num)) return;
    onSaved(num);
  }

  if (!editing) {
    return (
      <button
        className="min-w-[48px] rounded px-1 py-0.5 text-sm text-left hover:bg-muted/50 focus:outline-none focus:ring-1 focus:ring-ring"
        onClick={() => { setVal(current !== null ? String(current) : ''); setEditing(true); }}
        title="Click to set reorder point"
      >
        {current !== null ? current.toFixed(0) : <span className="text-muted-foreground text-xs">—</span>}
      </button>
    );
  }

  return (
    <input
      className="w-16 rounded border border-input bg-background px-1 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
      autoFocus
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
      placeholder="0"
    />
  );
}
