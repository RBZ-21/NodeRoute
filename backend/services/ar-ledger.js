'use strict';

const { supabase: defaultDb } = require('./supabase');
const creditEngine = require('./creditEngine');
const {
  buildScopeFields,
  executeWithOptionalScope,
  filterRowsByContext,
  insertRecordWithOptionalScope,
  rowMatchesContext,
  scopeQueryByContext,
} = require('./operating-context');

const OPEN_INVOICE_STATUSES = new Set(['open', 'pending', 'signed', 'sent', 'delivered', 'overdue']);
const RECEIPT_APPLIED_STATUSES = new Set(['applied', 'partially_applied', 'unapplied']);

function dbFrom(options = {}) {
  return options.db || defaultDb;
}

function contextCompanyId(context = {}) {
  return context.activeCompanyId || context.companyId || null;
}

function contextLocationId(context = {}) {
  return context.activeLocationId || context.locationId || null;
}

function toMoney(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 10000) / 10000 : 0;
}

function roundCents(value) {
  return Math.round(toMoney(value) * 100) / 100;
}

function stringId(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function isOpenInvoice(invoice) {
  return OPEN_INVOICE_STATUSES.has(String(invoice?.status || '').toLowerCase());
}

function invoiceAmount(invoice) {
  return toMoney(invoice?.open_balance ?? invoice?.balance_due ?? invoice?.balance ?? invoice?.total ?? invoice?.amount ?? 0);
}

function invoiceOriginalAmount(invoice) {
  return toMoney(invoice?.total ?? invoice?.amount ?? invoice?.subtotal ?? 0);
}

function signedLedgerAmount(entryType, amount) {
  const absolute = Math.abs(toMoney(amount));
  if (entryType === 'payment' || entryType === 'credit_memo') return -absolute;
  return toMoney(amount);
}

async function loadOne(db, table, id, context, options = {}) {
  const idField = options.idField || 'id';
  let query = db.from(table).select('*').eq(idField, id);
  if (context) query = scopeQueryByContext(query, context, { includeLocation: options.includeLocation !== false });
  const { data, error } = await query.single();
  if (error) throw new Error(`${table} ${id}: ${error.message}`);
  if (!data || (context && !rowMatchesContext(data, context))) {
    throw new Error(`${table} ${id} not found`);
  }
  return data;
}

async function selectRows(db, table, context, configure = (query) => query, options = {}) {
  let query = db.from(table).select('*');
  if (context) query = scopeQueryByContext(query, context, { includeLocation: options.includeLocation !== false });
  const { data, error } = await configure(query);
  if (error) throw new Error(`${table}: ${error.message}`);
  return filterRowsByContext(data || [], context || {});
}

async function customerLedgerBalance(db, customerId, context) {
  const rows = await selectRows(
    db,
    'ar_ledger_entries',
    context,
    (query) => query.eq('customer_id', String(customerId))
  );
  return roundCents(rows.reduce((sum, row) => sum + toMoney(row.amount), 0));
}

async function updateCustomerBalance(db, customerId, balance, context) {
  const updates = {
    current_balance: roundCents(balance),
  };
  const result = await executeWithOptionalScope(
    (candidate) => scopeQueryByContext(db.from('Customers').update(candidate), context, { includeLocation: true })
      .eq('id', customerId)
      .select()
      .single(),
    updates
  );
  if (result.error) throw new Error(`Customers ${customerId}: ${result.error.message}`);
  return result.data;
}

async function existingLedgerEntry(db, { entryType, referenceId, referenceType, context }) {
  if (!referenceId) return null;
  let query = db
    .from('ar_ledger_entries')
    .select('*')
    .eq('entry_type', entryType)
    .eq('reference_id', String(referenceId));
  if (referenceType) query = query.eq('reference_type', referenceType);
  if (context) query = scopeQueryByContext(query, context, { includeLocation: true });
  const { data, error } = await query.limit(1);
  if (error) throw new Error(`ar_ledger_entries lookup: ${error.message}`);
  return Array.isArray(data) && data.length ? data[0] : null;
}

// BE-004: detect "RPC not deployed" separately from real failures so we only
// fall back to the legacy path when the atomic function is genuinely absent.
function isMissingRpcError(error) {
  const code = String(error?.code || '');
  if (code === 'PGRST202' || code === '42883') return true;
  const message = String(error?.message || '').toLowerCase();
  return message.includes('could not find the function') || message.includes('does not exist');
}

// BE-004: shared RPC attempt helper (same pattern as BE-001 in
// inventory-ledger.js). Returns null when the RPC is unavailable (demo mode,
// offline resilient mode, injected test db without rpc, or migration not yet
// applied) so callers can fall back to the legacy path. Null data with no
// error is treated as unavailable, never as silent success.
async function tryArRpc(db, funcName, args) {
  if (typeof db.rpc !== 'function') return null;
  const result = await db.rpc(funcName, args);
  if (result && result.error) {
    if (isMissingRpcError(result.error)) return null;
    throw new Error(`${funcName}: ${result.error.message}`);
  }
  const payload = result && result.data;
  if (!payload || typeof payload !== 'object') return null;
  return payload;
}

async function insertLedgerEntry(db, payload, context) {
  const entryType = payload.entry_type;
  const referenceId = payload.reference_id ? String(payload.reference_id) : null;
  const referenceType = payload.reference_type || null;

  // BE-004: atomic DB-side path — idempotency check, customer row lock,
  // balance computation, entry insert, and Customers.current_balance update
  // all happen in one transaction inside insert_ar_ledger_entry.
  const rpcPayload = await tryArRpc(db, 'insert_ar_ledger_entry', {
    p_customer_id: String(payload.customer_id),
    p_entry_type: entryType,
    p_reference_id: referenceId,
    p_reference_type: referenceType,
    p_amount: toMoney(payload.amount),
    p_entry_date: payload.entry_date || today(),
    p_company_id: contextCompanyId(context) || null,
    p_location_id: contextLocationId(context) || null,
  });
  if (rpcPayload) {
    if (rpcPayload.ok !== false) {
      return rpcPayload.idempotent ? { ...rpcPayload.entry, idempotent: true } : rpcPayload.entry;
    }
    if (rpcPayload.code === 'AR_CUSTOMER_NOT_FOUND') {
      throw new Error(`Customers ${payload.customer_id}: not found`);
    }
    if (rpcPayload.code === 'AR_INVALID_CUSTOMER') {
      throw new Error('ar_ledger_entries insert: customer_id is required');
    }
    // Any other structured failure: fall through to the legacy path.
  }

  // Legacy fallback (demo mode / offline resilient mode only): the original
  // read-modify-write path. Single-process local state, so the concurrency
  // hazard the RPC eliminates does not apply here.
  const existing = await existingLedgerEntry(db, { entryType, referenceId, referenceType, context });
  if (existing) return { ...existing, idempotent: true };

  const amount = signedLedgerAmount(entryType, payload.amount);
  const previousBalance = await customerLedgerBalance(db, payload.customer_id, context);
  const balanceAfter = roundCents(previousBalance + amount);
  const row = {
    customer_id: String(payload.customer_id),
    entry_type: entryType,
    reference_id: referenceId,
    reference_type: referenceType,
    amount,
    balance_after: balanceAfter,
    entry_date: payload.entry_date || today(),
  };
  const { data, error } = await insertRecordWithOptionalScope(db, 'ar_ledger_entries', row, context || {});
  if (error) throw new Error(`ar_ledger_entries insert: ${error.message}`);
  await updateCustomerBalance(db, payload.customer_id, balanceAfter, context);
  return data;
}

async function openInvoicesForCustomer(db, customerId, context) {
  const rows = await selectRows(
    db,
    'invoices',
    context,
    (query) => query.eq('customer_id', String(customerId))
  );
  return rows.filter(isOpenInvoice);
}

function invoiceDueDate(invoice) {
  return invoice?.due_date || invoice?.invoice_date || invoice?.created_at || null;
}

function daysPastDue(invoice, asOfDate = today()) {
  const dueDate = invoiceDueDate(invoice);
  if (!dueDate) return 0;
  const due = new Date(`${String(dueDate).slice(0, 10)}T00:00:00.000Z`);
  const asOf = new Date(`${String(asOfDate).slice(0, 10)}T00:00:00.000Z`);
  if (!Number.isFinite(due.getTime()) || !Number.isFinite(asOf.getTime())) return 0;
  return Math.max(0, Math.floor((asOf.getTime() - due.getTime()) / 86_400_000));
}

async function recordCustomerCreditEvent(db, context, payload) {
  const row = {
    customer_id: String(payload.customer_id),
    event_type: payload.event_type,
    old_status: payload.old_status || null,
    new_status: payload.new_status || null,
    triggered_by: payload.triggered_by || 'system',
    note: payload.note || null,
  };
  const { data, error } = await insertRecordWithOptionalScope(db, 'customer_credit_events', row, context || {});
  if (error) throw new Error(`customer_credit_events insert: ${error.message}`);
  return data;
}

async function evaluateAutomaticCreditHold(db, customerId, context, options = {}) {
  let customer;
  try {
    customer = await loadOne(db, 'Customers', customerId, context, { includeLocation: true });
  } catch {
    return null;
  }
  if (customer.auto_hold_enabled === false || customer.credit_hold === true) return customer;

  const thresholdRaw = customer.credit_hold_threshold ?? customer.overdue_balance_threshold ?? customer.credit_limit;
  const threshold = toMoney(thresholdRaw);
  if (!Number.isFinite(threshold) || threshold <= 0) return customer;

  const overdueBalance = (await openInvoicesForCustomer(db, customerId, context))
    .filter((invoice) => daysPastDue(invoice, options.asOfDate || today()) > 0)
    .reduce((sum, invoice) => sum + invoiceAmount(invoice), 0);

  if (roundCents(overdueBalance) <= threshold) return customer;

  const oldStatus = customer.credit_status || 'good';
  const { data: updated, error } = await executeWithOptionalScope(
    (candidate) => scopeQueryByContext(db.from('Customers').update(candidate), context, { includeLocation: true })
      .eq('id', customerId)
      .select()
      .single(),
    {
      credit_hold: true,
      credit_hold_reason: 'past_due',
      credit_status: 'hold',
      credit_hold_placed_at: new Date().toISOString(),
      hold_notes: `Auto-hold: overdue balance $${roundCents(overdueBalance).toFixed(2)} exceeds threshold $${threshold.toFixed(2)}`,
    }
  );
  if (error) throw new Error(`Customers ${customerId}: ${error.message}`);
  await recordCustomerCreditEvent(db, context, {
    customer_id: customerId,
    event_type: 'auto_hold',
    old_status: oldStatus,
    new_status: 'hold',
    triggered_by: 'ar_ledger',
    note: `Overdue balance $${roundCents(overdueBalance).toFixed(2)} exceeded threshold $${threshold.toFixed(2)}`,
  });
  return updated;
}

async function updateInvoiceOpenBalance(db, invoice, nextOpenBalance, context) {
  const openBalance = roundCents(Math.max(0, nextOpenBalance));
  const updates = {
    open_balance: openBalance,
  };
  if (openBalance <= 0) {
    updates.status = 'paid';
    updates.payment_status = 'paid';
    updates.paid_at = new Date().toISOString();
    updates.paid_date = new Date().toISOString();
  }
  const result = await executeWithOptionalScope(
    (candidate) => scopeQueryByContext(db.from('invoices').update(candidate), context, { includeLocation: true })
      .eq('id', invoice.id)
      .select()
      .single(),
    updates
  );
  if (result.error) throw new Error(`invoices ${invoice.id}: ${result.error.message}`);
  return result.data;
}

// BE-004: atomic invoice open-balance change. Prefers the DB-side RPC (row
// lock + delta applied against the DB's current value, so concurrent receipt
// applications cannot lose updates); falls back to the legacy JS-computed
// absolute write when the RPC is unavailable.
async function applyInvoiceOpenBalanceChange(db, invoice, { delta = null, absolute = null }, context) {
  const rpcPayload = await tryArRpc(db, 'apply_invoice_balance_delta', {
    p_invoice_id: String(invoice.id),
    p_delta: delta == null ? null : toMoney(delta),
    p_set_absolute: absolute == null ? null : toMoney(absolute),
    p_company_id: contextCompanyId(context) || null,
    p_location_id: contextLocationId(context) || null,
  });
  if (rpcPayload) {
    if (rpcPayload.ok !== false) return rpcPayload.invoice;
    if (rpcPayload.code === 'AR_INVOICE_NOT_FOUND') {
      throw new Error(`invoices ${invoice.id}: not found`);
    }
    // AR_UNSUPPORTED_SCHEMA or other structured failure: use the legacy path.
  }
  const nextOpenBalance = absolute != null
    ? absolute
    : (invoiceAmount(invoice) || invoiceOriginalAmount(invoice)) - toMoney(delta || 0);
  return updateInvoiceOpenBalance(db, invoice, nextOpenBalance, context);
}

async function postInvoice(invoiceId, options = {}) {
  const db = dbFrom(options);
  const context = options.context || {};
  const invoice = await loadOne(db, 'invoices', invoiceId, context, { includeLocation: true });
  const customerId = stringId(invoice.customer_id);
  if (!customerId) throw new Error(`Invoice ${invoiceId} has no customer_id`);

  const amount = invoiceOriginalAmount(invoice);
  const entry = await insertLedgerEntry(db, {
    customer_id: customerId,
    entry_type: 'invoice',
    reference_id: invoice.id,
    reference_type: 'invoice',
    amount,
    entry_date: String(invoice.invoice_date || invoice.created_at || today()).slice(0, 10),
  }, context);

  const openBalance = invoice.open_balance == null ? amount : invoiceAmount(invoice);
  await applyInvoiceOpenBalanceChange(db, invoice, { absolute: openBalance }, context);
  await evaluateAutomaticCreditHold(db, customerId, context, { asOfDate: options.asOfDate });
  return entry;
}

async function loadReceiptApplications(db, receiptId, context) {
  return selectRows(
    db,
    'cash_receipt_applications',
    context,
    (query) => query.eq('cash_receipt_id', receiptId)
  );
}

async function applyReceipt(receiptId, applications = [], options = {}) {
  const db = dbFrom(options);
  const context = options.context || {};
  const receipt = await loadOne(db, 'cash_receipts', receiptId, context, { includeLocation: true });

  const existingApplications = await loadReceiptApplications(db, receipt.id, context);
  if (existingApplications.length || RECEIPT_APPLIED_STATUSES.has(String(receipt.status || '').toLowerCase())) {
    return {
      ...receipt,
      applications: existingApplications,
      applied_amount: roundCents(existingApplications.reduce((sum, row) => sum + toMoney(row.applied_amount), 0)),
      unapplied_amount: toMoney(receipt.unapplied_amount),
      idempotent: true,
    };
  }

  const validApplications = (applications || [])
    .map((application) => ({
      invoice_id: stringId(application.invoice_id || application.invoiceId),
      applied_amount: roundCents(application.applied_amount ?? application.appliedAmount),
    }))
    .filter((application) => application.invoice_id && application.applied_amount > 0);

  const receiptTotal = roundCents(receipt.total_amount);
  const appliedTotal = roundCents(validApplications.reduce((sum, application) => sum + application.applied_amount, 0));
  if (appliedTotal > receiptTotal) {
    throw new Error('Applied amount cannot exceed receipt total');
  }

  const customerId = stringId(receipt.customer_id);
  if (!customerId) throw new Error(`Receipt ${receiptId} has no customer_id`);

  const insertedApplications = [];
  for (const application of validApplications) {
    const invoice = await loadOne(db, 'invoices', application.invoice_id, context, { includeLocation: true });
    if (stringId(invoice.customer_id) !== customerId) {
      throw new Error(`Invoice ${application.invoice_id} does not belong to receipt customer`);
    }

    const appRow = {
      cash_receipt_id: receipt.id,
      invoice_id: invoice.id,
      applied_amount: application.applied_amount,
      applied_at: new Date().toISOString(),
      company_id: receipt.company_id || contextCompanyId(context),
      location_id: receipt.location_id || contextLocationId(context),
    };
    const { data, error } = await executeWithOptionalScope(
      (candidate) => db.from('cash_receipt_applications').insert([candidate]).select().single(),
      appRow
    );
    if (error) throw new Error(`cash_receipt_applications insert: ${error.message}`);
    insertedApplications.push(data);

    // BE-004: delta semantics — the RPC subtracts from the DB's current value
    // under a row lock instead of writing a JS-computed absolute balance.
    await applyInvoiceOpenBalanceChange(db, invoice, { delta: application.applied_amount }, context);
  }

  if (appliedTotal > 0) {
    await insertLedgerEntry(db, {
      customer_id: customerId,
      entry_type: 'payment',
      reference_id: receipt.id,
      reference_type: 'cash_receipt',
      amount: appliedTotal,
      entry_date: receipt.receipt_date || today(),
    }, context);
  }

  const unapplied = roundCents(receiptTotal - appliedTotal);
  const status = appliedTotal <= 0
    ? 'unapplied'
    : (unapplied > 0 ? 'partially_applied' : 'applied');

  const { data: updatedReceipt, error: updateError } = await executeWithOptionalScope(
    (candidate) => scopeQueryByContext(db.from('cash_receipts').update(candidate), context, { includeLocation: true })
      .eq('id', receipt.id)
      .select()
      .single(),
    {
      status,
      unapplied_amount: unapplied,
    }
  );
  if (updateError) throw new Error(`cash_receipts ${receipt.id}: ${updateError.message}`);

  await creditEngine.autoReleaseCheck(customerId, {
    notes: `Cash receipt ${receipt.id} applied`,
  }).catch(() => {});

  return {
    ...updatedReceipt,
    applications: insertedApplications,
    applied_amount: appliedTotal,
    unapplied_amount: unapplied,
    status,
  };
}

function emptyAgingBuckets() {
  return { current: 0, '30': 0, '60': 0, '90': 0, '120+': 0 };
}

function addToAgingBuckets(buckets, invoice, asOfDate) {
  const amount = invoiceAmount(invoice);
  const days = daysPastDue(invoice, asOfDate);
  if (days <= 0) buckets.current = roundCents(buckets.current + amount);
  else if (days <= 30) buckets['30'] = roundCents(buckets['30'] + amount);
  else if (days <= 60) buckets['60'] = roundCents(buckets['60'] + amount);
  else if (days <= 90) buckets['90'] = roundCents(buckets['90'] + amount);
  else buckets['120+'] = roundCents(buckets['120+'] + amount);
}

async function getAccountInquiry(customerId, companyId, options = {}) {
  const db = dbFrom(options);
  const context = options.context || { companyId, activeCompanyId: companyId };
  const asOfDate = options.asOfDate || today();
  const customer = await loadOne(db, 'Customers', customerId, context, { includeLocation: true });
  const openInvoices = (await openInvoicesForCustomer(db, customerId, context)).map((invoice) => ({
    ...invoice,
    open_balance: invoiceAmount(invoice),
    days_past_due: daysPastDue(invoice, asOfDate),
  }));
  const agingBuckets = emptyAgingBuckets();
  openInvoices.forEach((invoice) => addToAgingBuckets(agingBuckets, invoice, asOfDate));

  const receipts = await selectRows(
    db,
    'cash_receipts',
    context,
    (query) => query.eq('customer_id', String(customerId))
  );
  const unappliedCash = receipts
    .filter((receipt) => toMoney(receipt.unapplied_amount) > 0)
    .reduce((sum, receipt) => sum + toMoney(receipt.unapplied_amount), 0);
  const paymentMethods = [...new Set(receipts.map((receipt) => receipt.payment_method).filter(Boolean))];
  const recentActivity = (await selectRows(
    db,
    'ar_ledger_entries',
    context,
    (query) => query.eq('customer_id', String(customerId)).order('created_at', { ascending: false }).limit(25)
  ));

  return {
    customer,
    open_invoices: openInvoices,
    unapplied_cash: roundCents(unappliedCash),
    aging_buckets: agingBuckets,
    credit_status: customer.credit_status || (customer.credit_hold ? 'hold' : 'good'),
    payment_methods: paymentMethods,
    recent_activity: recentActivity,
  };
}

async function getAgingReport(companyId, asOfDate = today(), options = {}) {
  const db = dbFrom(options);
  const context = options.context || { companyId, activeCompanyId: companyId };
  const invoices = (await selectRows(db, 'invoices', context, (query) => query.order('due_date', { ascending: true })))
    .filter(isOpenInvoice);
  const byCustomer = new Map();
  for (const invoice of invoices) {
    const customerId = stringId(invoice.customer_id) || stringId(invoice.customer_name) || 'unknown';
    const row = byCustomer.get(customerId) || {
      customer_id: customerId,
      customer_name: invoice.customer_name || customerId,
      buckets: emptyAgingBuckets(),
      total_open: 0,
      invoice_count: 0,
    };
    const amount = invoiceAmount(invoice);
    addToAgingBuckets(row.buckets, invoice, asOfDate);
    row.total_open = roundCents(row.total_open + amount);
    row.invoice_count += 1;
    byCustomer.set(customerId, row);
  }
  return [...byCustomer.values()].sort((a, b) => b.total_open - a.total_open);
}

module.exports = {
  OPEN_INVOICE_STATUSES,
  applyReceipt,
  daysPastDue,
  evaluateAutomaticCreditHold,
  getAccountInquiry,
  getAgingReport,
  insertLedgerEntry,
  invoiceAmount,
  postInvoice,
  recordCustomerCreditEvent,
  toMoney,
};
