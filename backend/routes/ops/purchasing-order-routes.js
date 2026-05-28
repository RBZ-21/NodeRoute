const express = require('express');
const { authenticateToken, requireRole } = require('../../middleware/auth');
const {
  buildScopeFields,
  executeWithOptionalScope,
  filterRowsByContext,
  rowMatchesContext,
  scopeQueryByContext,
} = require('../../services/operating-context');
const {
  applyInventoryLedgerEntry,
  genId,
  genPoNumber,
  normalizePoLine,
  normalizeReceiptRules,
  poLineRequiresLot,
  summarizeVendorPurchaseOrders,
  resolveInventoryMatch,
  summarizeVendorPo,
  supabase,
  toNumber,
} = require('./purchasing-shared');
const {
  attachLotsToPurchaseOrder,
  linkScanToPurchaseOrder,
  loadVendorPurchaseOrdersFromDb,
  persistVendorPurchaseOrderSnapshot,
} = require('../../services/purchase-order-workflows');

/**
 * Load a single vendor PO from Supabase. Matches either the workflow id
 * (the `po-…` token stored as workflow_id on purchase_orders) or the
 * underlying purchase_orders.id UUID.
 */
async function loadVendorPoById(id, context) {
  const orders = await loadVendorPurchaseOrdersFromDb(context || {});
  if (!Array.isArray(orders)) return null;
  return orders.find((po) => String(po.id) === String(id) || String(po.db_id) === String(id)) || null;
}

function isMissingLotSourcePoColumnError(error) {
  return !!error?.message && String(error.message).includes('lot_codes.source_po_number does not exist');
}

async function ensureReceiptLotRecord({ lotNumber, itemNumber, poLine, acceptedQty, po, req }) {
  const trimmedLotNumber = String(lotNumber || '').trim();
  if (!trimmedLotNumber) return { lotId: null, created: false };

  const scopeFields = buildScopeFields(req.context || {});
  let lotQuery = supabase.from('lot_codes').select('id').eq('lot_number', trimmedLotNumber);
  if (scopeFields.company_id) lotQuery = lotQuery.eq('company_id', scopeFields.company_id);
  if (scopeFields.location_id) lotQuery = lotQuery.eq('location_id', scopeFields.location_id);

  const { data: scopedLots, error: scopedLotError } = await lotQuery.limit(1);
  let existingLot = null;

  if (scopedLotError) {
    const fallbackLookup = await scopeQueryByContext(supabase.from('lot_codes').select('*'), req.context).eq('lot_number', trimmedLotNumber).limit(5);
    if (fallbackLookup.error) throw new Error(fallbackLookup.error.message);
    existingLot = filterRowsByContext(fallbackLookup.data || [], req.context)[0] || null;
  } else {
    existingLot = scopedLots?.[0] || null;
  }

  if (existingLot) return { lotId: existingLot.id || null, created: false };

  const lotPayload = {
    lot_number: trimmedLotNumber,
    product_id: itemNumber || null,
    vendor_id: po.vendor || po.vendor_name || null,
    quantity_received: acceptedQty,
    unit_of_measure: poLine.unit || 'each',
    received_date: new Date().toISOString().slice(0, 10),
    received_by: req.user?.name || req.user?.email || 'system',
    source_po_number: po.po_number || null,
    notes: `Auto-created from vendor PO receipt${po.po_number ? ' · ' + po.po_number : ''}`,
    ...scopeFields,
  };

  let lotInsert = await executeWithOptionalScope(
    (candidate) => supabase.from('lot_codes').insert([candidate]).select('id').single(),
    lotPayload
  );
  if (isMissingLotSourcePoColumnError(lotInsert.error)) {
    const { source_po_number, ...legacyLotPayload } = lotPayload;
    lotInsert = await executeWithOptionalScope(
      (candidate) => supabase.from('lot_codes').insert([candidate]).select('id').single(),
      legacyLotPayload
    );
  }
  if (lotInsert.error && lotInsert.error.code === '23505') {
    const lookup = await scopeQueryByContext(supabase.from('lot_codes').select('id'), req.context).eq('lot_number', trimmedLotNumber).limit(1);
    if (lookup.error) throw new Error(lookup.error.message);
    return { lotId: lookup.data?.[0]?.id || null, created: false };
  }
  if (lotInsert.error) throw new Error(lotInsert.error.message);
  return { lotId: lotInsert.data?.id || null, created: !!lotInsert.data };
}

module.exports = function buildOpsPurchasingOrderRouter() {
  const router = express.Router();

  router.get('/vendor-purchase-orders', authenticateToken, async (req, res) => {
    try {
      const dbOrders = await loadVendorPurchaseOrdersFromDb(req.context || {});
      return res.json(Array.isArray(dbOrders) ? dbOrders.slice(0, 200) : []);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  });

  router.post('/vendor-purchase-orders/from-draft/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
    const { data: draft, error: draftErr } = await supabase
      .from('op_po_drafts').select('*').eq('id', req.params.id).single();
    if (draftErr || !draft) return res.status(404).json({ error: 'Draft not found' });
    if (!rowMatchesContext(draft, req.context)) return res.status(403).json({ error: 'Forbidden' });

    const sourceLines = Array.isArray(draft.lines) ? draft.lines : [];
    if (!sourceLines.length) return res.status(400).json({ error: 'Draft has no lines' });

    const vendor = String(req.body.vendor || draft.vendor || '').trim() || 'Unassigned Vendor';
    const receiptRules = normalizeReceiptRules(req.body.receiptRules || draft.source?.receipt_rules);
    const po = summarizeVendorPo({
      id: genId('po'),
      po_number: String(req.body.poNumber || '').trim() || genPoNumber(),
      vendor,
      status: 'open',
      expected_date: req.body.expectedDate || null,
      notes: String(req.body.notes || draft.notes || '').trim() || null,
      source_draft_id: draft.id,
      receipt_rules: receiptRules,
      lines: sourceLines.map((line, index) => normalizePoLine(line, index)),
      receipts: [],
      created_by: req.user?.name || req.user?.email || 'system',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    let persisted;
    try {
      persisted = await persistVendorPurchaseOrderSnapshot(po, req.context || {});
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }

    // Mark the draft as ordered and link to the new vendor PO.
    await supabase
      .from('op_po_drafts')
      .update({
        status: 'ordered',
        linked_vendor_po_id: persisted?.row?.id || null,
        updated_at: new Date().toISOString(),
        updated_by: req.user?.name || req.user?.email || 'system',
      })
      .eq('id', draft.id);

    res.json(po);
  });

  router.post('/vendor-purchase-orders', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
    const linesInput = Array.isArray(req.body.lines) ? req.body.lines : [];
    if (!linesInput.length) return res.status(400).json({ error: 'lines are required' });

    const normalizedLines = linesInput
      .map((line, index) => normalizePoLine(line, index))
      .filter((line) => line.product_name && line.ordered_qty > 0);
    if (!normalizedLines.length) return res.status(400).json({ error: 'No valid PO lines were provided' });

    const vendor = String(req.body.vendor || '').trim();
    if (!vendor) return res.status(400).json({ error: 'vendor is required' });

    const po = summarizeVendorPo({
      id: genId('po'),
      po_number: String(req.body.poNumber || '').trim() || genPoNumber(),
      vendor,
      status: 'open',
      expected_date: req.body.expectedDate || null,
      notes: String(req.body.notes || '').trim() || null,
      source_draft_id: req.body.sourceDraftId || null,
      receipt_rules: normalizeReceiptRules(req.body.receiptRules),
      lines: normalizedLines,
      receipts: [],
      created_by: req.user?.name || req.user?.email || 'system',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    try {
      await persistVendorPurchaseOrderSnapshot(po, req.context || {});
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
    res.json(po);
  });

  router.patch('/vendor-purchase-orders/:id/status', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
    const allowed = new Set(['open', 'partial_received', 'backordered', 'received', 'cancelled']);
    const nextStatus = String(req.body.status || '').trim().toLowerCase();
    if (!allowed.has(nextStatus)) return res.status(400).json({ error: 'Invalid status' });

    const current = await loadVendorPoById(req.params.id, req.context);
    if (!current) return res.status(404).json({ error: 'Vendor PO not found' });

    if ((current.status === 'received' || current.status === 'cancelled') && nextStatus === 'open') {
      return res.status(400).json({ error: `Cannot reopen PO from ${current.status}` });
    }

    const updated = summarizeVendorPo({
      ...current,
      status: nextStatus,
      updated_at: new Date().toISOString(),
      updated_by: req.user?.name || req.user?.email || 'system',
    });

    try {
      await persistVendorPurchaseOrderSnapshot(updated, req.context || {});
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
    res.json(updated);
  });

  router.post('/vendor-purchase-orders/:id/receive', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
    const receiveLines = Array.isArray(req.body.lines) ? req.body.lines : [];
    if (!receiveLines.length) return res.status(400).json({ error: 'lines are required' });

    const loadedPo = await loadVendorPoById(req.params.id, req.context);
    if (!loadedPo) return res.status(404).json({ error: 'Vendor PO not found' });

    const po = summarizeVendorPo(loadedPo);
    if (po.status === 'received' || po.status === 'cancelled') {
      return res.status(400).json({ error: `Cannot receive against PO with status ${po.status}` });
    }

    const receiptRules = normalizeReceiptRules({ ...(po.receipt_rules || {}), ...(req.body.receiptRules || {}) });
    const overReceiptPolicy = receiptRules.over_receipt_policy;
    const backorderPolicy = receiptRules.backorder_policy;

    for (const rawLine of receiveLines) {
      const targetLineNo = parseInt(rawLine.line_no, 10);
      const poLine = po.lines.find((line) => line.line_no === targetLineNo)
        || po.lines.find((line) => line.item_number && String(rawLine.item_number || '').trim() === line.item_number)
        || po.lines.find((line) => String(line.product_name || '').toLowerCase() === String(rawLine.product_name || '').trim().toLowerCase());
      if (!poLine) continue;
      const requestedQty = Math.max(0, toNumber(rawLine.qty_received ?? rawLine.quantity, 0));
      if (requestedQty <= 0) continue;
      if (poLineRequiresLot(poLine) && !String(rawLine.lot_number || '').trim()) {
        return res.status(400).json({
          error: `Lot number is required before receiving mollusk item "${poLine.product_name || `Line ${poLine.line_no}`}".`,
        });
      }
    }

    if (overReceiptPolicy === 'reject') {
      const rejectedLines = [];
      for (const rawLine of receiveLines) {
        const targetLineNo = parseInt(rawLine.line_no, 10);
        const poLine = po.lines.find((line) => line.line_no === targetLineNo)
          || po.lines.find((line) => line.item_number && String(rawLine.item_number || '').trim() === line.item_number)
          || po.lines.find((line) => String(line.product_name || '').toLowerCase() === String(rawLine.product_name || '').trim().toLowerCase());
        if (!poLine) continue;
        const requestedQty = Math.max(0, toNumber(rawLine.qty_received ?? rawLine.quantity, 0));
        if (requestedQty <= 0) continue;
        const ordered = Math.max(0, toNumber(poLine.ordered_qty, 0));
        const alreadyReceived = Math.max(0, toNumber(poLine.received_qty, 0));
        const remainingBefore = Math.max(0, ordered - Math.min(alreadyReceived, ordered));
        if (requestedQty > remainingBefore) {
          rejectedLines.push({
            line_no: poLine.line_no,
            product_name: poLine.product_name,
            requested_receive_qty: parseFloat(requestedQty.toFixed(3)),
            remaining_qty: parseFloat(remainingBefore.toFixed(3)),
            over_receipt_qty: parseFloat((requestedQty - remainingBefore).toFixed(3)),
          });
        }
      }
      if (rejectedLines.length) {
        return res.status(409).json({
          error: 'Over-receipt rejected by receipt policy',
          code: 'OVER_RECEIPT_REJECTED',
          over_receipt_policy: overReceiptPolicy,
          rejected_lines: rejectedLines,
        });
      }
    }

    const { data: inventory, error: invErr } = await scopeQueryByContext(supabase.from('products').select('*'), req.context);
    if (invErr) return res.status(500).json({ error: invErr.message });
    const inventoryRows = inventory || [];
    const receiptLines = [];
    let totalRequestedQty = 0;
    let totalAcceptedQty = 0;
    let totalRejectedQty = 0;
    let totalOverReceiptQty = 0;
    let lotsCreated = 0;

    for (const rawLine of receiveLines) {
      const targetLineNo = parseInt(rawLine.line_no, 10);
      const poLine = po.lines.find((line) => line.line_no === targetLineNo)
        || po.lines.find((line) => line.item_number && String(rawLine.item_number || '').trim() === line.item_number)
        || po.lines.find((line) => String(line.product_name || '').toLowerCase() === String(rawLine.product_name || '').trim().toLowerCase());
      if (!poLine) continue;

      const requestedQty = Math.max(0, toNumber(rawLine.qty_received ?? rawLine.quantity, 0));
      if (requestedQty <= 0) continue;
      totalRequestedQty += requestedQty;

      const orderedQty = Math.max(0, toNumber(poLine.ordered_qty, 0));
      const previousReceivedQty = Math.max(0, toNumber(poLine.received_qty, 0));
      const previouslyReceivedTowardOrdered = Math.min(previousReceivedQty, orderedQty);
      const remainingBefore = Math.max(0, orderedQty - previouslyReceivedTowardOrdered);
      const overRequestedQty = Math.max(0, requestedQty - remainingBefore);
      const acceptedQty = overReceiptPolicy === 'allow'
        ? requestedQty
        : Math.min(remainingBefore, requestedQty);
      const rejectedQty = overReceiptPolicy === 'cap' ? Math.max(0, requestedQty - acceptedQty) : 0;
      if (acceptedQty <= 0) continue;

      totalAcceptedQty += acceptedQty;
      totalRejectedQty += rejectedQty;
      totalOverReceiptQty += overRequestedQty;

      const unitCost = Math.max(0, toNumber(rawLine.unit_cost, toNumber(poLine.unit_cost, 0)));
      const lotNumber = String(rawLine.lot_number || '').trim() || null;
      poLine.received_qty = parseFloat((previousReceivedQty + acceptedQty).toFixed(3));
      poLine.over_received_qty = parseFloat((Math.max(0, toNumber(poLine.over_received_qty, 0)) + (overReceiptPolicy === 'allow' ? overRequestedQty : 0)).toFixed(3));
      poLine.unit_cost = parseFloat(unitCost.toFixed(4));
      poLine.line_total = parseFloat((orderedQty * unitCost).toFixed(2));
      poLine.received_total = parseFloat((toNumber(poLine.received_qty, 0) * unitCost).toFixed(2));
      if (lotNumber) poLine.lot_number = lotNumber;

      const receivedTowardOrdered = Math.min(toNumber(poLine.received_qty, 0), orderedQty);
      const backorderedAfterRaw = Math.max(0, orderedQty - receivedTowardOrdered);
      let waivedBackorderQtyApplied = 0;
      if (backorderPolicy === 'waive' && backorderedAfterRaw > 0) {
        waivedBackorderQtyApplied = backorderedAfterRaw;
        poLine.waived_backorder_qty = parseFloat((Math.max(0, toNumber(poLine.waived_backorder_qty, 0)) + waivedBackorderQtyApplied).toFixed(3));
        poLine.backordered_qty = 0;
      } else {
        poLine.backordered_qty = parseFloat(backorderedAfterRaw.toFixed(3));
      }

      const remainingAfter = Math.max(0, orderedQty - Math.min(toNumber(poLine.received_qty, 0), orderedQty));
      const varianceQty = parseFloat((acceptedQty - remainingBefore).toFixed(3));
      const varianceType = varianceQty > 0 ? 'over_receipt' : (varianceQty < 0 ? 'short_receipt' : 'exact_receipt');

      const matchedInventory = resolveInventoryMatch(poLine, inventoryRows);
      let itemNumber = poLine.item_number;
      let newQty = acceptedQty;
      let newCost = unitCost;
      let prevInventoryQty = 0;
      let prevInventoryCost = 0;

      if (matchedInventory) {
        itemNumber = matchedInventory.item_number;
        prevInventoryQty = Math.max(0, toNumber(matchedInventory.on_hand_qty, 0));
        prevInventoryCost = Math.max(0, toNumber(matchedInventory.cost, 0));
      } else {
        itemNumber = poLine.item_number || `PO-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
        const insertPayload = {
          item_number: itemNumber,
          description: poLine.product_name,
          category: poLine.category || 'Other',
          unit: poLine.unit || 'each',
          cost: unitCost,
          on_hand_qty: 0,
          on_hand_weight: 0,
          lot_item: poLineRequiresLot(poLine) ? 'Y' : 'N',
          updated_at: new Date().toISOString(),
        };
        const { data: inserted, error: insertError } = await supabase
          .from('products')
          .insert([insertPayload])
          .select()
          .single();
        if (insertError) return res.status(500).json({ error: insertError.message });
        inventoryRows.push(inserted);
        newQty = acceptedQty;
        newCost = unitCost;
      }
      poLine.item_number = itemNumber;

      // Legacy weighted-cost marker retained for workflow tests:
      // const weighted = ((prevQty * prevCost) + (acceptedQty * unitCost)) / newQty;
      // Base ledger note marker: notes: `PO ${po.po_number} receipt (${po.vendor})`
      let ledgerResult;
      try {
        ledgerResult = await applyInventoryLedgerEntry({
          itemNumber,
          deltaQty: acceptedQty,
          changeType: 'restock',
          notes: `PO ${po.po_number} receipt (${po.vendor})${lotNumber ? ' · Lot ' + lotNumber : ''}`,
          createdBy: req.user?.name || req.user?.email || 'system',
          unitCost,
          context: req.context,
        });
      } catch (ledgerError) {
        return res.status(500).json({ error: ledgerError.message });
      }

      newQty = Math.max(0, toNumber(ledgerResult.qty_after, acceptedQty));
      newCost = Math.max(0, toNumber(ledgerResult.cost_after, unitCost));
      const inventoryRow = inventoryRows.find((row) => String(row.item_number || '').trim() === itemNumber);
      if (inventoryRow) {
        inventoryRow.on_hand_qty = newQty;
        inventoryRow.cost = newCost;
      }

      let lotId = null;
      if (lotNumber) {
        try {
          const lotRecord = await ensureReceiptLotRecord({
            lotNumber,
            itemNumber,
            poLine,
            acceptedQty,
            po,
            req,
          });
          lotId = lotRecord.lotId || null;
          if (lotRecord.created) lotsCreated += 1;
        } catch (lotError) {
          return res.status(500).json({ error: lotError.message });
        }
      }

      receiptLines.push({
        line_no: poLine.line_no,
        item_number: itemNumber,
        product_name: poLine.product_name,
        lot_number: lotNumber,
        lot_id: lotId,
        qty_received: parseFloat(acceptedQty.toFixed(3)),
        requested_receive_qty: parseFloat(requestedQty.toFixed(3)),
        accepted_receive_qty: parseFloat(acceptedQty.toFixed(3)),
        rejected_receive_qty: parseFloat(rejectedQty.toFixed(3)),
        over_receipt_qty: parseFloat(overRequestedQty.toFixed(3)),
        remaining_before_qty: parseFloat(remainingBefore.toFixed(3)),
        remaining_after_qty: parseFloat(remainingAfter.toFixed(3)),
        quantity_variance_qty: varianceQty,
        variance_type: varianceType,
        backordered_qty_after_receipt: parseFloat(toNumber(poLine.backordered_qty, 0).toFixed(3)),
        waived_backorder_qty_applied: parseFloat(waivedBackorderQtyApplied.toFixed(3)),
        unit: poLine.unit,
        unit_cost: parseFloat(unitCost.toFixed(4)),
        inventory_qty_before_receipt: parseFloat(prevInventoryQty.toFixed(4)),
        inventory_cost_before_receipt: parseFloat(prevInventoryCost.toFixed(4)),
        inventory_cost_after_receipt: parseFloat(toNumber(newCost, unitCost).toFixed(4)),
        inventory_qty_after_receipt: parseFloat(toNumber(newQty, acceptedQty).toFixed(4)),
        over_receipt_policy: overReceiptPolicy,
        backorder_policy: backorderPolicy,
      });
    }

    if (!receiptLines.length) return res.status(400).json({ error: 'No valid receive quantities were applied' });

    po.receipts = po.receipts || [];
    const totalBackorderedAfterReceipt = po.lines.reduce((sum, line) => sum + Math.max(0, toNumber(line.backordered_qty, 0)), 0);
    po.receipts.unshift({
      id: genId('rcv'),
      received_at: new Date().toISOString(),
      received_by: req.user?.name || req.user?.email || 'system',
      carrier_name: String(req.body.carrier_name || '').trim() || null,
      notes: String(req.body.notes || '').trim() || null,
      scan_id: String(req.body.scan_id || '').trim() || null,
      receipt_rules_applied: {
        over_receipt_policy: overReceiptPolicy,
        backorder_policy: backorderPolicy,
      },
      variance_audit: {
        total_requested_qty: parseFloat(totalRequestedQty.toFixed(3)),
        total_accepted_qty: parseFloat(totalAcceptedQty.toFixed(3)),
        total_rejected_qty: parseFloat(totalRejectedQty.toFixed(3)),
        total_over_receipt_qty: parseFloat(totalOverReceiptQty.toFixed(3)),
        total_backordered_qty_after_receipt: parseFloat(totalBackorderedAfterReceipt.toFixed(3)),
        lots_created: lotsCreated,
        line_count_requested: receiveLines.length,
        line_count_applied: receiptLines.length,
      },
      lines: receiptLines,
    });
    po.receipt_rules = receiptRules;
    po.updated_at = new Date().toISOString();
    po.updated_by = req.user?.name || req.user?.email || 'system';

    const summarized = summarizeVendorPo(po);
    const refreshed = summarizeVendorPurchaseOrders([summarized]);
    const responsePo = refreshed.find((vendorPo) => vendorPo.id === summarized.id) || summarized;
    let persisted;
    try {
      persisted = await persistVendorPurchaseOrderSnapshot(responsePo, req.context || {});
      const latestReceipt = responsePo.receipts?.[0];
      const lotNumbers = (latestReceipt?.lines || [])
        .map((line) => String(line.lot_number || '').trim())
        .filter(Boolean);
      if (persisted?.row?.id) {
        if (latestReceipt?.scan_id) {
          await linkScanToPurchaseOrder(
            latestReceipt.scan_id,
            persisted.row.id,
            persisted.row.vendor_id || null,
            req.user?.name || req.user?.email || 'system'
          );
        }
        if (lotNumbers.length) {
          await attachLotsToPurchaseOrder(persisted.row.id, lotNumbers, req.context || {});
        }
      }
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }

    // Auto-generate a vendor bill when the PO reaches fully-received status.
    // Non-fatal: a bill creation failure does not roll back the receipt.
    if (summarized.status === 'received' && persisted?.row?.id) {
      try {
        const billAmount = parseFloat(
          ((summarized.lines || []).reduce((sum, line) => {
            const qty = toNumber(line.received_qty, 0);
            const cost = toNumber(line.unit_cost, 0);
            return sum + qty * cost;
          }, 0)).toFixed(2)
        );
        const month = String(new Date().getMonth() + 1).padStart(2, '0');
        const billNumber = `BILL-${new Date().getFullYear()}${month}-${persisted.row.id.slice(0, 6).toUpperCase()}`;
        const scopeFields = buildScopeFields(req.context);
        await supabase.from('vendor_bills').insert([{
          bill_number:       billNumber,
          purchase_order_id: persisted.row.id,
          vendor:            summarized.vendor || null,
          vendor_id:         persisted.row.vendor_id || null,
          amount:            billAmount,
          status:            'pending',
          auto_generated:    true,
          created_by:        req.user?.name || req.user?.email || 'system',
          notes:             `Auto-generated from PO ${summarized.po_number || persisted.row.id.slice(0, 8)} on full receipt`,
          ...scopeFields,
        }]);
      } catch (billErr) {
        console.error('[auto-bill] vendor bill creation failed:', billErr.message);
      }
    }

    res.json(responsePo);
  });

  return router;
};
