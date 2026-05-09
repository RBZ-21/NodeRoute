const PDFDocument = require('pdfkit');

function money(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? parsed.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    : '$0.00';
}

function numberOr(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function buildPurchaseOrderPDF(order) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
    const buffers = [];
    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const poNumber = order.po_number || String(order.id || '').slice(0, 8).toUpperCase();
    const createdAt = order.created_at ? new Date(order.created_at).toLocaleString() : 'Unknown';
    const lineItems = Array.isArray(order.items) ? order.items : [];

    doc.font('Helvetica-Bold').fontSize(24).fillColor('#111827').text(`Purchase Order ${poNumber}`);
    doc.moveDown(0.6);
    doc.font('Helvetica').fontSize(11).fillColor('#374151');
    doc.text(`Vendor: ${order.vendor || 'Unspecified Vendor'}`);
    doc.text(`Confirmed By: ${order.confirmed_by || '-'}`);
    doc.text(`Created: ${createdAt}`);
    doc.text(`Total Cost: ${money(order.total_cost)}`);

    if (order.notes) {
      doc.moveDown(0.8);
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827').text('Notes');
      doc.font('Helvetica').fontSize(10).fillColor('#374151').text(String(order.notes));
    }

    let y = Math.max(doc.y + 18, 190);
    doc.rect(50, y, doc.page.width - 100, 20).fill('#f3f4f6');
    doc.fillColor('#111827').font('Helvetica-Bold').fontSize(9);
    doc.text('ITEM #', 58, y + 6, { width: 68 });
    doc.text('DESCRIPTION', 128, y + 6, { width: 180 });
    doc.text('UNIT', 310, y + 6, { width: 44 });
    doc.text('QTY', 358, y + 6, { width: 52, align: 'right' });
    doc.text('UNIT COST', 414, y + 6, { width: 66, align: 'right' });
    doc.text('LINE TOTAL', 484, y + 6, { width: 66, align: 'right' });
    y += 24;

    if (!lineItems.length) {
      doc.font('Helvetica').fontSize(10).fillColor('#6b7280').text('No line items were saved on this purchase order.', 58, y);
      y += 18;
    }

    lineItems.forEach((item, index) => {
      if (y > 720) {
        doc.addPage();
        y = 60;
      }

      const description = String(item?.description || '-');
      const lotLabel = item?.lot_number ? `Lot ${item.lot_number}` : '';
      const descriptionLabel = lotLabel ? `${description} (${lotLabel})` : description;

      if (index % 2 === 0) {
        doc.rect(50, y - 2, doc.page.width - 100, 20).fill('#fafafa');
      }

      doc.fillColor('#111827').font('Helvetica').fontSize(9);
      doc.text(String(item?.item_number || '-'), 58, y, { width: 68 });
      doc.text(descriptionLabel, 128, y, { width: 180 });
      doc.text(String(item?.unit || '-'), 310, y, { width: 44 });
      doc.text(numberOr(item?.quantity).toFixed(2), 358, y, { width: 52, align: 'right' });
      doc.text(money(item?.unit_price), 414, y, { width: 66, align: 'right' });
      doc.text(money(item?.total), 484, y, { width: 66, align: 'right' });
      y += 20;
    });

    doc.moveTo(50, y + 6).lineTo(doc.page.width - 50, y + 6).strokeColor('#d1d5db').stroke();
    y += 16;
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827').text(`Total Cost: ${money(order.total_cost)}`, 360, y, {
      width: 190,
      align: 'right',
    });

    doc.end();
  });
}

module.exports = {
  buildPurchaseOrderPDF,
};
