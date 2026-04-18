const PDFDocument = require('pdfkit');

// ── PDF BUILDER ───────────────────────────────────────────────────────────────
function buildInvoicePDF(inv) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
    const buffers = [];
    doc.on('data', d => buffers.push(d));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const ACCENT = '#ff6b35';
    const MUTED  = '#666666';
    const signedAt = inv.signed_at ? new Date(inv.signed_at).toLocaleString() : new Date().toLocaleString();
    const invNum = inv.invoice_number || inv.id.slice(0,8).toUpperCase();

    // Header bar
    doc.rect(0, 0, doc.page.width, 80).fill(ACCENT);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(22).text('NodeRoute Systems', 50, 25);
    doc.fillColor('#ffffff').font('Helvetica').fontSize(11).text('noderoutesystems.com', 50, 52);

    // Invoice title
    doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(18).text(`INVOICE #${invNum}`, 350, 25, { align: 'right', width: 200 });
    doc.fillColor(MUTED).font('Helvetica').fontSize(10).text(`Date: ${signedAt}`, 350, 52, { align: 'right', width: 200 });

    let y = 110;

    // Bill To
    doc.fillColor('#111').font('Helvetica-Bold').fontSize(11).text('BILL TO', 50, y);
    y += 16;
    doc.fillColor('#333').font('Helvetica').fontSize(11).text(inv.customer_name, 50, y);
    y += 14;
    if (inv.customer_address) { doc.text(inv.customer_address, 50, y); y += 14; }
    if (inv.customer_email)   { doc.fillColor(ACCENT).text(inv.customer_email, 50, y); y += 14; }
    if (inv.driver_name) {
      doc.fillColor(MUTED).fontSize(10).text(`Driver: ${inv.driver_name}`, 50, y); y += 14;
    }

    y += 16;

    // Items table header
    doc.rect(50, y, doc.page.width - 100, 22).fill('#f0f0f0');
    doc.fillColor('#111').font('Helvetica-Bold').fontSize(10);
    doc.text('DESCRIPTION', 58, y + 6);
    doc.text('QTY',         330, y + 6, { width: 50,  align: 'right' });
    doc.text('UNIT PRICE',  388, y + 6, { width: 80,  align: 'right' });
    doc.text('TOTAL',       476, y + 6, { width: 74,  align: 'right' });
    y += 24;

    // Items rows
    const items = inv.items || [];
    items.forEach((item, i) => {
      if (i % 2 === 0) doc.rect(50, y - 2, doc.page.width - 100, 20).fill('#fafafa');
      doc.fillColor('#222').font('Helvetica').fontSize(10);
      doc.text(item.description || '', 58, y, { width: 268 });
      doc.text(String(item.quantity || ''), 330, y, { width: 50, align: 'right' });
      doc.text(`$${parseFloat(item.unit_price||0).toFixed(2)}`, 388, y, { width: 80, align: 'right' });
      doc.text(`$${parseFloat(item.total||0).toFixed(2)}`,      476, y, { width: 74, align: 'right' });
      y += 20;
    });

    y += 10;
    // Divider
    doc.moveTo(50, y).lineTo(doc.page.width - 50, y).strokeColor('#dddddd').stroke();
    y += 10;

    // Totals
    const totalsX = 380;
    doc.fillColor(MUTED).font('Helvetica').fontSize(10).text('Subtotal:', totalsX, y, { width: 90, align: 'right' });
    doc.fillColor('#222').text(`$${parseFloat(inv.subtotal||0).toFixed(2)}`, 476, y, { width: 74, align: 'right' });
    y += 16;
    doc.fillColor(MUTED).text('Tax:', totalsX, y, { width: 90, align: 'right' });
    doc.fillColor('#222').text(`$${parseFloat(inv.tax||0).toFixed(2)}`, 476, y, { width: 74, align: 'right' });
    y += 16;
    doc.rect(totalsX - 10, y - 4, 160, 24).fill(ACCENT);
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(12).text('TOTAL:', totalsX, y + 2, { width: 90, align: 'right' });
    doc.text(`$${parseFloat(inv.total||0).toFixed(2)}`, 476, y + 2, { width: 74, align: 'right' });
    y += 40;

    // Signature
    if (inv.signature_data) {
      doc.moveTo(50, y).lineTo(doc.page.width - 50, y).strokeColor('#dddddd').stroke();
      y += 14;
      doc.fillColor('#111').font('Helvetica-Bold').fontSize(10).text('CUSTOMER SIGNATURE', 50, y);
      y += 12;
      try {
        const sigData = inv.signature_data.replace(/^data:image\/\w+;base64,/, '');
        doc.image(Buffer.from(sigData, 'base64'), 50, y, { width: 200, height: 80 });
      } catch(e) {}
      doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(`Signed electronically on ${signedAt}`, 50, y + 86);
    }

    if (inv.notes) {
      y += 110;
      doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(`Notes: ${inv.notes}`, 50, y);
    }

    doc.end();
  });
}

module.exports = { buildInvoicePDF };
