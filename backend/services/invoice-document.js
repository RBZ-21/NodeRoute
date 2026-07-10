'use strict';

const { loadCompanySettings } = require('./company-settings');
const { scopeQueryByContext } = require('./operating-context');
const { supabase } = require('./supabase');

function text(value) {
  return String(value ?? '').trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstNumber(item, keys) {
  for (const key of keys) {
    const value = Number(item?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function normalizeInvoiceItem(item = {}) {
  const orderedQuantity = firstNumber(item, [
    'requested_qty',
    'ordered_qty',
    'requested_weight',
    'quantity',
    'qty',
  ]);
  const shippedQuantity = firstNumber(item, [
    'shipped_qty',
    'actual_weight',
    'quantity',
    'qty',
  ]);
  const unitPrice = firstNumber(item, [
    'unit_price',
    'unitPrice',
    'price_per_lb',
    'price',
  ]);
  const rawExtension = Number(item.total);

  return {
    itemNumber: text(item.item_number || item.itemNumber),
    orderedQuantity,
    shippedQuantity,
    uom: text(item.unit || item.uom),
    description: text(item.description || item.name),
    lotNumber: text(item.lot_number),
    unitPrice,
    extension: Number.isFinite(rawExtension)
      ? rawExtension
      : Number((shippedQuantity * unitPrice).toFixed(2)),
  };
}

function countInvoicePieces(items = []) {
  const weightUnits = new Set([
    'lb',
    'lbs',
    'pound',
    'pounds',
    'kg',
    'kgs',
    'kilogram',
    'kilograms',
    'oz',
    'ounce',
    'ounces',
  ]);

  return (Array.isArray(items) ? items : []).reduce((sum, item) => {
    const unit = text(item?.uom).toLowerCase();
    if (weightUnits.has(unit)) return sum;
    return sum + number(item?.shippedQuantity);
  }, 0);
}

function buildInvoiceDocument({
  invoice = {},
  companySettings = {},
  order = {},
  customer = {},
  stop = {},
  route = {},
  driver = {},
} = {}) {
  const items = (Array.isArray(invoice.items) ? invoice.items : []).map(normalizeInvoiceItem);
  const invoiceNumber = text(invoice.invoice_number)
    || text(invoice.id).slice(0, 8).toUpperCase();

  return {
    seller: {
      businessName: text(companySettings.businessName) || 'NodeRoute Systems',
      logoDataUrl: companySettings.invoiceLogoDataUrl || null,
      address: text(companySettings.invoiceAddress),
      phone: text(companySettings.invoicePhone),
      fax: text(companySettings.invoiceFax),
      afterHoursPhone: text(companySettings.invoiceAfterHoursPhone),
      remitTo: text(companySettings.invoiceRemitTo),
      salesTerms: text(companySettings.invoiceSalesTerms),
      creditTerms: text(companySettings.invoiceCreditTerms),
      copyLabel: text(companySettings.invoiceCopyLabel),
      safetyNotice: text(companySettings.invoiceSafetyNotice),
    },
    soldTo: {
      name: text(invoice.billing_name || invoice.customer_name),
      contact: text(invoice.billing_contact || customer.contact_name),
      address: text(invoice.billing_address || customer.billing_address || customer.address),
      phone: text(invoice.billing_phone || customer.billing_phone || customer.phone_number || customer.phone),
      email: text(invoice.billing_email || customer.billing_email || invoice.customer_email || customer.email),
    },
    shippedTo: {
      name: text(invoice.customer_name || order.customer_name),
      address: text(invoice.customer_address || order.customer_address || stop.address),
    },
    metadata: {
      invoiceNumber,
      customerNumber: text(customer.customer_number),
      salesperson: text(invoice.salesperson_name || order.salesperson_name),
      truckRoute: [text(driver.vehicle_id), text(route.name)].filter(Boolean).join(' / '),
      orderDate: order.created_at || invoice.created_at || null,
      deliveryDate: stop.scheduled_date || null,
      paymentTerms: text(customer.payment_terms || customer.credit_terms),
    },
    items,
    totals: {
      pieceCount: countInvoicePieces(items),
      subtotal: number(invoice.subtotal),
      tax: number(invoice.tax),
      total: number(invoice.total),
    },
    signature: {
      imageData: invoice.signature_data || null,
      signedAt: invoice.signed_at || null,
    },
    proofOfDelivery: {
      imageData: invoice.proof_of_delivery_image_data || null,
      uploadedAt: invoice.proof_of_delivery_uploaded_at || null,
    },
  };
}

function snapshotInvoiceDocument(document = {}) {
  return {
    ...document,
    seller: {
      ...(document.seller || {}),
      logoDataUrl: null,
    },
    signature: {
      ...(document.signature || {}),
      imageData: null,
    },
    proofOfDelivery: {
      ...(document.proofOfDelivery || {}),
      imageData: null,
    },
  };
}

function firstRow(result) {
  if (result?.error) throw result.error;
  if (Array.isArray(result?.data)) return result.data[0] || null;
  return result?.data || null;
}

async function loadInvoiceDocument(
  invoice,
  { db = supabase, loadSettings = loadCompanySettings } = {},
) {
  if (invoice?.document_snapshot && typeof invoice.document_snapshot === 'object') {
    return invoice.document_snapshot;
  }

  const context = {
    companyId: invoice?.company_id || null,
    locationId: invoice?.location_id || null,
  };
  if (!context.companyId) {
    const companySettings = await loadSettings(null, invoice?.company_name);
    return buildInvoiceDocument({ invoice, companySettings });
  }

  const invoiceResult = invoice?.id
    ? await scopeQueryByContext(db.from('invoices').select('*'), context)
      .eq('id', invoice.id)
      .limit(1)
    : null;
  const completeInvoice = firstRow(invoiceResult) || invoice;
  if (completeInvoice?.document_snapshot && typeof completeInvoice.document_snapshot === 'object') {
    return completeInvoice.document_snapshot;
  }

  const orderResult = completeInvoice?.order_id
    ? await scopeQueryByContext(db.from('orders').select('*'), context)
      .eq('id', completeInvoice.order_id)
      .limit(1)
    : null;
  const order = firstRow(orderResult);

  const customerId = completeInvoice?.customer_id || order?.customer_id;
  let customerResult = null;
  if (customerId !== null && customerId !== undefined && customerId !== '') {
    customerResult = await scopeQueryByContext(db.from('Customers').select('*'), context)
      .eq('id', customerId)
      .limit(1);
  } else if (completeInvoice?.customer_name) {
    customerResult = await scopeQueryByContext(db.from('Customers').select('*'), context)
      .eq('company_name', completeInvoice.customer_name)
      .limit(1);
  }
  const customer = firstRow(customerResult);

  const stopResult = order?.stop_id
    ? await scopeQueryByContext(db.from('stops').select('*'), context)
      .eq('id', order.stop_id)
      .limit(1)
    : null;
  const stop = firstRow(stopResult);

  const routeId = order?.route_id || stop?.route_id;
  const routeResult = routeId
    ? await scopeQueryByContext(db.from('routes').select('*'), context)
      .eq('id', routeId)
      .limit(1)
    : null;
  const route = firstRow(routeResult);

  const driverResult = route?.driver_id
    ? await scopeQueryByContext(db.from('users').select('*'), context)
      .eq('id', route.driver_id)
      .limit(1)
    : null;
  const driver = firstRow(driverResult);
  const companySettings = await loadSettings(
    completeInvoice.company_id,
    completeInvoice.company_name,
  );

  return buildInvoiceDocument({
    invoice: completeInvoice,
    companySettings,
    order,
    customer,
    stop,
    route,
    driver,
  });
}

module.exports = {
  buildInvoiceDocument,
  countInvoicePieces,
  loadInvoiceDocument,
  normalizeInvoiceItem,
  snapshotInvoiceDocument,
};
