'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// AI CHAT / CONVERSATION
//
// Extracted from services/ai.js. This module owns the chat assistant surface:
// the operations chat reply (with and without live DB context), the offline
// heuristic reply, and the per-user chat rate limiter, plus the prompt and
// knowledge-base constants those functions use exclusively.
//
// Low-level helpers that are shared across many AI features (getClient,
// extractMessageContent, DEFAULT_MODEL, and the numeric/string coercers) stay
// in services/ai.js and are required lazily below to avoid a load-time cycle
// (ai.js requires this module at the bottom of its own load).
// ─────────────────────────────────────────────────────────────────────────────

const CHAT_SYSTEM_PROMPT = `You are a knowledgeable operations assistant for NodeRoute, a food wholesale distribution and delivery management platform. You are helping {name} (role: {role}).

You help users navigate the platform, understand features, troubleshoot issues, and optimize their workflows.

Chat rules:
1. Use live account data when it is provided. Lead with concrete findings from that data instead of generic product copy.
2. If the user asks for status, today, list, summary, risk, or what needs attention, summarize the relevant live data first.
3. If matching entities are provided (customers, products, vendors, routes, orders, invoices), mention them by name when relevant.
4. If the live data is incomplete, say what you could verify and what you could not verify. Do not pretend you checked something that is not in context.
5. Only tell the user where to click after you have already answered the question as directly as possible.
6. Keep answers concise, practical, and operational. Avoid filler and avoid generic "open this page" answers when live data exists.

{knowledge}`;

const NODEROUTE_KNOWLEDGE = `## NodeRoute Platform Overview

**Navigation:** The platform is organized into groups: Core (Dashboard, Orders, Settings), Logistics (Deliveries, Live Map, Drivers, Routes, Stops), People (Customers, Users), Financials (Financial Overview, Invoices, Analytics, Inventory, Forecasting), Operations (Purchasing, FSMA Traceability, Vendors, Warehouse, Planning & Rules, Integrations), and AI Help.

**Orders:** Create and manage customer orders. Each order line can specify a product, quantity, unit, and price. For FTL (Food Traceability List) products, a lot number must be assigned. Orders have statuses: pending, confirmed, in_transit, delivered, cancelled.

**FSMA Traceability (admin only):** Tracks Food Traceability List products through the supply chain per FDA Section 204. Use the Lot Trace panel to look up a specific lot number and see which orders and delivery stops it went to. Use the Movements Report for paginated lot history with CSV export. Lot numbers are assigned during purchasing receiving or manually.

**Inventory:** View all products (seafood/food items) with stock levels, categories, costs, and FTL flags. FTL toggle marks items as Food Traceability List products — these require lot assignment on orders. Use AI Health Analysis for reorder and expiry alerts.

**Purchasing:** Manage vendor purchase orders. Draft POs come from Planning suggestions. Convert drafts to Vendor POs, then receive line items to update inventory. When receiving FTL items, enter a lot number to auto-create a lot_codes record.

**Planning & Rules:** Generate draft purchase orders from demand projections. Set lead time and coverage days, then recalculate. Create Draft PO button outputs a draft to Purchasing.

**Warehouse:** Manage internal storage locations (coolers, freezers, depots). Log scan/receive/pick/adjust events. Track customer returns.

**Analytics:** Unified Performance Rollups for customer, route, driver, and SKU performance. Set date range and row limit, then run the report.

**Drivers:** Manage driver accounts. Drivers log into /driver for a simplified mobile view showing their assigned stops.

**Routes and Stops:** Routes group stops for a delivery run. Stops represent individual delivery points with addresses, shipped lots, and completion status.

**Customers:** Manage customer accounts and contact info. Customer portal available at /portal for invoice viewing and payment.

**Invoices:** Generate and manage customer invoices. Stripe integration enables online payment via the customer portal.

**Forecasting:** AI-powered demand forecasting per product using historical usage. Shows predicted demand, reorder recommendations, and trend.

**Integrations (admin only):** Configure third-party integrations (QuickBooks, Stripe, etc.).

**Roles:** admin (full access), manager (most features, no user management or some admin ops), driver (delivery view only).

**AI Help > Walkthroughs:** Get step-by-step guides for any feature by entering the feature name and an optional question.`;

const chatRateLimiter = new Map();
const CHAT_RATE_LIMIT = 20;
const CHAT_RATE_WINDOW_MS = 60_000;

function checkChatRateLimit(userId) {
  const now = Date.now();
  const entry = chatRateLimiter.get(userId);
  if (!entry || now - entry.windowStart >= CHAT_RATE_WINDOW_MS) {
    chatRateLimiter.set(userId, { windowStart: now, count: 1 });
    return true;
  }
  if (entry.count >= CHAT_RATE_LIMIT) return false;
  entry.count += 1;
  return true;
}

function heuristicChatReply(message, dbContext = {}) {
  const { intOr, numberOr } = require('./ai');
  const msg = String(message || '').toLowerCase();
  const overview = dbContext.overview || {};
  const searchTerms = Array.isArray(dbContext.search_terms) ? dbContext.search_terms : [];
  const matchingCustomers = Array.isArray(dbContext.matchingCustomers) ? dbContext.matchingCustomers : [];
  const matchingProducts = Array.isArray(dbContext.matchingProducts) ? dbContext.matchingProducts : [];
  const matchingRoutes = Array.isArray(dbContext.matchingRoutes) ? dbContext.matchingRoutes : [];
  const matchingOrders = Array.isArray(dbContext.matchingOrders) ? dbContext.matchingOrders : [];
  const matchingInvoices = Array.isArray(dbContext.matchingInvoices) ? dbContext.matchingInvoices : [];

  if (msg.includes('today') || msg.includes('overview') || msg.includes('summary') || msg.includes('urgent')) {
    return [
      `Right now I can see ${intOr(overview.active_route_count, 0)} active route(s), ${intOr(overview.recent_order_count, 0)} recent order(s), ${intOr(overview.low_inventory_count, 0)} low-stock item(s), and ${intOr(overview.overdue_invoice_count, 0)} overdue invoice(s).`,
      intOr(overview.credit_hold_count, 0) > 0
        ? `${intOr(overview.credit_hold_count, 0)} customer account(s) are also on credit hold.`
        : 'I do not see any customer accounts on credit hold in the current context.',
    ].join(' ');
  }
  if (msg.includes('order') || msg.includes('delivery') || msg.includes('deliver')) {
    const count = Array.isArray(dbContext.recentOrders) ? dbContext.recentOrders.length : 0;
    const orderExamples = (dbContext.recentOrders || [])
      .slice(0, 3)
      .map((order) => `${order.order_number || 'order'} (${order.customer_name || 'unknown customer'}: ${order.status || 'unknown'})`);
    if (matchingOrders.length) {
      return `I found ${matchingOrders.length} recent matching order(s) for ${searchTerms.join(', ')}: ${matchingOrders.map((order) => `${order.order_number || 'order'} (${order.status || 'unknown status'})`).join(', ')}.`;
    }
    return count
      ? `There are ${count} recent order(s) in view. Recent examples: ${orderExamples.join(', ')}.`
      : 'I do not see recent orders in the current context. Check Orders for the full delivery queue.';
  }
  if (msg.includes('inventory') || msg.includes('stock') || msg.includes('low stock') || msg.includes('product')) {
    if (matchingProducts.length) {
      return `I found ${matchingProducts.length} matching product(s): ${matchingProducts.map((item) => `${item.description} (${numberOr(item.on_hand_qty, 0)} ${item.unit || 'units'} on hand)`).join(', ')}.`;
    }
    const lowItems = (dbContext.lowInventory || []).slice(0, 5);
    return lowItems.length
      ? `Low-stock items in the current context include ${lowItems.map((item) => `${item.description} (${numberOr(item.on_hand_qty, 0)} ${item.unit || 'units'})`).join(', ')}.`
      : 'I do not see any low-stock items in the current context.';
  }
  if (msg.includes('invoice') || msg.includes('overdue') || msg.includes('payment')) {
    if (matchingInvoices.length) {
      return `I found ${matchingInvoices.length} matching invoice(s): ${matchingInvoices.map((invoice) => `${invoice.invoice_number || invoice.id} for ${invoice.customer_name || 'unknown customer'} (${invoice.status || 'unknown'})`).join(', ')}.`;
    }
    const overdueInvoices = (dbContext.overdueInvoices || []).slice(0, 5);
    return overdueInvoices.length
      ? `Overdue invoices in the current context include ${overdueInvoices.map((invoice) => `${invoice.customer_name || 'unknown customer'} ($${numberOr(invoice.total, 0).toFixed(2)})`).join(', ')}.`
      : 'I do not see overdue invoices in the current context.';
  }
  if (msg.includes('route') || msg.includes('driver')) {
    if (matchingRoutes.length) {
      return `I found ${matchingRoutes.length} matching route(s): ${matchingRoutes.map((route) => `${route.name} (driver: ${route.driver || 'unassigned'})`).join(', ')}.`;
    }
    const routes = (dbContext.activeRoutes || []).slice(0, 5);
    return routes.length
      ? `Active routes in the current context include ${routes.map((route) => `${route.name} (driver: ${route.driver || 'unassigned'})`).join(', ')}.`
      : 'I do not see active routes in the current context.';
  }
  if (msg.includes('customer') || msg.includes('credit hold') || msg.includes('hold')) {
    if (matchingCustomers.length) {
      return `I found ${matchingCustomers.length} matching customer record(s): ${matchingCustomers.map((customer) => `${customer.company_name}${customer.credit_hold_reason ? ` [credit hold: ${customer.credit_hold_reason}]` : ''}`).join(', ')}.`;
    }
    const holds = (dbContext.creditHoldCustomers || []).slice(0, 5);
    return holds.length
      ? `Customers currently on credit hold include ${holds.map((customer) => `${customer.company_name} (${customer.credit_hold_reason})`).join(', ')}.`
      : 'I do not see any customers on credit hold in the current context.';
  }
  if (msg.includes('vendor') || msg.includes('supplier') || msg.includes('purchase order')) {
    const openPos = (dbContext.vendorPurchaseOrders || []).slice(0, 5);
    return openPos.length
      ? `Open vendor purchasing activity includes ${openPos.map((po) => `${po.po_number || 'PO'} for ${po.vendor || 'unknown vendor'} (${po.status || 'unknown status'})`).join(', ')}.`
      : 'I do not see open vendor purchase orders in the current context.';
  }
  if (msg.includes('forecast') || msg.includes('reorder') || msg.includes('plan')) {
    const lowItems = (dbContext.lowInventory || []).slice(0, 3);
    return lowItems.length
      ? `Planning should focus first on ${lowItems.map((item) => `${item.description} (${numberOr(item.on_hand_qty, 0)} ${item.unit || 'units'} on hand)`).join(', ')}.`
      : 'Planning data is limited here, but Inventory and Planning are the right places to review reorder risk.';
  }
  return 'I can answer more specifically if you ask about orders, inventory, invoices, customers, routes, vendors, or a named account or product.';
}

async function generateChatReply(userName, userRole, message, history = []) {
  const { getClient, extractMessageContent, stringOr, DEFAULT_MODEL } = require('./ai');
  try {
    const client = getClient();
    const systemContent = CHAT_SYSTEM_PROMPT
      .replace('{name}', stringOr(userName, 'User'))
      .replace('{role}', stringOr(userRole, 'user'))
      .replace('{knowledge}', NODEROUTE_KNOWLEDGE);

    const cappedHistory = history.slice(-10);
    const messages = [
      { role: 'system', content: systemContent },
      ...cappedHistory,
      { role: 'user', content: String(message || '') },
    ];

    const response = await client.chat.completions.create({
      model: DEFAULT_MODEL,
      max_tokens: 600,
      messages,
    });

    const choice = response.choices && response.choices[0];
    const reply = extractMessageContent(choice && choice.message && choice.message.content);
    return reply || 'I was unable to generate a response. Please try again.';
  } catch (err) {
    if (String(err.message || '').includes('OPENAI_API_KEY')) throw err;
    console.warn('Chat reply AI fallback:', err.message);
    return heuristicChatReply(message);
  }
}

async function generateChatReplyWithContext(userName, userRole, message, history = [], dbContext = {}) {
  const { getClient, extractMessageContent, intOr, numberOr, stringOr, DEFAULT_MODEL } = require('./ai');
  const client = getClient();
  const contextParts = [];
  const overview = dbContext.overview || {};
  const searchTerms = Array.isArray(dbContext.search_terms) ? dbContext.search_terms : [];

  if (Object.keys(overview).length) {
    contextParts.push(
      `## Live Account Snapshot\n- Active routes: ${intOr(overview.active_route_count, 0)}\n- Recent orders: ${intOr(overview.recent_order_count, 0)}\n- Low-stock items: ${intOr(overview.low_inventory_count, 0)}\n- Overdue invoices: ${intOr(overview.overdue_invoice_count, 0)}\n- Credit-hold customers: ${intOr(overview.credit_hold_count, 0)}\n- Open vendor POs: ${intOr(overview.open_vendor_po_count, 0)}`
    );
  }
  if (searchTerms.length) {
    contextParts.push(`## User Search Terms\n${searchTerms.map((term) => `- ${term}`).join('\n')}`);
  }
  if (dbContext.matchingCustomers && dbContext.matchingCustomers.length) {
    contextParts.push(`## Matching Customers\n${dbContext.matchingCustomers.map((customer) => `- ${customer.company_name}${customer.credit_hold_reason ? ` [credit hold: ${customer.credit_hold_reason}]` : ''}`).join('\n')}`);
  }
  if (dbContext.matchingProducts && dbContext.matchingProducts.length) {
    contextParts.push(`## Matching Products\n${dbContext.matchingProducts.map((item) => `- ${item.description}: ${numberOr(item.on_hand_qty, 0)} ${item.unit || 'units'} on hand`).join('\n')}`);
  }
  if (dbContext.matchingOrders && dbContext.matchingOrders.length) {
    contextParts.push(`## Matching Orders\n${dbContext.matchingOrders.map((order) => `- ${order.order_number || 'order'} for ${order.customer_name || 'unknown customer'}: ${order.status || 'unknown status'}`).join('\n')}`);
  }
  if (dbContext.matchingInvoices && dbContext.matchingInvoices.length) {
    contextParts.push(`## Matching Invoices\n${dbContext.matchingInvoices.map((invoice) => `- ${invoice.invoice_number || invoice.id} for ${invoice.customer_name || 'unknown customer'}: ${invoice.status || 'unknown status'} ($${numberOr(invoice.total, 0).toFixed(2)})`).join('\n')}`);
  }
  if (dbContext.matchingRoutes && dbContext.matchingRoutes.length) {
    contextParts.push(`## Matching Routes\n${dbContext.matchingRoutes.map((route) => `- ${route.name}: driver=${route.driver || 'unassigned'}`).join('\n')}`);
  }
  if (dbContext.matchingVendors && dbContext.matchingVendors.length) {
    contextParts.push(`## Matching Vendors\n${dbContext.matchingVendors.map((vendor) => `- ${vendor.name}`).join('\n')}`);
  }
  if (dbContext.recentOrders && dbContext.recentOrders.length) {
    contextParts.push(`## Recent Orders\n${dbContext.recentOrders.slice(0, 10).map((o) => `- ${o.order_number || 'order'} for ${o.customer_name || 'unknown'}: ${o.status || 'unknown status'}, ${o.date || o.created_at}`).join('\n')}`);
  }
  if (dbContext.lowInventory && dbContext.lowInventory.length) {
    contextParts.push(`## Low Inventory Items\n${dbContext.lowInventory.slice(0, 10).map((i) => `- ${i.description}: ${numberOr(i.on_hand_qty, 0)} ${i.unit || 'units'} on hand`).join('\n')}`);
  }
  if (dbContext.overdueInvoices && dbContext.overdueInvoices.length) {
    contextParts.push(`## Overdue Invoices\n${dbContext.overdueInvoices.slice(0, 10).map((inv) => `- ${inv.customer_name || 'unknown'}: $${numberOr(inv.total, 0).toFixed(2)} overdue (${inv.invoice_number || inv.id})`).join('\n')}`);
  }
  if (dbContext.creditHoldCustomers && dbContext.creditHoldCustomers.length) {
    contextParts.push(`## Customers on Credit Hold\n${dbContext.creditHoldCustomers.slice(0, 10).map((c) => `- ${c.company_name}: ${c.credit_hold_reason}`).join('\n')}`);
  }
  if (dbContext.activeRoutes && dbContext.activeRoutes.length) {
    contextParts.push(`## Active Routes Today\n${dbContext.activeRoutes.slice(0, 10).map((r) => `- ${r.name}: driver=${r.driver || 'unassigned'}`).join('\n')}`);
  }
  if (dbContext.vendorPurchaseOrders && dbContext.vendorPurchaseOrders.length) {
    contextParts.push(`## Open Vendor Purchase Orders\n${dbContext.vendorPurchaseOrders.slice(0, 10).map((po) => `- ${po.po_number || 'PO'} for ${po.vendor || 'unknown vendor'}: ${po.status || 'unknown status'} ($${numberOr(po.total_cost, 0).toFixed(2)})`).join('\n')}`);
  }

  const liveContext = contextParts.length
    ? `\n\n## Live Data from Your NodeRoute Account\n${contextParts.join('\n\n')}`
    : '';

  const systemContent = CHAT_SYSTEM_PROMPT
    .replace('{name}', stringOr(userName, 'User'))
    .replace('{role}', stringOr(userRole, 'user'))
    .replace('{knowledge}', NODEROUTE_KNOWLEDGE + liveContext);

  const cappedHistory = history.slice(-10);
  const messages = [
    { role: 'system', content: systemContent },
    ...cappedHistory,
    { role: 'user', content: String(message || '') },
  ];

  try {
    const response = await client.chat.completions.create({
      model: DEFAULT_MODEL,
      max_tokens: 600,
      messages,
    });

    const choice = response.choices && response.choices[0];
    const reply = extractMessageContent(choice && choice.message && choice.message.content);
    return reply || 'I was unable to generate a response. Please try again.';
  } catch (err) {
    if (String(err.message || '').includes('OPENAI_API_KEY')) throw err;
    console.warn('Chat (context) reply AI fallback:', err.message);
    return heuristicChatReply(message, dbContext);
  }
}

module.exports = {
  generateChatReply,
  generateChatReplyWithContext,
  checkChatRateLimit,
  heuristicChatReply,
};
