'use strict';

const { supabase: defaultDb } = require('./supabase');
const {
  buildScopeFields,
  filterRowsByContext,
  rowMatchesContext,
  scopeQueryByContext,
} = require('./operating-context');

function dbFrom(options = {}) {
  return options.db || defaultDb;
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function dateOnly(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function toMoney(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parseFloat(parsed.toFixed(2)) : 0;
}

function billAmount(bill = {}) {
  if (bill.open_balance !== undefined && bill.open_balance !== null && bill.open_balance !== '') return toMoney(bill.open_balance);
  if (bill.balance_due !== undefined && bill.balance_due !== null && bill.balance_due !== '') return toMoney(bill.balance_due);
  if (bill.total !== undefined && bill.total !== null && bill.total !== '') return toMoney(bill.total);
  if (bill.amount !== undefined && bill.amount !== null && bill.amount !== '') return toMoney(bill.amount);
  return toMoney(toMoney(bill.subtotal) + toMoney(bill.tax));
}

async function queryRows(query) {
  const { data, error } = await query;
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function queryOne(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data || null;
}

function scopeCompanyId(context = {}, explicitCompanyId = null) {
  return explicitCompanyId || context.activeCompanyId || context.companyId || null;
}

function scopeLocationId(context = {}, explicitLocationId = null) {
  return explicitLocationId || context.activeLocationId || context.locationId || null;
}

async function loadBill(db, billId, context = {}) {
  const bill = await queryOne(
    scopeQueryByContext(db.from('vendor_bills').select('*'), context, { includeLocation: true })
      .eq('id', billId)
      .single()
  );
  if (!bill) throw new Error('Vendor bill not found');
  if (!rowMatchesContext(bill, context)) throw new Error('Forbidden');
  return bill;
}

async function loadPaymentBatch(db, batchId, context = {}) {
  const batch = await queryOne(
    scopeQueryByContext(db.from('ap_payment_batches').select('*'), context, { includeLocation: true })
      .eq('id', batchId)
      .single()
  );
  if (!batch) throw new Error('AP payment batch not found');
  if (!rowMatchesContext(batch, context)) throw new Error('Forbidden');
  return batch;
}

async function existingLedgerEntry(db, context, entryType, referenceType, referenceId) {
  const rows = await queryRows(
    scopeQueryByContext(db.from('ap_ledger_entries').select('*'), context, { includeLocation: true })
      .eq('entry_type', entryType)
      .eq('reference_type', referenceType)
      .eq('reference_id', referenceId)
      .limit(1)
  );
  return rows[0] || null;
}

async function vendorBalance(db, context, vendorId) {
  const rows = await queryRows(
    scopeQueryByContext(db.from('ap_ledger_entries').select('*'), context, { includeLocation: true })
      .eq('vendor_id', vendorId)
  );
  return toMoney(filterRowsByContext(rows, context).reduce((sum, entry) => sum + toMoney(entry.amount), 0));
}

async function insertLedgerEntry(db, context, record) {
  const scoped = buildScopeFields(context, {
    company_id: scopeCompanyId(context, record.company_id),
    location_id: scopeLocationId(context, record.location_id),
    ...record,
  });
  const { data, error } = await db.from('ap_ledger_entries').insert(scoped).select().single();
  if (error) throw error;
  return data;
}

async function postBill(vendorBillId, options = {}) {
  const db = dbFrom(options);
  const context = options.context || {};
  const bill = await loadBill(db, vendorBillId, context);
  const vendorId = bill.vendor_id || null;
  if (!vendorId) throw new Error('Vendor bill is missing vendor_id');

  const existing = await existingLedgerEntry(db, context, 'bill', 'vendor_bill', vendorBillId);
  if (existing) return { ...existing, idempotent: true };

  const amount = billAmount(bill);
  const balanceAfter = toMoney(await vendorBalance(db, context, vendorId) + amount);
  return insertLedgerEntry(db, context, {
    company_id: bill.company_id,
    location_id: bill.location_id,
    vendor_id: vendorId,
    entry_type: 'bill',
    reference_id: vendorBillId,
    reference_type: 'vendor_bill',
    amount,
    balance_after: balanceAfter,
    entry_date: dateOnly(bill.bill_date || bill.created_at) || todayDate(),
  });
}

async function loadPaymentBatchItems(db, batchId, context = {}) {
  const rows = await queryRows(
    scopeQueryByContext(db.from('ap_payment_batch_items').select('*'), context, { includeLocation: true })
      .eq('ap_payment_batch_id', batchId)
      .order('created_at', { ascending: true })
  );
  return filterRowsByContext(rows, context);
}

async function processPaymentBatch(batchId, options = {}) {
  const db = dbFrom(options);
  const context = options.context || {};
  const batch = await loadPaymentBatch(db, batchId, context);
  if (String(batch.status || '').toLowerCase() === 'paid') return { ...batch, idempotent: true };
  if (!['approved', 'draft'].includes(String(batch.status || '').toLowerCase())) {
    throw new Error('AP payment batch must be approved before payment');
  }

  const items = await loadPaymentBatchItems(db, batchId, context);
  const paidAt = new Date().toISOString();
  let totalPaid = 0;
  const ledgerEntries = [];

  for (const item of items) {
    if (String(item.status || '').toLowerCase() === 'void') continue;
    const bill = await loadBill(db, item.vendor_bill_id, context);
    const vendorId = item.vendor_id || bill.vendor_id || null;
    const amount = toMoney(item.amount || billAmount(bill));
    if (!vendorId || amount <= 0) continue;

    let entry = await existingLedgerEntry(db, context, 'payment', 'ap_payment_batch_item', item.id);
    if (!entry) {
      const balanceAfter = toMoney(await vendorBalance(db, context, vendorId) - amount);
      entry = await insertLedgerEntry(db, context, {
        company_id: item.company_id || bill.company_id || batch.company_id,
        location_id: item.location_id || bill.location_id || batch.location_id,
        vendor_id: vendorId,
        entry_type: 'payment',
        reference_id: item.id,
        reference_type: 'ap_payment_batch_item',
        amount: -amount,
        balance_after: balanceAfter,
        entry_date: dateOnly(batch.payment_date) || todayDate(),
      });
    }
    ledgerEntries.push(entry);
    totalPaid += amount;

    await scopeQueryByContext(db.from('vendor_bills').update({
      status: 'paid',
      paid_at: paidAt,
      paid_by: options.paidBy || null,
      updated_at: paidAt,
    }), context, { includeLocation: true }).eq('id', bill.id).select().single();

    await scopeQueryByContext(db.from('ap_payment_batch_items').update({
      status: 'paid',
      paid_at: paidAt,
    }), context, { includeLocation: true }).eq('id', item.id).select().single();
  }

  const { data, error } = await scopeQueryByContext(db.from('ap_payment_batches').update({
    status: 'paid',
    paid_at: paidAt,
    paid_by: options.paidBy || null,
    total_amount: toMoney(batch.total_amount || totalPaid),
    updated_at: paidAt,
  }), context, { includeLocation: true }).eq('id', batchId).select().single();
  if (error) throw error;
  return { ...data, items, ledger_entries: ledgerEntries };
}

function agingBucket(daysOverdue) {
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return '30';
  if (daysOverdue <= 60) return '60';
  if (daysOverdue <= 90) return '90';
  return '120_plus';
}

function emptyBuckets() {
  return { current: 0, '30': 0, '60': 0, '90': 0, '120_plus': 0 };
}

function daysBetween(leftDate, rightDate) {
  const left = new Date(`${dateOnly(leftDate) || todayDate()}T00:00:00.000Z`);
  const right = new Date(`${dateOnly(rightDate) || todayDate()}T00:00:00.000Z`);
  return Math.floor((left.getTime() - right.getTime()) / (24 * 60 * 60 * 1000));
}

async function getAPAging(companyId, asOfDate = todayDate(), options = {}) {
  const db = dbFrom(options);
  const context = options.context || {};
  const rows = await queryRows(scopeQueryByContext(
    db.from('vendor_bills').select('*'),
    { ...context, activeCompanyId: scopeCompanyId(context, companyId) || context.activeCompanyId },
    { includeLocation: true }
  ));
  const scoped = filterRowsByContext(rows, context)
    .filter((bill) => !['paid', 'void'].includes(String(bill.status || '').toLowerCase()));
  const grouped = new Map();
  for (const bill of scoped) {
    const vendorId = String(bill.vendor_id || bill.vendor || bill.vendor_name || 'unassigned');
    const current = grouped.get(vendorId) || {
      vendor_id: bill.vendor_id || null,
      vendor_name: bill.vendor_name || bill.vendor || 'Unassigned Vendor',
      buckets: emptyBuckets(),
      total_open: 0,
      open_bills: [],
    };
    const amount = billAmount(bill);
    const bucket = agingBucket(daysBetween(asOfDate, bill.due_date || asOfDate));
    current.buckets[bucket] = toMoney(current.buckets[bucket] + amount);
    current.total_open = toMoney(current.total_open + amount);
    current.open_bills.push({
      id: bill.id,
      bill_number: bill.bill_number || null,
      due_date: bill.due_date || null,
      status: bill.status || null,
      amount,
      aging_bucket: bucket,
    });
    grouped.set(vendorId, current);
  }
  return Array.from(grouped.values()).sort((left, right) => right.total_open - left.total_open);
}

async function getCashRequirements(companyId, horizonDays = 30, options = {}) {
  const asOfDate = options.asOfDate || todayDate();
  const horizon = Math.max(0, Number(horizonDays) || 0);
  const horizonDate = new Date(`${asOfDate}T00:00:00.000Z`);
  horizonDate.setUTCDate(horizonDate.getUTCDate() + horizon);
  const dueBy = horizonDate.toISOString().slice(0, 10);
  const rows = await getAPAging(companyId, asOfDate, options);
  const bills = rows.flatMap((row) =>
    row.open_bills
      .filter((bill) => !bill.due_date || bill.due_date <= dueBy)
      .map((bill) => ({ ...bill, vendor_id: row.vendor_id, vendor_name: row.vendor_name }))
  );
  return {
    as_of_date: asOfDate,
    horizon_days: horizon,
    due_by: dueBy,
    total_due: toMoney(bills.reduce((sum, bill) => sum + bill.amount, 0)),
    bills,
  };
}

async function getVendorAPStatus(vendorId, options = {}) {
  const rows = await getAPAging(options.companyId || null, options.asOfDate || todayDate(), options);
  const match = rows.find((row) => String(row.vendor_id || '') === String(vendorId));
  return match || {
    vendor_id: vendorId,
    vendor_name: null,
    buckets: emptyBuckets(),
    total_open: 0,
    open_bills: [],
  };
}

module.exports = {
  billAmount,
  getAPAging,
  getCashRequirements,
  getVendorAPStatus,
  postBill,
  processPaymentBatch,
};
