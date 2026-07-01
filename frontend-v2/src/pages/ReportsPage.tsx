import { useEffect, useMemo, useState } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { SelectInput } from '../components/ui/select-input';
import { PageSkeleton } from '../components/layout/PageSkeleton';
import { TableEmptyState } from '../components/ui/data-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { type ReportPreset, useSalesReport } from '../hooks/useReports';
import { fetchWithAuth, sendWithAuth } from '../lib/api';

type NamedReportDefinition = {
  id: string;
  name: string;
  query_key: string;
  category?: string;
  description?: string;
};

type ReportFormat = 'csv' | 'text' | 'pdf' | 'xlsx';
type ScheduleCadence = 'daily' | 'weekly' | 'monthly';

function money(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function csvEscape(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, rows: unknown[][]) {
  const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\n');
  const href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
}

function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-2 text-xl font-semibold text-foreground">{value}</div>
    </div>
  );
}

function syncRangeDefaults(preset: ReportPreset): { start: string; end: string } {
  const now = new Date();
  const end = localDateKey(now);
  if (preset === 'daily') return { start: end, end };
  if (preset === 'weekly') {
    const start = new Date(now);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return { start: localDateKey(start), end };
  }
  if (preset === 'monthly') {
    return { start: localDateKey(new Date(now.getFullYear(), now.getMonth(), 1)), end };
  }
  if (preset === 'yearly') {
    return { start: localDateKey(new Date(now.getFullYear(), 0, 1)), end };
  }
  return { start: end, end };
}

const todayKey = localDateKey(new Date());

export function ReportsPage() {
  const [definitions, setDefinitions] = useState<NamedReportDefinition[]>([]);
  const [definitionsLoading, setDefinitionsLoading] = useState(true);
  const [definitionsError, setDefinitionsError] = useState('');
  const [selectedFormat, setSelectedFormat] = useState<ReportFormat>('csv');
  const [scheduleDefinition, setScheduleDefinition] = useState<NamedReportDefinition | null>(null);
  const [scheduleCadence, setScheduleCadence] = useState<ScheduleCadence>('daily');
  const [scheduleTime, setScheduleTime] = useState('08:00');
  const [scheduleEmail, setScheduleEmail] = useState('');
  const [scheduleStatus, setScheduleStatus] = useState('');
  const [scheduleError, setScheduleError] = useState('');
  const [reportPreset, setReportPreset] = useState<ReportPreset>('daily');
  const [reportStartDate, setReportStartDate] = useState(todayKey);
  const [reportEndDate, setReportEndDate] = useState(todayKey);
  const [reportItemFilter, setReportItemFilter] = useState('all');

  const { data: salesReport, isLoading, isError, error } = useSalesReport(
    reportPreset,
    reportStartDate,
    reportEndDate,
    reportItemFilter
  );

  const reportOverview = salesReport?.overview ?? {
    total_sales: 0, delivery_sales: 0, pickup_sales: 0, unknown_sales: 0,
    invoice_count: 0, order_count: 0, average_invoice: 0, item_count: 0,
  };

  useEffect(() => {
    let cancelled = false;
    setDefinitionsLoading(true);
    fetchWithAuth<{ definitions: NamedReportDefinition[] }>('/api/reports/definitions')
      .then((payload) => {
        if (cancelled) return;
        setDefinitions(payload.definitions || []);
        setDefinitionsError('');
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setDefinitionsError(err.message || 'Could not load report definitions');
      })
      .finally(() => {
        if (!cancelled) setDefinitionsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const definitionsByCategory = useMemo(() => {
    return definitions.reduce<Record<string, NamedReportDefinition[]>>((acc, definition) => {
      const category = definition.category || 'General';
      acc[category] = acc[category] || [];
      acc[category].push(definition);
      return acc;
    }, {});
  }, [definitions]);

  function exportItemSalesCsv() {
    if (!salesReport?.items?.length) return;
    downloadCsv(`reports-item-sales-${reportPreset}-${reportStartDate || 'start'}-${reportEndDate || 'end'}.csv`, [
      ['Item', 'Item Number', 'Qty Sold', 'Revenue', 'Delivery Sales', 'Pickup Sales', 'Invoices'],
      ...salesReport.items.map((item) => [
        item.label,
        item.item_number || '',
        item.qty,
        item.revenue,
        item.delivery_revenue,
        item.pickup_revenue,
        item.invoice_count,
      ]),
    ]);
  }

  function runNamedReport(definition: NamedReportDefinition) {
    const params = new URLSearchParams({
      queryKey: definition.query_key,
      format: selectedFormat,
    });
    window.location.href = `/api/reports/run?${params.toString()}`;
  }

  async function saveSchedule() {
    if (!scheduleDefinition) return;
    setScheduleError('');
    setScheduleStatus('');
    try {
      await sendWithAuth('/api/report-schedules', 'POST', {
        report_definition_id: scheduleDefinition.id || scheduleDefinition.query_key,
        cadence: scheduleCadence,
        cadence_config: {
          time: scheduleTime,
          format: selectedFormat,
        },
        delivery_targets: [{ target_type: 'email', address: scheduleEmail.trim() }],
      });
      setScheduleStatus(`${scheduleDefinition.name} schedule saved.`);
      setScheduleDefinition(null);
      setScheduleEmail('');
    } catch (err) {
      setScheduleError((err as Error).message || 'Could not save report schedule');
    }
  }

  return (
    <div className="space-y-5">
      {definitionsLoading ? <PageSkeleton /> : null}
      {definitionsError ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{definitionsError}</div> : null}
      {scheduleStatus ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{scheduleStatus}</div> : null}
      {scheduleError ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{scheduleError}</div> : null}

      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <CardTitle>Report Library</CardTitle>
            <CardDescription>Run named report packs or schedule recurring delivery.</CardDescription>
          </div>
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-muted-foreground">Export Format</span>
            <SelectInput
              value={selectedFormat}
              onChange={(e) => setSelectedFormat(e.target.value as ReportFormat)}
              className="flex min-w-32"
            >
              <option value="csv">CSV</option>
              <option value="text">Text</option>
              <option value="pdf">PDF</option>
              <option value="xlsx">Excel</option>
            </SelectInput>
          </label>
        </CardHeader>
        <CardContent className="space-y-5">
          {Object.entries(definitionsByCategory).length ? Object.entries(definitionsByCategory).map(([category, items]) => (
            <section key={category} className="space-y-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{category}</h3>
              <div className="divide-y divide-border rounded-md border border-border">
                {items.map((definition) => (
                  <div key={definition.id || definition.query_key} className="flex flex-col gap-3 p-3 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <div className="font-semibold text-foreground">{definition.name}</div>
                      {definition.description ? <div className="mt-1 text-sm text-muted-foreground">{definition.description}</div> : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button variant="outline" onClick={() => runNamedReport(definition)}>
                        Run Now
                      </Button>
                      <Button
                        variant="outline"
                        aria-label={`Schedule ${definition.name}`}
                        onClick={() => {
                          setScheduleDefinition(definition);
                          setScheduleStatus('');
                          setScheduleError('');
                        }}
                      >
                        Schedule
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )) : (
            <div className="rounded-md border border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
              No named reports are available.
            </div>
          )}

          {scheduleDefinition ? (
            <div className="rounded-md border border-border bg-muted/20 p-4">
              <div className="mb-3 flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="font-semibold">Schedule {scheduleDefinition.name}</div>
                  <div className="text-sm text-muted-foreground">Delivery uses the selected export format above.</div>
                </div>
                <Button variant="ghost" onClick={() => setScheduleDefinition(null)}>Cancel</Button>
              </div>
              <div className="grid gap-3 md:grid-cols-4">
                <label className="space-y-1 text-sm">
                  <span className="font-semibold text-muted-foreground">Cadence</span>
                  <SelectInput
                    value={scheduleCadence}
                    onChange={(e) => setScheduleCadence(e.target.value as ScheduleCadence)}
                    className="flex w-full"
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </SelectInput>
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-semibold text-muted-foreground">Time</span>
                  <Input type="time" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)} />
                </label>
                <label htmlFor="report-delivery-email" className="space-y-1 text-sm md:col-span-2">
                  <span className="font-semibold text-muted-foreground">Delivery email</span>
                  <Input
                    id="report-delivery-email"
                    type="email"
                    value={scheduleEmail}
                    onChange={(e) => setScheduleEmail(e.target.value)}
                    placeholder="ops@example.com"
                  />
                </label>
              </div>
              <div className="mt-3 flex justify-end">
                <Button onClick={saveSchedule} disabled={!scheduleEmail.trim()}>
                  Save Schedule
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {isLoading ? <PageSkeleton /> : null}
      {isError ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{String((error as Error)?.message || 'Could not load sales report')}</div> : null}

      <Card>
        <CardHeader className="space-y-1">
          <CardTitle>Sales Reports</CardTitle>
          <CardDescription>Daily, weekly, monthly, yearly, or custom-range sales with delivery and pickup splits.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {(['daily', 'weekly', 'monthly', 'yearly', 'range'] as ReportPreset[]).map((preset) => (
              <Button
                key={preset}
                variant={reportPreset === preset ? 'default' : 'outline'}
                onClick={() => {
                  setReportPreset(preset);
                  if (preset !== 'range') {
                    const { start, end } = syncRangeDefaults(preset);
                    setReportStartDate(start);
                    setReportEndDate(end);
                  }
                }}
              >
                {preset.charAt(0).toUpperCase() + preset.slice(1)}
              </Button>
            ))}
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <label className="space-y-1 text-sm">
              <span className="font-semibold text-muted-foreground">Item Filter</span>
              <SelectInput
                value={reportItemFilter}
                onChange={(e) => setReportItemFilter(e.target.value)}
                className="flex w-full"
              >
                <option value="all">All Items</option>
                {(salesReport?.available_items ?? []).map((item) => (
                  <option key={item.key} value={item.item_number || item.label}>
                    {item.label}{item.item_number ? ` (#${item.item_number})` : ''}
                  </option>
                ))}
              </SelectInput>
            </label>
            {reportPreset === 'range' ? (
              <>
                <label className="space-y-1 text-sm">
                  <span className="font-semibold text-muted-foreground">Start Date</span>
                  <Input type="date" value={reportStartDate} onChange={(e) => setReportStartDate(e.target.value)} />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-semibold text-muted-foreground">End Date</span>
                  <Input type="date" value={reportEndDate} onChange={(e) => setReportEndDate(e.target.value)} />
                </label>
              </>
            ) : (
              <>
                <MiniMetric label="Range Start" value={reportStartDate || '—'} />
                <MiniMetric label="Range End" value={reportEndDate || '—'} />
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MiniMetric label="Total Sales" value={money(reportOverview.total_sales)} />
        <MiniMetric label="Delivery Sales" value={money(reportOverview.delivery_sales)} />
        <MiniMetric label="Pickup Sales" value={money(reportOverview.pickup_sales)} />
        <MiniMetric label="Average Invoice" value={money(reportOverview.average_invoice)} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MiniMetric label="Invoices" value={reportOverview.invoice_count.toLocaleString()} />
        <MiniMetric label="Orders" value={reportOverview.order_count.toLocaleString()} />
        <MiniMetric label="Matched Items" value={reportOverview.item_count.toLocaleString()} />
        <MiniMetric label="Unclassified Sales" value={money(reportOverview.unknown_sales)} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <CardTitle>Item Sales</CardTitle>
            <CardDescription>Use the item filter above to focus on a specific product or review all sold items for the selected window.</CardDescription>
          </div>
          <Button variant="outline" onClick={exportItemSalesCsv} disabled={!salesReport?.items?.length}>
            Export Item Sales CSV
          </Button>
        </CardHeader>
        <CardContent className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Qty Sold</TableHead>
                <TableHead>Revenue</TableHead>
                <TableHead>Delivery Sales</TableHead>
                <TableHead>Pickup Sales</TableHead>
                <TableHead>Invoices</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(salesReport?.items ?? []).length ? (
                (salesReport?.items ?? []).map((item) => (
                  <TableRow key={item.key}>
                    <TableCell className="font-medium">
                      {item.label}
                      {item.item_number ? <div className="text-xs text-muted-foreground">#{item.item_number}</div> : null}
                    </TableCell>
                    <TableCell>{item.qty.toLocaleString()}</TableCell>
                    <TableCell>{money(item.revenue)}</TableCell>
                    <TableCell>{money(item.delivery_revenue)}</TableCell>
                    <TableCell>{money(item.pickup_revenue)}</TableCell>
                    <TableCell>{item.invoice_count.toLocaleString()}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableEmptyState
                  colSpan={6}
                  title="No sales rows found for the selected report filters."
                  description="Switch the preset or date range to broaden the sales report."
                  actionLabel="Show Daily Report"
                  onAction={() => {
                    const { start, end } = syncRangeDefaults('daily');
                    setReportPreset('daily');
                    setReportStartDate(start);
                    setReportEndDate(end);
                    setReportItemFilter('all');
                  }}
                />
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
