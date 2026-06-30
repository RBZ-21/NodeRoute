'use strict';

// Keep in sync with frontend-v2/src/lib/nav.ts NAV_ITEM_IDS.
// The backend cannot import that TypeScript/React module at runtime.
const NAV_ITEM_IDS = Object.freeze({
  dashboard: 'dashboard',
  dashboardBuilder: 'dashboard-builder',
  orders: 'orders',
  routes: 'routes',
  map: 'map',
  inventory: 'inventory',
  kits: 'kits',
  purchasing: 'purchasing',
  warehouse: 'warehouse',
  traceability: 'traceability',
  customers: 'customers',
  vendors: 'vendors',
  salesRep: 'sales-rep',
  phoneOrders: 'phone-orders',
  financials: 'financials',
  pricing: 'pricing',
  invoices: 'invoices',
  creditHold: 'credit-hold',
  analytics: 'analytics',
  dsr: 'dsr',
  forecasting: 'forecasting',
  reports: 'reports',
  aiHelp: 'ai-help',
  users: 'users',
  companies: 'companies',
  settings: 'settings',
  integrations: 'integrations',
  compliance: 'compliance',
  planning: 'planning',
  auditLog: 'audit-log',
});

const NAV_ITEM_ID_SET = new Set(Object.values(NAV_ITEM_IDS));

function isKnownNavItemId(value) {
  return NAV_ITEM_ID_SET.has(String(value || ''));
}

module.exports = {
  NAV_ITEM_IDS,
  NAV_ITEM_ID_SET,
  isKnownNavItemId,
};
