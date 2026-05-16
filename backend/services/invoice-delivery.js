const OPEN_UNPAID_INVOICE_STATUSES = new Set(['pending', 'signed', 'sent', 'delivered', 'overdue']);

function normalizeInvoiceStatus(status) {
  return String(status || '').trim().toLowerCase();
}

function canonicalInvoiceStatus(status) {
  const normalized = normalizeInvoiceStatus(status);
  return normalized === 'canceled' ? 'cancelled' : normalized;
}

function statusAfterDeliveryCompletion(status) {
  const normalized = canonicalInvoiceStatus(status);
  if (!normalized) return 'delivered';
  if (normalized === 'paid' || normalized === 'void' || normalized === 'cancelled') return normalized;
  return 'delivered';
}

function statusAfterInvoiceEmail(status) {
  const normalized = canonicalInvoiceStatus(status);
  if (!normalized) return 'sent';
  if (normalized === 'signed') return 'sent';
  if (
    normalized === 'pending'
    || normalized === 'sent'
    || normalized === 'delivered'
    || normalized === 'paid'
    || normalized === 'overdue'
    || normalized === 'void'
    || normalized === 'cancelled'
  ) {
    return normalized;
  }
  return 'sent';
}

function normalizeNotesBlock(value) {
  const lines = String(value || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length ? lines.join('\n') : null;
}

function mergeInvoiceNotesWithDriverNotes(invoiceNotes, driverNotes) {
  const normalizedInvoiceNotes = normalizeNotesBlock(invoiceNotes);
  const normalizedDriverNotes = normalizeNotesBlock(driverNotes);
  const preservedLines = normalizedInvoiceNotes
    ? normalizedInvoiceNotes.split('\n').filter((line) => !/^driver notes:/i.test(line))
    : [];

  if (normalizedDriverNotes) {
    preservedLines.push(`Driver notes: ${normalizedDriverNotes.split('\n').join(' / ')}`);
  }

  return preservedLines.length ? preservedLines.join('\n') : null;
}

function extractOrderNumberFromStopNotes(stopNotes) {
  const match = String(stopNotes || '').match(/\border\s+([a-z0-9-]+)/i);
  return match ? match[1].trim() : null;
}

function isOpenUnpaidInvoiceStatus(status) {
  return OPEN_UNPAID_INVOICE_STATUSES.has(canonicalInvoiceStatus(status));
}

module.exports = {
  OPEN_UNPAID_INVOICE_STATUSES,
  canonicalInvoiceStatus,
  extractOrderNumberFromStopNotes,
  isOpenUnpaidInvoiceStatus,
  mergeInvoiceNotesWithDriverNotes,
  normalizeInvoiceStatus,
  statusAfterDeliveryCompletion,
  statusAfterInvoiceEmail,
};
