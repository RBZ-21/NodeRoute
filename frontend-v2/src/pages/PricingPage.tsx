import { useCallback, useEffect, useState } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { SelectInput } from '../components/ui/select-input';
import { LoadingSkeleton } from '../components/ui/data-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { fetchWithAuth, sendWithAuth } from '../lib/api';
import { useToast } from '../components/ui/toast';

type Row = Record<string, unknown> & { id?: string };
type TabKey = 'levels' | 'specials' | 'quotes' | 'promotions' | 'rebates' | 'minimum';
type Column = { key: string; label: string; render?: (row: Row) => string };

const tabs: { id: TabKey; label: string }[] = [
  { id: 'levels', label: 'Price Levels' },
  { id: 'specials', label: 'Customer Specials' },
  { id: 'quotes', label: 'Quotes' },
  { id: 'promotions', label: 'Promotions' },
  { id: 'rebates', label: 'Rebates' },
  { id: 'minimum', label: 'Minimum Sell Rules' },
];

function rowText(row: Row, key: string) {
  const value = row[key];
  if (value == null || value === '') return '-';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function DataTable({ rows, columns, onEdit }: { rows: Row[]; columns: Column[]; onEdit?: (row: Row) => void }) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((column) => <TableHead key={column.key}>{column.label}</TableHead>)}
            {onEdit && <TableHead className="text-right">Edit</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length ? rows.map((row) => (
            <TableRow key={String(row.id || JSON.stringify(row))}>
              {columns.map((column) => (
                <TableCell key={column.key}>{column.render ? column.render(row) : rowText(row, column.key)}</TableCell>
              ))}
              {onEdit && (
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => onEdit(row)}>Edit</Button>
                </TableCell>
              )}
            </TableRow>
          )) : (
            <TableRow>
              <TableCell colSpan={columns.length + (onEdit ? 1 : 0)} className="text-sm text-muted-foreground">
                No records yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export function PricingPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('levels');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();

  const [levels, setLevels] = useState<Row[]>([]);
  const [specials, setSpecials] = useState<Row[]>([]);
  const [quotes, setQuotes] = useState<Row[]>([]);
  const [promotions, setPromotions] = useState<Row[]>([]);
  const [rebates, setRebates] = useState<Row[]>([]);
  const [minimumRules, setMinimumRules] = useState<Row[]>([]);

  const [editingLevelId, setEditingLevelId] = useState('');
  const [levelForm, setLevelForm] = useState({ name: '', description: '' });
  const [specialForm, setSpecialForm] = useState({ customer_id: '', product_id: '', special_price: '', effective_date: '', expiry_date: '' });
  const [editingQuoteId, setEditingQuoteId] = useState('');
  const [quoteForm, setQuoteForm] = useState({ customer_id: '', status: 'draft', valid_from: '', valid_until: '', notes: '', product_id: '', quoted_price: '', min_qty: '', uom: '' });
  const [editingPromotionId, setEditingPromotionId] = useState('');
  const [promotionForm, setPromotionForm] = useState({ name: '', promo_type: 'sale_price', status: 'draft', start_date: '', end_date: '', product_id: '', category_id: '', value: '' });
  const [editingRebateId, setEditingRebateId] = useState('');
  const [rebateForm, setRebateForm] = useState({ vendor_id: '', customer_id: '', name: '', rebate_type: 'percent', value: '', period_start: '', period_end: '' });
  const [editingMinimumId, setEditingMinimumId] = useState('');
  const [minimumForm, setMinimumForm] = useState({ product_id: '', category_id: '', min_margin_pct: '', min_price: '' });

  const loadSpecials = useCallback(async (customerId: string) => {
    if (!customerId.trim()) {
      setSpecials([]);
      return;
    }
    const data = await fetchWithAuth<{ specials: Row[] }>(`/api/pricing/special?customerId=${encodeURIComponent(customerId.trim())}`);
    setSpecials(data.specials || []);
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [levelsData, quotesData, promotionsData, rebatesData, minimumData] = await Promise.all([
        fetchWithAuth<{ price_levels: Row[] }>('/api/pricing/levels'),
        fetchWithAuth<{ quotes: Row[] }>('/api/pricing/quotes'),
        fetchWithAuth<{ promotions: Row[] }>('/api/promotions'),
        fetchWithAuth<{ rebates: Row[] }>('/api/pricing/rebates'),
        fetchWithAuth<{ rules: Row[] }>('/api/pricing/minimum-sell-rules'),
      ]);
      setLevels(levelsData.price_levels || []);
      setQuotes(quotesData.quotes || []);
      setPromotions(promotionsData.promotions || []);
      setRebates(rebatesData.rebates || []);
      setMinimumRules(minimumData.rules || []);
      if (specialForm.customer_id) await loadSpecials(specialForm.customer_id);
    } catch (err) {
      setError(String((err as Error)?.message || 'Could not load pricing records'));
    } finally {
      setLoading(false);
    }
  }, [loadSpecials, specialForm.customer_id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function saveLevel() {
    setSaving(true);
    try {
      const method = editingLevelId ? 'PATCH' : 'POST';
      const url = editingLevelId ? `/api/pricing/levels/${encodeURIComponent(editingLevelId)}` : '/api/pricing/levels';
      await sendWithAuth(url, method, levelForm);
      setLevelForm({ name: '', description: '' });
      setEditingLevelId('');
      toast.success('Price level saved.');
      await loadData();
    } catch (err) {
      toast.error(String((err as Error)?.message || 'Could not save price level'));
    } finally {
      setSaving(false);
    }
  }

  async function saveSpecial() {
    setSaving(true);
    try {
      await sendWithAuth('/api/pricing/special', 'POST', {
        ...specialForm,
        special_price: Number(specialForm.special_price || 0),
        expiry_date: specialForm.expiry_date || null,
      });
      toast.success('Customer special saved.');
      await loadSpecials(specialForm.customer_id);
    } catch (err) {
      toast.error(String((err as Error)?.message || 'Could not save customer special'));
    } finally {
      setSaving(false);
    }
  }

  async function saveQuote() {
    setSaving(true);
    try {
      if (editingQuoteId) {
        await sendWithAuth(`/api/pricing/quotes/${encodeURIComponent(editingQuoteId)}`, 'PATCH', {
          status: quoteForm.status,
          valid_from: quoteForm.valid_from || undefined,
          valid_until: quoteForm.valid_until || null,
          notes: quoteForm.notes || null,
        });
      } else {
        await sendWithAuth('/api/pricing/quotes', 'POST', {
          customer_id: quoteForm.customer_id,
          status: quoteForm.status,
          valid_from: quoteForm.valid_from || undefined,
          valid_until: quoteForm.valid_until || null,
          notes: quoteForm.notes || null,
          items: quoteForm.product_id && quoteForm.quoted_price ? [{
            product_id: quoteForm.product_id,
            quoted_price: Number(quoteForm.quoted_price),
            min_qty: quoteForm.min_qty ? Number(quoteForm.min_qty) : null,
            uom: quoteForm.uom || null,
          }] : [],
        });
      }
      setEditingQuoteId('');
      setQuoteForm({ customer_id: '', status: 'draft', valid_from: '', valid_until: '', notes: '', product_id: '', quoted_price: '', min_qty: '', uom: '' });
      toast.success('Quote saved.');
      await loadData();
    } catch (err) {
      toast.error(String((err as Error)?.message || 'Could not save quote'));
    } finally {
      setSaving(false);
    }
  }

  async function savePromotion() {
    setSaving(true);
    try {
      if (editingPromotionId) {
        await sendWithAuth(`/api/promotions/${encodeURIComponent(editingPromotionId)}`, 'PATCH', {
          name: promotionForm.name,
          promo_type: promotionForm.promo_type,
          status: promotionForm.status,
          start_date: promotionForm.start_date,
          end_date: promotionForm.end_date || null,
        });
      } else {
        await sendWithAuth('/api/promotions', 'POST', {
          name: promotionForm.name,
          promo_type: promotionForm.promo_type,
          status: promotionForm.status,
          start_date: promotionForm.start_date,
          end_date: promotionForm.end_date || null,
          items: promotionForm.value ? [{
            product_id: promotionForm.product_id || null,
            category_id: promotionForm.category_id || null,
            value: Number(promotionForm.value),
          }] : [],
        });
      }
      setEditingPromotionId('');
      setPromotionForm({ name: '', promo_type: 'sale_price', status: 'draft', start_date: '', end_date: '', product_id: '', category_id: '', value: '' });
      toast.success('Promotion saved.');
      await loadData();
    } catch (err) {
      toast.error(String((err as Error)?.message || 'Could not save promotion'));
    } finally {
      setSaving(false);
    }
  }

  async function saveRebate() {
    setSaving(true);
    try {
      const method = editingRebateId ? 'PATCH' : 'POST';
      const url = editingRebateId ? `/api/pricing/rebates/${encodeURIComponent(editingRebateId)}` : '/api/pricing/rebates';
      await sendWithAuth(url, method, {
        ...rebateForm,
        vendor_id: rebateForm.vendor_id || null,
        customer_id: rebateForm.customer_id || null,
        value: Number(rebateForm.value || 0),
      });
      setEditingRebateId('');
      setRebateForm({ vendor_id: '', customer_id: '', name: '', rebate_type: 'percent', value: '', period_start: '', period_end: '' });
      toast.success('Rebate saved.');
      await loadData();
    } catch (err) {
      toast.error(String((err as Error)?.message || 'Could not save rebate'));
    } finally {
      setSaving(false);
    }
  }

  async function saveMinimumRule() {
    setSaving(true);
    try {
      const method = editingMinimumId ? 'PATCH' : 'POST';
      const url = editingMinimumId ? `/api/pricing/minimum-sell-rules/${encodeURIComponent(editingMinimumId)}` : '/api/pricing/minimum-sell-rules';
      await sendWithAuth(url, method, {
        product_id: minimumForm.product_id || null,
        category_id: minimumForm.category_id || null,
        min_margin_pct: minimumForm.min_margin_pct ? Number(minimumForm.min_margin_pct) : null,
        min_price: minimumForm.min_price ? Number(minimumForm.min_price) : null,
      });
      setEditingMinimumId('');
      setMinimumForm({ product_id: '', category_id: '', min_margin_pct: '', min_price: '' });
      toast.success('Minimum sell rule saved.');
      await loadData();
    } catch (err) {
      toast.error(String((err as Error)?.message || 'Could not save minimum sell rule'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pricing</h1>
          <p className="text-sm text-muted-foreground">Price precedence, customer overrides, quote pricing, promotions, rebates, and minimum sell controls.</p>
        </div>
        <Button variant="outline" onClick={() => void loadData()} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </Button>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border" role="tablist" aria-label="Pricing sections">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={[
              'px-3 py-2 text-sm font-medium border-b-2',
              activeTab === tab.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {activeTab === 'levels' && (
        <Card>
          <CardHeader><CardTitle>Price Levels</CardTitle><CardDescription>Named customer pricing tiers.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[1fr_2fr_auto]">
              <Input value={levelForm.name} onChange={(e) => setLevelForm((f) => ({ ...f, name: e.target.value }))} placeholder="Level A" aria-label="Level name" />
              <Input value={levelForm.description} onChange={(e) => setLevelForm((f) => ({ ...f, description: e.target.value }))} placeholder="Description" aria-label="Level description" />
              <Button onClick={() => void saveLevel()} disabled={saving}>{editingLevelId ? 'Update' : 'Create'}</Button>
            </div>
            <DataTable rows={levels} columns={[{ key: 'name', label: 'Name' }, { key: 'description', label: 'Description' }]} onEdit={(row) => {
              setEditingLevelId(String(row.id || ''));
              setLevelForm({ name: String(row.name || ''), description: String(row.description || '') });
            }} />
          </CardContent>
        </Card>
      )}

      {activeTab === 'specials' && (
        <Card>
          <CardHeader><CardTitle>Customer Specials</CardTitle><CardDescription>Customer and product-specific override prices.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-6">
              <Input value={specialForm.customer_id} onChange={(e) => setSpecialForm((f) => ({ ...f, customer_id: e.target.value }))} placeholder="Customer ID" aria-label="Customer ID" />
              <Input value={specialForm.product_id} onChange={(e) => setSpecialForm((f) => ({ ...f, product_id: e.target.value }))} placeholder="Product ID" aria-label="Product ID" />
              <Input type="number" value={specialForm.special_price} onChange={(e) => setSpecialForm((f) => ({ ...f, special_price: e.target.value }))} placeholder="Price" aria-label="Special price" />
              <Input value={specialForm.effective_date} onChange={(e) => setSpecialForm((f) => ({ ...f, effective_date: e.target.value }))} placeholder="Effective date" aria-label="Effective date" />
              <Input value={specialForm.expiry_date} onChange={(e) => setSpecialForm((f) => ({ ...f, expiry_date: e.target.value }))} placeholder="Expiry date" aria-label="Expiry date" />
              <div className="flex gap-2">
                <Button onClick={() => void saveSpecial()} disabled={saving}>Save</Button>
                <Button variant="outline" onClick={() => void loadSpecials(specialForm.customer_id)}>Load</Button>
              </div>
            </div>
            <DataTable rows={specials} columns={[
              { key: 'customer_id', label: 'Customer' },
              { key: 'product_id', label: 'Product' },
              { key: 'special_price', label: 'Price' },
              { key: 'effective_date', label: 'Effective' },
              { key: 'expiry_date', label: 'Expiry' },
            ]} onEdit={(row) => setSpecialForm({
              customer_id: String(row.customer_id || ''),
              product_id: String(row.product_id || ''),
              special_price: String(row.special_price || ''),
              effective_date: String(row.effective_date || ''),
              expiry_date: String(row.expiry_date || ''),
            })} />
          </CardContent>
        </Card>
      )}

      {activeTab === 'quotes' && (
        <Card>
          <CardHeader><CardTitle>Quotes</CardTitle><CardDescription>Bid pricing with active date windows.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <Input value={quoteForm.customer_id} disabled={!!editingQuoteId} onChange={(e) => setQuoteForm((f) => ({ ...f, customer_id: e.target.value }))} placeholder="Customer ID" aria-label="Customer ID" />
              <SelectInput value={quoteForm.status} onChange={(e) => setQuoteForm((f) => ({ ...f, status: e.target.value }))} aria-label="Quote status">
                {['draft', 'active', 'expired', 'cancelled'].map((status) => <option key={status} value={status}>{status}</option>)}
              </SelectInput>
              <Input value={quoteForm.valid_from} onChange={(e) => setQuoteForm((f) => ({ ...f, valid_from: e.target.value }))} placeholder="Valid from" aria-label="Valid from" />
              <Input value={quoteForm.valid_until} onChange={(e) => setQuoteForm((f) => ({ ...f, valid_until: e.target.value }))} placeholder="Valid until" aria-label="Valid until" />
              {!editingQuoteId && <Input value={quoteForm.product_id} onChange={(e) => setQuoteForm((f) => ({ ...f, product_id: e.target.value }))} placeholder="Product ID" aria-label="Product ID" />}
              {!editingQuoteId && <Input type="number" value={quoteForm.quoted_price} onChange={(e) => setQuoteForm((f) => ({ ...f, quoted_price: e.target.value }))} placeholder="Quoted price" aria-label="Quoted price" />}
              {!editingQuoteId && <Input type="number" value={quoteForm.min_qty} onChange={(e) => setQuoteForm((f) => ({ ...f, min_qty: e.target.value }))} placeholder="Min qty" aria-label="Minimum quantity" />}
              {!editingQuoteId && <Input value={quoteForm.uom} onChange={(e) => setQuoteForm((f) => ({ ...f, uom: e.target.value }))} placeholder="UOM" aria-label="Unit of measure" />}
              <Input value={quoteForm.notes} onChange={(e) => setQuoteForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Notes" aria-label="Notes" className="md:col-span-3" />
              <Button onClick={() => void saveQuote()} disabled={saving}>{editingQuoteId ? 'Update' : 'Create'}</Button>
            </div>
            <DataTable rows={quotes} columns={[
              { key: 'customer_id', label: 'Customer' },
              { key: 'status', label: 'Status', render: (row) => String(row.status || '') },
              { key: 'valid_from', label: 'From' },
              { key: 'valid_until', label: 'Until' },
              { key: 'items', label: 'Items', render: (row) => String(Array.isArray(row.items) ? row.items.length : 0) },
            ]} onEdit={(row) => {
              setEditingQuoteId(String(row.id || ''));
              setQuoteForm({ customer_id: String(row.customer_id || ''), status: String(row.status || 'draft'), valid_from: String(row.valid_from || ''), valid_until: String(row.valid_until || ''), notes: String(row.notes || ''), product_id: '', quoted_price: '', min_qty: '', uom: '' });
            }} />
          </CardContent>
        </Card>
      )}

      {activeTab === 'promotions' && (
        <Card>
          <CardHeader><CardTitle>Promotions</CardTitle><CardDescription>Sale prices and discounts. Lowest active promotion price wins.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <Input value={promotionForm.name} onChange={(e) => setPromotionForm((f) => ({ ...f, name: e.target.value }))} placeholder="Promotion name" aria-label="Promotion name" />
              <SelectInput value={promotionForm.promo_type} onChange={(e) => setPromotionForm((f) => ({ ...f, promo_type: e.target.value }))} aria-label="Promotion type">
                {['sale_price', 'percent_off', 'dollar_off', 'buy_x_get_y'].map((type) => <option key={type} value={type}>{type}</option>)}
              </SelectInput>
              <SelectInput value={promotionForm.status} onChange={(e) => setPromotionForm((f) => ({ ...f, status: e.target.value }))} aria-label="Promotion status">
                {['draft', 'active', 'paused', 'expired'].map((status) => <option key={status} value={status}>{status}</option>)}
              </SelectInput>
              <Input value={promotionForm.start_date} onChange={(e) => setPromotionForm((f) => ({ ...f, start_date: e.target.value }))} placeholder="Start date" aria-label="Start date" />
              <Input value={promotionForm.end_date} onChange={(e) => setPromotionForm((f) => ({ ...f, end_date: e.target.value }))} placeholder="End date" aria-label="End date" />
              {!editingPromotionId && <Input value={promotionForm.product_id} onChange={(e) => setPromotionForm((f) => ({ ...f, product_id: e.target.value }))} placeholder="Product ID" aria-label="Product ID" />}
              {!editingPromotionId && <Input value={promotionForm.category_id} onChange={(e) => setPromotionForm((f) => ({ ...f, category_id: e.target.value }))} placeholder="Category ID" aria-label="Category ID" />}
              {!editingPromotionId && <Input type="number" value={promotionForm.value} onChange={(e) => setPromotionForm((f) => ({ ...f, value: e.target.value }))} placeholder="Value" aria-label="Promotion value" />}
              <Button onClick={() => void savePromotion()} disabled={saving}>{editingPromotionId ? 'Update' : 'Create'}</Button>
            </div>
            <DataTable rows={promotions} columns={[
              { key: 'name', label: 'Name' },
              { key: 'promo_type', label: 'Type' },
              { key: 'status', label: 'Status', render: (row) => String(row.status || '') },
              { key: 'start_date', label: 'Start' },
              { key: 'end_date', label: 'End' },
              { key: 'items', label: 'Items', render: (row) => String(Array.isArray(row.items) ? row.items.length : 0) },
            ]} onEdit={(row) => {
              setEditingPromotionId(String(row.id || ''));
              setPromotionForm({ name: String(row.name || ''), promo_type: String(row.promo_type || 'sale_price'), status: String(row.status || 'draft'), start_date: String(row.start_date || ''), end_date: String(row.end_date || ''), product_id: '', category_id: '', value: '' });
            }} />
          </CardContent>
        </Card>
      )}

      {activeTab === 'rebates' && (
        <Card>
          <CardHeader><CardTitle>Rebates</CardTitle><CardDescription>Vendor and customer rebate accrual rules.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <Input value={rebateForm.name} onChange={(e) => setRebateForm((f) => ({ ...f, name: e.target.value }))} placeholder="Rebate name" aria-label="Rebate name" />
              <Input value={rebateForm.vendor_id} onChange={(e) => setRebateForm((f) => ({ ...f, vendor_id: e.target.value }))} placeholder="Vendor ID" aria-label="Vendor ID" />
              <Input value={rebateForm.customer_id} onChange={(e) => setRebateForm((f) => ({ ...f, customer_id: e.target.value }))} placeholder="Customer ID" aria-label="Customer ID" />
              <SelectInput value={rebateForm.rebate_type} onChange={(e) => setRebateForm((f) => ({ ...f, rebate_type: e.target.value }))} aria-label="Rebate type">
                {['percent', 'dollar', 'per_unit'].map((type) => <option key={type} value={type}>{type}</option>)}
              </SelectInput>
              <Input type="number" value={rebateForm.value} onChange={(e) => setRebateForm((f) => ({ ...f, value: e.target.value }))} placeholder="Value" aria-label="Rebate value" />
              <Input value={rebateForm.period_start} onChange={(e) => setRebateForm((f) => ({ ...f, period_start: e.target.value }))} placeholder="Period start" aria-label="Period start" />
              <Input value={rebateForm.period_end} onChange={(e) => setRebateForm((f) => ({ ...f, period_end: e.target.value }))} placeholder="Period end" aria-label="Period end" />
              <Button onClick={() => void saveRebate()} disabled={saving}>{editingRebateId ? 'Update' : 'Create'}</Button>
            </div>
            <DataTable rows={rebates} columns={[
              { key: 'name', label: 'Name' },
              { key: 'rebate_type', label: 'Type' },
              { key: 'value', label: 'Value' },
              { key: 'period_start', label: 'Start' },
              { key: 'period_end', label: 'End' },
            ]} onEdit={(row) => {
              setEditingRebateId(String(row.id || ''));
              setRebateForm({ vendor_id: String(row.vendor_id || ''), customer_id: String(row.customer_id || ''), name: String(row.name || ''), rebate_type: String(row.rebate_type || 'percent'), value: String(row.value || ''), period_start: String(row.period_start || ''), period_end: String(row.period_end || '') });
            }} />
          </CardContent>
        </Card>
      )}

      {activeTab === 'minimum' && (
        <Card>
          <CardHeader><CardTitle>Minimum Sell Rules</CardTitle><CardDescription>Floor pricing from margin and explicit price rules.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-5">
              <Input value={minimumForm.product_id} onChange={(e) => setMinimumForm((f) => ({ ...f, product_id: e.target.value }))} placeholder="Product ID" aria-label="Product ID" />
              <Input value={minimumForm.category_id} onChange={(e) => setMinimumForm((f) => ({ ...f, category_id: e.target.value }))} placeholder="Category ID" aria-label="Category ID" />
              <Input type="number" value={minimumForm.min_margin_pct} onChange={(e) => setMinimumForm((f) => ({ ...f, min_margin_pct: e.target.value }))} placeholder="Min margin %" aria-label="Minimum margin percent" />
              <Input type="number" value={minimumForm.min_price} onChange={(e) => setMinimumForm((f) => ({ ...f, min_price: e.target.value }))} placeholder="Min price" aria-label="Minimum price" />
              <Button onClick={() => void saveMinimumRule()} disabled={saving}>{editingMinimumId ? 'Update' : 'Create'}</Button>
            </div>
            <DataTable rows={minimumRules} columns={[
              { key: 'product_id', label: 'Product' },
              { key: 'category_id', label: 'Category' },
              { key: 'min_margin_pct', label: 'Margin %' },
              { key: 'min_price', label: 'Min Price' },
              { key: 'id', label: 'Status', render: () => 'Active' },
            ]} onEdit={(row) => {
              setEditingMinimumId(String(row.id || ''));
              setMinimumForm({ product_id: String(row.product_id || ''), category_id: String(row.category_id || ''), min_margin_pct: String(row.min_margin_pct || ''), min_price: String(row.min_price || '') });
            }} />
          </CardContent>
        </Card>
      )}

      {loading && <LoadingSkeleton rows={2} label="Loading pricing data" />}
    </div>
  );
}
