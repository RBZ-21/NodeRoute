import { useEffect, useMemo, useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth, sendWithAuth } from '../lib/api';
import type { CountSheetRow, InventoryItem, LedgerEntry, LedgerResponse, LedgerSummary, RecentSoldItemsResponse } from '../types/inventory.types';
import { CatchWeightPriceInput, CatchWeightToggle, FtlToggle, InventoryLedger } from '../components/inventory';

function asNumber(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function money(v: number) { return v.toLocaleString('en-US', { style: 'currency', currency: 'USD' }); }
function csvEscape(v: string) { return `"${String(v).replace(/"/g, '""')}"`; }
function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((r) => r.map(csvEscape).join(',')).join('\n');
  const href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = href; a.download = filename; a.click(); URL.revokeObjectURL(href);
}
function sanitizeHtml(v: string) { return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function SummaryCard({ label, value }: { label: string; value: string }) {
  return <Card><CardHeader className="space-y-1"><CardDescription>{label}</CardDescription><CardTitle className="text-2xl">{value}</CardTitle></CardHeader></Card>;
}
function itemCategoryCompare(a: CountSheetRow, b: CountSheetRow) { return a.category.localeCompare(b.category); }

export function InventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedItemNumber, setSelectedItemNumber] = useState('');
  const [restockQty, setRestockQty] = useState('');
  const [adjustDelta, setAdjustDelta] = useState('');
  const [actionNotes, setActionNotes] = useState('');
  const [transferFrom, setTransferFrom] = useState('');
  const [transferTo, setTransferTo] = useState('');
  const [transferQty, setTransferQty] = useState('');
  const [transferNotes, setTransferNotes] = useState('');
  const [spoilageItem, setSpoilageItem] = useState('');
  const [spoilageQty, setSpoilageQty] = useState('');
  const [spoilageReason, setSpoilageReason] = useState('');
  const [spoilageNotes, setSpoilageNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState('');
  const [countCategoryFilter, setCountCategoryFilter] = useState('all');
  const [includeZeroStockInCounts, setIncludeZeroStockInCounts] = useState(true);
  const [recentSalesExclusionWindow, setRecentSalesExclusionWindow] = useState('all');
  const [recentSoldItemKeys, setRecentSoldItemKeys] = useState<Set<string> | null>(null);
  const [recentSoldLoading, setRecentSoldLoading] = useState(false);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerSummary, setLedgerSummary] = useState<LedgerSummary | null>(null);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [ledgerItemFilter, setLedgerItemFilter] = useState('');
  const [ledgerTypeFilter, setLedgerTypeFilter] = useState('');
  const [ledgerLimit, setLedgerLimit] = useState('75');

  async function loadInventory() {
    setLoading(true); setError('');
    try {
      const data = await fetchWithAuth<InventoryItem[]>('/api/inventory');
      const rows = Array.isArray(data) ? data : [];
      setItems(rows);
      if (!selectedItemNumber && rows.length) setSelectedItemNumber(rows[0].item_number || '');
      if (!spoilageItem && rows.length) setSpoilageItem(rows[0].item_number || '');
      if (!transferFrom && rows.length) setTransferFrom(rows[0].item_number || '');
      if (!transferTo && rows.length > 1) setTransferTo(rows[1].item_number || '');
    } catch (err) { setError(String((err as Error).message || 'Could not load inventory')); }
    finally { setLoading(false); }
  }

  async function loadLedger() {
    setLedgerLoading(true);
    try {
      const params = new URLSearchParams();
      if (ledgerItemFilter) params.set('item_number', ledgerItemFilter);
      if (ledgerTypeFilter) params.set('change_type', ledgerTypeFilter);
      params.set('limit', String(Math.max(1, Math.min(500, asNumber(ledgerLimit) || 75))));
      const data = await fetchWithAuth<LedgerResponse>(`/api/inventory/ledger?${params.toString()}`);
      setLedgerSummary(data.summary || null);
      setLedgerEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch (err) { setError(String((err as Error).message || 'Could not load ledger')); }
    finally { setLedgerLoading(false); }
  }

  async function loadRecentSoldItems(days: '30' | '60' | '90') {
    setRecentSoldLoading(true);
    try {
      const data = await fetchWithAuth<RecentSoldItemsResponse>(`/api/reporting/recent-sold-items?days=${days}`);
      setRecentSoldItemKeys(new Set((Array.isArray(data.items) ? data.items : []).map((i) => String(i.key || '').trim().toLowerCase()).filter(Boolean)));
    } catch (err) { setError(String((err as Error).message || 'Could not load recent sold items')); }
    finally { setRecentSoldLoading(false); }
  }

  useEffect(() => { void (async () => { await loadInventory(); await loadLedger(); })(); }, []);
  useEffect(() => {
    if (recentSalesExclusionWindow === 'all') { setRecentSoldItemKeys(null); return; }
    void loadRecentSoldItems(recentSalesExclusionWindow as '30' | '60' | '90');
  }, [recentSalesExclusionWindow]);

  const filtered = useMemo(() => { const n = search.trim().toLowerCase(); if (!n) return items; return items.filter((i) => [i.item_number, i.description, i.category].filter(Boolean).some((p) => String(p).toLowerCase().includes(n))); }, [items, search]);
  const summary = useMemo(() => ({ totalSkus: items.length, lowStock: items.filter((i) => asNumber(i.on_hand_qty) > 0 && asNumber(i.on_hand_qty) <= 10).length, outOfStock: items.filter((i) => asNumber(i.on_hand_qty) <= 0).length, inventoryValue: items.reduce((s, i) => s + asNumber(i.on_hand_qty) * asNumber(i.cost), 0) }), [items]);
  const selectedItem = useMemo(() => items.find((i) => i.item_number === selectedItemNumber) ?? null, [items, selectedItemNumber]);
  const countSheetRows = useMemo(() => {
    const rows = items.map((item) => ({ id: item.id, item_number: String(item.item_number || '').trim(), description: String(item.description || '').trim() || 'Unnamed item', category: String(item.category || 'Uncategorized').trim() || 'Uncategorized', on_hand_qty: asNumber(item.on_hand_qty), unit: String(item.unit || '').trim() })).filter((i) => i.item_number || i.description);
    return rows.filter((i) => countCategoryFilter === 'all' || i.category === countCategoryFilter).filter((i) => includeZeroStockInCounts || i.on_hand_qty > 0).filter((i) => { if (recentSalesExclusionWindow === 'all' || !recentSoldItemKeys) return true; return recentSoldItemKeys.has(i.item_number.trim().toLowerCase()) || recentSoldItemKeys.has(i.description.trim().toLowerCase()); }).sort((a, b) => itemCategoryCompare(a, b) || a.description.localeCompare(b.description) || a.item_number.localeCompare(b.item_number));
  }, [items, countCategoryFilter, includeZeroStockInCounts, recentSalesExclusionWindow, recentSoldItemKeys]);
  const countCategories = useMemo(() => [...new Set(items.map((i) => String(i.category || 'Uncategorized').trim() || 'Uncategorized'))].sort((a, b) => a.localeCompare(b)), [items]);
  const countSheetGroups = useMemo(() => { const g = new Map<string, CountSheetRow[]>(); for (const r of countSheetRows) { const l = g.get(r.category) ?? []; l.push(r); g.set(r.category, l); } return [...g.entries()].map(([category, rows]) => ({ category, rows })); }, [countSheetRows]);

  async function refreshAll() { await loadInventory(); await loadLedger(); }

  async function submitRestock() {
    if (!selectedItemNumber) return; const qty = asNumber(restockQty); if (qty <= 0) { setError('Restock quantity must be greater than 0.'); return; }
    setSubmitting(true); setError(''); setNotice('');
    try { await sendWithAuth(`/api/inventory/${encodeURIComponent(selectedItemNumber)}/restock`, 'POST', { qty, notes: actionNotes || undefined }); setRestockQty(''); setActionNotes(''); setNotice(`Restocked ${selectedItemNumber} by ${qty.toLocaleString()}.`); await refreshAll(); }
    catch (err) { setError(String((err as Error).message || 'Restock failed')); } finally { setSubmitting(false); }
  }
  async function submitAdjustment() {
    if (!selectedItemNumber) return; const delta = asNumber(adjustDelta); if (delta === 0) { setError('Adjustment delta must be non-zero.'); return; }
    setSubmitting(true); setError(''); setNotice('');
    try { await sendWithAuth(`/api/inventory/${encodeURIComponent(selectedItemNumber)}/adjust`, 'POST', { delta, notes: actionNotes || undefined }); setAdjustDelta(''); setActionNotes(''); setNotice(`Adjusted ${selectedItemNumber} by ${delta > 0 ? '+' : ''}${delta.toLocaleString()}.`); await refreshAll(); }
    catch (err) { setError(String((err as Error).message || 'Adjustment failed')); } finally { setSubmitting(false); }
  }
  async function submitTransfer() {
    const qty = asNumber(transferQty); if (!transferFrom || !transferTo) { setError('Select both source and destination items.'); return; } if (transferFrom === transferTo) { setError('Source and destination must be different.'); return; } if (qty <= 0) { setError('Transfer quantity must be greater than 0.'); return; }
    setSubmitting(true); setError(''); setNotice('');
    try { const res = await sendWithAuth<{ transfer_ref?: string }>('/api/inventory/transfer', 'POST', { from_item_number: transferFrom, to_item_number: transferTo, qty, notes: transferNotes || undefined }); setTransferQty(''); setTransferNotes(''); setNotice(`Transfer completed (${res.transfer_ref ?? 'ref unavailable'}).`); await refreshAll(); }
    catch (err) { setError(String((err as Error).message || 'Transfer failed')); } finally { setSubmitting(false); }
  }
  async function submitSpoilage() {
    const qty = asNumber(spoilageQty); if (!spoilageItem) { setError('Select an item for spoilage.'); return; } if (qty <= 0) { setError('Spoilage quantity must be greater than 0.'); return; }
    setSubmitting(true); setError(''); setNotice('');
    try { await sendWithAuth(`/api/inventory/${encodeURIComponent(spoilageItem)}/spoilage`, 'POST', { qty, reason: spoilageReason || undefined, notes: spoilageNotes || undefined }); setSpoilageQty(''); setSpoilageReason(''); setSpoilageNotes(''); setNotice(`Spoilage recorded for ${spoilageItem}.`); await refreshAll(); }
    catch (err) { setError(String((err as Error).message || 'Could not record spoilage')); } finally { setSubmitting(false); }
  }
  function exportCountSheetCsv() {
    const scope = countCategoryFilter === 'all' ? 'all-categories' : countCategoryFilter.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    downloadCsv(`inventory-count-sheet-${scope}.csv`, [['Category','Item #','Description','Current On Hand','Unit','Physical Count'], ...countSheetRows.map((i) => [i.category, i.item_number, i.description, i.on_hand_qty.toLocaleString(), i.unit, ''])]);
  }
  function printCountSheet() {
    const popup = window.open('', '_blank', 'noopener,noreferrer');
    if (!popup) { setError('Could not open the print view. Please allow pop-ups and try again.'); return; }
    const scopeLabel = countCategoryFilter === 'all' ? 'All Categories' : countCategoryFilter;
    const sections = countSheetGroups.map((g) => `<section class="category-block"><h2>${sanitizeHtml(g.category)}</h2><table><thead><tr><th>Item #</th><th>Description</th><th>Current On Hand</th><th>Unit</th><th>Physical Count</th></tr></thead><tbody>${g.rows.map((i) => `<tr><td>${sanitizeHtml(i.item_number||'-')}</td><td>${sanitizeHtml(i.description)}</td><td>${sanitizeHtml(i.on_hand_qty.toLocaleString())}</td><td>${sanitizeHtml(i.unit||'-')}</td><td class="blank-cell"></td></tr>`).join('')}</tbody></table></section>`).join('');
    popup.document.write(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>Inventory Count Sheet</title><style>body{font-family:Arial,sans-serif;margin:24px;color:#111827}h1{margin:0 0 6px;font-size:24px}.meta{margin-bottom:18px;color:#4b5563;font-size:12px}.category-block{margin-bottom:28px;page-break-inside:avoid}h2{margin:0 0 10px;font-size:18px;border-bottom:1px solid #d1d5db;padding-bottom:4px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #d1d5db;padding:8px 10px;font-size:12px;text-align:left}th{background:#f3f4f6}.blank-cell{min-width:140px;height:28px}@media print{body{margin:12px}}</style></head><body><h1>Inventory Count Sheet</h1><div class="meta">Category scope: ${sanitizeHtml(scopeLabel)} · Generated ${sanitizeHtml(new Date().toLocaleString())}</div>${sections||'<p>No inventory rows match the selected filters.</p>'}</body></html>`);
    popup.document.close(); popup.focus(); popup.print();
  }

  return (
    <div className="space-y-5">
      {loading && <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading inventory...</div>}
      {error && <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div>}
      {notice && <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="SKUs" value={summary.totalSkus.toLocaleString()} />
        <SummaryCard label="Low Stock" value={summary.lowStock.toLocaleString()} />
        <SummaryCard label="Out Of Stock" value={summary.outOfStock.toLocaleString()} />
        <SummaryCard label="Inventory Value" value={money(summary.inventoryValue)} />
      </div>
      <Card>
        <CardHeader><CardTitle>Inventory Actions</CardTitle><CardDescription>Restock and adjust item quantities through existing inventory APIs.</CardDescription></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <label className="space-y-1 text-sm"><span className="font-semibold text-muted-foreground">Item</span>
            <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={selectedItemNumber} onChange={(e) => setSelectedItemNumber(e.target.value)}>
              <option value="">Select item...</option>{items.map((i) => <option key={i.id} value={i.item_number || ''}>{i.item_number} - {i.description}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm"><span className="font-semibold text-muted-foreground">Restock Qty</span><Input type="number" min="0" step="0.01" value={restockQty} onChange={(e) => setRestockQty(e.target.value)} placeholder="e.g. 25" /></label>
          <label className="space-y-1 text-sm"><span className="font-semibold text-muted-foreground">Adjustment Delta</span><Input type="number" step="0.01" value={adjustDelta} onChange={(e) => setAdjustDelta(e.target.value)} placeholder="e.g. -2.5" /></label>
          <label className="space-y-1 text-sm md:col-span-4"><span className="font-semibold text-muted-foreground">Notes</span><Input value={actionNotes} onChange={(e) => setActionNotes(e.target.value)} placeholder="Optional movement notes" /></label>
          <div className="md:col-span-4 flex flex-wrap gap-2">
            <Button onClick={submitRestock} disabled={submitting || !selectedItemNumber}>Restock Item</Button>
            <Button variant="secondary" onClick={submitAdjustment} disabled={submitting || !selectedItemNumber}>Apply Adjustment</Button>
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
            {recentSalesExclusionWindow !== 'all' && <div className="text-sm text-muted-foreground">{recentSoldLoading ? `Checking sold items from the last ${recentSalesExclusionWindow} days...` : `Excluding items not sold in the last ${recentSalesExclusionWindow} days.`}</div>}
            <div className="flex flex-wrap gap-2">
              <Button onClick={printCountSheet} disabled={!countSheetRows.length || recentSoldLoading}>Print Count Sheet</Button>
              <Button variant="outline" onClick={exportCountSheetCsv} disabled={!countSheetRows.length || recentSoldLoading}>Export Count Sheet CSV</Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Transfer Inventory</CardTitle><CardDescription>Move stock between inventory SKUs.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {([['From Item', transferFrom, setTransferFrom], ['To Item', transferTo, setTransferTo]] as const).map(([label, val, setter]) => (
              <label key={label} className="space-y-1 text-sm"><span className="font-semibold text-muted-foreground">{label}</span>
                <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={val} onChange={(e) => setter(e.target.value)}>
                  <option value="">Select...</option>{items.map((i) => <option key={i.id} value={i.item_number || ''}>{i.item_number} - {i.description}</option>)}
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
              <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={spoilageItem} onChange={(e) => setSpoilageItem(e.target.value)}>
                <option value="">Select item...</option>{items.map((i) => <option key={i.id} value={i.item_number || ''}>{i.item_number} - {i.description}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm"><span className="font-semibold text-muted-foreground">Quantity</span><Input type="number" min="0" step="0.01" value={spoilageQty} onChange={(e) => setSpoilageQty(e.target.value)} placeholder="e.g. 2" /></label>
            <label className="space-y-1 text-sm"><span className="font-semibold text-muted-foreground">Reason</span><Input value={spoilageReason} onChange={(e) => setSpoilageReason(e.target.value)} placeholder="Temperature excursion" /></label>
            <label className="space-y-1 text-sm"><span className="font-semibold text-muted-foreground">Notes</span><Input value={spoilageNotes} onChange={(e) => setSpoilageNotes(e.target.value)} placeholder="Optional spoilage notes" /></label>
            <Button variant="secondary" onClick={submitSpoilage} disabled={submitting}>Post Spoilage</Button>
          </CardContent>
        </Card>
      </div>
      <InventoryLedger ledgerLoading={ledgerLoading} ledgerSummary={ledgerSummary} ledgerEntries={ledgerEntries} ledgerItemFilter={ledgerItemFilter} ledgerTypeFilter={ledgerTypeFilter} ledgerLimit={ledgerLimit} onItemFilterChange={setLedgerItemFilter} onTypeFilterChange={setLedgerTypeFilter} onLimitChange={setLedgerLimit} onApplyFilters={loadLedger} onRefresh={loadLedger} />
      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div><CardTitle>Inventory Overview</CardTitle><CardDescription>Live stock visibility. Toggle <strong>FTL</strong> (FDA Traceability List) to require lot assignment on every order for that product.</CardDescription></div>
          <div className="flex gap-2"><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search item/category" /><Button variant="outline" onClick={loadInventory}>Refresh</Button></div>
        </CardHeader>
        <CardContent className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader><TableRow><TableHead>Item #</TableHead><TableHead>Description</TableHead><TableHead>Category</TableHead><TableHead>On Hand</TableHead><TableHead>Cost</TableHead><TableHead>Status</TableHead><TableHead title="FDA Food Traceability List">FTL</TableHead><TableHead title="Sold by actual measured weight">Catch Wt</TableHead><TableHead title="Default price per pound">$/lb</TableHead></TableRow></TableHeader>
            <TableBody>
              {filtered.length ? filtered.map((item) => {
                const qty = asNumber(item.on_hand_qty);
                const status = qty <= 0 ? <Badge variant="warning">Out</Badge> : qty <= 10 ? <Badge variant="secondary">Low</Badge> : <Badge variant="success">Healthy</Badge>;
                return (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.item_number ?? '-'}</TableCell>
                    <TableCell>{item.description ?? '-'}</TableCell>
                    <TableCell>{item.category ?? '-'}</TableCell>
                    <TableCell>{qty.toLocaleString()} {item.unit ?? ''}</TableCell>
                    <TableCell>{money(asNumber(item.cost))}</TableCell>
                    <TableCell>{status}</TableCell>
                    <TableCell><FtlToggle item={item} onToggled={(u) => setItems((cur) => cur.map((it) => it.item_number === u.item_number ? { ...it, is_ftl_product: u.is_ftl_product } : it))} /></TableCell>
                    <TableCell><CatchWeightToggle item={item} onToggled={(u) => setItems((cur) => cur.map((it) => it.item_number === u.item_number ? { ...it, is_catch_weight: u.is_catch_weight } : it))} /></TableCell>
                    <TableCell>{item.is_catch_weight ? <CatchWeightPriceInput item={item} onSaved={(u) => setItems((cur) => cur.map((it) => it.item_number === u.item_number ? { ...it, default_price_per_lb: u.default_price_per_lb } : it))} /> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
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
