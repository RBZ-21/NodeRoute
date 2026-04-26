import { useEffect, useMemo, useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth, sendWithAuth } from '../lib/api';

type InventoryItem = {
  id: string;
  item_number?: string;
  description?: string;
  category?: string;
  on_hand_qty?: number | string;
  cost?: number | string;
  unit?: string;
  is_ftl_product?: boolean;
  is_catch_weight?: boolean;
  default_price_per_lb?: number | string;
};

type LedgerSummary = {
  count: number;
  total_delta: number;
  inbound_qty: number;
  outbound_qty: number;
};

type LedgerEntry = {
  item_number?: string;
  change_qty?: number | string;
  new_qty?: number | string;
  change_type?: string;
  notes?: string;
  created_by?: string;
  created_at?: string;
};

type LedgerResponse = {
  summary?: LedgerSummary;
  entries?: LedgerEntry[];
};

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

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

  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerSummary, setLedgerSummary] = useState<LedgerSummary | null>(null);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [ledgerItemFilter, setLedgerItemFilter] = useState('');
  const [ledgerTypeFilter, setLedgerTypeFilter] = useState('');
  const [ledgerLimit, setLedgerLimit] = useState('75');

  async function loadInventory() {
    setLoading(true);
    setError('');
    try {
      const data = await fetchWithAuth<InventoryItem[]>('/api/inventory');
      const rows = Array.isArray(data) ? data : [];
      setItems(rows);
      if (!selectedItemNumber && rows.length) setSelectedItemNumber(rows[0].item_number || '');
      if (!spoilageItem && rows.length) setSpoilageItem(rows[0].item_number || '');
      if (!transferFrom && rows.length) setTransferFrom(rows[0].item_number || '');
      if (!transferTo && rows.length > 1) setTransferTo(rows[1].item_number || '');
    } catch (err) {
      setError(String((err as Error).message || 'Could not load inventory'));
    } finally {
      setLoading(false);
    }
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
    } catch (err) {
      setError(String((err as Error).message || 'Could not load inventory ledger'));
    } finally {
      setLedgerLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      await loadInventory();
      await loadLedger();
    })();
  }, []);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) =>
      [item.item_number, item.description, item.category]
        .filter(Boolean)
        .some((part) => String(part).toLowerCase().includes(needle))
    );
  }, [items, search]);

  const summary = useMemo(() => {
    const totalSkus = items.length;
    const lowStock = items.filter((item) => asNumber(item.on_hand_qty) > 0 && asNumber(item.on_hand_qty) <= 10).length;
    const outOfStock = items.filter((item) => asNumber(item.on_hand_qty) <= 0).length;
    const inventoryValue = items.reduce((sum, item) => sum + asNumber(item.on_hand_qty) * asNumber(item.cost), 0);
    return { totalSkus, lowStock, outOfStock, inventoryValue };
  }, [items]);

  const selectedItem = useMemo(() => items.find((item) => item.item_number === selectedItemNumber) || null, [items, selectedItemNumber]);

  async function refreshAll() {
    await loadInventory();
    await loadLedger();
  }

  async function submitRestock() {
    if (!selectedItemNumber) return;
    const qty = asNumber(restockQty);
    if (qty <= 0) {
      setError('Restock quantity must be greater than 0.');
      return;
    }
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      await sendWithAuth(`/api/inventory/${encodeURIComponent(selectedItemNumber)}/restock`, 'POST', {
        qty,
        notes: actionNotes || undefined,
      });
      setRestockQty('');
      setActionNotes('');
      setNotice(`Restocked ${selectedItemNumber} by ${qty.toLocaleString()}.`);
      await refreshAll();
    } catch (err) {
      setError(String((err as Error).message || 'Restock failed'));
    } finally {
      setSubmitting(false);
    }
  }

  async function submitAdjustment() {
    if (!selectedItemNumber) return;
    const delta = asNumber(adjustDelta);
    if (delta === 0) {
      setError('Adjustment delta must be non-zero.');
      return;
    }
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      await sendWithAuth(`/api/inventory/${encodeURIComponent(selectedItemNumber)}/adjust`, 'POST', {
        delta,
        notes: actionNotes || undefined,
      });
      setAdjustDelta('');
      setActionNotes('');
      setNotice(`Adjusted ${selectedItemNumber} by ${delta > 0 ? '+' : ''}${delta.toLocaleString()}.`);
      await refreshAll();
    } catch (err) {
      setError(String((err as Error).message || 'Adjustment failed'));
    } finally {
      setSubmitting(false);
    }
  }

  async function submitTransfer() {
    const qty = asNumber(transferQty);
    if (!transferFrom || !transferTo) {
      setError('Select both source and destination items.');
      return;
    }
    if (transferFrom === transferTo) {
      setError('Transfer source and destination must be different.');
      return;
    }
    if (qty <= 0) {
      setError('Transfer quantity must be greater than 0.');
      return;
    }

    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      const response = await sendWithAuth<{ transfer_ref?: string }>(`/api/inventory/transfer`, 'POST', {
        from_item_number: transferFrom,
        to_item_number: transferTo,
        qty,
        notes: transferNotes || undefined,
      });
      setTransferQty('');
      setTransferNotes('');
      setNotice(`Transfer completed (${response.transfer_ref || 'ref unavailable'}).`);
      await refreshAll();
    } catch (err) {
      setError(String((err as Error).message || 'Transfer failed'));
    } finally {
      setSubmitting(false);
    }
  }

  async function submitSpoilage() {
    const qty = asNumber(spoilageQty);
    if (!spoilageItem) {
      setError('Select an item for spoilage.');
      return;
    }
    if (qty <= 0) {
      setError('Spoilage quantity must be greater than 0.');
      return;
    }

    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      await sendWithAuth(`/api/inventory/${encodeURIComponent(spoilageItem)}/spoilage`, 'POST', {
        qty,
        reason: spoilageReason || undefined,
        notes: spoilageNotes || undefined,
      });
      setSpoilageQty('');
      setSpoilageReason('');
      setSpoilageNotes('');
      setNotice(`Spoilage recorded for ${spoilageItem}.`);
      await refreshAll();
    } catch (err) {
      setError(String((err as Error).message || 'Could not record spoilage'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading inventory...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}
      {notice ? <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="SKUs" value={summary.totalSkus.toLocaleString()} />
        <SummaryCard label="Low Stock" value={summary.lowStock.toLocaleString()} />
        <SummaryCard label="Out Of Stock" value={summary.outOfStock.toLocaleString()} />
        <SummaryCard label="Inventory Value" value={money(summary.inventoryValue)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Inventory Actions</CardTitle>
          <CardDescription>Restock and adjust item quantities through existing inventory APIs.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-muted-foreground">Item</span>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={selectedItemNumber}
              onChange={(event) => setSelectedItemNumber(event.target.value)}
            >
              <option value="">Select item...</option>
              {items.map((item) => (
                <option key={item.id} value={item.item_number || ''}>
                  {item.item_number} - {item.description}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-muted-foreground">Restock Qty</span>
            <Input type="number" min="0" step="0.01" value={restockQty} onChange={(event) => setRestockQty(event.target.value)} placeholder="e.g. 25" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-muted-foreground">Adjustment Delta</span>
            <Input type="number" step="0.01" value={adjustDelta} onChange={(event) => setAdjustDelta(event.target.value)} placeholder="e.g. -2.5" />
          </label>
          <label className="space-y-1 text-sm md:col-span-4">
            <span className="font-semibold text-muted-foreground">Notes</span>
            <Input value={actionNotes} onChange={(event) => setActionNotes(event.target.value)} placeholder="Optional movement notes" />
          </label>
          <div className="md:col-span-4 flex flex-wrap gap-2">
            <Button onClick={submitRestock} disabled={submitting || !selectedItemNumber}>
              Restock Item
            </Button>
            <Button variant="secondary" onClick={submitAdjustment} disabled={submitting || !selectedItemNumber}>
              Apply Adjustment
            </Button>
            {selectedItem ? (
              <div className="ml-auto rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                Current: <strong>{asNumber(selectedItem.on_hand_qty).toLocaleString()}</strong> {selectedItem.unit || ''}
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Transfer Inventory</CardTitle>
            <CardDescription>Move stock between inventory SKUs using `/api/inventory/transfer`.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="space-y-1 text-sm">
              <span className="font-semibold text-muted-foreground">From Item</span>
              <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={transferFrom} onChange={(event) => setTransferFrom(event.target.value)}>
                <option value="">Select source...</option>
                {items.map((item) => (
                  <option key={item.id} value={item.item_number || ''}>
                    {item.item_number} - {item.description}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-semibold text-muted-foreground">To Item</span>
              <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={transferTo} onChange={(event) => setTransferTo(event.target.value)}>
                <option value="">Select destination...</option>
                {items.map((item) => (
                  <option key={item.id} value={item.item_number || ''}>
                    {item.item_number} - {item.description}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-semibold text-muted-foreground">Quantity</span>
              <Input type="number" min="0" step="0.01" value={transferQty} onChange={(event) => setTransferQty(event.target.value)} placeholder="e.g. 5" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-semibold text-muted-foreground">Notes</span>
              <Input value={transferNotes} onChange={(event) => setTransferNotes(event.target.value)} placeholder="Optional transfer notes" />
            </label>
            <Button onClick={submitTransfer} disabled={submitting}>
              Transfer Stock
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Record Spoilage</CardTitle>
            <CardDescription>Post waste/spoilage movements with reason and notes.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="space-y-1 text-sm">
              <span className="font-semibold text-muted-foreground">Item</span>
              <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={spoilageItem} onChange={(event) => setSpoilageItem(event.target.value)}>
                <option value="">Select item...</option>
                {items.map((item) => (
                  <option key={item.id} value={item.item_number || ''}>
                    {item.item_number} - {item.description}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-semibold text-muted-foreground">Quantity</span>
              <Input type="number" min="0" step="0.01" value={spoilageQty} onChange={(event) => setSpoilageQty(event.target.value)} placeholder="e.g. 2" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-semibold text-muted-foreground">Reason</span>
              <Input value={spoilageReason} onChange={(event) => setSpoilageReason(event.target.value)} placeholder="Temperature excursion" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-semibold text-muted-foreground">Notes</span>
              <Input value={spoilageNotes} onChange={(event) => setSpoilageNotes(event.target.value)} placeholder="Optional spoilage notes" />
            </label>
            <Button variant="secondary" onClick={submitSpoilage} disabled={submitting}>
              Post Spoilage
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <CardTitle>Inventory Ledger</CardTitle>
            <CardDescription>Unified stock movement history with filters and summary totals.</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={loadLedger} disabled={ledgerLoading}>
              Refresh Ledger
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-4">
            <label className="space-y-1 text-sm">
              <span className="font-semibold text-muted-foreground">Item Filter</span>
              <Input value={ledgerItemFilter} onChange={(event) => setLedgerItemFilter(event.target.value)} placeholder="Item number" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-semibold text-muted-foreground">Change Type</span>
              <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={ledgerTypeFilter} onChange={(event) => setLedgerTypeFilter(event.target.value)}>
                <option value="">All</option>
                <option value="restock">restock</option>
                <option value="adjustment">adjustment</option>
                <option value="pick">pick</option>
                <option value="spoilage">spoilage</option>
                <option value="count">count</option>
                <option value="depletion">depletion</option>
                <option value="transfer_in">transfer_in</option>
                <option value="transfer_out">transfer_out</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-semibold text-muted-foreground">Limit</span>
              <Input type="number" min="1" max="500" value={ledgerLimit} onChange={(event) => setLedgerLimit(event.target.value)} />
            </label>
            <div className="flex items-end">
              <Button onClick={loadLedger} disabled={ledgerLoading}>
                Apply Ledger Filters
              </Button>
            </div>
          </div>

          {ledgerSummary ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryCard label="Entries" value={asNumber(ledgerSummary.count).toLocaleString()} />
              <SummaryCard label="Net Delta" value={asNumber(ledgerSummary.total_delta).toLocaleString()} />
              <SummaryCard label="Inbound Qty" value={asNumber(ledgerSummary.inbound_qty).toLocaleString()} />
              <SummaryCard label="Outbound Qty" value={asNumber(ledgerSummary.outbound_qty).toLocaleString()} />
            </div>
          ) : null}

          <div className="rounded-lg border border-border bg-card p-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Item #</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Delta</TableHead>
                  <TableHead>New Qty</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead>By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ledgerEntries.length ? (
                  ledgerEntries.map((entry, index) => (
                    <TableRow key={`${entry.item_number || 'item'}-${entry.created_at || index}`}>
                      <TableCell>{entry.created_at ? new Date(entry.created_at).toLocaleString() : '-'}</TableCell>
                      <TableCell className="font-medium">{entry.item_number || '-'}</TableCell>
                      <TableCell>{entry.change_type || '-'}</TableCell>
                      <TableCell>{asNumber(entry.change_qty).toLocaleString()}</TableCell>
                      <TableCell>{asNumber(entry.new_qty).toLocaleString()}</TableCell>
                      <TableCell>{entry.notes || '-'}</TableCell>
                      <TableCell>{entry.created_by || '-'}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="text-muted-foreground">
                      {ledgerLoading ? 'Loading ledger entries...' : 'No ledger entries for current filters.'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <CardTitle>Inventory Overview</CardTitle>
            <CardDescription>
              Live stock visibility. Toggle <strong>FTL</strong> (FDA Traceability List) to require lot assignment on every order for that product.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search item/category" />
            <Button variant="outline" onClick={loadInventory}>
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item #</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>On Hand</TableHead>
                <TableHead>Cost</TableHead>
                <TableHead>Status</TableHead>
                <TableHead title="FDA Food Traceability List — requires lot on every order">FTL</TableHead>
                <TableHead title="Sold by actual measured weight — invoice uses real weight">Catch Wt</TableHead>
                <TableHead title="Default price per pound for catch weight products">$/lb</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length ? (
                filtered.map((item) => {
                  const qty = asNumber(item.on_hand_qty);
                  const status =
                    qty <= 0 ? <Badge variant="warning">Out</Badge> : qty <= 10 ? <Badge variant="secondary">Low</Badge> : <Badge variant="success">Healthy</Badge>;
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.item_number || '-'}</TableCell>
                      <TableCell>{item.description || '-'}</TableCell>
                      <TableCell>{item.category || '-'}</TableCell>
                      <TableCell>
                        {qty.toLocaleString()} {item.unit || ''}
                      </TableCell>
                      <TableCell>{money(asNumber(item.cost))}</TableCell>
                      <TableCell>{status}</TableCell>
                      <TableCell>
                        <FtlToggle item={item} onToggled={(updated) => {
                          setItems((current) =>
                            current.map((it) =>
                              it.item_number === updated.item_number
                                ? { ...it, is_ftl_product: updated.is_ftl_product }
                                : it
                            )
                          );
                        }} />
                      </TableCell>
                      <TableCell>
                        <CatchWeightToggle item={item} onToggled={(updated) => {
                          setItems((current) =>
                            current.map((it) =>
                              it.item_number === updated.item_number
                                ? { ...it, is_catch_weight: updated.is_catch_weight }
                                : it
                            )
                          );
                        }} />
                      </TableCell>
                      <TableCell>
                        {item.is_catch_weight ? (
                          <CatchWeightPriceInput item={item} onSaved={(updated) => {
                            setItems((current) =>
                              current.map((it) =>
                                it.item_number === updated.item_number
                                  ? { ...it, default_price_per_lb: updated.default_price_per_lb }
                                  : it
                              )
                            );
                          }} />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={9} className="text-muted-foreground">
                    No inventory rows available.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

function CatchWeightToggle({ item, onToggled }: {
  item: InventoryItem;
  onToggled: (updated: { item_number: string; is_catch_weight: boolean }) => void;
}) {
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
    } catch {
      // reverts on failure
    } finally {
      setSaving(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={saving}
      title={item.is_catch_weight ? 'Catch weight ON — click to turn off' : 'Not catch weight — click to enable'}
      className={[
        'inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1',
        item.is_catch_weight ? 'bg-orange-500 focus:ring-orange-400' : 'bg-gray-200 focus:ring-gray-400',
        saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
      ].join(' ')}
    >
      <span
        className={[
          'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
          item.is_catch_weight ? 'translate-x-6' : 'translate-x-1',
        ].join(' ')}
      />
    </button>
  );
}

function CatchWeightPriceInput({ item, onSaved }: {
  item: InventoryItem;
  onSaved: (updated: { item_number: string; default_price_per_lb: number }) => void;
}) {
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
        `/api/inventory/${encodeURIComponent(item.item_number)}`,
        'PATCH',
        { default_price_per_lb: parsed }
      );
      onSaved({ item_number: result.item_number, default_price_per_lb: result.default_price_per_lb ?? parsed });
      setEditing(false);
    } catch {
      // stays in edit mode on failure
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    const display = item.default_price_per_lb != null ? `$${Number(item.default_price_per_lb).toFixed(4)}` : 'Set';
    return (
      <button onClick={() => { setValue(String(item.default_price_per_lb ?? '')); setEditing(true); }}
        className="text-xs text-blue-600 underline underline-offset-2 hover:text-blue-800">
        {display}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        type="number" min="0" step="0.0001"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
        className="h-7 w-20 rounded border border-input bg-background px-2 text-xs"
        autoFocus
      />
      <button onClick={save} disabled={saving}
        className="rounded bg-orange-500 px-2 py-0.5 text-xs font-medium text-white hover:bg-orange-600 disabled:opacity-50">
        {saving ? '…' : 'Save'}
      </button>
      <button onClick={() => setEditing(false)}
        className="text-xs text-muted-foreground hover:text-foreground">
        ✕
      </button>
    </div>
  );
}

function FtlToggle({ item, onToggled }: {
  item: InventoryItem;
  onToggled: (updated: { item_number: string; is_ftl_product: boolean }) => void;
}) {
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
    } catch {
      // toggle reverts on failure since we didn't optimistically update
    } finally {
      setSaving(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={saving}
      title={item.is_ftl_product ? 'On FDA Traceability List — click to remove' : 'Not on FDA Traceability List — click to flag'}
      className={[
        'inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1',
        item.is_ftl_product ? 'bg-blue-600 focus:ring-blue-500' : 'bg-gray-200 focus:ring-gray-400',
        saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
      ].join(' ')}
    >
      <span
        className={[
          'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
          item.is_ftl_product ? 'translate-x-6' : 'translate-x-1',
        ].join(' ')}
      />
    </button>
  );
}
