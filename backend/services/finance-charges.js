'use strict';

const { supabase: defaultDb } = require('./supabase');
const {
  buildScopeFields,
  executeWithOptionalScope,
  filterRowsByContext,
  insertRecordWithOptionalScope,
  scopeQueryByContext,
} = require('./operating-context');
const arLedger = require('./ar-ledger');

function dbFrom(options = {}) {
  return options.db || defaultDb;
}

function toMoney(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 10000) / 10000 : 0;
}

function roundCents(value) {
  return Math.round(toMoney(value) * 100) / 100;
}

function normalizeMode(mode) {
  const normalized = String(mode || 'preview').toLowerCase();
  if (normalized === 'commit') return 'committed';
  if (normalized === 'committed') return 'committed';
  return 'preview';
}

function financeChargeRate() {
  const parsed = Number(process.env.AR_FINANCE_CHARGE_RATE || process.env.FINANCE_CHARGE_RATE || 0.015);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0.015;
}

function runDateKey(value) {
  const key = String(value || new Date().toISOString().slice(0, 10)).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : new Date().toISOString().slice(0, 10);
}

function daysBetweenDates(later, earlier) {
  const laterDate = new Date(`${String(later).slice(0, 10)}T00:00:00.000Z`);
  const earlierDate = new Date(`${String(earlier).slice(0, 10)}T00:00:00.000Z`);
  if (!Number.isFinite(laterDate.getTime()) || !Number.isFinite(earlierDate.getTime())) return 0;
  return Math.max(0, Math.floor((laterDate.getTime() - earlierDate.getTime()) / 86_400_000));
}

async function selectRows(db, table, context, configure = (query) => query, options = {}) {
  let query = db.from(table).select('*');
  if (context) query = scopeQueryByContext(query, context, { includeLocation: options.includeLocation !== false });
  const { data, error } = await configure(query);
  if (error) throw new Error(`${table}: ${error.message}`);
  return filterRowsByContext(data || [], context || {});
}

function invoiceOpenAmount(invoice) {
  return arLedger.invoiceAmount(invoice) || toMoney(invoice.total || invoice.amount || 0);
}

function isChargeableInvoice(invoice, runDate) {
  const status = String(invoice.status || '').toLowerCase();
  if (!['open', 'pending', 'signed', 'sent', 'delivered', 'overdue'].includes(status)) return false;
  const dueDate = invoice.due_date || invoice.invoice_date || invoice.created_at;
  if (!dueDate) return false;
  return daysBetweenDates(runDate, dueDate) > 0 && invoiceOpenAmount(invoice) > 0;
}

async function buildChargeEntries(db, companyId, runDate, context) {
  const rate = financeChargeRate();
  const invoices = (await selectRows(
    db,
    'invoices',
    context,
    (query) => query.eq('company_id', companyId)
  )).filter((invoice) => isChargeableInvoice(invoice, runDate));

  return invoices.map((invoice) => {
    const openAmount = invoiceOpenAmount(invoice);
    const daysOverdue = daysBetweenDates(runDate, invoice.due_date || invoice.invoice_date || invoice.created_at);
    return {
      company_id: invoice.company_id || companyId,
      location_id: invoice.location_id || context?.activeLocationId || context?.locationId || null,
      customer_id: String(invoice.customer_id || ''),
      invoice_id: String(invoice.id),
      days_overdue: daysOverdue,
      charge_amount: roundCents(openAmount * rate),
    };
  }).filter((entry) => entry.customer_id && entry.charge_amount > 0);
}

async function findCommittedRun(db, companyId, runDate, context) {
  let query = db
    .from('finance_charge_runs')
    .select('*')
    .eq('company_id', companyId)
    .eq('run_date', runDate)
    .eq('mode', 'committed');
  if (context) query = scopeQueryByContext(query, context, { includeLocation: true });
  const { data, error } = await query.limit(1);
  if (error) throw new Error(`finance_charge_runs lookup: ${error.message}`);
  return Array.isArray(data) && data.length ? data[0] : null;
}

async function hydrateRunEntries(db, runId, context) {
  return selectRows(
    db,
    'finance_charge_entries',
    context,
    (query) => query.eq('finance_charge_run_id', runId)
  );
}

async function calculateFinanceCharges(companyId, runDate, mode = 'preview', options = {}) {
  const db = dbFrom(options);
  const context = options.context || { companyId, activeCompanyId: companyId };
  const normalizedRunDate = runDateKey(runDate);
  const normalizedMode = normalizeMode(mode);

  const entries = await buildChargeEntries(db, companyId, normalizedRunDate, context);
  const totalCharges = roundCents(entries.reduce((sum, entry) => sum + toMoney(entry.charge_amount), 0));

  if (normalizedMode !== 'committed') {
    return {
      mode: 'preview',
      run_date: normalizedRunDate,
      entries,
      total_charges: totalCharges,
    };
  }

  const existing = await findCommittedRun(db, companyId, normalizedRunDate, context);
  if (existing) {
    return {
      ...existing,
      mode: 'committed',
      idempotent: true,
      entries: await hydrateRunEntries(db, existing.id, context),
      total_charges: toMoney(existing.total_charges),
    };
  }

  const { data: run, error: runError } = await insertRecordWithOptionalScope(db, 'finance_charge_runs', {
    run_date: normalizedRunDate,
    mode: 'committed',
    status: 'committed',
    total_charges: totalCharges,
    created_by: options.createdBy || null,
  }, context);
  if (runError) throw new Error(`finance_charge_runs insert: ${runError.message}`);

  const insertedEntries = [];
  for (const entry of entries) {
    const row = {
      ...buildScopeFields(context, {
        company_id: entry.company_id,
        location_id: entry.location_id,
      }),
      finance_charge_run_id: run.id,
      customer_id: entry.customer_id,
      invoice_id: entry.invoice_id,
      days_overdue: entry.days_overdue,
      charge_amount: entry.charge_amount,
    };
    const { data, error } = await executeWithOptionalScope(
      (candidate) => db.from('finance_charge_entries').insert([candidate]).select().single(),
      row
    );
    if (error) throw new Error(`finance_charge_entries insert: ${error.message}`);
    insertedEntries.push(data);

    await arLedger.insertLedgerEntry(db, {
      customer_id: entry.customer_id,
      entry_type: 'finance_charge',
      reference_id: `${run.id}:${entry.invoice_id}`,
      reference_type: 'finance_charge_run',
      amount: entry.charge_amount,
      entry_date: normalizedRunDate,
    }, {
      ...context,
      activeCompanyId: entry.company_id || context?.activeCompanyId || context?.companyId,
      activeLocationId: entry.location_id || context?.activeLocationId || context?.locationId,
    });
  }

  return {
    ...run,
    mode: 'committed',
    entries: insertedEntries,
    total_charges: totalCharges,
  };
}

module.exports = {
  calculateFinanceCharges,
  daysBetweenDates,
  financeChargeRate,
};
