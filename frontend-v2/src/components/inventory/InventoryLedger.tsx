import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import type { LedgerEntry, LedgerSummary } from '../../types/inventory.types';

function asNumber(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function MiniCard({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-border bg-card px-4 py-3"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-xl font-bold">{value}</p></div>;
}
const CHANGE_TYPES = ['restock','adjustment','pick','spoilage','count','depletion','transfer_in','transfer_out'];

export function InventoryLedger({ ledgerLoading, ledgerSummary, ledgerEntries, ledgerItemFilter, ledgerTypeFilter, ledgerLimit, onItemFilterChange, onTypeFilterChange, onLimitChange, onApplyFilters, onRefresh }: {
  ledgerLoading: boolean; ledgerSummary: LedgerSummary | null; ledgerEntries: LedgerEntry[];
  ledgerItemFilter: string; ledgerTypeFilter: string; ledgerLimit: string;
  onItemFilterChange: (v: string) => void; onTypeFilterChange: (v: string) => void; onLimitChange: (v: string) => void;
  onApplyFilters: () => void; onRefresh: () => void;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div><CardTitle>Inventory Ledger</CardTitle><CardDescription>Unified stock movement history with filters and summary totals.</CardDescription></div>
        <Button variant="outline" onClick={onRefresh} disabled={ledgerLoading}>Refresh Ledger</Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 md:grid-cols-4">
          <label className="space-y-1 text-sm"><span className="font-semibold text-muted-foreground">Item Filter</span><Input value={ledgerItemFilter} onChange={(e) => onItemFilterChange(e.target.value)} placeholder="Item number" /></label>
          <label className="space-y-1 text-sm"><span className="font-semibold text-muted-foreground">Change Type</span>
            <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={ledgerTypeFilter} onChange={(e) => onTypeFilterChange(e.target.value)}>
              <option value="">All</option>{CHANGE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm"><span className="font-semibold text-muted-foreground">Limit</span><Input type="number" min="1" max="500" value={ledgerLimit} onChange={(e) => onLimitChange(e.target.value)} /></label>
          <div className="flex items-end"><Button onClick={onApplyFilters} disabled={ledgerLoading}>Apply Ledger Filters</Button></div>
        </div>
        {ledgerSummary && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MiniCard label="Entries" value={asNumber(ledgerSummary.count).toLocaleString()} />
            <MiniCard label="Net Delta" value={asNumber(ledgerSummary.total_delta).toLocaleString()} />
            <MiniCard label="Inbound Qty" value={asNumber(ledgerSummary.inbound_qty).toLocaleString()} />
            <MiniCard label="Outbound Qty" value={asNumber(ledgerSummary.outbound_qty).toLocaleString()} />
          </div>
        )}
        <div className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader><TableRow><TableHead>Timestamp</TableHead><TableHead>Item #</TableHead><TableHead>Type</TableHead><TableHead>Delta</TableHead><TableHead>New Qty</TableHead><TableHead>Notes</TableHead><TableHead>By</TableHead></TableRow></TableHeader>
            <TableBody>
              {ledgerEntries.length ? ledgerEntries.map((entry, i) => (
                <TableRow key={`${entry.item_number ?? 'item'}-${entry.created_at ?? i}`}>
                  <TableCell>{entry.created_at ? new Date(entry.created_at).toLocaleString() : '-'}</TableCell>
                  <TableCell className="font-medium">{entry.item_number ?? '-'}</TableCell>
                  <TableCell>{entry.change_type ?? '-'}</TableCell>
                  <TableCell>{asNumber(entry.change_qty).toLocaleString()}</TableCell>
                  <TableCell>{asNumber(entry.new_qty).toLocaleString()}</TableCell>
                  <TableCell>{entry.notes ?? '-'}</TableCell>
                  <TableCell>{entry.created_by ?? '-'}</TableCell>
                </TableRow>
              )) : <TableRow><TableCell colSpan={7} className="text-muted-foreground">{ledgerLoading ? 'Loading ledger entries...' : 'No ledger entries for current filters.'}</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
