const { supabase } = require('./supabase');
const {
  buildScopeFields,
  executeWithOptionalScope,
  filterRowsByContext,
  insertRecordWithOptionalScope,
} = require('./operating-context');

const {
  normalizePoLine,
  normalizeReceiptRules,
  summarizeVendorPurchaseOrders,
  toNumber,
} = require('../lib/purchasing-shared');

const COUNT_UNITS = new Set(['ea', 'each', 'count', 'case', 'cases', 'box', 'boxes', 'bag', 'bags', 'carton', 'cartons', 'dozen', 'pallet', 'pallets']);
const WEIGHT_UNITS = new Set(['lb', 'lbs', 'pound', 'pounds', 'kg', 'kgs', 'oz', 'ounce', 'ounces']);

function isWorkflowSchemaMissing(error) {
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('does not exist')
    || message.includes('schema cache')
    || message.includes('could not find the table')
  );
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeWorkflowStatus(value) {
  const normalized = normalizeText(value).toLowerCase();
  return normalized || 'open';
}

function inferApprovalRequired(line) {
  const rawType = normalizeText(line?.item_type).toLowerCase();
  if (rawType === 'count') return true;
  if (rawType === 'weighted') return false;
  const unit = normalizeText(line?.unit).toLowerCase();
  if (COUNT_UNITS.has(unit)) return true;
  if (WEIGHT_UNITS.has(unit)) return false;
  return false;
}

function hasDiscrepancy(line) {
  return (
    Math.abs(toNumber(line?.quantity_variance_qty, 0)) > 0.0001
    || toNumber(line?.rejected_receive_qty, 0) > 0
    || toNumber(line?.over_receipt_qty, 0) > 0
    || toNumber(line?.remaining_after_qty, 0) > 0
  );
}

async function querySingleTable(table, context) {
  const result = await supabase.from(table).select('*').order('created_at', { ascending: false });
  if (result.error) {
    if (isWorkflowSchemaMissing(result.error)) return null;
    throw new Error(result.error.message);
  }
  return filterRowsByContext(result.data || [], context);
}

async function findVendorByName(vendorName, context) {
  const normalized = normalizeText(vendorName).toLowerCase();
  if (!normalized) return null;
  const vendors = await querySingleTable('vendors', context);
  if (!Array.isArray(vendors)) return null;
  return vendors.find((vendor) => normalizeText(vendor.name).toLowerCase() === normalized) || null;
}

async function linkScanToPurchaseOrder(scanId, purchaseOrderId, vendorId, userName) {
  const normalizedScanId = normalizeText(scanId);
  if (!normalizedScanId || !purchaseOrderId) return;
  const result = await supabase
    .from('po_invoice_scans')
    .update({
      purchase_order_id: purchaseOrderId,
      vendor_id: vendorId || null,
      status: 'approved',
      approved_by: userName || 'system',
      approved_at: new Date().toISOString(),
    })
    .eq('id', normalizedScanId)
    .select()
    .single();
  if (result.error && !isWorkflowSchemaMissing(result.error)) {
    throw new Error(result.error.message);
  }
}

async function attachLotsToPurchaseOrder(purchaseOrderId, lotNumbers, context) {
  if (!purchaseOrderId) return;
  const scope = buildScopeFields(context || {});
  const values = Array.from(
    new Set(
      (Array.isArray(lotNumbers) ? lotNumbers : [])
        .map((value) => normalizeText(value))
        .filter(Boolean)
    )
  );
  for (const lotNumber of values) {
    let lotUpdate = supabase.from('lot_codes').update({ purchase_order_id: purchaseOrderId }).eq('lot_number', lotNumber);
    if (scope.company_id) lotUpdate = lotUpdate.eq('company_id', scope.company_id);
    if (scope.location_id) lotUpdate = lotUpdate.eq('location_id', scope.location_id);
    const lotResult = await lotUpdate;
    if (lotResult.error && !isWorkflowSchemaMissing(lotResult.error)) {
      throw new Error(lotResult.error.message);
    }

    let inventoryLotUpdate = supabase.from('inventory_lots').update({ purchase_order_id: purchaseOrderId }).eq('lot_number', lotNumber);
    if (scope.company_id) inventoryLotUpdate = inventoryLotUpdate.eq('company_id', scope.company_id);
    if (scope.location_id) inventoryLotUpdate = inventoryLotUpdate.eq('location_id', scope.location_id);
    const inventoryLotResult = await inventoryLotUpdate;
    if (inventoryLotResult.error && !isWorkflowSchemaMissing(inventoryLotResult.error)) {
      throw new Error(inventoryLotResult.error.message);
    }
  }
}

function mapVendorPoRow(row, receiptsByPurchaseOrderId) {
  const rowLines = Array.isArray(row.items)
    ? row.items.map((line, index) => normalizePoLine(line, index))
    : [];
  const nestedReceipts = receiptsByPurchaseOrderId.get(row.id)
    || (Array.isArray(row.receipts) ? row.receipts : []);
  return {
    id: row.workflow_id || row.id,
    db_id: row.id,
    po_number: row.po_number || null,
    vendor: row.vendor || null,
    vendor_name: row.vendor || null,
    vendor_id: row.vendor_id || null,
    status: normalizeWorkflowStatus(row.status),
    notes: row.notes || null,
    expected_date: row.expected_date || row.scheduled_receipt_date || null,
    scheduled_receipt_date: row.scheduled_receipt_date || row.expected_date || null,
    source_draft_id: row.source_draft_id || null,
    receipt_rules: normalizeReceiptRules(row.receipt_rules || {}),
    lines: rowLines,
    receipts: nestedReceipts,
    created_by: row.created_by || row.confirmed_by || 'system',
    created_at: row.created_at || new Date().toISOString(),
    updated_at: row.updated_at || row.created_at || new Date().toISOString(),
    updated_by: row.updated_by || row.confirmed_by || null,
  };
}

async function loadVendorPurchaseOrdersFromDb(context) {
  const rows = await querySingleTable('purchase_orders', context);
  if (!Array.isArray(rows)) return null;

  const vendorOrderRows = rows.filter((row) => normalizeText(row.workflow_kind).toLowerCase() === 'vendor_order');
  if (!vendorOrderRows.length) return [];

  const purchaseOrderIds = vendorOrderRows.map((row) => row.id).filter(Boolean);
  const receiptsRows = await querySingleTable('po_receipts', context);
  const receiptRows = Array.isArray(receiptsRows)
    ? receiptsRows
      .filter((receipt) => purchaseOrderIds.includes(receipt.purchase_order_id))
      .sort((left, right) => String(right.received_at || '').localeCompare(String(left.received_at || '')))
    : [];

  const receiptIds = receiptRows.map((receipt) => receipt.id).filter(Boolean);
  const receiptLineRows = await querySingleTable('po_receiving_lines', context);
  const lineRows = Array.isArray(receiptLineRows)
    ? receiptLineRows
      .filter((line) => receiptIds.includes(line.receipt_id))
      .sort((left, right) => String(left.created_at || '').localeCompare(String(right.created_at || '')))
    : [];

  const linesByReceiptId = new Map();
  for (const line of lineRows) {
    const bucket = linesByReceiptId.get(line.receipt_id) || [];
    bucket.push({
      line_no: line.line_no,
      item_number: line.item_number || null,
      product_name: line.product_name || null,
      lot_number: line.lot_number || null,
      qty_received: line.qty_received,
      requested_receive_qty: line.requested_receive_qty,
      accepted_receive_qty: line.accepted_receive_qty,
      rejected_receive_qty: line.rejected_receive_qty,
      over_receipt_qty: line.over_receipt_qty,
      remaining_before_qty: line.remaining_before_qty,
      remaining_after_qty: line.remaining_after_qty,
      quantity_variance_qty: line.quantity_variance_qty,
      variance_type: line.variance_type,
      backordered_qty_after_receipt: line.backordered_qty_after_receipt,
      waived_backorder_qty_applied: line.waived_backorder_qty_applied,
      unit: line.unit || null,
      unit_cost: line.unit_cost,
      approval_required: !!line.approval_required,
      approval_status: line.approval_status || null,
      approved_at: line.approved_at || null,
      approved_by: line.approved_by || null,
    });
    linesByReceiptId.set(line.receipt_id, bucket);
  }

  const receiptsByPurchaseOrderId = new Map();
  for (const receipt of receiptRows) {
    const bucket = receiptsByPurchaseOrderId.get(receipt.purchase_order_id) || [];
    bucket.push({
      id: receipt.id,
      received_at: receipt.received_at || null,
      received_by: receipt.received_by || null,
      notes: receipt.notes || null,
      scan_id: receipt.scan_id || null,
      variance_audit: receipt.variance_audit || {},
      receipt_rules_applied: receipt.receipt_rules_applied || {},
      lines: linesByReceiptId.get(receipt.id) || [],
    });
    receiptsByPurchaseOrderId.set(receipt.purchase_order_id, bucket);
  }

  return summarizeVendorPurchaseOrders(
    vendorOrderRows.map((row) => mapVendorPoRow(row, receiptsByPurchaseOrderId))
  );
}

async function savePurchaseOrderHeader(rowId, payload, context) {
  if (rowId) {
    const result = await executeWithOptionalScope(
      (candidate) => supabase.from('purchase_orders').update(candidate).eq('id', rowId).select().single(),
      payload
    );
    if (result.error) {
      if (isWorkflowSchemaMissing(result.error)) return null;
      throw new Error(result.error.message);
    }
    return result.data;
  }

  const insert = await insertRecordWithOptionalScope(supabase, 'purchase_orders', payload, context);
  if (insert.error) {
    if (isWorkflowSchemaMissing(insert.error)) return null;
    throw new Error(insert.error.message);
  }
  return insert.data;
}

async function replaceReceiptAuditRows(purchaseOrderId, po, context) {
  const tablesToClear = ['po_discrepancy_log', 'po_receiving_approval_queue', 'po_receiving_lines', 'po_receipts'];
  for (const table of tablesToClear) {
    const result = await supabase.from(table).delete().eq('purchase_order_id', purchaseOrderId);
    if (result.error) {
      if (isWorkflowSchemaMissing(result.error)) return false;
      throw new Error(result.error.message);
    }
  }

  for (const receipt of (Array.isArray(po.receipts) ? po.receipts : [])) {
    const receiptInsert = await insertRecordWithOptionalScope(supabase, 'po_receipts', {
      purchase_order_id: purchaseOrderId,
      scan_id: normalizeText(receipt.scan_id) || null,
      notes: receipt.notes || null,
      received_by: receipt.received_by || null,
      received_at: receipt.received_at || new Date().toISOString(),
      receipt_rules_applied: receipt.receipt_rules_applied || normalizeReceiptRules(po.receipt_rules || {}),
      variance_audit: receipt.variance_audit || {},
    }, context);
    if (receiptInsert.error) {
      if (isWorkflowSchemaMissing(receiptInsert.error)) return false;
      throw new Error(receiptInsert.error.message);
    }

    const receiptRow = receiptInsert.data;
    const approvedBy = normalizeText(receipt.received_by) || 'system';
    const approvedAt = receipt.received_at || new Date().toISOString();

    for (const line of (Array.isArray(receipt.lines) ? receipt.lines : [])) {
      const approvalRequired = inferApprovalRequired(line);
      const approvalStatus = normalizeText(line.approval_status).toLowerCase()
        || (approvalRequired ? 'approved' : 'not_required');

      const lineInsert = await insertRecordWithOptionalScope(supabase, 'po_receiving_lines', {
        purchase_order_id: purchaseOrderId,
        receipt_id: receiptRow.id,
        line_no: parseInt(line.line_no, 10) || 0,
        item_number: normalizeText(line.item_number) || null,
        product_name: normalizeText(line.product_name) || null,
        lot_number: normalizeText(line.lot_number) || null,
        qty_received: toNumber(line.qty_received, 0),
        requested_receive_qty: toNumber(line.requested_receive_qty, 0),
        accepted_receive_qty: toNumber(line.accepted_receive_qty ?? line.qty_received, 0),
        rejected_receive_qty: toNumber(line.rejected_receive_qty, 0),
        over_receipt_qty: toNumber(line.over_receipt_qty, 0),
        remaining_before_qty: toNumber(line.remaining_before_qty, 0),
        remaining_after_qty: toNumber(line.remaining_after_qty, 0),
        quantity_variance_qty: toNumber(line.quantity_variance_qty, 0),
        variance_type: normalizeText(line.variance_type) || 'exact_receipt',
        backordered_qty_after_receipt: toNumber(line.backordered_qty_after_receipt, 0),
        waived_backorder_qty_applied: toNumber(line.waived_backorder_qty_applied, 0),
        unit: normalizeText(line.unit) || null,
        unit_cost: toNumber(line.unit_cost, 0),
        approval_required: approvalRequired,
        approval_status: approvalStatus,
        approved_at: approvalRequired && approvalStatus !== 'pending' ? approvedAt : null,
        approved_by: approvalRequired && approvalStatus !== 'pending' ? approvedBy : null,
      }, context);
      if (lineInsert.error) {
        if (isWorkflowSchemaMissing(lineInsert.error)) return false;
        throw new Error(lineInsert.error.message);
      }

      if (approvalRequired) {
        const queueInsert = await insertRecordWithOptionalScope(supabase, 'po_receiving_approval_queue', {
          purchase_order_id: purchaseOrderId,
          receipt_id: receiptRow.id,
          receipt_line_id: lineInsert.data?.id || null,
          line_no: parseInt(line.line_no, 10) || 0,
          item_number: normalizeText(line.item_number) || null,
          product_name: normalizeText(line.product_name) || null,
          approval_type: 'count_item',
          requested_qty: toNumber(line.requested_receive_qty ?? line.qty_received, 0),
          status: approvalStatus,
          decision_notes: approvalStatus === 'pending' ? null : 'Approved via purchasing receipt workflow.',
          decided_at: approvalStatus === 'pending' ? null : approvedAt,
          decided_by: approvalStatus === 'pending' ? null : approvedBy,
        }, context);
        if (queueInsert.error) {
          if (isWorkflowSchemaMissing(queueInsert.error)) return false;
          throw new Error(queueInsert.error.message);
        }
      }

      if (hasDiscrepancy(line)) {
        const discrepancyInsert = await insertRecordWithOptionalScope(supabase, 'po_discrepancy_log', {
          purchase_order_id: purchaseOrderId,
          receipt_id: receiptRow.id,
          receipt_line_id: lineInsert.data?.id || null,
          line_no: parseInt(line.line_no, 10) || 0,
          item_number: normalizeText(line.item_number) || null,
          product_name: normalizeText(line.product_name) || null,
          expected_qty: toNumber(line.remaining_before_qty, 0) + Math.min(toNumber(line.accepted_receive_qty ?? line.qty_received, 0), Math.max(0, toNumber(line.remaining_before_qty, 0))),
          requested_qty: toNumber(line.requested_receive_qty ?? line.qty_received, 0),
          accepted_qty: toNumber(line.accepted_receive_qty ?? line.qty_received, 0),
          rejected_qty: toNumber(line.rejected_receive_qty, 0),
          over_receipt_qty: toNumber(line.over_receipt_qty, 0),
          remaining_after_qty: toNumber(line.remaining_after_qty, 0),
          variance_qty: toNumber(line.quantity_variance_qty, 0),
          variance_type: normalizeText(line.variance_type) || 'exact_receipt',
          flagged_at: receipt.received_at || new Date().toISOString(),
          flagged_by: approvedBy,
        }, context);
        if (discrepancyInsert.error) {
          if (isWorkflowSchemaMissing(discrepancyInsert.error)) return false;
          throw new Error(discrepancyInsert.error.message);
        }
      }
    }
  }

  return true;
}

async function persistVendorPurchaseOrderSnapshot(po, context) {
  const purchaseOrder = po || {};
  const vendorName = normalizeText(purchaseOrder.vendor || purchaseOrder.vendor_name) || 'Unassigned Vendor';
  const vendorRecord = await findVendorByName(vendorName, context);

  const lookup = await supabase
    .from('purchase_orders')
    .select('*')
    .eq('workflow_id', normalizeText(purchaseOrder.id))
    .limit(1);
  if (lookup.error) {
    if (isWorkflowSchemaMissing(lookup.error)) return { row: null, rowsBackedByDb: false };
    throw new Error(lookup.error.message);
  }

  const existingRow = filterRowsByContext(lookup.data || [], context)[0] || null;
  const headerPayload = {
    workflow_id: normalizeText(purchaseOrder.id),
    workflow_kind: 'vendor_order',
    po_number: purchaseOrder.po_number || null,
    vendor: vendorName,
    vendor_id: vendorRecord?.id || null,
    items: Array.isArray(purchaseOrder.lines) ? purchaseOrder.lines.map((line, index) => normalizePoLine(line, index)) : [],
    total_cost: toNumber(purchaseOrder.total_ordered_cost ?? purchaseOrder.total_cost, 0),
    notes: purchaseOrder.notes || null,
    confirmed_by: purchaseOrder.created_by || purchaseOrder.updated_by || null,
    created_by: purchaseOrder.created_by || null,
    created_at: purchaseOrder.created_at || new Date().toISOString(),
    updated_by: purchaseOrder.updated_by || null,
    updated_at: purchaseOrder.updated_at || new Date().toISOString(),
    status: normalizeWorkflowStatus(purchaseOrder.status),
    expected_date: purchaseOrder.expected_date || purchaseOrder.scheduled_receipt_date || null,
    scheduled_receipt_date: purchaseOrder.scheduled_receipt_date || purchaseOrder.expected_date || null,
    receipt_rules: normalizeReceiptRules(purchaseOrder.receipt_rules || {}),
    receipts: Array.isArray(purchaseOrder.receipts) ? purchaseOrder.receipts : [],
    received_at: purchaseOrder.first_received_at || null,
    closed_at: normalizeWorkflowStatus(purchaseOrder.status) === 'received'
      ? (purchaseOrder.latest_received_at || purchaseOrder.updated_at || purchaseOrder.created_at || new Date().toISOString())
      : null,
    source_draft_id: purchaseOrder.source_draft_id || null,
  };

  const savedRow = await savePurchaseOrderHeader(existingRow?.id || null, headerPayload, context);
  if (!savedRow) return { row: null, rowsBackedByDb: false };

  const receiptRowsBackedByDb = await replaceReceiptAuditRows(savedRow.id, purchaseOrder, context);
  return { row: savedRow, rowsBackedByDb: receiptRowsBackedByDb };
}

async function recordPoInvoiceScan({ context, createdBy, fileName, mimeType, parsed, purchaseOrderId = null, vendorId = null, invoiceImageUrl = null, source = 'scan-po' }) {
  const payload = {
    purchase_order_id: purchaseOrderId,
    vendor_id: vendorId,
    source,
    file_name: fileName || null,
    mime_type: mimeType || null,
    invoice_image_url: invoiceImageUrl || null,
    parsed_vendor: parsed?.vendor || null,
    parsed_po_number: parsed?.po_number || null,
    parsed_date: parsed?.date || null,
    parsed_total_cost: parsed?.total_cost != null ? toNumber(parsed.total_cost, 0) : null,
    parsed_items: Array.isArray(parsed?.items) ? parsed.items : [],
    status: 'parsed',
    created_by: createdBy || 'system',
    parsed_at: new Date().toISOString(),
  };
  const result = await insertRecordWithOptionalScope(supabase, 'po_invoice_scans', payload, context);
  if (result.error) {
    if (isWorkflowSchemaMissing(result.error)) return null;
    throw new Error(result.error.message);
  }
  return result.data || null;
}

module.exports = {
  attachLotsToPurchaseOrder,
  findVendorByName,
  isWorkflowSchemaMissing,
  linkScanToPurchaseOrder,
  loadVendorPurchaseOrdersFromDb,
  persistVendorPurchaseOrderSnapshot,
  recordPoInvoiceScan,
  replaceReceiptAuditRows,
};
