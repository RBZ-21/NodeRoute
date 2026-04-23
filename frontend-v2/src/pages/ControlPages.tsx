import { useEffect, useMemo, useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth, sendWithAuth } from '../lib/api';

type ForecastOrdersResponse = {
  monthly?: Array<{ label?: string; count?: number | string }>;
  cadence?: Array<{
    customer?: string;
    order_count?: number | string;
    last_order?: string;
    days_since?: number | string;
    avg_cadence_days?: number | string | null;
    next_order_in_days?: number | string | null;
  }>;
};

type InventoryForecast = {
  product_name?: string;
  product_id?: string;
  predicted_demand_units?: number | string;
  reorder_recommended?: boolean;
  suggested_reorder_quantity?: number | string;
  confidence?: string;
  trend?: string;
  reasoning?: string;
};

type CompanySettings = {
  forceDriverSignature?: boolean;
};

type Vendor = {
  id: string;
  name?: string;
  contact_name?: string;
  email?: string;
  phone?: string;
  payment_terms?: string;
  lead_time_days?: number | string | null;
  status?: string;
  created_at?: string;
};

type Warehouse = {
  id: string;
  name?: string;
  code?: string;
  isDefault?: boolean;
  created_at?: string;
};

type ProjectionResponse = {
  projections?: Array<{
    product_name?: string;
    stock_qty?: number | string;
    avg_daily_usage?: number | string;
    projected_remaining_qty?: number | string;
    days_until_stockout?: number | string | null;
    unit?: string;
  }>;
};

type SuggestionsResponse = {
  suggestions?: Array<{
    product_name?: string;
    stock_qty?: number | string;
    avg_daily_usage?: number | string;
    suggested_order_qty?: number | string;
    urgency?: string;
    estimated_unit_cost?: number | string;
  }>;
};

type EdiJob = {
  id: string;
  direction?: string;
  partner?: string;
  doc_type?: string;
  status?: string;
  created_at?: string;
};

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function ForecastPage() {
  const [ordersData, setOrdersData] = useState<ForecastOrdersResponse | null>(null);
  const [inventoryData, setInventoryData] = useState<InventoryForecast[]>([]);
  const [days, setDays] = useState('14');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [orders, inventory] = await Promise.all([
        fetchWithAuth<ForecastOrdersResponse>('/api/forecast/orders'),
        fetchWithAuth<InventoryForecast[]>(`/api/forecast/inventory?days=${Math.max(1, Math.min(90, asNumber(days) || 14))}`),
      ]);
      setOrdersData(orders || null);
      setInventoryData(Array.isArray(inventory) ? inventory : []);
    } catch (err) {
      setError(String((err as Error).message || 'Could not load forecast data'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const summary = useMemo(() => {
    const monthlyOrders = (ordersData?.monthly || []).reduce((sum, row) => sum + asNumber(row.count), 0);
    const customerCadence = (ordersData?.cadence || []).length;
    const recommended = inventoryData.filter((row) => !!row.reorder_recommended).length;
    return { monthlyOrders, customerCadence, recommended };
  }, [ordersData, inventoryData]);

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading forecasting data...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="12-Month Orders" value={summary.monthlyOrders.toLocaleString()} />
        <SummaryCard label="Cadence Accounts" value={summary.customerCadence.toLocaleString()} />
        <SummaryCard label="Reorder Alerts" value={summary.recommended.toLocaleString()} />
        <SummaryCard label="Forecast Horizon" value={`${Math.max(1, Math.min(90, asNumber(days) || 14))} days`} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <CardTitle>Demand Forecast</CardTitle>
            <CardDescription>Customer cadence and AI demand outlook from existing `/api/forecast` routes.</CardDescription>
          </div>
          <div className="flex items-end gap-2">
            <label className="space-y-1 text-sm">
              <span className="font-semibold text-muted-foreground">Days</span>
              <Input type="number" min="1" max="90" value={days} onChange={(event) => setDays(event.target.value)} />
            </label>
            <Button onClick={load}>Refresh</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Orders</TableHead>
                  <TableHead>Last Order</TableHead>
                  <TableHead>Days Since</TableHead>
                  <TableHead>Avg Cadence</TableHead>
                  <TableHead>Next Due</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(ordersData?.cadence || []).length ? (
                  (ordersData?.cadence || []).slice(0, 40).map((row, index) => (
                    <TableRow key={`${row.customer || 'customer'}-${index}`}>
                      <TableCell className="font-medium">{row.customer || '-'}</TableCell>
                      <TableCell>{asNumber(row.order_count).toLocaleString()}</TableCell>
                      <TableCell>{row.last_order ? new Date(row.last_order).toLocaleDateString() : '-'}</TableCell>
                      <TableCell>{asNumber(row.days_since).toLocaleString()}</TableCell>
                      <TableCell>{row.avg_cadence_days == null ? '-' : asNumber(row.avg_cadence_days).toLocaleString()}</TableCell>
                      <TableCell>{row.next_order_in_days == null ? '-' : asNumber(row.next_order_in_days).toLocaleString()}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="text-muted-foreground">
                      No customer cadence rows available.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <div className="rounded-lg border border-border bg-card p-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Predicted Demand</TableHead>
                  <TableHead>Reorder Qty</TableHead>
                  <TableHead>Recommendation</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead>Trend</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inventoryData.length ? (
                  inventoryData.slice(0, 50).map((row, index) => (
                    <TableRow key={`${row.product_id || row.product_name || 'forecast'}-${index}`}>
                      <TableCell className="font-medium">{row.product_name || row.product_id || '-'}</TableCell>
                      <TableCell>{asNumber(row.predicted_demand_units).toLocaleString()}</TableCell>
                      <TableCell>{asNumber(row.suggested_reorder_quantity).toLocaleString()}</TableCell>
                      <TableCell>
                        <Badge variant={row.reorder_recommended ? 'warning' : 'neutral'}>
                          {row.reorder_recommended ? 'Reorder' : 'Stable'}
                        </Badge>
                      </TableCell>
                      <TableCell>{row.confidence || '-'}</TableCell>
                      <TableCell>{row.trend || '-'}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="text-muted-foreground">
                      No inventory forecast rows available.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function SettingsPage() {
  const [settings, setSettings] = useState<CompanySettings>({ forceDriverSignature: false });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await fetchWithAuth<CompanySettings>('/api/settings/company');
      setSettings({ forceDriverSignature: !!data?.forceDriverSignature });
    } catch (err) {
      setError(String((err as Error).message || 'Could not load company settings'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function save() {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const data = await sendWithAuth<CompanySettings>('/api/settings/company', 'PATCH', {
        forceDriverSignature: !!settings.forceDriverSignature,
      });
      setSettings({ forceDriverSignature: !!data?.forceDriverSignature });
      setNotice('Company settings updated.');
    } catch (err) {
      setError(String((err as Error).message || 'Could not save company settings'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading settings...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}
      {notice ? <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div> : null}

      <Card>
        <CardHeader>
          <CardTitle>Company Configuration</CardTitle>
          <CardDescription>Operational controls stored in `/api/settings/company`.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-muted-foreground">Force Driver Signature Before Completion</span>
            <select
              value={settings.forceDriverSignature ? 'yes' : 'no'}
              onChange={(event) => setSettings((current) => ({ ...current, forceDriverSignature: event.target.value === 'yes' }))}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </label>
          <div className="flex gap-2">
            <Button onClick={save} disabled={saving}>
              Save Settings
            </Button>
            <Button variant="outline" onClick={load}>
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function AIHelpPage() {
  const [feature, setFeature] = useState('');
  const [question, setQuestion] = useState('');
  const [responseText, setResponseText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function requestWalkthrough() {
    const trimmedFeature = feature.trim();
    if (!trimmedFeature) {
      setError('Feature is required.');
      return;
    }
    setLoading(true);
    setError('');
    setResponseText('');
    try {
      const data = await sendWithAuth<Record<string, unknown>>('/api/ai/walkthrough', 'POST', {
        feature: trimmedFeature,
        question: question.trim() || '',
      });
      setResponseText(JSON.stringify(data, null, 2));
    } catch (err) {
      setError(String((err as Error).message || 'Could not generate walkthrough'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}
      <Card>
        <CardHeader>
          <CardTitle>AI Walkthroughs</CardTitle>
          <CardDescription>Generate guided steps from existing `/api/ai/walkthrough` flow.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-muted-foreground">Feature</span>
            <Input value={feature} onChange={(event) => setFeature(event.target.value)} placeholder="Inventory receiving workflow" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold text-muted-foreground">Question (optional)</span>
            <Input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="What should operations verify before posting?" />
          </label>
          <Button onClick={requestWalkthrough} disabled={loading}>
            {loading ? 'Generating...' : 'Generate Walkthrough'}
          </Button>
          <pre className="max-h-[420px] overflow-auto rounded-lg border border-border bg-muted/30 p-4 text-xs leading-relaxed">
            {responseText || 'Walkthrough output will appear here.'}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}

export function VendorsPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [leadTime, setLeadTime] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await fetchWithAuth<Vendor[]>('/api/ops/vendors');
      setVendors(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(String((err as Error).message || 'Could not load vendors'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createVendor() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Vendor name is required.');
      return;
    }
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      await sendWithAuth('/api/ops/vendors', 'POST', {
        vendorName: trimmed,
        email: email.trim() || null,
        leadTimeDays: asNumber(leadTime) || 0,
      });
      setName('');
      setEmail('');
      setLeadTime('');
      setNotice(`Added vendor ${trimmed}.`);
      await load();
    } catch (err) {
      setError(String((err as Error).message || 'Could not create vendor'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading vendors...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}
      {notice ? <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div> : null}

      <Card>
        <CardHeader>
          <CardTitle>Vendor Setup</CardTitle>
          <CardDescription>Supplier records for operations and purchasing automation.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Blue Ocean Seafood" />
          <Input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="procurement@vendor.com" />
          <Input value={leadTime} onChange={(event) => setLeadTime(event.target.value)} placeholder="Lead time days" />
          <div className="flex gap-2">
            <Button onClick={createVendor} disabled={submitting}>
              Add Vendor
            </Button>
            <Button variant="outline" onClick={load}>
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Vendors</CardTitle>
        </CardHeader>
        <CardContent className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vendor</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Lead Time</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vendors.length ? (
                vendors.map((vendor) => (
                  <TableRow key={vendor.id}>
                    <TableCell className="font-medium">{vendor.name || '-'}</TableCell>
                    <TableCell>{vendor.email || '-'}</TableCell>
                    <TableCell>{vendor.lead_time_days == null ? '-' : `${asNumber(vendor.lead_time_days)} days`}</TableCell>
                    <TableCell>{vendor.status || '-'}</TableCell>
                    <TableCell>{vendor.created_at ? new Date(vendor.created_at).toLocaleDateString() : '-'}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    No vendors found.
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

export function WarehousePage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await fetchWithAuth<Warehouse[]>('/api/ops/warehouses');
      setWarehouses(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(String((err as Error).message || 'Could not load warehouses'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createWarehouse() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Warehouse name is required.');
      return;
    }
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      await sendWithAuth('/api/ops/warehouses', 'POST', {
        name: trimmed,
        code: code.trim() || null,
      });
      setName('');
      setCode('');
      setNotice(`Created warehouse ${trimmed}.`);
      await load();
    } catch (err) {
      setError(String((err as Error).message || 'Could not create warehouse'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading warehouses...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}
      {notice ? <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div> : null}

      <Card>
        <CardHeader>
          <CardTitle>Warehouse Registry</CardTitle>
          <CardDescription>Add and maintain warehouse entities in operations scope.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Secondary Warehouse" />
          <Input value={code} onChange={(event) => setCode(event.target.value)} placeholder="WH2" />
          <Button onClick={createWarehouse} disabled={submitting}>
            Add Warehouse
          </Button>
          <Button variant="outline" onClick={load}>
            Refresh
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Warehouses</CardTitle>
        </CardHeader>
        <CardContent className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Default</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {warehouses.length ? (
                warehouses.map((warehouse) => (
                  <TableRow key={warehouse.id}>
                    <TableCell className="font-medium">{warehouse.name || '-'}</TableCell>
                    <TableCell>{warehouse.code || '-'}</TableCell>
                    <TableCell>
                      <Badge variant={warehouse.isDefault ? 'success' : 'neutral'}>{warehouse.isDefault ? 'Default' : 'No'}</Badge>
                    </TableCell>
                    <TableCell>{warehouse.created_at ? new Date(warehouse.created_at).toLocaleDateString() : '-'}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">
                    No warehouse rows available.
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

export function PlanningPage() {
  const [days, setDays] = useState('30');
  const [lookbackDays, setLookbackDays] = useState('30');
  const [coverageDays, setCoverageDays] = useState('30');
  const [leadTimeDays, setLeadTimeDays] = useState('5');
  const [projectionData, setProjectionData] = useState<ProjectionResponse | null>(null);
  const [suggestionsData, setSuggestionsData] = useState<SuggestionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [projections, suggestions] = await Promise.all([
        fetchWithAuth<ProjectionResponse>(`/api/ops/projections?days=${Math.max(1, Math.min(90, asNumber(days) || 30))}&lookbackDays=${Math.max(7, Math.min(90, asNumber(lookbackDays) || 30))}`),
        fetchWithAuth<SuggestionsResponse>(
          `/api/ops/purchasing-suggestions?coverageDays=${Math.max(1, Math.min(90, asNumber(coverageDays) || 30))}&leadTimeDays=${Math.max(0, Math.min(60, asNumber(leadTimeDays) || 5))}&lookbackDays=${Math.max(7, Math.min(90, asNumber(lookbackDays) || 30))}`
        ),
      ]);
      setProjectionData(projections || null);
      setSuggestionsData(suggestions || null);
    } catch (err) {
      setError(String((err as Error).message || 'Could not load planning data'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const summary = useMemo(() => {
    const projectionRows = projectionData?.projections || [];
    const suggestionRows = suggestionsData?.suggestions || [];
    const atRisk = projectionRows.filter((row) => row.days_until_stockout != null && asNumber(row.days_until_stockout) <= 14).length;
    const suggestedSpend = suggestionRows.reduce(
      (sum, row) => sum + asNumber(row.suggested_order_qty) * asNumber(row.estimated_unit_cost),
      0
    );
    return { atRisk, suggestedSpend, suggestionCount: suggestionRows.length };
  }, [projectionData, suggestionsData]);

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading planning model...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="At-Risk SKUs" value={summary.atRisk.toLocaleString()} />
        <SummaryCard label="Suggested Lines" value={summary.suggestionCount.toLocaleString()} />
        <SummaryCard label="Suggested Spend" value={money(summary.suggestedSpend)} />
        <SummaryCard label="Lookback Window" value={`${Math.max(7, Math.min(90, asNumber(lookbackDays) || 30))} days`} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <CardTitle>Planning Controls</CardTitle>
            <CardDescription>Projection and purchasing suggestion model controls.</CardDescription>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Input value={days} onChange={(event) => setDays(event.target.value)} placeholder="Projection days" />
            <Input value={lookbackDays} onChange={(event) => setLookbackDays(event.target.value)} placeholder="Lookback days" />
            <Input value={coverageDays} onChange={(event) => setCoverageDays(event.target.value)} placeholder="Coverage days" />
            <Input value={leadTimeDays} onChange={(event) => setLeadTimeDays(event.target.value)} placeholder="Lead time days" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={load}>Apply Filters</Button>

          <div className="rounded-lg border border-border bg-card p-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead>Daily Usage</TableHead>
                  <TableHead>Projected Remaining</TableHead>
                  <TableHead>Days to Stockout</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(projectionData?.projections || []).length ? (
                  (projectionData?.projections || []).slice(0, 50).map((row, index) => (
                    <TableRow key={`${row.product_name || 'projection'}-${index}`}>
                      <TableCell className="font-medium">{row.product_name || '-'}</TableCell>
                      <TableCell>{asNumber(row.stock_qty).toLocaleString()} {row.unit || ''}</TableCell>
                      <TableCell>{asNumber(row.avg_daily_usage).toLocaleString()}</TableCell>
                      <TableCell>{asNumber(row.projected_remaining_qty).toLocaleString()}</TableCell>
                      <TableCell>{row.days_until_stockout == null ? '-' : asNumber(row.days_until_stockout).toLocaleString()}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground">
                      No projection rows available.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <div className="rounded-lg border border-border bg-card p-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Suggested Qty</TableHead>
                  <TableHead>Urgency</TableHead>
                  <TableHead>Unit Cost</TableHead>
                  <TableHead>Estimated Spend</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(suggestionsData?.suggestions || []).length ? (
                  (suggestionsData?.suggestions || []).slice(0, 50).map((row, index) => {
                    const spend = asNumber(row.suggested_order_qty) * asNumber(row.estimated_unit_cost);
                    return (
                      <TableRow key={`${row.product_name || 'suggestion'}-${index}`}>
                        <TableCell className="font-medium">{row.product_name || '-'}</TableCell>
                        <TableCell>{asNumber(row.suggested_order_qty).toLocaleString()}</TableCell>
                        <TableCell>
                          <Badge variant={String(row.urgency || '').toLowerCase() === 'high' ? 'warning' : 'secondary'}>
                            {String(row.urgency || 'normal')}
                          </Badge>
                        </TableCell>
                        <TableCell>{money(asNumber(row.estimated_unit_cost))}</TableCell>
                        <TableCell>{money(spend)}</TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground">
                      No suggestion rows available.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function IntegrationsPage() {
  const [jobs, setJobs] = useState<EdiJob[]>([]);
  const [capabilities, setCapabilities] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [direction, setDirection] = useState('outbound');
  const [partner, setPartner] = useState('');
  const [docType, setDocType] = useState('850');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [jobData, capabilitiesData] = await Promise.all([
        fetchWithAuth<EdiJob[]>('/api/ops/edi-jobs'),
        fetchWithAuth<Record<string, boolean>>('/api/ops/capabilities'),
      ]);
      setJobs(Array.isArray(jobData) ? jobData : []);
      setCapabilities(capabilitiesData || {});
    } catch (err) {
      setError(String((err as Error).message || 'Could not load integrations data'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function queueEdiJob() {
    const partnerName = partner.trim();
    if (!partnerName) {
      setError('Partner is required.');
      return;
    }
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      await sendWithAuth('/api/ops/edi-jobs', 'POST', {
        direction,
        partner: partnerName,
        docType,
      });
      setPartner('');
      setDocType('850');
      setNotice(`Queued ${direction} EDI ${docType} for ${partnerName}.`);
      await load();
    } catch (err) {
      setError(String((err as Error).message || 'Could not queue EDI job'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      {loading ? <div className="rounded-md border border-border bg-muted/50 px-4 py-2 text-sm">Loading integrations...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div> : null}
      {notice ? <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</div> : null}

      <Card>
        <CardHeader>
          <CardTitle>Queue EDI Job</CardTitle>
          <CardDescription>Submit integrations queue events through `/api/ops/edi-jobs`.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <select value={direction} onChange={(event) => setDirection(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
            <option value="outbound">outbound</option>
            <option value="inbound">inbound</option>
          </select>
          <Input value={partner} onChange={(event) => setPartner(event.target.value)} placeholder="Partner name" />
          <Input value={docType} onChange={(event) => setDocType(event.target.value)} placeholder="Doc type (e.g., 850)" />
          <div className="flex gap-2">
            <Button onClick={queueEdiJob} disabled={submitting}>
              Queue Job
            </Button>
            <Button variant="outline" onClick={load}>
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Capabilities Snapshot</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Object.keys(capabilities).length ? (
            Object.entries(capabilities).map(([key, value]) => (
              <div key={key} className="rounded-md border border-border bg-muted/20 px-3 py-2 text-sm">
                <div className="font-semibold">{key.replace(/_/g, ' ')}</div>
                <div className="text-muted-foreground">{value ? 'Enabled' : 'Disabled'}</div>
              </div>
            ))
          ) : (
            <div className="text-sm text-muted-foreground">No capability snapshot available.</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>EDI Jobs</CardTitle>
        </CardHeader>
        <CardContent className="rounded-lg border border-border bg-card p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Direction</TableHead>
                <TableHead>Partner</TableHead>
                <TableHead>Doc Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.length ? (
                jobs.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell>{job.direction || '-'}</TableCell>
                    <TableCell className="font-medium">{job.partner || '-'}</TableCell>
                    <TableCell>{job.doc_type || '-'}</TableCell>
                    <TableCell>{job.status || '-'}</TableCell>
                    <TableCell>{job.created_at ? new Date(job.created_at).toLocaleString() : '-'}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    No EDI jobs queued.
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
