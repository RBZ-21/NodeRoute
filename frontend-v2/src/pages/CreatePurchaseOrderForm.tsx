import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Combobox } from '../components/ui/combobox';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import {
  type InventoryProduct,
  type PoScanResult,
  type PurchaseOrder,
  scanPoFile,
  useAbandonPurchaseOrder,
  useConfirmPurchaseOrder,
  useInventoryProducts,
  usePurchaseOrders,
  useSavePurchaseOrderDraft,
  useVendorPurchaseOrders,
} from '../hooks/usePurchasing';
import { useSaveVendorMutation, useVendorsQuery } from '../hooks/useVendors';
import {
  type PurchaseItemDraft,
  type VendorDraft,
  asNumber,
  buildLeadTimeHistoryLookups,
  buildScannedVendorDraft,
  buildVendorOptions,
  emptyLine,
  formatLeadTimeDays,
  handleFileInputChange,
  lineRequiresLot,
  money,
  normalizeCatalogItemNumber,
  normalizeVendorName,
  resolveProductLeadTimeHistory,
  vendorCatalogItemNumbers,
} from './purchasing.helpers';

type Props = {
  /** Surfaced in the parent's notice/error banners so messaging stays in one place. */
  setNotice: (message: string) => void;
  setFormError: (message: string) => void;
  editingDraft?: PurchaseOrder | null;
  onDraftChange?: (draft: PurchaseOrder | null) => void;
};

function draftLineFromSavedItem(item: unknown): PurchaseItemDraft {
  const line = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
  return {
    ...emptyLine(),
    description: String(line.description || line.product_name || ''),
    item_number: String(line.item_number || ''),
    quantity: line.quantity != null ? String(line.quantity) : '',
    unit_price: line.unit_price != null ? String(line.unit_price) : line.unit_cost != null ? String(line.unit_cost) : '',
    unit: String(line.unit || 'lb'),
    category: String(line.category || 'Other'),
    lot_number: String(line.lot_number || ''),
    expiration_date: String(line.expiration_date || ''),
    count_item_approved: line.count_item_approved === false ? false : true,
  };
}

function applyProductToDraftLine(line: PurchaseItemDraft, product: InventoryProduct, fallbackItemNumber: string, fallbackQty?: string): PurchaseItemDraft {
  return {
    ...line,
    description: line.description || product.description || '',
    item_number: line.item_number || product.item_number || fallbackItemNumber,
    quantity: line.quantity || fallbackQty || '',
    unit: product.unit || line.unit || 'lb',
    unit_price: asNumber(product.cost) > 0 && !line.unit_price ? String(asNumber(product.cost)) : line.unit_price,
    category: product.category || line.category || 'Other',
  };
}

function buildPurchaseItems(lines: PurchaseItemDraft[], requireDescription: boolean) {
  return lines
    .map((l) => {
      const description = l.description.trim();
      const itemNumber = l.item_number.trim();
      const quantity = asNumber(l.quantity);
      const unitPrice = asNumber(l.unit_price);
      return {
        description,
        item_number: itemNumber || undefined,
        quantity,
        unit_price: unitPrice,
        unit: l.unit.trim() || 'lb',
        category: l.category.trim() || 'Other',
        lot_number: l.lot_number.trim() || undefined,
        expiration_date: l.expiration_date || undefined,
        total: parseFloat((quantity * unitPrice).toFixed(2)),
      };
    })
    .filter((item) => quantityIsPositive(item.quantity) && (requireDescription ? item.description : (item.description || item.item_number)));
}

function quantityIsPositive(value: number) {
  return Number.isFinite(value) && value > 0;
}

/**
 * The "AI PO Scanner" + "Confirm Purchase Order" flow. Owns all create-PO
 * state (vendor, PO number, notes, draft lines, scan result, scanned-vendor
 * draft) and its data-shaping (vendor catalog scoping, product options,
 * lead-time history, scan insights), so editing a draft line no longer
 * re-renders the rest of the purchasing page.
 */
export function CreatePurchaseOrderForm({ setNotice, setFormError, editingDraft = null, onDraftChange }: Props) {
  const [searchParams] = useSearchParams();
  const vendorParam = String(searchParams.get('vendor') || '').trim();
  const itemParam   = String(searchParams.get('item') || '').trim();
  const qtyParam    = String(searchParams.get('qty') || '').trim();

  const { data: orders = [] } = usePurchaseOrders(vendorParam || undefined);
  const { data: products = [] } = useInventoryProducts();
  const { data: vendorRecords = [], refetch: refetchVendors } = useVendorsQuery();
  const { data: vendorPurchaseOrders = [] } = useVendorPurchaseOrders();
  const confirmPo = useConfirmPurchaseOrder();
  const saveDraft = useSavePurchaseOrderDraft();
  const abandonPo = useAbandonPurchaseOrder();
  const saveVendorMutation = useSaveVendorMutation();

  const [vendor, setVendor] = useState(vendorParam);
  const [poNumber, setPoNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<PurchaseItemDraft[]>(() => {
    if (itemParam) {
      return [{ ...emptyLine(), item_number: itemParam, quantity: qtyParam || '' }];
    }
    return [emptyLine()];
  });
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState('');
  const [scanResult, setScanResult] = useState<PoScanResult | null>(null);
  const [scannedVendorDraft, setScannedVendorDraft] = useState<VendorDraft | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const prefillHydratedRef = useRef(false);

  useEffect(() => {
    if (editingDraft) return;
    if (vendorParam) setVendor((current) => current || vendorParam);
  }, [editingDraft, vendorParam]);

  useEffect(() => {
    if (!editingDraft) return;
    setVendor(String(editingDraft.vendor || ''));
    setPoNumber(String(editingDraft.po_number || ''));
    setNotes(String(editingDraft.notes || ''));
    const savedLines = (Array.isArray(editingDraft.items) ? editingDraft.items : []).map(draftLineFromSavedItem);
    setLines(savedLines.length ? savedLines : [emptyLine()]);
    setScanResult(null);
    setScannedVendorDraft(null);
    prefillHydratedRef.current = true;
  }, [editingDraft]);

  useEffect(() => {
    if (editingDraft || prefillHydratedRef.current || !itemParam || !products.length) return;
    const product = products.find((p) => normalizeCatalogItemNumber(p.item_number) === normalizeCatalogItemNumber(itemParam));
    if (!product) return;
    prefillHydratedRef.current = true;
    setLines((current) => {
      const first = current[0] || emptyLine();
      return [
        applyProductToDraftLine(first, product, itemParam, qtyParam),
        ...current.slice(1),
      ];
    });
  }, [editingDraft, itemParam, products, qtyParam]);

  const draftTotal = useMemo(
    () => lines.reduce((sum, l) => sum + asNumber(l.quantity) * asNumber(l.unit_price), 0),
    [lines],
  );

  const vendorOptions = useMemo(() => buildVendorOptions(orders, vendorRecords), [orders, vendorRecords]);

  const selectedVendorRecord = useMemo(
    () => vendorRecords.find((record) => normalizeVendorName(record.name) === normalizeVendorName(vendor)) || null,
    [vendorRecords, vendor],
  );
  const scannedVendorNeedsSave = Boolean(
    scannedVendorDraft?.name &&
    normalizeVendorName(scannedVendorDraft.name) === normalizeVendorName(vendor) &&
    !selectedVendorRecord
  );
  const selectedVendorCatalog = useMemo(
    () => vendorCatalogItemNumbers(selectedVendorRecord),
    [selectedVendorRecord],
  );
  const selectedVendorCatalogLookup = useMemo(
    () => new Set(selectedVendorCatalog.map((entry) => normalizeCatalogItemNumber(entry))),
    [selectedVendorCatalog],
  );
  const scopedProducts = useMemo(() => {
    if (!selectedVendorCatalogLookup.size) return products;
    return products.filter((product) => selectedVendorCatalogLookup.has(normalizeCatalogItemNumber(product.item_number)));
  }, [products, selectedVendorCatalogLookup]);
  const catalogProductsMissingFromInventory = useMemo(() => {
    if (!selectedVendorCatalogLookup.size) return 0;
    const liveInventoryLookup = new Set(
      products
        .map((product) => normalizeCatalogItemNumber(product.item_number))
        .filter(Boolean)
    );
    return selectedVendorCatalog.filter((itemNumber) => !liveInventoryLookup.has(normalizeCatalogItemNumber(itemNumber))).length;
  }, [products, selectedVendorCatalog, selectedVendorCatalogLookup]);

  const productOptions = useMemo(
    () => scopedProducts.map((p) => ({
      label: p.description,
      sublabel: `#${p.item_number} · ${p.unit ?? 'lb'} · $${asNumber(p.cost).toFixed(2)}`,
      value: p.item_number,
    })),
    [scopedProducts],
  );

  const leadTimeHistoryLookups = useMemo(
    () => buildLeadTimeHistoryLookups(vendorPurchaseOrders),
    [vendorPurchaseOrders],
  );
  const selectedVendorLeadTimeHistory = useMemo(
    () => leadTimeHistoryLookups.vendorHistory.get(String(vendor || '').trim().toLowerCase()) || null,
    [leadTimeHistoryLookups, vendor],
  );
  const lineLeadTimeHistory = useMemo(
    () => lines.map((line) => resolveProductLeadTimeHistory(line, vendor, leadTimeHistoryLookups.productHistory)),
    [leadTimeHistoryLookups, lines, vendor],
  );

  const scanInsights = useMemo(() => {
    if (!scanResult) {
      return {
        weightedCount: 0,
        countCount: 0,
        pendingCountApprovals: 0,
        extractedLots: 0,
        mediumOrHighConfidenceLots: 0,
      };
    }
    return scanResult.items.reduce(
      (summary, item) => {
        if (item.item_type === 'weighted') summary.weightedCount += 1;
        if (item.item_type === 'count') {
          summary.countCount += 1;
          if (!lines[summary.lineIndex]?.count_item_approved) summary.pendingCountApprovals += 1;
        }
        if (String(item.lot_number || '').trim()) {
          summary.extractedLots += 1;
          if (item.lot_number_confidence === 'medium' || item.lot_number_confidence === 'high') {
            summary.mediumOrHighConfidenceLots += 1;
          }
        }
        summary.lineIndex += 1;
        return summary;
      },
      {
        weightedCount: 0,
        countCount: 0,
        pendingCountApprovals: 0,
        extractedLots: 0,
        mediumOrHighConfidenceLots: 0,
        lineIndex: 0,
      },
    );
  }, [lines, scanResult]);

  function updateLine<Key extends keyof PurchaseItemDraft>(index: number, key: Key, value: PurchaseItemDraft[Key]) {
    setLines((cur) => cur.map((l, i) => (i === index ? { ...l, [key]: value } : l)));
  }
  function setCountItemApproval(index: number, approved: boolean) {
    setLines((cur) => cur.map((line, lineIndex) => (lineIndex === index ? { ...line, count_item_approved: approved } : line)));
  }
  function addLine() { setLines((cur) => [...cur, emptyLine()]); }
  function removeLine(index: number) {
    setLines((cur) => (cur.length === 1 ? cur : cur.filter((_, i) => i !== index)));
  }

  function applyScanResult(result: PoScanResult) {
    const vendorDraft = buildScannedVendorDraft(result);
    const existingVendor = vendorDraft
      ? vendorRecords.find((record) => {
        const savedName = normalizeVendorName(record.name);
        return savedName === normalizeVendorName(vendorDraft.name) || savedName === normalizeVendorName(result.vendor);
      })
      : null;
    const resolvedVendorName = existingVendor?.name || vendorDraft?.name || result.vendor || '';
    if (resolvedVendorName) setVendor(resolvedVendorName);
    setScannedVendorDraft(vendorDraft && !existingVendor ? vendorDraft : null);
    if (result.po_number) setPoNumber(result.po_number);
    const draftLines: PurchaseItemDraft[] = (result.items || []).map((item) => ({
      description: item.description ?? '',
      item_number: '',
      quantity: item.quantity != null ? String(item.quantity) : '',
      unit_price: item.unit_price != null ? String(item.unit_price) : '',
      unit: item.unit ?? (item.item_type === 'count' ? 'each' : 'lb'),
      category: item.category ?? 'Other',
      lot_number: item.lot_number ?? '',
      expiration_date: '',
      count_item_approved: item.item_type !== 'count',
    }));
    setLines(draftLines.length ? draftLines : [emptyLine()]);
    setScanResult(result);
    setNotice('PO scan complete — review and confirm the lines below.');
  }

  async function handleScanFile(file: File) {
    setScanLoading(true);
    setScanError('');
    setScanResult(null);
    try {
      const result = await scanPoFile(file);
      applyScanResult(result);
      if (!result.items?.length) {
        setScanError('The image uploaded, but no invoice line items were detected. Try a clearer, well-lit photo that includes the full item table, or enter the lines manually below.');
      }
    } catch (err) {
      setScanError(String((err as Error).message || 'PO scan failed'));
    } finally {
      setScanLoading(false);
    }
  }

  async function saveScannedVendor() {
    if (!scannedVendorDraft?.name) return;
    setFormError('');
    try {
      const saved = await saveVendorMutation.mutateAsync({ id: undefined, draft: scannedVendorDraft });
      const savedName = String(saved.name || scannedVendorDraft.name || '').trim();
      if (savedName) setVendor(savedName);
      setScannedVendorDraft(null);
      await refetchVendors();
      setNotice(`Vendor "${savedName || 'New Vendor'}" saved from the invoice scan.`);
    } catch (err) {
      setFormError(String((err as Error).message || 'Could not save scanned vendor'));
    }
  }

  function resetForm() {
    setVendor(vendorParam || '');
    setPoNumber('');
    setNotes('');
    setLines([emptyLine()]);
    setScanResult(null);
    setScannedVendorDraft(null);
    prefillHydratedRef.current = true;
    onDraftChange?.(null);
  }

  function savePurchaseOrderDraft() {
    const items = buildPurchaseItems(lines, false);
    if (!items.length) {
      setFormError('Add at least one line with item number or description and quantity.');
      return;
    }

    setFormError('');
    const total_cost = items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
    saveDraft.mutate(
      {
        id: editingDraft?.id || null,
        scan_id: scanResult?.scan_id || null,
        vendor: vendor || null,
        po_number: poNumber || null,
        notes: notes || null,
        total_cost,
        items,
      },
      {
        onSuccess: (draft) => {
          onDraftChange?.(draft);
          setPoNumber(String(draft.po_number || poNumber || ''));
          setNotice(`Purchase order draft ${draft.po_number || ''} saved. You can return to it from Purchasing Orders.`);
        },
        onError: (err) => setFormError(String((err as Error).message || 'Failed to save purchase order draft')),
      }
    );
  }

  function abandonPurchaseOrder() {
    if (!editingDraft?.id) {
      resetForm();
      setNotice('Unsaved purchase order abandoned.');
      return;
    }

    setFormError('');
    abandonPo.mutate(editingDraft.id, {
      onSuccess: (draft) => {
        resetForm();
        setNotice(`Purchase order ${draft.po_number || ''} abandoned.`);
      },
      onError: (err) => setFormError(String((err as Error).message || 'Failed to abandon purchase order')),
    });
  }

  function submitPurchaseOrder() {
    const unapprovedCountItem = lines.find((line, index) => scanResult?.items[index]?.item_type === 'count' && !line.count_item_approved);
    if (unapprovedCountItem) {
      setFormError(`Review and approve scanned count item "${unapprovedCountItem.description || `line ${lines.indexOf(unapprovedCountItem) + 1}`}" before confirming the PO.`);
      return;
    }

    const items = buildPurchaseItems(lines, true);

    if (!items.length) { setFormError('Add at least one line with description and quantity.'); return; }
    const missingLotItem = items.find((item) => lineRequiresLot(item) && !String(item.lot_number || '').trim());
    if (missingLotItem) {
      setFormError(`Lot number is required before confirming mollusk item "${missingLotItem.description}".`);
      return;
    }
    if (!vendor.trim()) {
      setFormError('Vendor Name Required');
      return;
    }

    setFormError('');
    const total_cost = items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);

    confirmPo.mutate(
      { draft_id: editingDraft?.id || null, scan_id: scanResult?.scan_id || null, vendor: vendor || null, po_number: poNumber || null, notes: notes || null, total_cost, items },
      {
        onSuccess: (response) => {
          const failed = Array.isArray(response.errors) && response.errors.length;
          const lotsMsg = response.lots_created ? ` ${response.lots_created} lot record(s) created.` : '';
          const poLabel = response.purchase_order?.po_number ? ` PO # ${response.purchase_order.po_number}.` : '';
          setNotice(failed
            ? `PO saved with ${response.errors?.length || 0} line errors.${poLabel}${lotsMsg}`
            : `Purchase order confirmed and inventory updated.${poLabel}${lotsMsg}`);
          resetForm();
        },
        onError: (err) => setFormError(String((err as Error).message || 'Failed to confirm purchase order')),
      }
    );
  }

  return (
    <>
      {/* AI PO Scanner */}
      <Card>
        <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>AI PO Scanner</CardTitle>
            <CardDescription>Snap a photo on your phone or upload an image. AI extracts line items and pre-fills the form below.</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => handleFileInputChange(e, fileInputRef, handleScanFile)} />
            <input ref={cameraInputRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" onChange={(e) => handleFileInputChange(e, cameraInputRef, handleScanFile)} />
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={scanLoading}>{scanLoading ? 'Scanning…' : '📁 Upload Image'}</Button>
            <Button variant="outline" onClick={() => cameraInputRef.current?.click()} disabled={scanLoading}>{scanLoading ? 'Scanning…' : '📷 Take Photo'}</Button>
          </div>
        </CardHeader>
        {scanError && <CardContent><div className="rounded-md border border-destructive/25 bg-destructive/5 px-4 py-2 text-sm text-destructive">{scanError}</div></CardContent>}
        {scanResult && (
          <CardContent>
            <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 space-y-1">
              <div className="font-semibold">Scan Summary</div>
              {scanResult.vendor && <div>Vendor: <strong>{scanResult.vendor}</strong></div>}
              {scanResult.po_number && <div>PO #: <strong>{scanResult.po_number}</strong></div>}
              {scanResult.date && <div>Date: <strong>{scanResult.date}</strong></div>}
              {scanResult.total_cost != null && <div>Total: <strong>{money(scanResult.total_cost)}</strong></div>}
              <div>{scanResult.items.length} line item(s) extracted — review below before confirming.</div>
              <div>Weighted items detected: <strong>{scanInsights.weightedCount}</strong></div>
              <div>Count items detected: <strong>{scanInsights.countCount}</strong></div>
              <div>Count items awaiting per-line approval: <strong>{scanInsights.pendingCountApprovals}</strong></div>
              <div>Lot numbers detected: <strong>{scanInsights.extractedLots}</strong> {scanInsights.extractedLots ? `(medium/high confidence: ${scanInsights.mediumOrHighConfidenceLots})` : ''}</div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Confirm PO Form */}
      <Card>
        <CardHeader>
          <CardTitle>{editingDraft ? 'Resume Purchase Order Draft' : 'Confirm Purchase Order'}</CardTitle>
          <CardDescription>Lot Number is required for FSMA 204 traceability on FDA Food Traceability List products. Expiration date is optional but strongly recommended (enables FEFO picking).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {editingDraft ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-900">
              Editing saved draft <strong>{editingDraft.po_number || editingDraft.id.slice(0, 8)}</strong>. Confirming it will update inventory; abandoning it will keep the record out of the active workflow.
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-3">
            <label className="space-y-1 text-sm">
              <span className="font-semibold text-muted-foreground">Vendor</span>
              <Combobox value={vendor} onChange={setVendor} onSelect={(opt) => setVendor(opt.label)} options={vendorOptions} placeholder="Blue Ocean Seafood" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-semibold text-muted-foreground">PO Number</span>
              <Input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="PO-2026-044" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-semibold text-muted-foreground">Notes</span>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Dock B receiving" />
            </label>
          </div>

          {vendor.trim() ? (
            <div className="rounded-lg border border-blue-200 bg-blue-50/80 px-4 py-3 text-sm text-blue-900">
              {selectedVendorRecord ? (
                <div className="space-y-1">
                  {selectedVendorCatalog.length ? (
                    <div>
                      Vendor catalog scoped to <strong>{selectedVendorCatalog.length} SKU{selectedVendorCatalog.length === 1 ? '' : 's'}</strong>. Product search suggestions below now stay inside this vendor catalog.
                    </div>
                  ) : (
                    <div>
                      <strong>{selectedVendorRecord.name}</strong> does not have a scoped product catalog yet, so the PO form is still showing all inventory items. Add catalog SKUs in Vendors to narrow this supplier down.
                    </div>
                  )}
                  {catalogProductsMissingFromInventory ? (
                    <div className="text-xs text-blue-900/80">
                      {catalogProductsMissingFromInventory} catalog SKU{catalogProductsMissingFromInventory === 1 ? '' : 's'} are not present in live inventory right now, so they will not appear in the product picker until inventory is updated.
                    </div>
                  ) : null}
                  <div className="text-xs text-blue-900/80">
                    Manual entry still works if the vendor is shipping a new item before the catalog is updated.
                  </div>
                </div>
              ) : (
                <div>
                  This vendor is not linked to a vendor master record yet, so product search is still pulling from all inventory. Create or rename the vendor in Vendors to start using a scoped catalog.
                </div>
              )}
            </div>
          ) : null}

          {scannedVendorNeedsSave && scannedVendorDraft ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-950">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="font-semibold">New vendor detected from invoice</div>
                  <div className="text-xs text-amber-900/80">
                    Review the scanned details below, then save it to Vendors so future invoices link to the vendor catalog and history.
                  </div>
                </div>
                <Button size="sm" onClick={() => void saveScannedVendor()} disabled={saveVendorMutation.isPending}>
                  {saveVendorMutation.isPending ? 'Saving...' : 'Save Vendor'}
                </Button>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-amber-900/80">Name</span>
                  <Input value={scannedVendorDraft.name || ''} onChange={(e) => {
                    const nextName = e.target.value;
                    setScannedVendorDraft((draft) => draft ? { ...draft, name: nextName } : draft);
                    setVendor(nextName);
                  }} />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-amber-900/80">Contact</span>
                  <Input value={scannedVendorDraft.contact || ''} onChange={(e) => setScannedVendorDraft((draft) => draft ? { ...draft, contact: e.target.value } : draft)} placeholder="Accounts payable" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-amber-900/80">Email</span>
                  <Input value={scannedVendorDraft.email || ''} onChange={(e) => setScannedVendorDraft((draft) => draft ? { ...draft, email: e.target.value } : draft)} placeholder="orders@vendor.com" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-amber-900/80">Phone</span>
                  <Input value={scannedVendorDraft.phone || ''} onChange={(e) => setScannedVendorDraft((draft) => draft ? { ...draft, phone: e.target.value } : draft)} placeholder="(555) 123-4567" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-amber-900/80">Payment Terms</span>
                  <Input value={scannedVendorDraft.payment_terms || ''} onChange={(e) => setScannedVendorDraft((draft) => draft ? { ...draft, payment_terms: e.target.value } : draft)} placeholder="Net 30" />
                </label>
                <label className="space-y-1 md:col-span-2 lg:col-span-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-amber-900/80">Address</span>
                  <Input value={scannedVendorDraft.address || ''} onChange={(e) => setScannedVendorDraft((draft) => draft ? { ...draft, address: e.target.value } : draft)} placeholder="Vendor address" />
                </label>
              </div>
            </div>
          ) : null}

          {vendor.trim() ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-sm">
              {selectedVendorLeadTimeHistory ? (
                <div className="space-y-1">
                  <div>
                    <strong>{selectedVendorLeadTimeHistory.vendor}</strong> averages{' '}
                    <strong>{formatLeadTimeDays(selectedVendorLeadTimeHistory.averageDays)}</strong> across{' '}
                    {selectedVendorLeadTimeHistory.receiptCount} received PO{selectedVendorLeadTimeHistory.receiptCount === 1 ? '' : 's'}.
                  </div>
                  <div className="text-xs text-emerald-900/80">
                    Product-specific lead-time history appears on matched lines below so buyers can compare vendor averages to actual item behavior.
                  </div>
                </div>
              ) : (
                <div className="text-emerald-900/80">
                  No measured lead-time history is available for <strong>{vendor}</strong> yet. Product-specific lead-time guidance will appear here after receipts are recorded.
                </div>
              )}
            </div>
          ) : null}

          <div className="table-scroll-container overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead>Item #</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Unit Price</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Item Type</TableHead>
                  <TableHead>Approval</TableHead>
                  <TableHead>Lot Number <span className="ml-1 text-xs font-normal text-muted-foreground">(FSMA)</span></TableHead>
                  <TableHead>Expiration <span className="ml-1 text-xs font-normal text-muted-foreground">(optional)</span></TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line, index) => (
                  <TableRow key={index}>
                    <TableCell>
                      <Combobox
                        value={line.description}
                        onChange={(v) => updateLine(index, 'description', v)}
                        onSelect={(opt) => {
                          const p = products.find((x) => x.item_number === opt.value);
                          if (!p) return;
                          setLines((cur) => cur.map((l, i) => i !== index ? l : {
                            ...l,
                            description: p.description,
                            item_number: p.item_number,
                            unit: p.unit ?? 'lb',
                            unit_price: asNumber(p.cost) > 0 ? String(asNumber(p.cost)) : l.unit_price,
                            category: p.category ?? l.category,
                          }));
                        }}
                        options={productOptions}
                        placeholder="Atlantic Salmon"
                      />
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <Input value={line.item_number} onChange={(e) => updateLine(index, 'item_number', e.target.value)} placeholder="SAL-01" />
                        {lineLeadTimeHistory[index] ? (
                          <div className="text-[11px] text-emerald-700">
                            Avg lead time {formatLeadTimeDays(lineLeadTimeHistory[index]?.averageDays)} across {lineLeadTimeHistory[index]?.receiptCount} received PO{lineLeadTimeHistory[index]?.receiptCount === 1 ? '' : 's'}
                            {lineLeadTimeHistory[index]?.latestDays != null ? ` · latest ${formatLeadTimeDays(lineLeadTimeHistory[index]?.latestDays)}` : ''}
                          </div>
                        ) : selectedVendorLeadTimeHistory && (line.item_number.trim() || line.description.trim()) ? (
                          <div className="text-[11px] text-muted-foreground">
                            Vendor avg {formatLeadTimeDays(selectedVendorLeadTimeHistory.averageDays)} · no product-specific history yet
                          </div>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell><Input type="number" min="0" step="0.01" value={line.quantity} onChange={(e) => updateLine(index, 'quantity', e.target.value)} /></TableCell>
                    <TableCell><Input type="number" min="0" step="0.01" value={line.unit_price} onChange={(e) => updateLine(index, 'unit_price', e.target.value)} /></TableCell>
                    <TableCell><Input value={line.unit} onChange={(e) => updateLine(index, 'unit', e.target.value)} /></TableCell>
                    <TableCell><Input value={line.category} onChange={(e) => updateLine(index, 'category', e.target.value)} /></TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {scanResult?.items[index]?.item_type
                          ? `${scanResult.items[index].item_type.charAt(0).toUpperCase()}${scanResult.items[index].item_type.slice(1)}`
                          : 'Manual'}
                      </span>
                    </TableCell>
                    <TableCell>
                      {scanResult?.items[index]?.item_type === 'count' ? (
                        <label className="flex items-start gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={line.count_item_approved}
                            onChange={(event) => setCountItemApproval(index, event.target.checked)}
                            aria-label={`Approve count item ${line.description || `line ${index + 1}`}`}
                          />
                          <span>
                            <span className="block font-medium text-foreground">
                              {line.count_item_approved ? 'Count verified' : 'Approval required'}
                            </span>
                            <span className="block text-[11px] text-muted-foreground">
                              Count items need a distinct line-by-line confirmation before the PO can be submitted.
                            </span>
                          </span>
                        </label>
                      ) : (
                        <span className="text-xs text-muted-foreground">Overall PO review</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <Input
                          value={line.lot_number}
                          onChange={(e) => updateLine(index, 'lot_number', e.target.value)}
                          placeholder={lineRequiresLot(line) ? 'Required for shellfish lots' : 'e.g. SAL-2026-001'}
                          className="font-mono text-sm"
                        />
                        {lineRequiresLot(line) ? (
                          <div className="text-[11px] text-amber-700">Required before confirming mussel, clam, and oyster receipts.</div>
                        ) : null}
                        {String(scanResult?.items[index]?.lot_number || '').trim() ? (
                          <div className="text-[11px] text-sky-700">
                            Scan detected lot <span className="font-mono">{scanResult?.items[index]?.lot_number}</span> ({scanResult?.items[index]?.lot_number_confidence} confidence).
                          </div>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell><Input type="date" value={line.expiration_date} onChange={(e) => updateLine(index, 'expiration_date', e.target.value)} /></TableCell>
                    <TableCell>{money(asNumber(line.quantity) * asNumber(line.unit_price))}</TableCell>
                    <TableCell><Button variant="ghost" size="sm" onClick={() => removeLine(index)}>Remove</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={addLine}>Add Line</Button>
            <Button variant="secondary" onClick={savePurchaseOrderDraft} disabled={saveDraft.isPending || confirmPo.isPending || abandonPo.isPending}>
              {saveDraft.isPending ? 'Saving...' : 'Save for Later'}
            </Button>
            <Button onClick={submitPurchaseOrder} disabled={confirmPo.isPending || saveDraft.isPending || abandonPo.isPending}>
              {confirmPo.isPending ? 'Confirming...' : 'Confirm PO'}
            </Button>
            <Button variant="outline" onClick={abandonPurchaseOrder} disabled={abandonPo.isPending || confirmPo.isPending || saveDraft.isPending}>
              {abandonPo.isPending ? 'Abandoning...' : 'Abandon PO'}
            </Button>
            <div className="ml-auto rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
              Draft Total: <strong>{money(draftTotal)}</strong>
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
