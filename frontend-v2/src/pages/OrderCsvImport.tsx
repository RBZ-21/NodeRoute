import { useMemo, useState } from 'react';
import { Button } from '../components/ui/button';
import { SelectInput } from '../components/ui/select-input';
import { Modal } from '../components/ui/overlay-panel';
import { sendWithAuth } from '../lib/api';

/**
 * CSV Import for orders. Flow: upload → column mapping → validation preview
 * (per-row errors) → commit. The backend rejects the whole import if any row
 * is invalid (no partial commits).
 */

type ParsedCsv = { headers: string[]; rows: string[][] };

// Minimal CSV parser handling quoted fields and embedded commas/newlines.
function parseCsv(text: string): ParsedCsv {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((c) => c.trim() !== '')) rows.push(row); }
  const headers = rows.shift() || [];
  return { headers: headers.map((h) => h.trim()), rows };
}

const TARGET_FIELDS = [
  { key: 'customer_name', label: 'Customer Name', required: true },
  { key: 'customer_email', label: 'Customer Email', required: false },
  { key: 'customer_address', label: 'Address', required: false },
  { key: 'item_number', label: 'Item #', required: false },
  { key: 'item_name', label: 'Item Description', required: false },
  { key: 'quantity', label: 'Quantity', required: true },
  { key: 'unit', label: 'Unit', required: false },
  { key: 'unit_price', label: 'Unit Price', required: false },
] as const;

type TargetKey = (typeof TARGET_FIELDS)[number]['key'];

const TEMPLATE_CSV =
  'customer_name,customer_email,customer_address,item_number,item_name,quantity,unit,unit_price\n' +
  'Harbor Cafe,orders@harbor.test,123 Harbor St,SAL-01,Atlantic Salmon,10,lb,12.50\n';

function autoMap(header: string): TargetKey | '' {
  const h = header.toLowerCase().replace(/[^a-z]/g, '');
  if (h.includes('customername') || h === 'customer' || h === 'name') return 'customer_name';
  if (h.includes('email')) return 'customer_email';
  if (h.includes('address')) return 'customer_address';
  if (h.includes('itemnumber') || h === 'sku' || h === 'itemno') return 'item_number';
  if (h.includes('description') || h.includes('itemname') || h === 'item' || h === 'product') return 'item_name';
  if (h.includes('quantity') || h === 'qty') return 'quantity';
  if (h.includes('unitprice') || h === 'price') return 'unit_price';
  if (h === 'unit' || h.includes('uom')) return 'unit';
  return '';
}

type PreviewRow = { rowNumber: number; customer_name: string; itemLabel: string; quantity: number; errors: string[] };

export function OrderCsvImport({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: (count: number) => void }) {
  const [step, setStep] = useState<'upload' | 'map' | 'preview'>('upload');
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<Record<TargetKey, string>>({} as Record<TargetKey, string>);
  const [error, setError] = useState('');
  const [committing, setCommitting] = useState(false);

  function reset() {
    setStep('upload'); setParsed(null); setMapping({} as Record<TargetKey, string>); setError(''); setCommitting(false);
  }

  function handleClose() { reset(); onClose(); }

  function downloadTemplate() {
    const href = URL.createObjectURL(new Blob([TEMPLATE_CSV], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = href; a.download = 'orders-import-template.csv'; a.click(); URL.revokeObjectURL(href);
  }

  async function handleFile(file: File) {
    setError('');
    const text = await file.text();
    const result = parseCsv(text);
    if (!result.headers.length || !result.rows.length) { setError('The CSV appears to be empty.'); return; }
    setParsed(result);
    const initial = {} as Record<TargetKey, string>;
    for (const header of result.headers) {
      const target = autoMap(header);
      if (target && !initial[target]) initial[target] = header;
    }
    setMapping(initial);
    setStep('map');
  }

  // Build grouped orders: consecutive rows with the same customer_name are one
  // order with multiple line items.
  const previewRows = useMemo<PreviewRow[]>(() => {
    if (!parsed) return [];
    const idx = (key: TargetKey) => parsed.headers.indexOf(mapping[key]);
    return parsed.rows.map((cells, i) => {
      const get = (key: TargetKey) => { const c = idx(key); return c >= 0 ? String(cells[c] ?? '').trim() : ''; };
      const customer = get('customer_name');
      const itemNumber = get('item_number');
      const itemName = get('item_name');
      const qty = Number(get('quantity'));
      const errors: string[] = [];
      if (!customer) errors.push('Missing customer name');
      if (!itemNumber && !itemName) errors.push('Missing item');
      if (!Number.isFinite(qty) || qty <= 0) errors.push('Quantity must be > 0');
      return {
        rowNumber: i + 1,
        customer_name: customer,
        itemLabel: itemName || itemNumber || '—',
        quantity: Number.isFinite(qty) ? qty : 0,
        errors,
      };
    });
  }, [parsed, mapping]);

  const errorCount = previewRows.filter((r) => r.errors.length).length;

  function buildOrders() {
    if (!parsed) return [];
    const idx = (key: TargetKey) => parsed.headers.indexOf(mapping[key]);
    const get = (cells: string[], key: TargetKey) => { const c = idx(key); return c >= 0 ? String(cells[c] ?? '').trim() : ''; };
    // Group consecutive rows by customer name.
    const orders: Array<{ customer_name: string; customer_email: string; customer_address: string; items: Array<Record<string, unknown>> }> = [];
    for (const cells of parsed.rows) {
      const customer = get(cells, 'customer_name');
      const item = {
        item_number: get(cells, 'item_number') || null,
        name: get(cells, 'item_name') || null,
        unit: get(cells, 'unit') || 'each',
        quantity: Number(get(cells, 'quantity')) || 0,
        unit_price: Number(get(cells, 'unit_price')) || 0,
      };
      const last = orders[orders.length - 1];
      if (last && last.customer_name === customer) last.items.push(item);
      else orders.push({ customer_name: customer, customer_email: get(cells, 'customer_email'), customer_address: get(cells, 'customer_address'), items: [item] });
    }
    return orders;
  }

  async function commit() {
    if (errorCount > 0) { setError(`${errorCount} row(s) have errors. Fix the CSV and re-upload.`); return; }
    setCommitting(true);
    setError('');
    try {
      const result = await sendWithAuth<{ committed: number }>('/api/orders/bulk-import', 'POST', { rows: buildOrders() });
      onImported(result.committed);
      handleClose();
    } catch (err) {
      setError(String((err as Error).message || 'Import failed.'));
    } finally {
      setCommitting(false);
    }
  }

  const requiredUnmapped = TARGET_FIELDS.filter((f) => f.required && !mapping[f.key]);

  return (
    <Modal open={open} title="Import Orders from CSV" description="Map columns, review validation, then commit." onClose={handleClose}>
      <div className="space-y-4">
        {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div> : null}

        {step === 'upload' && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Upload a CSV with customer name, address, and item/quantity columns.</p>
            <input type="file" accept=".csv,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }} className="block w-full text-sm" />
            <Button variant="outline" size="sm" onClick={downloadTemplate}>Download template CSV</Button>
          </div>
        )}

        {step === 'map' && parsed && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Match your CSV columns to order fields. Required fields are marked.</p>
            <div className="grid gap-2">
              {TARGET_FIELDS.map((field) => (
                <label key={field.key} className="grid grid-cols-2 items-center gap-2 text-sm">
                  <span className="font-medium">{field.label}{field.required ? <span className="text-destructive"> *</span> : ''}</span>
                  <SelectInput
                    className="h-9 px-2"
                    value={mapping[field.key] || ''}
                    onChange={(e) => setMapping((m) => ({ ...m, [field.key]: e.target.value }))}
                  >
                    <option value="">— not mapped —</option>
                    {parsed.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </SelectInput>
                </label>
              ))}
            </div>
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep('upload')}>Back</Button>
              <Button onClick={() => setStep('preview')} disabled={requiredUnmapped.length > 0}>
                {requiredUnmapped.length > 0 ? `Map ${requiredUnmapped.map((f) => f.label).join(', ')}` : 'Preview'}
              </Button>
            </div>
          </div>
        )}

        {step === 'preview' && (
          <div className="space-y-3">
            <div className={`rounded-md border px-3 py-2 text-sm ${errorCount ? 'border-destructive/25 bg-destructive/5 text-destructive' : 'border-emerald-300 bg-emerald-50 text-emerald-700'}`}>
              {errorCount ? `${errorCount} of ${previewRows.length} rows have errors. Nothing will be imported until they are fixed.` : `All ${previewRows.length} rows valid and ready to import.`}
            </div>
            <div className="max-h-64 overflow-y-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr><th className="px-2 py-1.5 text-left">Row</th><th className="px-2 py-1.5 text-left">Customer</th><th className="px-2 py-1.5 text-left">Item</th><th className="px-2 py-1.5 text-right">Qty</th><th className="px-2 py-1.5 text-left">Status</th></tr>
                </thead>
                <tbody>
                  {previewRows.map((r) => (
                    <tr key={r.rowNumber} className="border-t border-border/60">
                      <td className="px-2 py-1.5 text-muted-foreground">{r.rowNumber}</td>
                      <td className="px-2 py-1.5">{r.customer_name || '—'}</td>
                      <td className="px-2 py-1.5">{r.itemLabel}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{r.quantity || '—'}</td>
                      <td className="px-2 py-1.5">{r.errors.length ? <span className="text-destructive">{r.errors.join('; ')}</span> : <span className="text-emerald-600">OK</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep('map')}>Back</Button>
              <Button onClick={() => void commit()} disabled={committing || errorCount > 0}>
                {committing ? 'Importing…' : `Import ${previewRows.length - errorCount} Order Row(s)`}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
