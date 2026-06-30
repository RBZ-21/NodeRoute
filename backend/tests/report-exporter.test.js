'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function makeDb(tables) {
  return {
    from(tableName) {
      let rows = [...(tables[tableName] || [])];
      const query = {
        select() {
          return query;
        },
        limit() {
          return query;
        },
        eq(field, value) {
          rows = rows.filter((row) => String(row[field]) === String(value));
          return query;
        },
        then(resolve, reject) {
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

test('report exporter dispatches only canonical known report keys', async () => {
  const exporter = require('../services/report-exporter');
  const db = makeDb({
    invoices: [{
      id: 'invoice-report-1',
      company_id: 'company-report-a',
      invoice_number: 'INV-100',
      customer_name: 'Blue Fin Market',
      total: 125,
      open_balance: 25,
      status: 'sent',
      created_at: '2026-06-29T00:00:00.000Z',
    }],
  });

  const report = await exporter.runNamedReport('invoiceRegisterReport', 'company-report-a', {}, { db });

  assert.equal(report.query_key, 'invoice_register');
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].invoice_number, 'INV-100');
});

test('report exporter rejects prototype and arbitrary query keys before dispatch', async () => {
  const exporter = require('../services/report-exporter');

  await assert.rejects(
    () => exporter.runNamedReport('__proto__', 'company-report-a'),
    (error) => error.status === 400 && /unknown report query key/i.test(error.message),
  );
  await assert.rejects(
    () => exporter.runNamedReport('toString', 'company-report-a'),
    (error) => error.status === 400 && /unknown report query key/i.test(error.message),
  );
});

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
