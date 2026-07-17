'use strict';

const PDFDocument = require('pdfkit');
const { loadCompanySettings } = require('./company-settings');
const { loadInvoiceDocument } = require('./invoice-document');

const CUSTOMER_INVOICE_NOTE = 'Please contact the office if you have any questions.';
const ACCENT = '#ff6b35';
const INK = '#172033';
const MUTED = '#64748b';
const RULE = '#cbd5e1';
const PAPER = '#f8fafc';

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function money(value) {
  const amount = Number(value);
  return `$${(Number.isFinite(amount) ? amount : 0).toFixed(2)}`;
}

function quantity(value) {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? amount.toLocaleString('en-US', { maximumFractionDigits: 3 })
    : '-';
}

function formatInvoiceDate(value) {
  if (!value) return '-';
  const raw = String(value).trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const parsed = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);
  if (Number.isNaN(parsed.getTime())) return text(value, '-');
  return parsed.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function imageBuffer(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const encoded = dataUrl.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
  try {
    return Buffer.from(encoded, 'base64');
  } catch {
    return null;
  }
}

function drawLabel(doc, label, value, x, y, width, height = 44) {
  doc.rect(x, y, width, height).lineWidth(0.5).strokeColor(RULE).stroke();
  doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(6.5).text(label, x + 5, y + 5, {
    width: width - 10,
    characterSpacing: 0.3,
  });
  doc.fillColor(INK).font('Helvetica').fontSize(8).text(text(value, '-'), x + 5, y + 16, {
    width: width - 10,
    height: height - 19,
    ellipsis: true,
  });
}

function drawAddressBlock(doc, label, lines, x, y, width, height) {
  doc.fillColor(INK).rect(x, y, width, 18).fill();
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7).text(label, x + 6, y + 6, {
    width: width - 12,
    characterSpacing: 0.5,
  });
  doc.rect(x, y + 18, width, height - 18).lineWidth(0.5).strokeColor(RULE).stroke();
  doc.fillColor(INK).font('Helvetica').fontSize(8).text(
    lines.map((line) => text(line)).filter(Boolean).join('\n') || '-',
    x + 7,
    y + 25,
    { width: width - 14, height: height - 30, ellipsis: true, lineGap: 2 },
  );
}

function drawDocumentHeader(doc, document, continuation = false) {
  const seller = document.seller || {};
  const metadata = document.metadata || {};
  const left = 36;
  const right = doc.page.width - 36;
  const width = right - left;

  doc.rect(left, 30, width, 5).fill(ACCENT);
  const logo = imageBuffer(seller.logoDataUrl);
  let sellerX = left;
  if (logo) {
    try {
      doc.image(logo, left, 45, { fit: [76, 42], align: 'left', valign: 'center' });
      sellerX += 86;
    } catch {
      sellerX = left;
    }
  }
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(continuation ? 14 : 15).text(
    text(seller.businessName, 'NodeRoute Systems'),
    sellerX,
    46,
    { width: 245 - (sellerX - left), height: 42, ellipsis: true },
  );

  const contactLines = [
    seller.phone && `Phone ${seller.phone}`,
    seller.fax && `Fax ${seller.fax}`,
    seller.afterHoursPhone && `After Hours ${seller.afterHoursPhone}`,
  ].filter(Boolean);
  doc.fillColor(MUTED).font('Helvetica').fontSize(7.5).text(contactLines.join('\n'), 285, 45, {
    width: 120,
    align: 'right',
    lineGap: 2,
  });

  doc.fillColor(INK).rect(420, 43, 156, 46).fill();
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(15).text(
    continuation ? 'INVOICE (CONT.)' : 'INVOICE',
    428,
    50,
    { width: 140, align: 'right' },
  );
  doc.fillColor('#ffffff').font('Helvetica').fontSize(8).text(
    `# ${text(metadata.invoiceNumber, '-')}`,
    428,
    71,
    { width: 140, align: 'right' },
  );
  return 100;
}

function drawItemsHeader(doc, y) {
  const columns = [
    ['ITEM NO.', 54, 'left'],
    ['ORDERED', 46, 'right'],
    ['SHIPPED', 46, 'right'],
    ['UOM', 38, 'center'],
    ['DESCRIPTION', 150, 'left'],
    ['LOT NO.', 62, 'left'],
    ['UNIT PRICE', 68, 'right'],
    ['EXTENSION', 76, 'right'],
  ];
  let x = 36;
  doc.fillColor(INK).rect(x, y, 540, 23).fill();
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(6.5);
  for (const [label, width, align] of columns) {
    doc.text(label, x + 4, y + 8, { width: width - 8, align });
    x += width;
  }
  return y + 23;
}

function drawItems(doc, document, startY) {
  const items = Array.isArray(document.items) ? document.items : [];
  let y = drawItemsHeader(doc, startY);
  const widths = [54, 46, 46, 38, 150, 62, 68, 76];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index] || {};
    if (y > 708) {
      doc.addPage();
      drawDocumentHeader(doc, document, true);
      y = drawItemsHeader(doc, 108);
    }
    const values = [
      text(item.itemNumber, '-'),
      quantity(item.orderedQuantity),
      quantity(item.shippedQuantity),
      text(item.uom, '-'),
      text(item.description, '-'),
      text(item.lotNumber, '-'),
      money(item.unitPrice),
      money(item.extension),
    ];
    const aligns = ['left', 'right', 'right', 'center', 'left', 'left', 'right', 'right'];
    const rowHeight = Math.max(23, doc.heightOfString(values[4], { width: 142, fontSize: 7.5 }) + 10);
    if (index % 2 === 0) doc.fillColor(PAPER).rect(36, y, 540, rowHeight).fill();
    doc.strokeColor(RULE).lineWidth(0.35).moveTo(36, y + rowHeight).lineTo(576, y + rowHeight).stroke();
    let x = 36;
    doc.fillColor(INK).font('Helvetica').fontSize(7.5);
    values.forEach((value, valueIndex) => {
      doc.text(value, x + 4, y + 7, {
        width: widths[valueIndex] - 8,
        height: rowHeight - 9,
        align: aligns[valueIndex],
        ellipsis: true,
      });
      x += widths[valueIndex];
    });
    y += rowHeight;
  }

  if (!items.length) {
    doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(8).text('No line items', 42, y + 9);
    y += 30;
  }
  return y;
}

function ensureSpace(doc, document, y, height) {
  if (y + height <= 748) return y;
  doc.addPage();
  drawDocumentHeader(doc, document, true);
  return 108;
}

function drawSummary(doc, document, inv, y) {
  const totals = document.totals || {};
  y = ensureSpace(doc, document, y + 12, 112);

  doc.fillColor(INK).rect(36, y, 112, 22).fill();
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7).text('NUMBER OF PCS.', 42, y + 8, { width: 100 });
  doc.rect(36, y + 22, 112, 42).lineWidth(0.5).strokeColor(RULE).stroke();
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(15).text(quantity(totals.pieceCount), 42, y + 35, {
    width: 100,
    align: 'center',
  });

  doc.fillColor(INK).rect(158, y, 216, 22).fill();
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7).text("CUSTOMER'S SIGNATURE", 164, y + 8, { width: 204 });
  doc.rect(158, y + 22, 216, 42).lineWidth(0.5).strokeColor(RULE).stroke();
  const signature = imageBuffer(inv?.signature_data || document.signature?.imageData);
  if (signature) {
    try {
      doc.image(signature, 166, y + 26, { fit: [150, 32], align: 'left', valign: 'center' });
    } catch {
      // A malformed optional signature must not prevent the invoice from rendering.
    }
  }
  if (document.signature?.signedAt) {
    doc.fillColor(MUTED).font('Helvetica').fontSize(6).text(formatInvoiceDate(document.signature.signedAt), 316, y + 49, {
      width: 50,
      align: 'right',
    });
  }

  doc.fillColor(INK).rect(384, y, 192, 22).fill();
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7).text('INVOICE TOTAL', 390, y + 8, { width: 180 });
  doc.rect(384, y + 22, 192, 42).lineWidth(0.5).strokeColor(RULE).stroke();
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(15).text(money(totals.total), 390, y + 35, {
    width: 180,
    align: 'right',
  });

  doc.fillColor(MUTED).font('Helvetica').fontSize(7.5);
  doc.text(`Subtotal ${money(totals.subtotal)}`, 384, y + 72, { width: 192, align: 'right' });
  doc.text(`Tax ${money(totals.tax)}`, 384, y + 84, { width: 192, align: 'right' });
  return y + 104;
}

function drawTerms(doc, document, startY) {
  const seller = document.seller || {};
  let y = ensureSpace(doc, document, startY + 8, 122);
  const width = 264;
  const terms = [
    ['SALES TERMS', seller.salesTerms],
    ['CREDIT TERMS', seller.creditTerms],
  ];

  terms.forEach(([label, value], index) => {
    const x = 36 + (index * 276);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(7).text(label, x, y, { width });
    doc.fillColor(MUTED).font('Helvetica').fontSize(6.3).text(text(value, CUSTOMER_INVOICE_NOTE), x, y + 13, {
      width,
      height: 73,
      lineGap: 1.5,
      ellipsis: true,
    });
  });

  const footerY = y + 92;
  doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(8).text(text(seller.copyLabel, 'CUSTOMER COPY'), 36, footerY, {
    width: 540,
    align: 'center',
  });
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(8).text(text(seller.safetyNotice), 36, footerY + 15, {
    width: 540,
    align: 'center',
  });
  doc.fillColor(MUTED).font('Helvetica').fontSize(6.5).text(CUSTOMER_INVOICE_NOTE, 36, footerY + 30, {
    width: 540,
    align: 'center',
  });
  return footerY + 40;
}

function drawProofOfDelivery(doc, document, inv) {
  const proof = imageBuffer(inv?.proof_of_delivery_image_data || document.proofOfDelivery?.imageData);
  if (!proof) return;
  doc.addPage();
  drawDocumentHeader(doc, document, true);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(10).text('PROOF OF DELIVERY', 36, 112);
  try {
    doc.image(proof, 36, 134, { fit: [540, 520], align: 'center', valign: 'top' });
  } catch {
    doc.fillColor(MUTED).font('Helvetica').fontSize(8).text('Proof-of-delivery image could not be displayed.', 36, 134);
  }
  if (document.proofOfDelivery?.uploadedAt) {
    doc.fillColor(MUTED).font('Helvetica').fontSize(7).text(
      `Uploaded ${formatInvoiceDate(document.proofOfDelivery.uploadedAt)}`,
      36,
      670,
    );
  }
}

async function buildInvoicePDF(inv = {}, suppliedDocument = null) {
  let document = suppliedDocument || await loadInvoiceDocument(inv);
  if (!document?.seller?.logoDataUrl && inv.company_id) {
    const currentSettings = await loadCompanySettings(inv.company_id, document?.seller?.businessName);
    document = {
      ...document,
      seller: {
        ...(document.seller || {}),
        logoDataUrl: currentSettings.invoiceLogoDataUrl || null,
      },
    };
  }
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 36, size: 'LETTER', bufferPages: true });
    const buffers = [];
    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const headerBottom = drawDocumentHeader(doc, document);
    const soldTo = document.soldTo || {};
    const shippedTo = document.shippedTo || {};
    const seller = document.seller || {};
    const metadata = document.metadata || {};

    drawAddressBlock(doc, 'SOLD TO', [soldTo.name, soldTo.contact, soldTo.address, soldTo.phone, soldTo.email], 36, headerBottom, 172, 82);
    drawAddressBlock(doc, 'SHIPPED TO', [shippedTo.name, shippedTo.address], 220, headerBottom, 172, 82);
    drawAddressBlock(doc, 'PLEASE REMIT TO', [seller.businessName, seller.remitTo || seller.address], 404, headerBottom, 172, 82);

    const metadataColumns = [
      ['CUSTOMER #', metadata.customerNumber, 67],
      ['SALESPERSON', metadata.salesperson, 82],
      ['TRUCK / ROUTE', metadata.truckRoute, 82],
      ['ORDER DATE', formatInvoiceDate(metadata.orderDate), 77],
      ['DELIVERY DATE', formatInvoiceDate(metadata.deliveryDate), 77],
      ['TERMS', metadata.paymentTerms, 69],
      ['INVOICE #', metadata.invoiceNumber, 86],
    ];
    let metadataX = 36;
    metadataColumns.forEach(([label, value, width]) => {
      drawLabel(doc, label, value, metadataX, 194, width, 43);
      metadataX += width;
    });

    let y = drawItems(doc, document, 247);
    y = drawSummary(doc, document, inv, y);
    drawTerms(doc, document, y);
    drawProofOfDelivery(doc, document, inv);
    doc.end();
  });
}

module.exports = { buildInvoicePDF, CUSTOMER_INVOICE_NOTE, formatInvoiceDate };
