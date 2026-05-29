function normalizeText(value) {
  return String(value ?? '').trim();
}

function asNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sanitizeInvoiceLotEntry(entry = {}) {
  const lotNumber = normalizeText(entry.lot_number);
  if (!lotNumber) return null;

  const itemNumber = normalizeText(entry.item_number) || undefined;
  const description = normalizeText(entry.description) || undefined;
  const qty = entry.qty != null && `${entry.qty}` !== '' ? asNumber(entry.qty) : undefined;
  const weight = entry.weight != null && `${entry.weight}` !== '' ? asNumber(entry.weight) : undefined;

  return {
    item_number: itemNumber,
    description,
    lot_number: lotNumber,
    qty,
    weight,
  };
}

function invoiceLotEntriesFromItems(items = []) {
  // Order and PO scan flows now pass lot_number through item payloads; derive invoice lot rows from those items.
  const sourceItems = Array.isArray(items) ? items : [];
  const entries = [];

  for (const item of sourceItems) {
    const lotNumber = normalizeText(item?.lot_number);
    if (!lotNumber) continue;

    const unit = normalizeText(item?.unit).toLowerCase();
    const isWeightManaged = unit === 'lb' || !!item?.is_catch_weight;
    const weight = isWeightManaged
      ? (
          item?.quantity_from_lot
          ?? item?.actual_weight
          ?? item?.requested_weight
          ?? item?.quantity
        )
      : undefined;
    const qty = isWeightManaged
      ? (
          item?.requested_qty
          ?? item?.count
          ?? item?.cases
        )
      : (
          item?.quantity_from_lot
          ?? item?.requested_qty
          ?? item?.quantity
        );

    const entry = sanitizeInvoiceLotEntry({
      item_number: item?.item_number,
      description: item?.description || item?.name,
      lot_number: lotNumber,
      qty,
      weight,
    });

    if (entry) entries.push(entry);
  }

  return entries;
}

function dedupeInvoiceLots(entries = []) {
  const deduped = [];
  const seen = new Set();

  for (const raw of entries) {
    const entry = sanitizeInvoiceLotEntry(raw);
    if (!entry) continue;
    const key = [
      entry.item_number || '',
      entry.description || '',
      entry.lot_number,
      entry.qty ?? '',
      entry.weight ?? '',
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry);
  }

  return deduped;
}

function normalizeInvoiceLots(invoice = {}) {
  const explicitLots = Array.isArray(invoice?.lot_numbers) ? invoice.lot_numbers : [];
  const derivedLots = invoiceLotEntriesFromItems(invoice?.items);
  return dedupeInvoiceLots([...explicitLots, ...derivedLots]);
}

function invoiceLotSummaryLines(invoice = {}) {
  return normalizeInvoiceLots(invoice).map((lot) => {
    const summaryBits = [];
    if (lot.item_number) summaryBits.push(lot.item_number);
    if (lot.description) summaryBits.push(lot.description);
    summaryBits.push(`Lot ${lot.lot_number}`);
    if (lot.qty != null && lot.qty > 0) summaryBits.push(`Qty ${lot.qty}`);
    if (lot.weight != null && lot.weight > 0) summaryBits.push(`${lot.weight} lbs`);
    return summaryBits.join(' · ');
  });
}

module.exports = {
  invoiceLotEntriesFromItems,
  normalizeInvoiceLots,
  invoiceLotSummaryLines,
};
