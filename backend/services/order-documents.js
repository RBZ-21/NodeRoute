'use strict';

const PDFDocument = require('pdfkit');

function normalizeText(value) {
  return String(value ?? '').trim();
}

function quantityLabel(item) {
  const quantity = item?.quantity ?? item?.qty ?? item?.requested_qty ?? item?.requestedWeight ?? item?.requested_weight ?? '';
  const unit = item?.unit || (item?.is_catch_weight ? 'lb' : '');
  return [quantity, unit].filter((part) => normalizeText(part)).join(' ');
}

function itemName(item) {
  return normalizeText(item?.name || item?.description || item?.item_number || item?.product_id || 'Item');
}

function instructionText(item) {
  const instructions = Array.isArray(item?.instructions) ? item.instructions : [];
  return instructions
    .map((instruction) => normalizeText(instruction?.instruction || instruction?.message || instruction))
    .filter(Boolean)
    .join('; ');
}

function collectOrders(primaryOrder, orders) {
  if (Array.isArray(orders) && orders.length) return orders;
  return primaryOrder ? [primaryOrder] : [];
}

function writeHeader(doc, title, subtitle) {
  doc.font('Helvetica-Bold').fontSize(20).fillColor('#111111').text(title);
  if (subtitle) {
    doc.moveDown(0.3).font('Helvetica').fontSize(10).fillColor('#555555').text(subtitle);
  }
  doc.moveDown(1);
}

function ensureRoom(doc, y, min = 72) {
  if (y < doc.page.height - min) return y;
  doc.addPage();
  return doc.y;
}

function writeOrderSummary(doc, order) {
  const orderNumber = normalizeText(order?.order_number || order?.id || 'Draft');
  const customer = normalizeText(order?.customer_name || 'No customer');
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#111111').text(`${orderNumber} - ${customer}`);
  if (order?.customer_address) {
    doc.font('Helvetica').fontSize(9).fillColor('#555555').text(normalizeText(order.customer_address));
  }
  doc.moveDown(0.5);
}

function writeItems(doc, items, options = {}) {
  if (!Array.isArray(items) || !items.length) {
    doc.font('Helvetica').fontSize(10).fillColor('#555555').text('No line items.');
    doc.moveDown();
    return;
  }

  const includeLot = options.includeLot !== false;
  const includeLocation = options.includeLocation !== false;
  const includeInstructions = options.includeInstructions !== false;

  items.forEach((item, index) => {
    ensureRoom(doc, doc.y, 84);
    const prefix = options.numbered ? `${index + 1}. ` : '';
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#111111').text(`${prefix}${itemName(item)}`);
    doc.font('Helvetica').fontSize(9).fillColor('#333333')
      .text(`Item #: ${normalizeText(item.item_number || '-')}`)
      .text(`Qty: ${quantityLabel(item) || '-'}`);
    if (includeLot) doc.text(`Lot: ${normalizeText(item.lot_number || item.lot || '-')}`);
    if (includeLocation) doc.text(`Warehouse location: ${normalizeText(item.location || item.bin_location || item.warehouse_location || '-')}`);
    const instructions = instructionText(item);
    if (includeInstructions && instructions) doc.text(`Instructions: ${instructions}`);
    doc.moveDown(0.4);
  });
}

function routeStopOrder(stops = []) {
  return [...stops].sort((a, b) => {
    const aSeq = Number(a?.sequence ?? a?.stop_sequence ?? 0);
    const bSeq = Number(b?.sequence ?? b?.stop_sequence ?? 0);
    if (aSeq !== bSeq) return aSeq - bSeq;
    return String(a?.id || '').localeCompare(String(b?.id || ''));
  });
}

function buildSections({ title, route, order, orders, stops, generatedAt }) {
  const allOrders = collectOrders(order, orders);
  const orderedStops = routeStopOrder(stops);
  const routeName = normalizeText(route?.name || route?.id || '');
  const subtitle = [
    routeName ? `Route: ${routeName}` : null,
    generatedAt ? `Generated: ${generatedAt}` : null,
  ].filter(Boolean).join(' | ');

  return { allOrders, orderedStops, subtitle, title };
}

async function buildOrderDocumentPDF({ title, route = null, order = null, orders = [], stops = [] }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: 'LETTER', compress: false });
    doc.info.Title = title;
    doc.info.Subject = title;
    const buffers = [];
    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const { allOrders, orderedStops, subtitle } = buildSections({
      title,
      route,
      order,
      orders,
      stops,
      generatedAt: new Date().toLocaleString(),
    });

    writeHeader(doc, title, subtitle);

    if (title === 'LOADING SHEET') {
      allOrders.forEach((currentOrder) => {
        writeOrderSummary(doc, currentOrder);
        writeItems(doc, currentOrder.items || [], { includeInstructions: true });
      });
    } else if (title === 'CUT LIST') {
      allOrders.forEach((currentOrder) => {
        const cutItems = (currentOrder.items || []).filter((item) => instructionText(item) || /cut|portion|trim/i.test(normalizeText(item.notes)));
        writeOrderSummary(doc, currentOrder);
        writeItems(doc, cutItems.length ? cutItems : currentOrder.items || [], { includeLocation: false });
      });
    } else if (title === 'PICK LIST') {
      allOrders.forEach((currentOrder) => {
        writeOrderSummary(doc, currentOrder);
        writeItems(doc, currentOrder.items || [], { includeInstructions: false });
      });
    } else if (title === 'PULL SHEET') {
      if (orderedStops.length) {
        orderedStops.forEach((stop) => {
          ensureRoom(doc, doc.y, 72);
          doc.font('Helvetica-Bold').fontSize(11).fillColor('#111111')
            .text(`#${stop.sequence ?? '-'} ${normalizeText(stop.customer_name || stop.name || 'Stop')}`);
          doc.font('Helvetica').fontSize(9).fillColor('#555555').text(normalizeText(stop.address || '-'));
          const stopOrder = allOrders.find((candidate) => String(candidate.id) === String(stop.order_id));
          if (stopOrder) writeItems(doc, stopOrder.items || [], { includeInstructions: false });
          else doc.moveDown(0.5);
        });
      } else {
        allOrders.forEach((currentOrder) => {
          writeOrderSummary(doc, currentOrder);
          writeItems(doc, currentOrder.items || [], { includeInstructions: false });
        });
      }
    } else if (title === 'PICKING LABELS') {
      allOrders.forEach((currentOrder) => {
        (currentOrder.items || []).forEach((item) => {
          ensureRoom(doc, doc.y, 96);
          doc.roundedRect(doc.x, doc.y, doc.page.width - doc.x * 2, 74, 4).stroke('#999999');
          const x = doc.x + 10;
          const y = doc.y + 10;
          doc.font('Helvetica-Bold').fontSize(12).fillColor('#111111').text(itemName(item), x, y);
          doc.font('Helvetica').fontSize(9).fillColor('#333333')
            .text(`Customer: ${normalizeText(currentOrder.customer_name || '-')}`, x, y + 18)
            .text(`Item #: ${normalizeText(item.item_number || '-')}`, x, y + 32)
            .text(`Qty: ${quantityLabel(item) || '-'} | Lot: ${normalizeText(item.lot_number || '-')}`, x, y + 46);
          doc.y = y + 80;
        });
      });
    } else {
      allOrders.forEach((currentOrder) => {
        writeOrderSummary(doc, currentOrder);
        writeItems(doc, currentOrder.items || []);
      });
    }

    doc.end();
  });
}

module.exports = {
  buildOrderDocumentPDF,
  instructionText,
};
