import { useEffect, useMemo, useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth } from '../lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

type LotTrace = {
  lot: {
    lot_number: string;
    product_id?: string;
    product?: string;
    vendor?: string;
    received_date?: string;
    received_by?: string;
    quantity_received?: number;
    unit_of_measure?: string;
    expiration_date?: string;
    notes?: string;
  };
  orders: {
    order_id: string;
    order_number?: string;
    customer?: string;
    customer_email?: string;
    status?: string;
    quantity?: number;
    delivery_date?: string;
  }[];
  stops: {
    stop_id: string;
    stop_name?: string;
    address?: string;
    quantity?: number;
    delivered_at?: string;
  }[];
};

type ReportRow = {
  lot_number: string;
  product_id?: string;
  vendor?: string;
  received_date?: string;
  received_by?: string;
  qty_received?: number;
  unit_of_measure?: string;
  qty_shipped?: number;
  qty_remaining?: number;
  expiration_date?: string;
  notes?: string;
};

type ReportResponse = {
  page: number;
  page_size: number;
  total: number;
  rows: ReportRow[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

function fmtDate(value: unknown): string {
  if (!value) return '—';
  try {
    return new Date(String(value)).toLocaleDateString();
  } catch {
    return String(value);
  }
}

function fmtQty(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function exportCsv(rows: ReportRow[], filename: string) {
  const headers = [
    'Lot #', 'Product', 'Vendor', 'Received Date', 'Received By',
    'Qty Received', 'Unit', 'Qty Shipped', 'Qty Remaining', 'Expiration',
  ];
  const lines = rows.map((r) => [
    r.lot_number,
    r.product_id ?? '',
    r.vendor ?? '',
    r.received_date ?? '',
    r.received_by ?? '',
    r.qty_received ?? '',
    r.unit_of_measure ?? '',
    r.qty_shipped ?? '',
    r.qty_remaining ?? '',
    r.expiration_date ?? '',
  ].map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','));

  const csv = [headers.join(','), ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function TraceabilityPage() {
  // Trace-by-lot-number panel
  const [traceInput, setTraceInput] = useState('');
  const [traceResult, setTraceResult] = useState<LotTrace | null>(null);
  const [tracing, setTracing] = useState(false);
  const [traceError, setTraceError] = useState('');

  // Report panel
  const [reportLot, setReportLot] = useState('');
  const [reportProduct, setReportProduct] = useState('');
  const [reportDateFrom, setReportDateFrom] = useState('');
  const [reportDateTo, setReportDateTo] = useState('');
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [reportPage, setReportPage] = useState(1);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');

  // ── Trace lookup ────────────────────────────────────────────────────────────
  async function runTrace() {
    const lot = traceInput.trim();
    if (!lot) return;
    setTracing(true);
    setTraceError('');
    setTraceResult(null);
    try {
      const data = await fetchWithAuth<LotTrace>(`/api/lots/${encodeURIComponent(lot)}/trace`);
      setTraceResult(data);
    } catch (err) {
      setTraceError(String((err as Error).message || 'Trace failed'));
    } finally {
      setTracing(false);
    }
  }

  // ── Report ──────────────────────────────────────────────────────────────────
  async function runReport(page = 1) {
    setReportLoading(true);
    setReportError('');
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (reportLot)     params.set('lot',        reportLot);
      if (reportProduct) params.set('product_id', reportProduct);
      if (reportDateFrom) params.set('date_from', reportDateFrom);
      if (reportDateTo)   params.set('date_to',   reportDateTo);
      const data = await fetchWithAuth<ReportResponse>(`/api/lots/traceability/report?${params}`);
      setReport(data);
      setReportPage(page);
    } catch (err) {
      setReportError(String((err as Error).message || 'Report failed'));
    } finally {
      setReportLoading(false);
    }
  }

  useEffect(() => { runReport(1); }, []); // load first page on mount

  const totalPages = useMemo(() => {
    if (!report) return 1;
    return Math.max(1, Math.ceil(report.total / report.page_size));
  }, [report]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold">FSMA 204 Traceability</h2>
        <p className="text-sm text-muted-foreground">
          FDA Food Traceability List — lot-level supply chain records. Full trace available within 24 hours.
        </p>
      </div>

      {/* ── Lot Trace ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Trace a Lot</CardTitle>
          <CardDescription>
            Enter a lot number to retrieve the full supply chain: receiving → orders → deliveries.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={traceInput}
              onChange={(e) => setTraceInput(e.target.value)}
              placeholder="e.g. SALMON-2026-001"
              onKeyDown={(e) => e.key === 'Enter' && runTrace()}
              className="max-w-sm"
            />
            <Button onClick={runTrace} disabled={tracing || !traceInput.trim()}>
              {tracing ? 'Searching…' : 'Trace'}
            </Button>
          </div>

          {traceError && (
            <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">
              {traceError}
            </div>
          )}

          {traceResult && (
            <div className="space-y-4">
              {/* Lot info */}
              <div className="rounded-lg border border-border bg-muted/20 p-4">
                <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Lot Record</h3>
                <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-sm">
                  <Kv label="Lot Number"    value={traceResult.lot.lot_number} highlight />
                  <Kv label="Product"       value={traceResult.lot.product || traceResult.lot.product_id} />
                  <Kv label="Vendor"        value={traceResult.lot.vendor} />
                  <Kv label="Received"      value={fmtDate(traceResult.lot.received_date)} />
                  <Kv label="Received By"   value={traceResult.lot.received_by} />
                  <Kv label="Qty Received"  value={`${fmtQty(traceResult.lot.quantity_received)} ${traceResult.lot.unit_of_measure || ''}`} />
                  <Kv label="Expiration"    value={fmtDate(traceResult.lot.expiration_date)} />
                  <Kv label="Notes"         value={traceResult.lot.notes} />
                </dl>
              </div>

              {/* Orders */}
              <div>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Orders ({traceResult.orders.length})
                </h3>
                {traceResult.orders.length ? (
                  <div className="rounded-lg border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Order #</TableHead>
                          <TableHead>Customer</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Qty from Lot</TableHead>
                          <TableHead>Date</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {traceResult.orders.map((o) => (
                          <TableRow key={o.order_id}>
                            <TableCell className="font-medium">{o.order_number || o.order_id.slice(0, 8)}</TableCell>
                            <TableCell>{fmt(o.customer)}</TableCell>
                            <TableCell>
                              <Badge variant={o.status === 'invoiced' ? 'success' : o.status === 'pending' ? 'warning' : 'secondary'}>
                                {o.status || 'unknown'}
                              </Badge>
                            </TableCell>
                            <TableCell>{fmtQty(o.quantity)}</TableCell>
                            <TableCell>{fmtDate(o.delivery_date)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No orders found for this lot.</p>
                )}
              </div>

              {/* Stops */}
              <div>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Delivery Stops ({traceResult.stops.length})
                </h3>
                {traceResult.stops.length ? (
                  <div className="rounded-lg border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Stop</TableHead>
                          <TableHead>Address</TableHead>
                          <TableHead>Qty</TableHead>
                          <TableHead>Dispatched</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {traceResult.stops.map((s) => (
                          <TableRow key={s.stop_id}>
                            <TableCell className="font-medium">{fmt(s.stop_name)}</TableCell>
                            <TableCell>{fmt(s.address)}</TableCell>
                            <TableCell>{fmtQty(s.quantity)}</TableCell>
                            <TableCell>{fmtDate(s.delivered_at)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No delivery stops found for this lot.</p>
                )}
              </div>

              <Button
                variant="outline"
                onClick={() => {
                  if (!traceResult) return;
                  const rows: ReportRow[] = [{
                    lot_number:      traceResult.lot.lot_number,
                    product_id:      traceResult.lot.product_id,
                    vendor:          traceResult.lot.vendor,
                    received_date:   traceResult.lot.received_date,
                    received_by:     traceResult.lot.received_by,
                    qty_received:    traceResult.lot.quantity_received,
                    unit_of_measure: traceResult.lot.unit_of_measure,
                    qty_shipped:     traceResult.orders.reduce((s, o) => s + (o.quantity || 0), 0),
                    expiration_date: traceResult.lot.expiration_date,
                  }];
                  exportCsv(rows, `trace-${traceResult.lot.lot_number}.csv`);
                }}
              >
                Export CSV
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Lot Movements Report ──────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Lot Movements Report</CardTitle>
          <CardDescription>Filter by lot, product, and date range. Export-ready CSV.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <label className="space-y-1 text-sm">
              <span className="font-semibold text-muted-foreground">Lot #</span>
              <Input value={reportLot} onChange={(e) => setReportLot(e.target.value)} placeholder="SALMON-2026" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-semibold text-muted-foreground">Product ID</span>
              <Input value={reportProduct} onChange={(e) => setReportProduct(e.target.value)} placeholder="SAL-01" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-semibold text-muted-foreground">From</span>
              <Input type="date" value={reportDateFrom} onChange={(e) => setReportDateFrom(e.target.value)} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-semibold text-muted-foreground">To</span>
              <Input type="date" value={reportDateTo} onChange={(e) => setReportDateTo(e.target.value)} />
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => runReport(1)} disabled={reportLoading}>
              {reportLoading ? 'Loading…' : 'Run Report'}
            </Button>
            {report && report.rows.length > 0 && (
              <Button variant="outline" onClick={() => exportCsv(report.rows, 'lot-movements.csv')}>
                Export CSV ({report.rows.length} rows)
              </Button>
            )}
          </div>

          {reportError && (
            <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">
              {reportError}
            </div>
          )}

          {report && (
            <>
              <div className="text-sm text-muted-foreground">
                Showing {report.rows.length} of {report.total} lots — Page {reportPage} of {totalPages}
              </div>
              <div className="rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Lot #</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Received</TableHead>
                      <TableHead>Qty Received</TableHead>
                      <TableHead>Qty Shipped</TableHead>
                      <TableHead>Remaining</TableHead>
                      <TableHead>Expiration</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.rows.length ? (
                      report.rows.map((row) => (
                        <TableRow key={row.lot_number}>
                          <TableCell className="font-medium">{row.lot_number}</TableCell>
                          <TableCell>{fmt(row.product_id)}</TableCell>
                          <TableCell>{fmt(row.vendor)}</TableCell>
                          <TableCell>{fmtDate(row.received_date)}</TableCell>
                          <TableCell>{fmtQty(row.qty_received)} {row.unit_of_measure || ''}</TableCell>
                          <TableCell>{fmtQty(row.qty_shipped)}</TableCell>
                          <TableCell>
                            <span className={Number(row.qty_remaining) === 0 ? 'text-muted-foreground' : ''}>
                              {fmtQty(row.qty_remaining)}
                            </span>
                          </TableCell>
                          <TableCell>
                            <ExpiryBadge date={row.expiration_date} />
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={8} className="text-muted-foreground">
                          No lots match the current filters.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline" size="sm"
                    disabled={reportPage <= 1 || reportLoading}
                    onClick={() => runReport(reportPage - 1)}
                  >
                    Previous
                  </Button>
                  <span className="text-sm text-muted-foreground">Page {reportPage} / {totalPages}</span>
                  <Button
                    variant="outline" size="sm"
                    disabled={reportPage >= totalPages || reportLoading}
                    onClick={() => runReport(reportPage + 1)}
                  >
                    Next
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Small sub-components ──────────────────────────────────────────────────────

function Kv({ label, value, highlight }: { label: string; value: unknown; highlight?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={highlight ? 'font-mono font-semibold text-foreground' : 'text-sm text-foreground'}>
        {value !== null && value !== undefined && value !== '' ? String(value) : '—'}
      </dd>
    </div>
  );
}

function ExpiryBadge({ date }: { date?: string | null }) {
  if (!date) return <span className="text-muted-foreground">—</span>;
  const daysUntil = Math.floor((new Date(date).getTime() - Date.now()) / 86_400_000);
  if (daysUntil < 0)  return <Badge variant="neutral">Expired</Badge>;
  if (daysUntil <= 7) return <Badge variant="warning">{fmtDate(date)}</Badge>;
  return <span className="text-sm">{fmtDate(date)}</span>;
}
