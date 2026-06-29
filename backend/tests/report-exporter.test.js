'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('report exporter CSV output includes headers and data rows', async () => {
  const exporter = require('../services/report-exporter');
  const rows = [
    { customer_name: 'Blue Fin Market', total_sales: 123.45 },
    { customer_name: 'Harbor Cafe', total_sales: 67.89 },
  ];
  const columns = [
    { key: 'customer_name', header: 'Customer' },
    { key: 'total_sales', header: 'Sales' },
  ];

  const buffer = exporter.toCSV(rows, columns);
  const csv = buffer.toString('utf8').trim();

  assert.ok(Buffer.isBuffer(buffer));
  assert.equal(csv.split('\n').length, 3);
  assert.equal(csv.split('\n')[0], 'Customer,Sales');
  assert.match(csv, /Blue Fin Market,123.45/);
});

test('report exporter PDF adapter returns a PDF buffer', async () => {
  const exporter = require('../services/report-exporter');
  const buffer = await exporter.toPDF(
    [{ invoice_number: 'INV-100', total: 100 }],
    [{ key: 'invoice_number', header: 'Invoice' }, { key: 'total', header: 'Total' }],
    'Invoice Register',
  );

  assert.ok(Buffer.isBuffer(buffer));
  assert.equal(buffer.subarray(0, 4).toString('utf8'), '%PDF');
});

test('report exporter Excel adapter writes the requested sheet name', async () => {
  const ExcelJS = require('exceljs');
  const exporter = require('../services/report-exporter');
  const buffer = await exporter.toExcel(
    [{ sku: 'A100', gross_profit: 42 }],
    [{ key: 'sku', header: 'SKU' }, { key: 'gross_profit', header: 'Gross Profit' }],
    'Gross Profit',
  );

  assert.ok(Buffer.isBuffer(buffer));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.ok(workbook.getWorksheet('Gross Profit'));
  assert.equal(workbook.getWorksheet('Gross Profit').rowCount, 2);
});
