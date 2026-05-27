import { useMemo, useState } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { StatusBadge } from '../components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { parseRows, parseSummary, useForecasting } from '../hooks/useForecasting';

const reorderColors = { yes: 'red', no: 'green' } as const;

function asMoney(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function ForecastingPage() {
  const { data, isLoading, isError, error, refetch } = useForecasting();

  const rows = useMemo(() => (data ? parseRows(data.data) : []), [data]);
  const summary = useMemo(() => parseSummary(data?.data, rows), [data, rows]);
  const sourceEndpoint = data?.endpoint || '/api/forecast/inventory';

  const [categoryFilter, setCategoryFilter] = useState<'all' | string>('all');
  const [locationFilter, setLocationFilter] = useState<'all' | string>('all');

  const categoryOptions = useMemo(() => {
    const options = new Set<string>();
    for (const row of rows) { if (row.category) options.add(row.category); }
    return Array.from(options).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const locationOptions = useMemo(() => {
    const options = new Set<string>();
    for (const row of rows) { if (row.location) options.add(row.location); }
    return Array.from(options).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (categoryFilter !== 'all' && row.category !== categoryFilter) return false;
      if (locationFilter !== 'all' && row.location !== locationFilter) return false;
      return true;
    });
  }, [rows, categoryFilter, locationFilter]);

  return (
    <div className="space-y-5">
      {isLoading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading forecasting data...</div> : null}
      {isError ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{String((error as Error)?.message || 'Could not load forecast data')}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Projected Revenue (Next 30 Days)" value={asMoney(summary.projectedRevenue30d)} />
        <SummaryCard label="Projected Orders" value={summary.projectedOrders.toLocaleString()} />
        <SummaryCard label="Top Forecasted Product" value={summary.topForecastedProduct || '-'} />
        <SummaryCard label="Inventory Risk Items" value={summary.inventoryRiskItems.toLocaleString()} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <CardTitle>Forecast Filters</CardTitle>
            <CardDescription>AI demand forecast from <span className="font-semibold">{sourceEndpoint}</span>.</CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Category</span>
              <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                <option value="all">All Categories</option>
                {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Location</span>
              <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
                <option value="all">All Locations</option>
                {locationOptions.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>
            <Button variant="outline" onClick={() => refetch()}>Refresh</Button>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Forecast Inventory Table</CardTitle>
          <CardDescription>AI-powered demand forecast to guide reorder planning and ops decisions.</CardDescription>
        </CardHeader>
        <CardContent className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Current Stock</TableHead>
                <TableHead>Avg Weekly Demand</TableHead>
                <TableHead>Weeks of Supply</TableHead>
                <TableHead>Reorder Recommended</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length ? filtered.map((row) => (
                <TableRow key={`${row.product}-${row.category}-${row.location}`}>
                  <TableCell className="font-medium">
                    <div>{row.product}</div>
                    <div className="text-xs text-muted-foreground">{row.category} · {row.location}</div>
                  </TableCell>
                  <TableCell>{row.currentStock.toLocaleString()}</TableCell>
                  <TableCell>{row.avgWeeklyDemand.toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                  <TableCell>{row.weeksOfSupply.toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                  <TableCell>
                    <StatusBadge status={row.reorderRecommended} colorMap={reorderColors} labelMap={{ yes: 'Yes', no: 'No' }} />
                  </TableCell>
                </TableRow>
              )) : (
                <TableRow><TableCell colSpan={5} className="text-muted-foreground">No forecast rows found for the selected filters.</TableCell></TableRow>
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
    <Card><CardHeader className="space-y-1"><CardDescription>{label}</CardDescription><CardTitle className="text-2xl">{value}</CardTitle></CardHeader></Card>
  );
}
