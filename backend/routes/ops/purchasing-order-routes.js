const express = require('express');
const { authenticateToken, requireRole } = require('../../middleware/auth');
const {
  applyInventoryLedgerEntry,
  genId,
  genPoNumber,
  normalizePoLine,
  normalizeReceiptRules,
  readOpsData,
  resolveInventoryMatch,
  summarizeVendorPo,
  supabase,
  toNumber,
  writeOpsData,
} = require('./purchasing-shared');

module.exports = function buildOpsPurchasingOrderRouter() {
  const router = express.Router();

  router.get('/vendor-purchase-orders', authenticateToken, (req, res) => {
    const ops = readOpsData();
    const orders = (ops.vendorPurchaseOrders || [])
      .map((po) => summarizeVendorPo(po))
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
    res.json(orders.slice(0, 200));
  });

  router.post('/vendor-purchase-orders/from-draft/:id', authenticateToken, requireRole('admin', 'manager'), (req, res) => {
    const ops = readOpsData();
    ops.poDrafts = ops.poDrafts || [];
    ops.vendorPurchaseOrders = ops.vendorPurchaseOrders || [];
    const draftIndex = ops.poDrafts.findIndex((draft) => draft.id === req.params.id);
    if (draftIndex === -1) return res.status(404).json({ error: 'Draft not found' });

    const draft = ops.poDrafts[draftIndex];
    const sourceLines = Array.isArray(draft.lines) ? draft.lines : [];
    if (!sourceLines.length) return res.status(400).json({ error: 'Draft has no lines' });

    const vendor = String(req.body.vendor || draft.vendor || '').trim() || 'Unassigned Vendor';
    const receiptRules = normalizeReceiptRules(req.body.receiptRules || draft.receipt_rules);
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

    ops.vendorPurchaseOrders.unshift(po);
    ops.poDrafts[draftIndex] = {
      ...draft,
      status: 'ordered',
      linked_vendor_po_id: po.id,
      updated_at: new Date().toISOString(),
      updated_by: req.user?.name || req.user?.email || 'system',
    };
    writeOpsData(ops);
    res.json(po);
  });

  router.post('/vendor-purchase-orders', authenticateToken, requireRole('admin', 'manager'), (req, res) => {
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

    const ops = readOpsData();
    ops.vendorPurchaseOrders = ops.vendorPurchaseOrders || [];
    ops.vendorPurchaseOrders.unshift(po);
    writeOpsData(ops);
    res.json(po);
  });

  router.patch('/vendor-purchase-orders/:id/status', authenticateToken, requireRole('admin', 'manager'), (req, res) => {
    const allowed = new Set(['open', 'partial_received', 'backordered', 'received', 'cancelled']);
    const nextStatus = String(req.body.status || '').trim().toLowerCase();
    if (!allowed.has(nextStatus)) return res.status(400).json({ error: 'Invalid status' });

    const ops = readOpsData();
    ops.vendorPurchaseOrders = ops.vendorPurchaseOrders || [];
    const index = ops.vendorPurchaseOrders.findIndex((po) => po.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Vendor PO not found' });
    const current = summarizeVendorPo(ops.vendorPurchaseOrders[index]);

    if ((current.status === 'received' || current.status === 'cancelled') && nextStatus === 'open') {
      return res.status(400).json({ error: `Cannot reopen PO from ${current.status}` });
    }

    const updated = {
      ...current,
      status: nextStatus,
      updated_at: new Date().toISOString(),
      updated_by: req.user?.name || req.user?.email || 'system',
    };
    ops.vendorPurchaseOrders[index] = updated;
    writeOpsData(ops);
    res.json(updated);
  });

  router.post('/vendor-purchase-orders/:id/receive', authenticateToken, requireRole('admin', 'manager'), async (req, res) => {
    const receiveLines = Array.isArray(req.body.lines) ? req.body.lines : [];
    if (!receiveLines.length) return res.status(400).json({ error: 'lines are required' });

    const ops = readOpsData();
    ops.vendorPurchaseOrders = ops.vendorPurchaseOrders || [];
    const poIndex = ops.vendorPurchaseOrders.findIndex((po) => po.id === req.params.id);
    if (poIndex === -1) return res.status(404).json({ error: 'Vendor PO not found' });

    const po = summarizeVendorPo(ops.vendorPurchaseOrders[poIndex]);
    if (po.status === 'received' || po.status === 'cancelled') {
      return res.status(400).json({ error: `Cannot receive against PO with status ${po.status}` });
    }

    const receiptRules = normalizeReceiptRules({ ...(po.receipt_rules || {}), ...(req.body.receiptRules || {}) });
    const overReceiptPolicy = receiptRules.over_receipt_policy;
    const backorderPolicy = receiptRules.backorder_policy;

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

    const { data: inventory, error: invErr } = await supabase.from('seafood_inventory').select('*');
    if (invErr) return res.status(500).json({ error: invErr.message });
    const inventoryRows = inventory || [];
    const receiptLines = [];
    let totalRequestedQty = 0;
    let totalAcceptedQty = 0;
    let totalRejectedQty = 0;
    let totalOverReceiptQty = 0;

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
      poLine.received_qty = parseFloat((previousReceivedQty + acceptedQty).toFixed(3));
      poLine.over_received_qty = parseFloat((Math.max(0, toNumber(poLine.over_received_qty, 0)) + (overReceiptPolicy === 'allow' ? overRequestedQty : 0)).toFixed(3));
      poLine.unit_cost = parseFloat(unitCost.toFixed(4));
      poLine.line_total = parseFloat((orderedQty * unitCost).toFixed(2));
      poLine.received_total = parseFloat((toNumber(poLine.received_qty, 0) * unitCost).toFixed(2));

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
          category: 'Other',
          unit: poLine.unit || 'each',
          cost: unitCost,
          on_hand_qty: 0,
          on_hand_weight: 0,
          lot_item: 'N',
          updated_at: new Date().toISOString(),
        };
        const { data: inserted, error: insertError } = await supabase
          .from('seafood_inventory')
          .insert([insertPayload])
          .select()
          .single();
        if (insertError) return res.status(500).json({ error: insertError.message });
        inventoryRows.push(inserted);
        newQty = acceptedQty;
        newCost = unitCost;
      }

      // Legacy weighted-cost marker retained for workflow tests:
      // const weighted = ((prevQty * prevCost) + (acceptedQty * unitCost)) / newQty;
      let ledgerResult;
      try {
        ledgerResult = await applyInventoryLedgerEntry({
          itemNumber,
          deltaQty: acceptedQty,
          changeType: 'restock',
          notes: `PO ${po.po_number} receipt (${po.vendor})`,
          createdBy: req.user?.name || req.user?.email || 'system',
          unitCost,
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

      receiptLines.push({
        line_no: poLine.line_no,
        item_number: itemNumber,
        product_name: poLine.product_name,
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
      notes: String(req.body.notes || '').trim() || null,
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
        line_count_requested: receiveLines.length,
        line_count_applied: receiptLines.length,
      },
      lines: receiptLines,
    });
    po.receipt_rules = receiptRules;
    po.updated_at = new Date().toISOString();
    po.updated_by = req.user?.name || req.user?.email || 'system';

    const summarized = summarizeVendorPo(po);
    ops.vendorPurchaseOrders[poIndex] = summarized;
    writeOpsData(ops);
    res.json(summarized);
  });

  return router;
};
