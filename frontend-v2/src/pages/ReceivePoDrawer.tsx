import { useMemo, useRef, useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import {
  type PoScanResult,
  type VendorPoReceiptRules,
  type VendorPurchaseOrder,
  scanPoFile,
  useReceiveVendorPurchaseOrder,
} from '../hooks/usePurchasing';
import {
  type ReceiveLineDraft,
  type ReceiveScanApplySummary,
  asNumber,
  buildReceiveDraft,
  findReceiveScanMatchIndex,
  handleFileInputChange,
  lineRequiresLot,
  remainingQty,
} from './purchasing.helpers';

function buildInitialLines(po: VendorPurchaseOrder): ReceiveLineDraft[] {
  return (po.lines || []).map((line) => buildReceiveDraft(line));
}

function buildInitialRules(po: VendorPurchaseOrder): VendorPoReceiptRules {
  return {
    over_receipt_policy: po.receipt_rules?.over_receipt_policy || 'cap',
    backorder_policy: po.receipt_rules?.backorder_policy || 'open',
  };
}

type Props = {
  /** The PO being received. The parent renders this drawer with key={po.id},
   * so a fresh instance (and fresh draft state) mounts per PO. */
  po: VendorPurchaseOrder;
  /** Called with the updated PO after a successful receipt post, so the parent
   * can keep its selected-PO reference (and the receiving table) in sync. */
  onPosted: (po: VendorPurchaseOrder) => void;
  onClose: () => void;
  setNotice: (message: string) => void;
  setFormError: (message: string) => void;
};

/**
 * Self-contained vendor-PO receiving drawer. Owns all receive-editing state
 * (line quantities, costs, lots, scan, barcode, carrier, notes, rules) so
 * typing into the receive grid no longer re-renders the rest of the
 * purchasing page.
 */
export function ReceivePoDrawer({ po, onPosted, onClose, setNotice, setFormError }: Props) {
  const receiveVendorPo = useReceiveVendorPurchaseOrder();

  const [receiveScanLoading, setReceiveScanLoading] = useState(false);
  const [receiveScanError, setReceiveScanError] = useState('');
  const [receiveScanResult, setReceiveScanResult] = useState<PoScanResult | null>(null);
  const [receiveNotes, setReceiveNotes] = useState('');
  const [carrierName, setCarrierName] = useState('');
  const [receiveLines, setReceiveLines] = useState<ReceiveLineDraft[]>(() => buildInitialLines(po));
  const [receiveRules, setReceiveRules] = useState<VendorPoReceiptRules>(() => buildInitialRules(po));
  const [barcodeScan, setBarcodeScan] = useState('');
  const [barcodeMatch, setBarcodeMatch] = useState<{ lineIndex: number; lineName: string } | null>(null);
  const receiveFileInputRef = useRef<HTMLInputElement>(null);
  const receiveCameraInputRef = useRef<HTMLInputElement>(null);

  const receiveDetectedLotCount = useMemo(
    () => (receiveScanResult?.items || []).filter((item) => String(item.lot_number || '').trim()).length,
    [receiveScanResult],
  );

  function updateReceiveLine(index: number, key: keyof ReceiveLineDraft, value: string) {
    setReceiveLines((cur) => cur.map((l, i) => (i === index ? { ...l, [key]: value } : l)));
  }

  function handleBarcodeSubmit(scanValue: string) {
    const normalized = scanValue.trim().toLowerCase();
    if (!normalized) return;
    const lines = po.lines || [];
    const idx = lines.findIndex((l) => {
      const barcode = String((l as Record<string, unknown>).barcode || '').trim().toLowerCase();
      const itemNo  = String(l.item_number || '').trim().toLowerCase();
      return barcode === normalized || itemNo === normalized;
    });
    if (idx >= 0) {
      setBarcodeMatch({ lineIndex: idx, lineName: lines[idx].product_name || lines[idx].item_number || `Line ${idx + 1}` });
      updateReceiveLine(idx, 'qty_received', String(asNumber(receiveLines[idx]?.qty_received || 0) + 1));
    } else {
      setBarcodeMatch(null);
    }
    setBarcodeScan('');
  }

  function applyReceiveScanResult(result: PoScanResult): ReceiveScanApplySummary {
    const poLines = po.lines || [];
    const usedIndexes = new Set<number>();
    const draftLines = poLines.map((line, index) => ({ ...buildReceiveDraft(line), ...(receiveLines[index] || {}) }));
    const unmatchedItems: string[] = [];
    let mappedCount = 0;

    for (const item of result.items || []) {
      const matchIndex = findReceiveScanMatchIndex(poLines, item, usedIndexes);
      if (matchIndex < 0) {
        unmatchedItems.push(String(item.description || 'Unnamed scan line'));
        continue;
      }

      usedIndexes.add(matchIndex);
      mappedCount += 1;
      draftLines[matchIndex] = {
        ...draftLines[matchIndex],
        qty_received: item.quantity != null ? String(item.quantity) : draftLines[matchIndex].qty_received,
        unit_cost: item.unit_price != null ? String(item.unit_price) : draftLines[matchIndex].unit_cost,
        lot_number: String(item.lot_number || '').trim() || draftLines[matchIndex].lot_number,
      };
    }

    setReceiveLines(draftLines);
    setReceiveScanResult(result);
    return { mappedCount, unmatchedItems };
  }

  async function handleReceiveScanFile(file: File) {
    setReceiveScanLoading(true);
    setReceiveScanError('');
    setReceiveScanResult(null);
    try {
      const result = await scanPoFile(file);
      const applied = applyReceiveScanResult(result);
      if (!result.items?.length) {
        setReceiveScanError('The image uploaded, but no receipt line items were detected. Try a clearer, well-lit photo that includes the full item table, or enter received quantities manually.');
      }
      const unmatchedSuffix = applied.unmatchedItems.length
        ? ` ${applied.unmatchedItems.length} line(s) still need manual review.`
        : '';
      setNotice(
        `Scanned receipt mapped ${applied.mappedCount} of ${(result.items || []).length} line(s) into ${po.po_number || po.id.slice(0, 8)}.${unmatchedSuffix}`
      );
    } catch (err) {
      setReceiveScanError(String((err as Error).message || 'Receipt scan failed'));
    } finally {
      setReceiveScanLoading(false);
    }
  }

  function resetDraft() {
    setReceiveNotes('');
    setCarrierName('');
    setReceiveScanLoading(false);
    setReceiveScanError('');
    setReceiveScanResult(null);
    setReceiveRules(buildInitialRules(po));
    setReceiveLines(buildInitialLines(po));
  }

  function submitReceipt() {
    const missingLotLine = receiveLines.find((line) => {
      const source = (po.lines || []).find((poLine) => poLine.line_no === line.line_no);
      return !!source
        && asNumber(line.qty_received) > 0
        && lineRequiresLot(source)
        && !String(line.lot_number || '').trim();
    });
    if (missingLotLine) {
      const source = (po.lines || []).find((poLine) => poLine.line_no === missingLotLine.line_no);
      setFormError(`Lot number is required before receiving mollusk item "${source?.product_name || `Line ${missingLotLine.line_no}`}".`);
      return;
    }

    const payloadLines = receiveLines
      .map((line) => {
        const source = (po.lines || []).find((poLine) => poLine.line_no === line.line_no);
        return {
          line_no: line.line_no,
          qty_received: asNumber(line.qty_received),
          unit_cost: asNumber(line.unit_cost) > 0 ? asNumber(line.unit_cost) : undefined,
          item_number: source?.item_number || undefined,
          product_name: source?.product_name || undefined,
          lot_number: String(line.lot_number || '').trim() || undefined,
        };
      })
      .filter((line) => line.qty_received > 0);

    if (!payloadLines.length) {
      setFormError('Enter at least one received quantity before posting the receipt.');
      return;
    }

    setFormError('');
    receiveVendorPo.mutate(
      {
        id: po.id,
        payload: {
          scan_id: receiveScanResult?.scan_id || null,
          lines: payloadLines,
          carrier_name: carrierName.trim() || null,
          notes: receiveNotes.trim() || null,
          receiptRules: receiveRules,
        },
      },
      {
        onSuccess: (updatedPo) => {
          const latestReceipt = updatedPo.receipts?.[0];
          const acceptedQty = asNumber(latestReceipt?.variance_audit?.total_accepted_qty);
          const rejectedQty = asNumber(latestReceipt?.variance_audit?.total_rejected_qty);
          const backorderedQty = asNumber(latestReceipt?.variance_audit?.total_backordered_qty_after_receipt);
          setNotice(
            `Receipt posted for ${updatedPo.po_number || updatedPo.id.slice(0, 8)}. Accepted ${acceptedQty.toFixed(2)} unit(s), rejected ${rejectedQty.toFixed(2)}, backordered ${backorderedQty.toFixed(2)}.`
          );
          setReceiveNotes('');
          setCarrierName('');
          setReceiveScanError('');
          setReceiveScanResult(null);
          setReceiveRules(buildInitialRules(updatedPo));
          setReceiveLines((updatedPo.lines || []).map((line) => buildReceiveDraft(line)));
          onPosted(updatedPo);
        },
        onError: (err) => setFormError(String((err as Error).message || 'Could not post receipt')),
      },
    );
  }

  return (
    <div className="rounded-xl border border-border bg-muted/10 p-4 space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-lg font-semibold">
            Receiving {po.po_number || po.id.slice(0, 8)}
          </div>
          <div className="text-sm text-muted-foreground">
            Vendor: <strong>{po.vendor || po.vendor_name || 'Unassigned Vendor'}</strong>
            {' · '}
            Status: <strong>{String(po.status || 'open').replace(/_/g, ' ')}</strong>
          </div>
          {po.notes ? (
            <div className="mt-2 text-sm text-muted-foreground">{po.notes}</div>
          ) : null}
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
            Ordered: <strong>{asNumber(po.total_ordered_qty).toFixed(2)}</strong>
          </div>
          <div className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
            Received: <strong>{asNumber(po.total_received_qty).toFixed(2)}</strong>
          </div>
          <div className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
            Backordered: <strong>{asNumber(po.total_backordered_qty).toFixed(2)}</strong>
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <label className="space-y-1 text-sm">
          <span className="font-semibold text-muted-foreground">Over-receipt policy</span>
          <select
            value={String(receiveRules.over_receipt_policy || 'cap')}
            onChange={(e) => setReceiveRules((cur) => ({ ...cur, over_receipt_policy: e.target.value }))}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="reject">Reject overages</option>
            <option value="cap">Cap at ordered qty</option>
            <option value="allow">Allow over-receipts</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-semibold text-muted-foreground">Backorder policy</span>
          <select
            value={String(receiveRules.backorder_policy || 'open')}
            onChange={(e) => setReceiveRules((cur) => ({ ...cur, backorder_policy: e.target.value }))}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="open">Keep backorders open</option>
            <option value="waive">Waive shorted qty</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-semibold text-muted-foreground">Carrier / Shipping Company</span>
          <Input value={carrierName} onChange={(e) => setCarrierName(e.target.value)} placeholder="e.g. Armory Transportation, FedEx (optional)" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-semibold text-muted-foreground">Receipt Notes</span>
          <Input value={receiveNotes} onChange={(e) => setReceiveNotes(e.target.value)} placeholder="Driver shorted 2 cases on pallet 3" />
        </label>
      </div>

      <div className="rounded-lg border border-dashed border-sky-200 bg-sky-50/70 p-4 space-y-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-sm font-semibold text-foreground">AI Dock Invoice Scanner</div>
            <div className="text-xs text-muted-foreground">
              Scan the vendor invoice for this open PO to prefill receive quantities, unit costs, and lot numbers.
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input ref={receiveFileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => handleFileInputChange(e, receiveFileInputRef, handleReceiveScanFile)} />
            <input ref={receiveCameraInputRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" onChange={(e) => handleFileInputChange(e, receiveCameraInputRef, handleReceiveScanFile)} />
            <Button variant="outline" onClick={() => receiveFileInputRef.current?.click()} disabled={receiveScanLoading}>
              {receiveScanLoading ? 'Scanning…' : 'Upload Invoice'}
            </Button>
            <Button variant="outline" onClick={() => receiveCameraInputRef.current?.click()} disabled={receiveScanLoading}>
              {receiveScanLoading ? 'Scanning…' : 'Use Camera'}
            </Button>
          </div>
        </div>
        {receiveScanError ? (
          <div className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {receiveScanError}
          </div>
        ) : null}
        {receiveScanResult ? (
          <div className="grid gap-2 md:grid-cols-4">
            <div className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
              Scanned lines: <strong>{receiveScanResult.items.length}</strong>
            </div>
            <div className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
              Lot numbers detected: <strong>{receiveDetectedLotCount}</strong>
            </div>
            <div className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
              Scan vendor: <strong>{receiveScanResult.vendor || 'Unknown'}</strong>
            </div>
            <div className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
              Scan PO ref: <strong>{receiveScanResult.po_number || 'Not found'}</strong>
            </div>
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border border-border bg-background px-4 py-3">
        <div className="text-sm font-semibold mb-2">Barcode Scan Receiving</div>
        <div className="flex gap-2">
          <Input
            value={barcodeScan}
            onChange={(e) => setBarcodeScan(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleBarcodeSubmit(barcodeScan); }}
            placeholder="Scan or type barcode / item number — press Enter"
            className="flex-1"
          />
          <Button variant="outline" onClick={() => handleBarcodeSubmit(barcodeScan)}>Apply</Button>
        </div>
        {barcodeMatch && (
          <div className="mt-2 text-sm text-emerald-700">
            +1 added to <strong>{barcodeMatch.lineName}</strong> (line {barcodeMatch.lineIndex + 1})
          </div>
        )}
        {barcodeScan.trim() && !barcodeMatch && (
          <div className="mt-2 text-sm text-rose-600">No line matched "{barcodeScan.trim()}"</div>
        )}
      </div>

      <div className="table-scroll-container overflow-x-auto rounded-lg border border-border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Line</TableHead>
              <TableHead>Product</TableHead>
              <TableHead>Ordered</TableHead>
              <TableHead>Received</TableHead>
              <TableHead>Remaining</TableHead>
              <TableHead>Receive Now</TableHead>
              <TableHead>Unit Cost</TableHead>
              <TableHead>Lot Number</TableHead>
              <TableHead>Expected Variance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(po.lines || []).map((line, index) => {
              const draft = receiveLines[index];
              const ordered = asNumber(line.ordered_qty);
              const received = asNumber(line.received_qty);
              const remaining = remainingQty(line);
              const receiveNow = asNumber(draft?.qty_received);
              const expectedVariance = receiveNow - remaining;
              return (
                <TableRow key={line.line_no}>
                  <TableCell className="font-medium">#{line.line_no}</TableCell>
                  <TableCell>
                    <div className="font-medium">{line.product_name || 'Unnamed item'}</div>
                    <div className="text-xs text-muted-foreground">{line.item_number || 'No item #'}</div>
                  </TableCell>
                  <TableCell>{ordered.toFixed(2)} {line.unit || 'each'}</TableCell>
                  <TableCell>{received.toFixed(2)} {line.unit || 'each'}</TableCell>
                  <TableCell>{remaining.toFixed(2)} {line.unit || 'each'}</TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={draft?.qty_received || ''}
                      onChange={(e) => updateReceiveLine(index, 'qty_received', e.target.value)}
                      placeholder="0.00"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min="0"
                      step="0.0001"
                      value={draft?.unit_cost || ''}
                      onChange={(e) => updateReceiveLine(index, 'unit_cost', e.target.value)}
                      placeholder="0.0000"
                    />
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <Input
                        value={draft?.lot_number || ''}
                        onChange={(e) => updateReceiveLine(index, 'lot_number', e.target.value)}
                        placeholder={lineRequiresLot(line) ? 'Required for shellfish lots' : 'Optional lot'}
                        className="font-mono text-sm"
                      />
                      {lineRequiresLot(line) ? (
                        <div className="text-[11px] text-amber-700">Required before posting mussel, clam, and oyster receipts.</div>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    {receiveNow <= 0 ? (
                      <span className="text-muted-foreground">No receipt entered</span>
                    ) : expectedVariance > 0 ? (
                      <Badge variant="warning">Over by {expectedVariance.toFixed(2)}</Badge>
                    ) : expectedVariance < 0 ? (
                      <Badge variant="secondary">Short by {Math.abs(expectedVariance).toFixed(2)}</Badge>
                    ) : (
                      <Badge variant="success">Exact receipt</Badge>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={submitReceipt} disabled={receiveVendorPo.isPending}>
          {receiveVendorPo.isPending ? 'Posting Receipt...' : 'Post Receipt to Inventory'}
        </Button>
        <Button variant="outline" onClick={resetDraft}>
          Reset Receipt Draft
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Close Receipt Panel
        </Button>
      </div>

      {po.receipts?.length ? (
        <div className="space-y-3">
          <div className="text-sm font-semibold text-foreground">Recent Receipt Activity</div>
          {(po.receipts || []).slice(0, 3).map((receipt) => (
            <div key={receipt.id} className="rounded-lg border border-border bg-background p-3 text-sm space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <strong>{receipt.received_at ? new Date(receipt.received_at).toLocaleString() : 'Receipt logged'}</strong>
                  <span className="ml-2 text-muted-foreground">by {receipt.received_by || 'system'}</span>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge variant="neutral">Accepted {asNumber(receipt.variance_audit?.total_accepted_qty).toFixed(2)}</Badge>
                  <Badge variant="warning">Rejected {asNumber(receipt.variance_audit?.total_rejected_qty).toFixed(2)}</Badge>
                  <Badge variant="secondary">Backordered {asNumber(receipt.variance_audit?.total_backordered_qty_after_receipt).toFixed(2)}</Badge>
                </div>
              </div>
              {receipt.notes ? <div className="text-muted-foreground">{receipt.notes}</div> : null}
              {(receipt.lines || []).some((line) => asNumber(line.over_receipt_qty) > 0 || String(line.variance_type || '') !== 'exact_receipt') ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  {(receipt.lines || [])
                    .filter((line) => asNumber(line.over_receipt_qty) > 0 || String(line.variance_type || '') !== 'exact_receipt')
                    .map((line) => `${line.product_name || line.item_number || `Line ${line.line_no}`}: ${String(line.variance_type || 'variance').replace(/_/g, ' ')} (${asNumber(line.quantity_variance_qty).toFixed(2)})`)
                    .join(' • ')}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
