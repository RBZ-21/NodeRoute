import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { SelectInput } from '../components/ui/select-input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { StatCard } from '../components/ui/stat-card';
import { PageSkeleton } from '../components/layout/PageSkeleton';
import { TableEmptyState } from '../components/ui/data-state';
import { StatusBadge } from '../components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { parseRows, parseSummary, useForecasting } from '../hooks/useForecasting';

const reorderColors = { yes: 'red', no: 'green' } as const;

function asMoney(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function ForecastingPage() {
  const navigate = useNavigate();
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
      {isLoading ? <PageSkeleton /> : null}
      {isError ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{String((error as Error)?.message || 'Could not load forecast data')}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Projected Revenue (Next 30 Days)" value={asMoney(summary.projectedRevenue30d)} />
        <StatCard label="Projected Orders" value={summary.projectedOrders.toLocaleString()} />
        <StatCard label="Top Forecasted Product" value={summary.topForecastedProduct || '-'} />
        <StatCard label="Inventory Risk Items" value={summary.inventoryRiskItems.toLocaleString()} />
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
              <SelectInput value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                <option value="all">All Categories</option>
                {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
              </SelectInput>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Location</span>
              <SelectInput value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}>
                <option value="all">All Locations</option>
                {locationOptions.map((l) => <option key={l} value={l}>{l}</option>)}
              </SelectInput>
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
                <TableEmptyState
                  colSpan={5}
                  title="No forecast rows found for the selected filters."
                  description="Open purchasing to create replenishment work, or adjust the forecast filters."
                  actionLabel="Open Purchasing"
                  onAction={() => navigate('/purchasing')}
                />
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
