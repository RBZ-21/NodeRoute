const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '../../data');
const opsFile = path.join(dataDir, 'ops.json');

function defaultOpsData() {
  return {
    uomRules: [],
    warehouses: [{ id: 'wh-main', name: 'Main Warehouse', code: 'MAIN', isDefault: true, created_at: new Date().toISOString() }],
    cycleCounts: [],
    returns: [],
    barcodeEvents: [],
    ediJobs: [],
    vendors: [],
    poDrafts: [],
    vendorPurchaseOrders: [],
  };
}

function readOpsData() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(opsFile)) fs.writeFileSync(opsFile, JSON.stringify(defaultOpsData(), null, 2));
  try {
    const parsed = JSON.parse(fs.readFileSync(opsFile, 'utf8'));
    return { ...defaultOpsData(), ...parsed };
  } catch {
    return defaultOpsData();
  }
}

function writeOpsData(data) {
  fs.writeFileSync(opsFile, JSON.stringify(data, null, 2));
}

function genId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toNumber(value, fallback = 0) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

module.exports = {
  defaultOpsData,
  genId,
  readOpsData,
  toNumber,
  writeOpsData,
};
