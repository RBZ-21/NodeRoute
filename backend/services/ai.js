const OpenAI = require('openai');
const { createAiConfigError, isAiConfigError } = require('./ai-errors');

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const DEFAULT_VISION_MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-4o';

const FORECAST_SYSTEM_PROMPT = `You are a demand forecasting analyst for a food wholesale distribution warehouse.
Your job is to analyze historical sales data and predict future demand accurately.

Rules you MUST follow:
1. Focus on recent consumption patterns first, then adjust for trend.
2. Perishables and short-shelf-life items should avoid aggressive over-ordering.
3. If history is sparse, lower confidence instead of inventing certainty.
4. Use whole integers for all unit counts.
5. Keep reasoning practical and concise.`;

const INVENTORY_SYSTEM_PROMPT = `You are a warehouse inventory management AI for a food wholesale distribution business.
You specialize in perishable goods, spoilage prevention, and waste reduction.

Rules:
1. Prioritize CRITICAL first, then WARNING, then INFO.
2. Any item expiring within 3 days should be treated as urgent.
3. Keep reasons short and operationally useful.
4. Suggested actions should be specific next steps, not generic advice.`;

const REORDER_ALERT_SYSTEM_PROMPT = `You are an operations alert writer for a food wholesale distribution company.
Write short, direct reorder alerts for the warehouse team.

Rules:
1. Keep the message under 3 sentences.
2. Always include product name, days until stockout, and recommended order quantity.
3. If expiry is relevant, mention it clearly.
4. Be concise and operational.`;

const WALKTHROUGH_SYSTEM_PROMPT = `You are a friendly internal product guide for the NodeRoute delivery operations app.
Explain features clearly to normal users.

Rules:
1. Be practical, not promotional.
2. Keep steps short and easy to scan.
3. Mention role restrictions or gotchas in warnings.
4. Use simple language that fits inside the UI.`;

const ORDER_INTAKE_SYSTEM_PROMPT = `You are an order-intake assistant for a food wholesale delivery operation.
Convert unstructured customer messages into clean line items for order entry.

Rules:
1. Extract only what is present in the message. Do not invent products.
2. Prefer quantity + unit + item name.
3. Use unit "lb" for weight-based items and "each" for piece/count items.
4. If quantity is missing but item is clearly requested, set amount to 1.
5. Keep notes short and operational.
6. Return structured JSON only.`;

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

const PO_SCAN_PROMPT = `You are an OCR-style receiving document scanner for a food wholesale distribution warehouse.
Extract every visible line item from the uploaded vendor invoice, dock receipt, packing slip, or purchase order image.

Rules:
1. Return structured JSON only.
2. Treat table rows, itemized charges, product rows, and received/shipped quantity rows as line items.
3. Preserve the written product description exactly when possible. Do not invent products that are not visible.
4. Infer category from the product name if it is not explicit.
5. If a value is not legible, return null for that field instead of dropping the line.
6. Quantities, unit prices, and totals must be numbers, not strings. Strip currency symbols.
7. If quantity or unit price is missing but a product row is visible, still return the line with null for the missing values.
8. For each line item, classify whether it looks weighted merchandise, count-based merchandise, or unknown.
9. Extract a lot number when one is visibly tied to the item. If no lot number is visible, return null and confidence "none".
10. Extract visible vendor contact details from the invoice header when present. Use null for missing vendor details.
11. Only return an empty items array when there are truly no visible product or charge rows.
12. When several images are provided, they are sequential pages of one document. Merge all line items across the pages into a single result, read the vendor, PO number, date, and total once, and do not double-count header or total rows that repeat across pages.`;

const FORECAST_SCHEMA = {
  name: 'inventory_demand_forecast',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'product_id',
      'product_name',
      'forecast_period_days',
      'predicted_demand_units',
      'reorder_recommended',
      'suggested_reorder_quantity',
      'confidence',
      'trend',
      'reasoning',
    ],
    properties: {
      product_id: { type: 'string' },
      product_name: { type: 'string' },
      forecast_period_days: { type: 'integer' },
      predicted_demand_units: { type: 'integer' },
      reorder_recommended: { type: 'boolean' },
      suggested_reorder_quantity: { type: 'integer' },
      confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
      trend: { type: 'string', enum: ['increasing', 'decreasing', 'stable'] },
      reasoning: { type: 'string' },
    },
  },
};

const INVENTORY_ANALYSIS_SCHEMA = {
  name: 'inventory_health_analysis',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['analysis_date', 'total_skus_analyzed', 'summary', 'action_items'],
    properties: {
      analysis_date: { type: 'string' },
      total_skus_analyzed: { type: 'integer' },
      summary: {
        type: 'object',
        additionalProperties: false,
        required: ['critical_items', 'warning_items', 'overstocked_items', 'healthy_items'],
        properties: {
          critical_items: { type: 'integer' },
          warning_items: { type: 'integer' },
          overstocked_items: { type: 'integer' },
          healthy_items: { type: 'integer' },
        },
      },
      action_items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['priority', 'action', 'product_id', 'product_name', 'current_stock', 'reason', 'suggested_action'],
          properties: {
            priority: { type: 'string', enum: ['CRITICAL', 'WARNING', 'INFO'] },
            action: { type: 'string', enum: ['REORDER', 'EXPEDITE_SALE', 'REDUCE_ORDER', 'MONITOR'] },
            product_id: { type: 'string' },
            product_name: { type: 'string' },
            current_stock: { type: 'integer' },
            reason: { type: 'string' },
            suggested_action: { type: 'string' },
          },
        },
      },
    },
  },
};

const REORDER_ALERT_SCHEMA = {
  name: 'reorder_alert_message',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['subject', 'body'],
    properties: {
      subject: { type: 'string' },
      body: { type: 'string' },
    },
  },
};

const WALKTHROUGH_SCHEMA = {
  name: 'feature_walkthrough',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'summary', 'steps', 'tips', 'warnings'],
    properties: {
      title: { type: 'string' },
      summary: { type: 'string' },
      steps: { type: 'array', items: { type: 'string' } },
      tips: { type: 'array', items: { type: 'string' } },
      warnings: { type: 'array', items: { type: 'string' } },
    },
  },
};

const PO_SCAN_SCHEMA = {
  name: 'purchase_order_scan',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['vendor', 'vendor_details', 'po_number', 'date', 'items', 'total_cost'],
    properties: {
      vendor: { type: ['string', 'null'] },
      vendor_details: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'contact', 'email', 'phone', 'address', 'payment_terms'],
        properties: {
          name: { type: ['string', 'null'] },
          contact: { type: ['string', 'null'] },
          email: { type: ['string', 'null'] },
          phone: { type: ['string', 'null'] },
          address: { type: ['string', 'null'] },
          payment_terms: { type: ['string', 'null'] },
        },
      },
      po_number: { type: ['string', 'null'] },
      date: { type: ['string', 'null'] },
      total_cost: { type: ['number', 'null'] },
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['description', 'category', 'quantity', 'unit', 'unit_price', 'total', 'item_type', 'lot_number', 'lot_number_confidence'],
          properties: {
            description: { type: ['string', 'null'] },
            category: { type: ['string', 'null'] },
            quantity: { type: ['number', 'null'] },
            unit: { type: ['string', 'null'] },
            unit_price: { type: ['number', 'null'] },
            total: { type: ['number', 'null'] },
            item_type: { type: 'string', enum: ['weighted', 'count', 'unknown'] },
            lot_number: { type: ['string', 'null'] },
            lot_number_confidence: { type: 'string', enum: ['none', 'low', 'medium', 'high'] },
          },
        },
      },
    },
  },
};

const ORDER_INTAKE_SCHEMA = {
  name: 'order_intake_draft',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['customer_name_hint', 'order_notes', 'items', 'warnings'],
    properties: {
      customer_name_hint: { type: ['string', 'null'] },
      order_notes: { type: ['string', 'null'] },
      warnings: { type: 'array', items: { type: 'string' } },
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'unit', 'amount', 'unit_price', 'notes', 'item_number'],
          properties: {
            name: { type: 'string' },
            unit: { type: 'string', enum: ['lb', 'each'] },
            amount: { type: 'number' },
            unit_price: { type: 'number' },
            notes: { type: ['string', 'null'] },
            item_number: { type: ['string', 'null'] },
          },
        },
      },
    },
  },
};

let _client = null;

function getClient() {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY environment variable is not set');
    _client = new OpenAI({ apiKey });
  }
  return _client;
}

function numberOr(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function intOr(value, fallback = 0) {
  return Math.round(numberOr(value, fallback));
}

function stringOr(value, fallback = '') {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractMessageContent(messageContent) {
  if (typeof messageContent === 'string') return messageContent.trim();
  if (!Array.isArray(messageContent)) return '';
  return messageContent
    .filter((part) => part && (part.type === 'text' || part.type === 'output_text'))
    .map((part) => String(part.text || part.content || '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

async function callAI({ systemPrompt, userMessage, schema, maxTokens = 700, model = DEFAULT_MODEL }) {
  const client = getClient();
  const response = await client.chat.completions.create({
    model,
    max_tokens: maxTokens,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: schema.name,
        strict: true,
        schema: schema.schema,
      },
    },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  });

  const choice = response.choices && response.choices[0];
  const refusal = choice && choice.message && choice.message.refusal;
  if (refusal) throw new Error(`Model refused request: ${refusal}`);

  const raw = extractMessageContent(choice && choice.message && choice.message.content);
  const parsed = safeJsonParse(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Model returned invalid structured JSON');
  }
  return parsed;
}

function buildWeeklyBuckets(history, numWeeks) {
  const buckets = [];
  const now = Date.now();
  for (let i = numWeeks - 1; i >= 0; i -= 1) {
    const weekStart = new Date(now - (i + 1) * 7 * 86400000);
    const weekEnd = new Date(now - i * 7 * 86400000);
    const label = weekStart.toISOString().split('T')[0];
    const used = (history || [])
      .filter((entry) => {
        const createdAt = new Date(entry.created_at);
        return createdAt >= weekStart && createdAt < weekEnd && numberOr(entry.change_qty, 0) < 0;
      })
      .reduce((sum, entry) => sum + Math.abs(numberOr(entry.change_qty, 0)), 0);
    buckets.push({ week: label, used: Number(used.toFixed(2)) });
  }
  return buckets;
}

function summarizeTrend(values) {
  if (values.length < 2) return 'stable';
  const half = Math.max(1, Math.floor(values.length / 2));
  const early = values.slice(0, half);
  const late = values.slice(-half);
  const earlyAvg = early.reduce((sum, value) => sum + value, 0) / early.length;
  const lateAvg = late.reduce((sum, value) => sum + value, 0) / late.length;
  if (lateAvg > earlyAvg * 1.15) return 'increasing';
  if (lateAvg < earlyAvg * 0.85) return 'decreasing';
  return 'stable';
}

function heuristicForecast(product, history, forecastDays) {
  const weeklyBuckets = buildWeeklyBuckets(history, 12);
  const nonZero = weeklyBuckets.filter((bucket) => bucket.used > 0);
  const recentBuckets = weeklyBuckets.slice(-4);
  const recentActive = recentBuckets.filter((bucket) => bucket.used > 0);
  const referenceBuckets = recentActive.length >= 2
    ? recentActive
    : (nonZero.length ? nonZero.slice(-6) : recentBuckets);
  const averageWeekly = referenceBuckets.reduce((sum, bucket) => sum + bucket.used, 0) / Math.max(referenceBuckets.length, 1);
  const dailyUsage = averageWeekly / 7;
  const predictedDemand = Math.max(0, Math.round(dailyUsage * forecastDays));
  const currentStock = numberOr(product.on_hand_qty, 0);
  const shortage = predictedDemand - currentStock;
  const trend = summarizeTrend(referenceBuckets.map((bucket) => bucket.used));
  const confidence = recentActive.length < 2 ? 'low' : recentActive.length < 4 ? 'medium' : 'high';
  const suggestedReorder = shortage > 0 ? Math.max(0, Math.round(shortage + dailyUsage * 3)) : 0;

  return {
    product_id: stringOr(product.item_number, 'unknown'),
    product_name: stringOr(product.description, 'Unknown product'),
    forecast_period_days: intOr(forecastDays, 14),
    predicted_demand_units: predictedDemand,
    reorder_recommended: suggestedReorder > 0,
    suggested_reorder_quantity: suggestedReorder,
    confidence,
    trend,
    reasoning: confidence === 'low'
      ? 'Limited history is available, so this forecast uses recent average usage with low confidence.'
      : `Based on recent weekly usage, demand looks ${trend} over the next ${forecastDays} days.`,
  };
}

function isForecastPlausible(result, history, forecastDays) {
  if (!result || typeof result !== 'object') return false;
  const weeklyBuckets = buildWeeklyBuckets(history, 12);
  const totalRecentUsage = weeklyBuckets.reduce((sum, bucket) => sum + bucket.used, 0);
  const predicted = Math.max(0, intOr(result.predicted_demand_units, 0));
  const suggested = Math.max(0, intOr(result.suggested_reorder_quantity, 0));
  const horizon = Math.max(1, intOr(forecastDays, 14));

  if (totalRecentUsage > 0 && predicted === 0) return false;
  if (predicted > Math.ceil(totalRecentUsage * 3 + horizon * 10)) return false;
  if (result.reorder_recommended === true && suggested === 0) return false;
  return true;
}

function normalizeForecast(result, product, forecastDays, history) {
  const fallback = heuristicForecast(product, history, forecastDays);
  const source = isForecastPlausible(result, history, forecastDays) ? result : fallback;
  return {
    product_id: stringOr(source && source.product_id, fallback.product_id),
    product_name: stringOr(source && source.product_name, fallback.product_name),
    forecast_period_days: clamp(intOr(source && source.forecast_period_days, fallback.forecast_period_days), 1, 90),
    predicted_demand_units: Math.max(0, intOr(source && source.predicted_demand_units, fallback.predicted_demand_units)),
    reorder_recommended: typeof (source && source.reorder_recommended) === 'boolean'
      ? source.reorder_recommended
      : fallback.reorder_recommended,
    suggested_reorder_quantity: Math.max(0, intOr(source && source.suggested_reorder_quantity, fallback.suggested_reorder_quantity)),
    confidence: ['low', 'medium', 'high'].includes(source && source.confidence) ? source.confidence : fallback.confidence,
    trend: ['increasing', 'decreasing', 'stable'].includes(source && source.trend) ? source.trend : fallback.trend,
    reasoning: stringOr(source && source.reasoning, fallback.reasoning),
  };
}

async function forecastDemand(product, history, forecastDays = 14) {
  const weeklyBuckets = buildWeeklyBuckets(history, 12);
  const userMessage = `Analyze demand for this food wholesale product and provide a ${forecastDays}-day forecast.

Product:
- ID: ${stringOr(product.item_number, 'unknown')}
- Name: ${stringOr(product.description, 'Unknown product')}
- Category: ${product.category || 'Food'}
- Unit: ${product.unit || 'unit'}
- Current stock on hand: ${numberOr(product.on_hand_qty, 0)} ${product.unit || 'unit'}
- Cost per unit: $${numberOr(product.cost, 0)}

Weekly usage history (last ${weeklyBuckets.length} weeks, oldest to newest):
${weeklyBuckets.map((week) => `- Week of ${week.week}: used ${week.used} ${product.unit || 'units'}`).join('\n')}

Weeks with usage data: ${weeklyBuckets.filter((week) => week.used > 0).length}
Forecast period: ${forecastDays} days`;

  try {
    const aiResult = await callAI({
      systemPrompt: FORECAST_SYSTEM_PROMPT,
      userMessage,
      schema: FORECAST_SCHEMA,
      maxTokens: 500,
    });
    return normalizeForecast(aiResult, product, forecastDays, history);
  } catch (error) {
    if (String(error.message || '').includes('OPENAI_API_KEY')) throw error;
    return normalizeForecast(null, product, forecastDays, history);
  }
}

function heuristicInventoryAnalysis(products, historyByItem, expiringLots) {
  const analysisDate = new Date().toISOString();
  const actionItems = [];

  for (const product of products) {
    const currentStock = Math.max(0, intOr(product.on_hand_qty, 0));
    const weekly = buildWeeklyBuckets(historyByItem[product.item_number] || [], 4).map((bucket) => bucket.used);
    const avgWeeklyDemand = weekly.reduce((sum, value) => sum + value, 0) / Math.max(weekly.length, 1);
    const expiring = (expiringLots || [])
      .filter((lot) => lot.item_number === product.item_number)
      .sort((a, b) => new Date(a.expiry_date) - new Date(b.expiry_date));
    const soonest = expiring[0];
    const daysToExpiry = soonest && soonest.expiry_date
      ? Math.round((new Date(soonest.expiry_date) - Date.now()) / 86400000)
      : null;

    if (daysToExpiry !== null && daysToExpiry <= 3 && currentStock > 0) {
      actionItems.push({
        priority: 'CRITICAL',
        action: 'EXPEDITE_SALE',
        product_id: stringOr(product.item_number, 'unknown'),
        product_name: stringOr(product.description, 'Unknown product'),
        current_stock: currentStock,
        reason: 'Lot expires within 3 days.',
        suggested_action: `Move ${product.description} urgently before ${soonest.expiry_date}.`,
      });
      continue;
    }

    if (avgWeeklyDemand > 0 && currentStock <= Math.ceil(avgWeeklyDemand * 0.5)) {
      actionItems.push({
        priority: 'CRITICAL',
        action: 'REORDER',
        product_id: stringOr(product.item_number, 'unknown'),
        product_name: stringOr(product.description, 'Unknown product'),
        current_stock: currentStock,
        reason: 'Stock is below half of weekly demand.',
        suggested_action: `Reorder ${Math.max(1, Math.round(avgWeeklyDemand * 2 - currentStock))} units now.`,
      });
      continue;
    }

    if (avgWeeklyDemand > 0 && currentStock > avgWeeklyDemand * 2) {
      actionItems.push({
        priority: 'WARNING',
        action: 'REDUCE_ORDER',
        product_id: stringOr(product.item_number, 'unknown'),
        product_name: stringOr(product.description, 'Unknown product'),
        current_stock: currentStock,
        reason: 'Stock is more than two weeks of demand.',
        suggested_action: `Slow purchasing and review spoilage risk for ${product.description}.`,
      });
      continue;
    }

    if (currentStock === 0) {
      actionItems.push({
        priority: 'WARNING',
        action: 'REORDER',
        product_id: stringOr(product.item_number, 'unknown'),
        product_name: stringOr(product.description, 'Unknown product'),
        current_stock: currentStock,
        reason: 'Current stock is zero.',
        suggested_action: `Check if ${product.description} should be reordered or retired.`,
      });
    }
  }

  const summary = {
    critical_items: actionItems.filter((item) => item.priority === 'CRITICAL').length,
    warning_items: actionItems.filter((item) => item.priority === 'WARNING').length,
    overstocked_items: actionItems.filter((item) => item.action === 'REDUCE_ORDER').length,
    healthy_items: Math.max(0, products.length - actionItems.length),
  };

  actionItems.sort((a, b) => {
    const rank = { CRITICAL: 0, WARNING: 1, INFO: 2 };
    return rank[a.priority] - rank[b.priority];
  });

  return {
    analysis_date: analysisDate,
    total_skus_analyzed: products.length,
    summary,
    action_items: actionItems,
  };
}

function normalizeInventoryAnalysis(result, products, historyByItem, expiringLots) {
  const fallback = heuristicInventoryAnalysis(products, historyByItem, expiringLots);
  const rawItems = Array.isArray(result && result.action_items) ? result.action_items : fallback.action_items;
  const actionItems = rawItems.map((item) => ({
    priority: ['CRITICAL', 'WARNING', 'INFO'].includes(item && item.priority) ? item.priority : 'INFO',
    action: ['REORDER', 'EXPEDITE_SALE', 'REDUCE_ORDER', 'MONITOR'].includes(item && item.action) ? item.action : 'MONITOR',
    product_id: stringOr(item && item.product_id, 'unknown'),
    product_name: stringOr(item && item.product_name, 'Unknown product'),
    current_stock: Math.max(0, intOr(item && item.current_stock, 0)),
    reason: stringOr(item && item.reason, 'Review this item.'),
    suggested_action: stringOr(item && item.suggested_action, 'Monitor this item.'),
  }));

  actionItems.sort((a, b) => {
    const rank = { CRITICAL: 0, WARNING: 1, INFO: 2 };
    return rank[a.priority] - rank[b.priority];
  });

  const summary = result && result.summary ? {
    critical_items: Math.max(0, intOr(result.summary.critical_items, actionItems.filter((item) => item.priority === 'CRITICAL').length)),
    warning_items: Math.max(0, intOr(result.summary.warning_items, actionItems.filter((item) => item.priority === 'WARNING').length)),
    overstocked_items: Math.max(0, intOr(result.summary.overstocked_items, actionItems.filter((item) => item.action === 'REDUCE_ORDER').length)),
    healthy_items: Math.max(0, intOr(result.summary.healthy_items, Math.max(0, products.length - actionItems.length))),
  } : fallback.summary;

  return {
    analysis_date: stringOr(result && result.analysis_date, fallback.analysis_date),
    total_skus_analyzed: Math.max(0, intOr(result && result.total_skus_analyzed, fallback.total_skus_analyzed)),
    summary,
    action_items: actionItems,
  };
}

async function analyzeInventory(products, historyByItem, expiringLots) {
  const today = new Date().toISOString().split('T')[0];
  const inventoryPayload = products.map((product) => {
    const history = historyByItem[product.item_number] || [];
    const weeklyBuckets = buildWeeklyBuckets(history, 4);
    const avgWeeklyDemand = Number((weeklyBuckets.reduce((sum, bucket) => sum + bucket.used, 0) / 4).toFixed(2));
    const expiring = (expiringLots || [])
      .filter((lot) => lot.item_number === product.item_number)
      .sort((a, b) => new Date(a.expiry_date) - new Date(b.expiry_date));
    const soonestExpiry = expiring[0] || null;

    return {
      product_id: stringOr(product.item_number, 'unknown'),
      product_name: stringOr(product.description, 'Unknown product'),
      current_stock: Math.max(0, intOr(product.on_hand_qty, 0)),
      unit: stringOr(product.unit, 'lb'),
      avg_weekly_demand: avgWeeklyDemand,
      expiry_date: soonestExpiry ? soonestExpiry.expiry_date : null,
      cost_per_unit: numberOr(product.cost, 0),
    };
  });

  const userMessage = `Analyze this warehouse inventory snapshot taken on ${today}.

Inventory data:
${JSON.stringify(inventoryPayload, null, 2)}

Return the highest-priority action items first.`;

  try {
    const aiResult = await callAI({
      systemPrompt: INVENTORY_SYSTEM_PROMPT,
      userMessage,
      schema: INVENTORY_ANALYSIS_SCHEMA,
      maxTokens: 2200,
    });
    return normalizeInventoryAnalysis(aiResult, products, historyByItem, expiringLots);
  } catch (error) {
    if (String(error.message || '').includes('OPENAI_API_KEY')) throw error;
    return normalizeInventoryAnalysis(null, products, historyByItem, expiringLots);
  }
}

function heuristicReorderAlert(product, dailyUsage, reorderQty, expiryDate) {
  const currentStock = Math.max(0, intOr(product.on_hand_qty, 0));
  const daysUntilStockout = dailyUsage > 0 ? Math.max(0, Math.round(currentStock / dailyUsage)) : null;
  const name = stringOr(product.description, 'Unknown product');
  const expiryNote = expiryDate ? ` Expiry to watch: ${expiryDate}.` : '';
  return {
    subject: `Reorder alert: ${name}`,
    body: `${name} has about ${daysUntilStockout !== null ? daysUntilStockout : 'unknown'} day(s) until stockout. Recommended order quantity: ${Math.max(0, intOr(reorderQty, 0))} ${stringOr(product.unit, 'units')}.${expiryNote}`.trim(),
  };
}

function normalizeReorderAlert(result, product, dailyUsage, reorderQty, expiryDate) {
  const fallback = heuristicReorderAlert(product, dailyUsage, reorderQty, expiryDate);
  return {
    subject: stringOr(result && result.subject, fallback.subject),
    body: stringOr(result && result.body, fallback.body),
  };
}

async function generateReorderAlert(product, dailyUsage, reorderQty, expiryDate = null) {
  const currentStock = Math.max(0, intOr(product.on_hand_qty, 0));
  const daysUntilStockout = dailyUsage > 0 ? Math.round(currentStock / dailyUsage) : null;
  const userMessage = `Write a reorder alert for this item:

Product: ${stringOr(product.description, 'Unknown product')}
Current Stock: ${currentStock} ${stringOr(product.unit, 'lb')}
Daily Average Usage: ${numberOr(dailyUsage, 0).toFixed(2)} ${stringOr(product.unit, 'lb')}
Recommended Reorder Quantity: ${Math.max(0, intOr(reorderQty, 0))} ${stringOr(product.unit, 'lb')}
Expiry Date: ${expiryDate || 'N/A'}
Days Until Stockout: ${daysUntilStockout !== null ? daysUntilStockout : 'Unknown'}`;

  try {
    const aiResult = await callAI({
      systemPrompt: REORDER_ALERT_SYSTEM_PROMPT,
      userMessage,
      schema: REORDER_ALERT_SCHEMA,
      maxTokens: 220,
    });
    return normalizeReorderAlert(aiResult, product, dailyUsage, reorderQty, expiryDate);
  } catch (error) {
    if (String(error.message || '').includes('OPENAI_API_KEY')) throw error;
    return normalizeReorderAlert(null, product, dailyUsage, reorderQty, expiryDate);
  }
}

function heuristicWalkthrough(feature, question = '') {
  const title = `${feature} Walkthrough`;
  const q = stringOr(question);
  const key = String(feature || '').trim().toLowerCase();
  if (key.includes('dashboard') || key.includes('home') || key.includes('overview')) {
    return {
      title,
      summary: 'The Dashboard gives a real-time snapshot of today\'s orders, inventory alerts, overdue invoices, and active routes.',
      steps: [
        'Open the Dashboard from the main navigation.',
        'Review the summary cards: open orders, low-stock alerts, overdue invoices, and active routes.',
        'Click any card to navigate directly to the relevant section.',
      ],
      tips: [
        'Use the Dashboard as a daily starting point before drilling into specific modules.',
        'Alert counts update on page refresh — reload if counts look stale.',
      ],
      warnings: [
        'Counts reflect your role\'s visibility scope; admin and manager views include more data.',
      ],
    };
  }
  if (key.includes('order') || key.includes('delivery') || key.includes('deliveries')) {
    return {
      title,
      summary: 'Orders tracks all customer delivery requests from creation through fulfillment.',
      steps: [
        'Open the Orders section from the main navigation.',
        'Create a new order by clicking New Order and filling in customer, items, and delivery date.',
        'Track progress through statuses: pending → confirmed → dispatched → delivered.',
        'Use filters to narrow by status, date range, or customer.',
      ],
      tips: [
        'Confirm orders before dispatching to lock in quantities and prevent edits.',
        'Bulk status updates save time when closing out a full route\'s deliveries.',
      ],
      warnings: [
        'Canceling a dispatched order may require manual inventory adjustment.',
      ],
    };
  }
  if (key.includes('customer') || key.includes('account')) {
    return {
      title,
      summary: 'Customers manages your buyer accounts including contact info, credit terms, and hold status.',
      steps: [
        'Open the Customers section from the main navigation.',
        'Search for an existing customer or click Add Customer to create a new record.',
        'Set payment terms, credit limit, and any credit hold reasons on the customer profile.',
        'Use the activity tab to view order and invoice history for the account.',
      ],
      tips: [
        'Keep credit hold reasons updated so the AR team has context when following up.',
        'Customer numbers are used as keys in orders and invoices — set them carefully.',
      ],
      warnings: [
        'Placing a customer on credit hold will block new orders from being confirmed.',
      ],
    };
  }
  if (key.includes('invoice') || key.includes('billing') || key.includes('receivable')) {
    return {
      title,
      summary: 'Invoices tracks amounts owed by customers and supports follow-up workflows for overdue balances.',
      steps: [
        'Open Financials > Invoices.',
        'Review statuses: draft, sent, partial, paid, overdue.',
        'Use the AI Follow-Up Draft button to generate a collection email for overdue invoices.',
        'Mark invoices as paid when payment is received.',
      ],
      tips: [
        'Filter by "overdue" status to prioritize collections each week.',
        'The AI follow-up tool adjusts tone automatically based on days overdue.',
      ],
      warnings: [
        'Marking an invoice paid does not automatically release a credit hold — update the customer record separately.',
      ],
    };
  }
  if (key.includes('route') || key.includes('stop')) {
    return {
      title,
      summary: 'Routes defines the sequence of delivery stops for each driver\'s run.',
      steps: [
        'Open the Routes section from the main navigation.',
        'Create a route and add stops by customer and address.',
        'Use AI Optimize Route to reorder stops for efficiency.',
        'Assign a driver to the route and dispatch when ready.',
      ],
      tips: [
        'Keep routes geographically compact to reduce drive time.',
        'Re-run optimization after adding or removing stops.',
      ],
      warnings: [
        'Changing stop order after a driver has started may cause confusion — communicate changes directly.',
      ],
    };
  }
  if (key.includes('driver')) {
    return {
      title,
      summary: 'Driver management covers assigning drivers to routes and tracking delivery completion.',
      steps: [
        'Open Routes and use the Driver column to assign a driver to each route.',
        'Use AI Driver Assignments for bulk workload-balanced suggestions.',
        'Drivers update stop statuses in real time as deliveries complete.',
        'Review delivery counts per driver in Analytics > Driver Performance.',
      ],
      tips: [
        'Balance route stop counts across drivers to avoid overloading one person.',
        'Drivers with higher completed-delivery counts are prioritized by the AI assignment tool.',
      ],
      warnings: [
        'Reassigning a driver mid-route can cause status sync issues — do it before dispatch.',
      ],
    };
  }
  if (key.includes('inventor') || key.includes('stock') || key.includes('warehouse')) {
    return {
      title,
      summary: 'Inventory tracks on-hand quantities, lot codes, and warehouse locations for all SKUs.',
      steps: [
        'Open Inventory (or Operations > Warehouse) from the main navigation.',
        'Review on-hand quantities, filtering by category or low-stock threshold.',
        'Use lot code tracking to monitor expiry dates and flag items for markdown.',
        'Adjust quantities manually for receiving discrepancies or write-offs.',
      ],
      tips: [
        'Set reorder thresholds per item so the Planning module surfaces suggestions automatically.',
        'Sort by days-to-expiry to catch spoilage risk early.',
      ],
      warnings: [
        'Manual quantity adjustments bypass receiving workflows — use them only for corrections.',
      ],
    };
  }
  if (key.includes('vendor') || key.includes('supplier')) {
    return {
      title,
      summary: 'Vendors stores your supplier profiles and links to their purchase order history.',
      steps: [
        'Open the Vendors section and add or select a supplier.',
        'Review the vendor\'s PO history, fulfillment rate, and performance score.',
        'Use Operations > Purchasing to create and manage POs for this vendor.',
        'Run AI Vendor Score for a data-driven performance grade.',
      ],
      tips: [
        'Keep vendor payment terms accurate — they feed into cash flow reporting.',
        'Vendors with low fulfillment rates are flagged automatically in Purchasing.',
      ],
      warnings: [
        'Deleting a vendor does not remove their historical POs — reassign records first.',
      ],
    };
  }
  if (key.includes('forecast') || key.includes('reorder') || key.includes('demand')) {
    return {
      title,
      summary: 'Demand forecasting suggests reorder quantities based on sales velocity and lead times.',
      steps: [
        'Open Operations > Planning.',
        'Review the forecast table — items are ranked by urgency using usage history.',
        'Adjust lead-time and coverage-day settings to tune suggestions.',
        'Click Create Draft PO to convert suggestions into a purchase order draft.',
      ],
      tips: [
        'Forecasts improve with more order history — results are stronger after 4+ weeks of data.',
        'Override suggested quantities for seasonal adjustments before creating the PO.',
      ],
      warnings: [
        'Forecasts do not account for promotions or known demand spikes — adjust manually when needed.',
      ],
    };
  }
  if (key.includes('scan') || key.includes('po scan') || key.includes('image')) {
    return {
      title,
      summary: 'PO Image Scan uses AI vision to extract line items from a purchase order photo or PDF.',
      steps: [
        'Open Operations > Purchasing and click Scan PO Image.',
        'Upload a clear JPEG, PNG, WEBP, or PDF of the purchase order.',
        'Review the extracted vendor, PO number, date, and line items.',
        'Edit any fields the scan missed before saving.',
      ],
      tips: [
        'Clear, well-lit photos produce the most accurate extractions.',
        'PDFs work best when the text is machine-readable rather than handwritten.',
      ],
      warnings: [
        'Always verify extracted quantities and prices before confirming — AI can misread handwritten or low-contrast documents.',
      ],
    };
  }
  if (key.includes('planning')) {
    return {
      title,
      summary: 'Use Planning to generate draft purchase orders from demand suggestions and inventory projections.',
      steps: [
        'Open Operations > Planning.',
        'Set lead-time and coverage-day values, then click Recalculate.',
        'Enter an optional vendor and click Create Draft PO.',
        'Open Operations > Purchasing and use Create Vendor PO on the draft when ready.',
      ],
      tips: [
        'Use shorter lead time and lower coverage when cash or cooler space is tight.',
        'If no draft lines appear, verify item usage history and on-hand inventory data.',
      ],
      warnings: [
        'Creating a draft does not place a supplier order until you create a Vendor PO.',
      ],
    };
  }
  if (key.includes('purchasing')) {
    return {
      title,
      summary: 'Use Purchasing to execute supplier orders: convert drafts to vendor POs, track statuses, and receive lines.',
      steps: [
        'Open Operations > Purchasing.',
        'In Draft Purchase Orders, click Create Vendor PO for a ready draft.',
        'Use Vendor Purchase Orders & Receiving to filter open/backordered POs.',
        'Click Receive on a vendor PO, post quantities, and confirm receipts.',
      ],
      tips: [
        'Use status filters to isolate open and backordered supplier orders.',
        'Export CSV for receiving/audit handoff when needed.',
      ],
      warnings: [
        'Receiving updates inventory quantities and costs, so verify line quantities before submit.',
      ],
    };
  }
  if (key.includes('warehouse')) {
    return {
      title,
      summary: 'Warehouse tracks your internal storage locations, scan events, and returns operations.',
      steps: [
        'Open Operations > Warehouse.',
        'Add your internal locations (cooler, freezer, depot) in Warehouses & Cycle Count.',
        'Log barcode scan/receive/pick/adjust events as operations occur.',
        'Track customer returns in Returns Tracking.',
      ],
      tips: [
        'Use short warehouse codes for faster reporting and scan workflows.',
        'Keep scan action types consistent so downstream reporting stays clean.',
      ],
      warnings: [
        'Warehouses are your own locations, not suppliers. Supplier ordering happens in Planning/Purchasing.',
      ],
    };
  }
  if (key.includes('reporting') || key.includes('analytics') || key.includes('rollup')) {
    return {
      title,
      summary: 'Analytics includes Unified Performance Rollups for customer, route, driver, and SKU performance.',
      steps: [
        'Open Financials > Analytics.',
        'Set start date, end date, and row limit in Unified Performance Rollups.',
        'Run the report and review grouped sections by customer, route, driver, and SKU.',
      ],
      tips: [
        'Use shorter date windows first for faster scans and cleaner outlier detection.',
        'Compare route and driver sections together when investigating margin changes.',
      ],
      warnings: [
        'Very large date ranges can flatten trends; start narrow and expand.',
      ],
    };
  }
  if (key.includes('portal') || key.includes('payment')) {
    return {
      title,
      summary: 'Customer portal payments are Stripe-powered for setup intents, checkout, and off-session/autopay charging.',
      steps: [
        'Open customer portal payment settings and create a setup intent.',
        'Use Payment Element to save a payment method securely.',
        'Pay invoices directly or run charge-now/autopay flow for eligible accounts.',
        'Validate webhook events in backend logs for success/failure outcomes.',
      ],
      tips: [
        'Use Checkout for one-off customer-directed payment sessions.',
        'Keep Stripe webhook secret and endpoint configuration aligned with environment.',
      ],
      warnings: [
        'Webhook signature verification must pass or payment status updates will be ignored.',
      ],
    };
  }
  return {
    title,
    summary: q
      ? `This guide explains how to use ${feature} and addresses your question: ${q}`
      : `This guide explains the usual workflow for ${feature}.`,
    steps: [
      `Open the ${feature} area from the main navigation.`,
      'Review the available fields and required inputs before making changes.',
      'Complete the action, then confirm the result in the related table or status panel.',
    ],
    tips: [
      'Use recent records or examples already in the app to match the expected format.',
      'Refresh the page data after major updates if totals or statuses look stale.',
    ],
    warnings: [
      'Some actions may be limited by your role permissions.',
    ],
  };
}

function normalizeWalkthrough(result, feature, question) {
  const fallback = heuristicWalkthrough(feature, question);
  const q = stringOr(question);
  const aiSummary = stringOr(result && result.summary, '');
  // When falling back to heuristic, append the user's question so it's surfaced in the summary
  const fallbackSummary = q ? `${fallback.summary} Regarding your question: ${q}` : fallback.summary;
  return {
    title: stringOr(result && result.title, fallback.title),
    summary: aiSummary || fallbackSummary,
    steps: Array.isArray(result && result.steps) && result.steps.length ? result.steps.map((item) => stringOr(item)).filter(Boolean) : fallback.steps,
    tips: Array.isArray(result && result.tips) && result.tips.length ? result.tips.map((item) => stringOr(item)).filter(Boolean) : fallback.tips,
    warnings: Array.isArray(result && result.warnings) ? result.warnings.map((item) => stringOr(item)).filter(Boolean) : fallback.warnings,
  };
}

function normalizeUnitToken(raw) {
  const unit = String(raw || '').trim().toLowerCase();
  if (['lb', 'lbs', 'pound', 'pounds'].includes(unit)) return 'lb';
  if (['ea', 'each', 'ct', 'count', 'pc', 'pcs', 'piece', 'pieces', 'unit', 'units'].includes(unit)) return 'each';
  if (['case', 'cases', 'cs'].includes(unit)) return 'case';
  if (['box', 'boxes', 'bx'].includes(unit)) return 'box';
  if (['pallet', 'pallets', 'plt'].includes(unit)) return 'pallet';
  if (['gallon', 'gallons', 'gal'].includes(unit)) return 'gallon';
  if (['dozen', 'dozens', 'dz'].includes(unit)) return 'dozen';
  if (['bag', 'bags'].includes(unit)) return 'bag';
  if (['carton', 'cartons', 'ctn'].includes(unit)) return 'carton';
  return '';
}

function splitIntakeLines(message) {
  return String(message || '')
    .split(/\r?\n/)
    .flatMap((line) => line.split(/[;]+/))
    .map((line) => line.replace(/^[\s\-*•]+/, '').replace(/^\d+[.)]\s+/, '').trim())
    .filter(Boolean);
}

function parseIntakeLine(line) {
  const qtyFirst = line.match(/^(\d+(?:\.\d+)?)\s*(lb|lbs|pound|pounds|ea|each|ct|count|pc|pcs|piece|pieces|case|cases|cs|box|boxes|bx|pallet|pallets|plt|gallon|gallons|gal|dozen|dozens|dz|bag|bags|carton|cartons|ctn)?\s+(.+?)(?:\s*(?:@|at)\s*\$?(\d+(?:\.\d+)?))?$/i);
  if (qtyFirst) {
    const amount = numberOr(qtyFirst[1], 1);
    const unit = normalizeUnitToken(qtyFirst[2]) || 'each';
    const name = stringOr(qtyFirst[3]).replace(/\s{2,}/g, ' ');
    const unitPrice = qtyFirst[4] ? numberOr(qtyFirst[4], 0) : 0;
    if (name) return { name, unit, amount, unit_price: unitPrice, notes: '', item_number: '' };
  }

  const qtyLast = line.match(/^(.+?)\s*(?:-|:|,)?\s*(\d+(?:\.\d+)?)\s*(lb|lbs|pound|pounds|ea|each|ct|count|pc|pcs|piece|pieces|case|cases|cs|box|boxes|bx|pallet|pallets|plt|gallon|gallons|gal|dozen|dozens|dz|bag|bags|carton|cartons|ctn)(?:\s*(?:@|at)\s*\$?(\d+(?:\.\d+)?))?$/i);
  if (qtyLast) {
    const name = stringOr(qtyLast[1]).replace(/\s{2,}/g, ' ');
    const amount = numberOr(qtyLast[2], 1);
    const unit = normalizeUnitToken(qtyLast[3]) || 'each';
    const unitPrice = qtyLast[4] ? numberOr(qtyLast[4], 0) : 0;
    if (name) return { name, unit, amount, unit_price: unitPrice, notes: '', item_number: '' };
  }

  return null;
}

function heuristicOrderIntakeDraft(message) {
  const lines = splitIntakeLines(message);
  const items = [];
  const warnings = [];

  const customerLine = lines.find((line) => /^(customer|client|for)\s*[:\-]/i.test(line));
  let customerNameHint = null;
  if (customerLine) {
    const m = customerLine.match(/^(?:customer|client|for)\s*[:\-]\s*(.+)$/i);
    customerNameHint = m ? stringOr(m[1]) : null;
  }

  for (const line of lines) {
    if (/^(customer|client|for|ship to|deliver to|address|phone|email)\b/i.test(line)) continue;
    if (/^(note|notes|instruction|instructions)\s*[:\-]/i.test(line)) continue;
    const parsed = parseIntakeLine(line);
    if (parsed) {
      items.push(parsed);
      continue;
    }
    if (line.split(' ').length >= 2 && !/^\d+([.,]\d+)?$/.test(line)) {
      items.push({ name: line, unit: 'each', amount: 1, unit_price: 0, notes: '', item_number: '' });
    }
  }

  if (!items.length) {
    warnings.push('Could not confidently extract line items. Review the source message and add items manually.');
  }

  const orderNoteLine = lines.find((line) => /(?:deliver|leave|call|substitute|asap|rush|before|after)/i.test(line));
  const orderNotes = orderNoteLine || '';

  return {
    customer_name_hint: customerNameHint || null,
    order_notes: orderNotes || null,
    items,
    warnings,
  };
}

function normalizeOrderIntakeDraft(result, message) {
  const fallback = heuristicOrderIntakeDraft(message);
  const rawItems = Array.isArray(result && result.items) ? result.items : fallback.items;
  const normalizedItems = rawItems
    .map((item) => ({
      name: stringOr(item && item.name),
      unit: normalizeUnitToken(item && item.unit) || 'each',
      amount: Math.max(0, numberOr(item && item.amount, 1)),
      unit_price: Math.max(0, numberOr(item && item.unit_price, 0)),
      notes: item && item.notes != null ? stringOr(item.notes) : '',
      item_number: item && item.item_number != null ? stringOr(item.item_number) : '',
    }))
    .filter((item) => item.name);

  const warnings = Array.isArray(result && result.warnings)
    ? result.warnings.map((warning) => stringOr(warning)).filter(Boolean)
    : fallback.warnings;

  return {
    customer_name_hint: result && result.customer_name_hint != null
      ? stringOr(result.customer_name_hint) || null
      : fallback.customer_name_hint,
    order_notes: result && result.order_notes != null
      ? stringOr(result.order_notes) || null
      : fallback.order_notes,
    items: normalizedItems.length ? normalizedItems : fallback.items,
    warnings: warnings.length ? warnings : fallback.warnings,
  };
}

async function generateWalkthrough(feature, question = '') {
  const userMessage = `Create a walkthrough for the following NodeRoute feature.

Feature: ${stringOr(feature, 'Dashboard')}
User question: ${question || 'No extra question provided.'}

Current product areas to account for:
- Planning: draft PO generation from projections/suggestions.
- Purchasing: vendor PO execution + receiving.
- Warehouse: internal warehouse locations, scans, and returns.
- Analytics: unified rollups by customer/route/driver/SKU.
- Portal payments: Stripe setup intents, checkout, charge-now, and webhook outcomes.

Explain how to use it inside the app, including the usual sequence of actions and any gotchas.`;

  try {
    const aiResult = await callAI({
      systemPrompt: WALKTHROUGH_SYSTEM_PROMPT,
      userMessage,
      schema: WALKTHROUGH_SCHEMA,
      maxTokens: 700,
    });
    return normalizeWalkthrough(aiResult, feature, question);
  } catch (error) {
    if (!String(error.message || '').includes('OPENAI_API_KEY')) {
      console.warn('AI walkthrough fallback:', error.message);
    }
    return normalizeWalkthrough(null, feature, question);
  }
}

async function generateOrderIntakeDraft(message) {
  const sourceMessage = stringOr(message);
  const heuristic = normalizeOrderIntakeDraft(null, sourceMessage);
  if (!sourceMessage) return heuristic;

  const userMessage = `Parse this food wholesale order intake message into structured order-entry fields.

Message:
${sourceMessage}

Return all extracted order line items and any warnings if details are unclear.`;

  try {
    const aiResult = await callAI({
      systemPrompt: ORDER_INTAKE_SYSTEM_PROMPT,
      userMessage,
      schema: ORDER_INTAKE_SCHEMA,
      maxTokens: 900,
    });
    return normalizeOrderIntakeDraft(aiResult, sourceMessage);
  } catch (error) {
    if (!String(error.message || '').includes('OPENAI_API_KEY')) {
      console.warn('AI order intake fallback:', error.message);
    }
    return heuristic;
  }
}

function normalizePOScan(result) {
  const items = Array.isArray(result && result.items) ? result.items : [];
  const weightedUnits = new Set(['lb', 'lbs', 'pound', 'pounds', 'kg', 'kgs', 'kilogram', 'kilograms', 'oz', 'ounce', 'ounces']);
  const countUnits = new Set(['ea', 'each', 'case', 'cases', 'box', 'boxes', 'bag', 'bags', 'pack', 'packs', 'dozen']);
  const normalizedItems = items.map((item) => {
    const quantity = item && item.quantity == null ? null : numberOr(item && item.quantity, null);
    const unitPrice = item && item.unit_price == null ? null : numberOr(item && item.unit_price, null);
    const total = item && item.total == null ? null : numberOr(item && item.total, null);
    const unit = item && item.unit != null ? stringOr(item.unit) : null;
    const normalizedUnit = String(unit || '').toLowerCase();
    const inferredType = weightedUnits.has(normalizedUnit)
      ? 'weighted'
      : countUnits.has(normalizedUnit)
        ? 'count'
        : 'unknown';
    const rawItemType = item && item.item_type != null ? stringOr(item.item_type).toLowerCase() : '';
    const rawLotNumber = item && item.lot_number != null ? stringOr(item.lot_number) : '';
    const rawLotConfidence = item && item.lot_number_confidence != null ? stringOr(item.lot_number_confidence).toLowerCase() : '';
    return {
      description: item && item.description != null ? stringOr(item.description) : null,
      category: item && item.category != null ? stringOr(item.category) : null,
      quantity,
      unit,
      unit_price: unitPrice,
      total: total != null ? total : (quantity != null && unitPrice != null ? Number((quantity * unitPrice).toFixed(2)) : null),
      item_type: ['weighted', 'count'].includes(rawItemType) ? rawItemType : inferredType,
      lot_number: rawLotNumber || null,
      lot_number_confidence: rawLotNumber
        ? (['low', 'medium', 'high'].includes(rawLotConfidence) ? rawLotConfidence : 'medium')
        : 'none',
    };
  });

  const computedTotal = normalizedItems.reduce((sum, item) => sum + numberOr(item.total, 0), 0);
  const vendorDetails = result && typeof result.vendor_details === 'object' && result.vendor_details
    ? result.vendor_details
    : {};
  const vendorName = stringOr(result && result.vendor != null ? result.vendor : vendorDetails.name) || null;

  return {
    vendor: vendorName,
    vendor_details: {
      name: stringOr(vendorDetails.name || vendorName) || null,
      contact: stringOr(vendorDetails.contact) || null,
      email: stringOr(vendorDetails.email) || null,
      phone: stringOr(vendorDetails.phone) || null,
      address: stringOr(vendorDetails.address) || null,
      payment_terms: stringOr(vendorDetails.payment_terms) || null,
    },
    po_number: result && result.po_number != null ? stringOr(result.po_number) || null : null,
    date: result && result.date != null ? stringOr(result.date) || null : null,
    items: normalizedItems,
    total_cost: result && result.total_cost != null ? numberOr(result.total_cost, computedTotal) : Number(computedTotal.toFixed(2)),
  };
}

/**
 * Normalize the various accepted call shapes into an ordered array of
 * `{ base64, mimeType }` page descriptors.
 *
 * Accepts:
 *   - parsePurchaseOrderImage(base64String, mimeType)        // legacy single
 *   - parsePurchaseOrderImage({ base64, mimeType })          // single object
 *   - parsePurchaseOrderImage([{ base64, mimeType }, ...])   // multi-page
 */
function normalizePoScanPages(input, fallbackMimeType = 'image/jpeg') {
  const toPage = (page) => {
    const base64 = typeof page === 'string' ? page : page && page.base64;
    if (!base64) return null;
    const rawMime = (page && typeof page === 'object' && page.mimeType) || fallbackMimeType;
    const mimeType = rawMime === 'application/pdf' ? 'application/pdf' : rawMime;
    return { base64, mimeType };
  };
  const list = Array.isArray(input) ? input : [input];
  return list.map(toPage).filter(Boolean);
}

async function parsePurchaseOrderImage(images, mimeType = 'image/jpeg') {
  const pages = normalizePoScanPages(images, mimeType);
  if (pages.length === 0) throw new Error('PO scan requires at least one image');
  try {
    const client = getClient();
    const response = await client.chat.completions.create({
      model: DEFAULT_VISION_MODEL,
      max_tokens: 4096,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: PO_SCAN_SCHEMA.name,
          strict: true,
          schema: PO_SCAN_SCHEMA.schema,
        },
      },
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: PO_SCAN_PROMPT },
          ...pages.map((page) => ({
            type: 'image_url',
            image_url: { url: `data:${page.mimeType};base64,${page.base64}`, detail: 'high' },
          })),
        ],
      }],
    });

    const choice = response.choices && response.choices[0];
    const refusal = choice && choice.message && choice.message.refusal;
    if (refusal) throw new Error(`Model refused request: ${refusal}`);

    const raw = extractMessageContent(choice && choice.message && choice.message.content);
    const parsed = safeJsonParse(raw);
    if (!parsed || typeof parsed !== 'object') throw new Error('PO scan returned invalid structured JSON');
    const result = normalizePOScan(parsed);
    if (result.items.length === 0) {
      console.warn('[po-scan] model returned valid JSON but zero items - likely low-quality image or token limit');
    }
    return result;
  } catch (err) {
    if (isAiConfigError(err)) throw createAiConfigError();
    console.warn('PO scan AI failed:', err.message);
    throw new Error('AI vision scan failed. Please try again with a clearer image or enter the details manually.');
  }
}

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

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE OPTIMIZATION
// ─────────────────────────────────────────────────────────────────────────────

const ROUTE_OPTIMIZATION_SYSTEM_PROMPT = `You are a logistics route optimizer for a food wholesale delivery operation.
Reorder delivery stops to minimize total drive time and fuel, accounting for geographic clustering and time windows.

Rules:
1. Return stop IDs in the optimal delivery sequence.
2. Cluster geographically close stops together.
3. Prefer delivery windows requested by customers when present.
4. Keep reasoning brief and operational.`;

const ROUTE_OPTIMIZATION_SCHEMA = {
  name: 'route_optimization',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['optimized_stop_ids', 'key_changes', 'estimated_efficiency_gain', 'reasoning'],
    properties: {
      optimized_stop_ids: { type: 'array', items: { type: 'string' } },
      key_changes: { type: 'array', items: { type: 'string' } },
      estimated_efficiency_gain: { type: 'string' },
      reasoning: { type: 'string' },
    },
  },
};

function stopCoordinates(stop) {
  const lat = numberOr(stop && stop.lat, NaN);
  const lng = numberOr(stop && stop.lng, NaN);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  return { lat, lng };
}

function haversineMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function coordinateRouteOptimization(stops) {
  const stopList = (stops || []).map((stop) => ({ ...stop, _coords: stopCoordinates(stop) }));
  const sortable = stopList.filter((stop) => stop._coords);
  if (sortable.length < 2) return null;

  const sorted = [sortable[0]];
  const remaining = sortable.slice(1);
  let currentCoords = sortable[0]._coords;

  while (remaining.length) {
    let nearestIndex = 0;
    let nearestDistance = Infinity;
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      const distance = haversineMiles(
        currentCoords.lat,
        currentCoords.lng,
        candidate._coords.lat,
        candidate._coords.lng,
      );
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    }
    const [nextStop] = remaining.splice(nearestIndex, 1);
    sorted.push(nextStop);
    currentCoords = nextStop._coords;
  }

  const unsortable = stopList.filter((stop) => !stop._coords);
  const optimizedStopIds = [...sorted, ...unsortable].map((stop) => String(stop.id));
  const coordinateCoverage = `${sortable.length} of ${stopList.length}`;
  const keyChanges = [`GPS optimization used recorded coordinates for ${coordinateCoverage} stop(s).`];
  if (unsortable.length) {
    keyChanges.push(`${unsortable.length} stop(s) without coordinates stayed at the end in their original order.`);
  }

  return {
    optimized_stop_ids: optimizedStopIds,
    key_changes: keyChanges,
    estimated_efficiency_gain: 'Approximate — GPS heuristic fallback',
    reasoning: 'Heuristic fallback: stop order optimized from recorded GPS coordinates, with non-geocoded stops preserved afterward.',
  };
}

function heuristicRouteOptimization(stops) {
  const coordinateResult = coordinateRouteOptimization(stops);
  if (coordinateResult) return coordinateResult;

  // Sort by zip code prefix for rough geographic clustering, then by full address within zone
  const withZip = stops.map((s) => {
    const zip = String(s.address || '').match(/\b(\d{5})\b/);
    return { ...s, _zipPrefix: zip ? zip[1].slice(0, 3) : 'zzz' };
  });
  const sorted = [...withZip].sort((a, b) =>
    a._zipPrefix.localeCompare(b._zipPrefix) || String(a.address || '').localeCompare(String(b.address || ''))
  );
  return {
    optimized_stop_ids: sorted.map((s) => String(s.id)),
    key_changes: ['Stops grouped by zip code prefix for approximate geographic clustering.'],
    estimated_efficiency_gain: 'Unknown — AI unavailable',
    reasoning: 'Heuristic fallback: stops sorted by zip code zone. Run again when AI is available for optimal routing.',
  };
}

async function optimizeRoute(stops) {
  if (!stops || stops.length < 2) {
    return {
      optimized_stop_ids: (stops || []).map((s) => String(s.id)),
      key_changes: [],
      estimated_efficiency_gain: 'N/A — fewer than 2 stops',
      reasoning: 'Nothing to optimize.',
    };
  }

  const stopList = stops.map((s, i) => {
    const coords = stopCoordinates(s);
    const coordinateText = coords ? `${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}` : 'Unavailable';
    return `${i + 1}. ID: ${s.id} | Customer: ${stringOr(s.customer_name, 'Unknown')} | Address: ${stringOr(s.address, 'No address')} | Coordinates: ${coordinateText} | Window: ${s.preferred_delivery_window || 'Any'}`;
  }).join('\n');

  const userMessage = `Optimize the sequence for these ${stops.length} delivery stops:

${stopList}

Use the coordinates as the primary routing signal whenever they are available.

Return the stop IDs in optimal delivery order.`;

  try {
    const result = await callAI({
      systemPrompt: ROUTE_OPTIMIZATION_SYSTEM_PROMPT,
      userMessage,
      schema: ROUTE_OPTIMIZATION_SCHEMA,
      maxTokens: 600,
    });
    // Validate all stop IDs are present
    const stopIds = new Set(stops.map((s) => String(s.id)));
    const returnedIds = (result.optimized_stop_ids || []).map(String);
    const allPresent = returnedIds.length === stops.length && returnedIds.every((id) => stopIds.has(id));
    if (!allPresent) return heuristicRouteOptimization(stops);
    return result;
  } catch (err) {
    if (String(err.message || '').includes('OPENAI_API_KEY')) throw err;
    return heuristicRouteOptimization(stops);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMER RISK SCORING
// ─────────────────────────────────────────────────────────────────────────────

const CUSTOMER_RISK_SYSTEM_PROMPT = `You are a credit and churn risk analyst for a food wholesale distribution company.
Assess each customer's risk based on payment behavior, order patterns, and account signals.

Rules:
1. Base risk_score on 0-100 where 0 is no risk and 100 is extreme risk.
2. risk_level must match: low (0-33), medium (34-66), high (67-100).
3. List specific, evidence-based risk_factors only.
4. recommended_action must be a concrete next step for the account manager.`;

const CUSTOMER_RISK_SCHEMA = {
  name: 'customer_risk_score',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['risk_level', 'risk_score', 'risk_factors', 'recommended_action', 'summary'],
    properties: {
      risk_level: { type: 'string', enum: ['low', 'medium', 'high'] },
      risk_score: { type: 'integer' },
      risk_factors: { type: 'array', items: { type: 'string' } },
      recommended_action: { type: 'string' },
      summary: { type: 'string' },
    },
  },
};

function heuristicCustomerRisk(customer, invoices, recentOrders) {
  const factors = [];
  let score = 0;

  if (customer.status === 'inactive') { score += 30; factors.push('Account is marked inactive.'); }
  if (customer.credit_hold_reason) { score += 40; factors.push(`On credit hold: ${customer.credit_hold_reason}`); }

  const overdueInvoices = (invoices || []).filter((inv) => inv.status === 'overdue');
  if (overdueInvoices.length > 0) {
    score += Math.min(40, overdueInvoices.length * 15);
    factors.push(`${overdueInvoices.length} overdue invoice(s).`);
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
  const recentCount = (recentOrders || []).filter((o) => new Date(o.created_at) >= thirtyDaysAgo).length;
  if (recentCount === 0 && (recentOrders || []).length > 0) {
    score += 20;
    factors.push('No orders in the past 30 days.');
  }

  score = clamp(score, 0, 100);
  const risk_level = score >= 67 ? 'high' : score >= 34 ? 'medium' : 'low';

  return {
    risk_level,
    risk_score: score,
    risk_factors: factors.length ? factors : ['No significant risk signals detected.'],
    recommended_action: risk_level === 'high'
      ? 'Contact customer immediately to resolve overdue balance or credit hold.'
      : risk_level === 'medium'
        ? 'Monitor account closely and follow up on any open invoices.'
        : 'No action required — continue normal account management.',
    summary: `${stringOr(customer.company_name, 'Customer')} scored ${score}/100 (${risk_level} risk).`,
  };
}

async function scoreCustomerRisk(customer, invoices = [], recentOrders = []) {
  const overdueCount = (invoices || []).filter((i) => i.status === 'overdue').length;
  const totalInvoiced = (invoices || []).reduce((s, i) => s + numberOr(i.total, 0), 0);
  const totalPaid = (invoices || []).filter((i) => i.status === 'paid').reduce((s, i) => s + numberOr(i.total, 0), 0);
  const orderCount = (recentOrders || []).length;
  const lastOrderDate = orderCount > 0
    ? recentOrders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0].created_at
    : null;

  const userMessage = `Score the credit and churn risk for this wholesale customer.

Customer: ${stringOr(customer.company_name, 'Unknown')}
Status: ${customer.status || 'active'}
Credit hold: ${customer.credit_hold_reason || 'None'}
Payment terms: ${customer.payment_terms || 'Unknown'}
Total invoiced (90 days): $${totalInvoiced.toFixed(2)}
Total paid (90 days): $${totalPaid.toFixed(2)}
Overdue invoices: ${overdueCount}
Orders (90 days): ${orderCount}
Last order: ${lastOrderDate || 'None on record'}`;

  try {
    const result = await callAI({
      systemPrompt: CUSTOMER_RISK_SYSTEM_PROMPT,
      userMessage,
      schema: CUSTOMER_RISK_SCHEMA,
      maxTokens: 500,
    });
    const score = clamp(intOr(result.risk_score, 0), 0, 100);
    const level = score >= 67 ? 'high' : score >= 34 ? 'medium' : 'low';
    return {
      risk_level: ['low', 'medium', 'high'].includes(result.risk_level) ? result.risk_level : level,
      risk_score: score,
      risk_factors: Array.isArray(result.risk_factors) ? result.risk_factors.map((f) => stringOr(f)).filter(Boolean) : [],
      recommended_action: stringOr(result.recommended_action, 'Monitor account.'),
      summary: stringOr(result.summary, ''),
    };
  } catch (err) {
    if (String(err.message || '').includes('OPENAI_API_KEY')) throw err;
    return heuristicCustomerRisk(customer, invoices, recentOrders);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ANOMALY DETECTION
// ─────────────────────────────────────────────────────────────────────────────

const ANOMALY_DETECTION_SYSTEM_PROMPT = `You are an operations anomaly detector for a food wholesale delivery company.
Identify unusual patterns in delivery and order data that may indicate problems.

Rules:
1. Only flag genuine anomalies — not normal variation.
2. Severity: high = needs immediate attention, medium = investigate soon, low = monitor.
3. Be specific: name the entity, metric, and why it's unusual.
4. Keep descriptions short and operational.`;

const ANOMALY_DETECTION_SCHEMA = {
  name: 'anomaly_detection',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['anomalies', 'analysis_period', 'summary'],
    properties: {
      analysis_period: { type: 'string' },
      summary: { type: 'string' },
      anomalies: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'severity', 'description', 'affected_entity', 'recommended_action'],
          properties: {
            type: { type: 'string' },
            severity: { type: 'string', enum: ['low', 'medium', 'high'] },
            description: { type: 'string' },
            affected_entity: { type: 'string' },
            recommended_action: { type: 'string' },
          },
        },
      },
    },
  },
};

function heuristicAnomalyDetection(deliveries, orders) {
  const anomalies = [];
  const today = new Date();

  // Flag deliveries stuck in transit > 24 hours
  (deliveries || []).forEach((d) => {
    if (d.status === 'in_transit' && d.created_at) {
      const hoursAgo = (today - new Date(d.created_at)) / 3600000;
      if (hoursAgo > 24) {
        anomalies.push({
          type: 'stuck_delivery',
          severity: 'high',
          description: `Delivery has been in-transit for ${Math.round(hoursAgo)} hours without completion.`,
          affected_entity: `Delivery ${d.id || 'unknown'}`,
          recommended_action: 'Contact the assigned driver to confirm delivery status.',
        });
      }
    }
  });

  // Flag orders with no activity in pending > 48 hours
  (orders || []).forEach((o) => {
    if (o.status === 'pending' && o.created_at) {
      const hoursAgo = (today - new Date(o.created_at)) / 3600000;
      if (hoursAgo > 48) {
        anomalies.push({
          type: 'stale_order',
          severity: 'medium',
          description: `Order has been in pending status for ${Math.round(hoursAgo / 24)} days.`,
          affected_entity: `Order for ${stringOr(o.customer_name, 'unknown customer')}`,
          recommended_action: 'Confirm the order with the customer or advance it to confirmed.',
        });
      }
    }
  });

  return {
    anomalies,
    analysis_period: 'Last 7 days',
    summary: anomalies.length
      ? `Detected ${anomalies.length} anomaly(ies) requiring attention.`
      : 'No significant anomalies detected in recent operations.',
  };
}

async function detectAnomalies(deliveries = [], orders = []) {
  const stuckDeliveries = (deliveries || []).filter((d) => {
    if (d.status !== 'in_transit' || !d.created_at) return false;
    return (Date.now() - new Date(d.created_at)) / 3600000 > 24;
  });

  const staleOrders = (orders || []).filter((o) => {
    if (o.status !== 'pending' || !o.created_at) return false;
    return (Date.now() - new Date(o.created_at)) / 3600000 > 48;
  });

  const cancelledRecent = (orders || []).filter((o) => o.status === 'cancelled').length;
  const deliveryStatuses = (deliveries || []).reduce((acc, d) => {
    acc[d.status] = (acc[d.status] || 0) + 1;
    return acc;
  }, {});

  const userMessage = `Analyze these recent operations for anomalies (last 7 days).

Deliveries (${deliveries.length} total):
- Status breakdown: ${JSON.stringify(deliveryStatuses)}
- Stuck in transit >24h: ${stuckDeliveries.length}
${stuckDeliveries.slice(0, 5).map((d) => `  • Delivery ${d.id}: ${Math.round((Date.now() - new Date(d.created_at)) / 3600000)}h in transit`).join('\n')}

Orders (${orders.length} total):
- Pending >48h: ${staleOrders.length}
- Recently cancelled: ${cancelledRecent}
${staleOrders.slice(0, 5).map((o) => `  • Order for ${o.customer_name || 'unknown'}: ${Math.round((Date.now() - new Date(o.created_at)) / 3600000)}h in pending`).join('\n')}`;

  try {
    const result = await callAI({
      systemPrompt: ANOMALY_DETECTION_SYSTEM_PROMPT,
      userMessage,
      schema: ANOMALY_DETECTION_SCHEMA,
      maxTokens: 800,
    });
    return {
      anomalies: Array.isArray(result.anomalies) ? result.anomalies : [],
      analysis_period: stringOr(result.analysis_period, 'Last 7 days'),
      summary: stringOr(result.summary, ''),
    };
  } catch (err) {
    if (String(err.message || '').includes('OPENAI_API_KEY')) throw err;
    return heuristicAnomalyDetection(deliveries, orders);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// VENDOR PERFORMANCE SCORING
// ─────────────────────────────────────────────────────────────────────────────

const VENDOR_SCORE_SYSTEM_PROMPT = `You are a vendor performance analyst for a food wholesale distribution company.
Score vendors based on their purchase order history.

Rules:
1. Scores are 0-100 where 100 is perfect.
2. overall_grade: A (90-100), B (75-89), C (60-74), D (45-59), F (<45).
3. strengths and concerns must be specific to the data provided.
4. Keep summary to 1-2 sentences.`;

const VENDOR_SCORE_SCHEMA = {
  name: 'vendor_performance_score',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['overall_grade', 'on_time_score', 'quality_score', 'price_consistency_score', 'summary', 'strengths', 'concerns'],
    properties: {
      overall_grade: { type: 'string', enum: ['A', 'B', 'C', 'D', 'F'] },
      on_time_score: { type: 'integer' },
      quality_score: { type: 'integer' },
      price_consistency_score: { type: 'integer' },
      summary: { type: 'string' },
      strengths: { type: 'array', items: { type: 'string' } },
      concerns: { type: 'array', items: { type: 'string' } },
    },
  },
};

function heuristicVendorScore(vendor, purchaseOrders) {
  const completed = (purchaseOrders || []).filter((po) => po.status === 'received' || po.status === 'complete');
  const partial = (purchaseOrders || []).filter((po) => po.status === 'partial');
  const total = (purchaseOrders || []).length;

  const onTimeScore = total > 0 ? clamp(Math.round((completed.length / total) * 100), 0, 100) : 50;
  const qualityScore = total > 0 ? clamp(Math.round(((completed.length + partial.length * 0.7) / total) * 100), 0, 100) : 50;
  const avg = Math.round((onTimeScore + qualityScore + 70) / 3);
  const grade = avg >= 90 ? 'A' : avg >= 75 ? 'B' : avg >= 60 ? 'C' : avg >= 45 ? 'D' : 'F';

  return {
    overall_grade: grade,
    on_time_score: onTimeScore,
    quality_score: qualityScore,
    price_consistency_score: 70,
    summary: `${stringOr(vendor.name, 'Vendor')} completed ${completed.length} of ${total} PO(s) fully. Grade: ${grade}.`,
    strengths: completed.length > 0 ? [`${completed.length} PO(s) received in full.`] : [],
    concerns: partial.length > 0 ? [`${partial.length} PO(s) only partially fulfilled.`] : [],
  };
}

async function scoreVendorPerformance(vendor, purchaseOrders = []) {
  const completed = (purchaseOrders || []).filter((po) => po.status === 'received' || po.status === 'complete').length;
  const partial = (purchaseOrders || []).filter((po) => po.status === 'partial').length;
  const pending = (purchaseOrders || []).filter((po) => po.status === 'pending' || po.status === 'ordered').length;
  const total = (purchaseOrders || []).length;

  const userMessage = `Score this vendor's performance based on their purchase order history.

Vendor: ${stringOr(vendor.name, 'Unknown')}
Category: ${vendor.category || 'General'}
Payment terms: ${vendor.payment_terms || 'Unknown'}
Notes: ${vendor.notes || 'None'}

Purchase Order Summary (last 90 days):
- Total POs: ${total}
- Fully received: ${completed}
- Partially received: ${partial}
- Still pending/ordered: ${pending}
- Fulfillment rate: ${total > 0 ? Math.round((completed / total) * 100) : 0}%`;

  try {
    const result = await callAI({
      systemPrompt: VENDOR_SCORE_SYSTEM_PROMPT,
      userMessage,
      schema: VENDOR_SCORE_SCHEMA,
      maxTokens: 500,
    });
    return {
      overall_grade: ['A', 'B', 'C', 'D', 'F'].includes(result.overall_grade) ? result.overall_grade : 'C',
      on_time_score: clamp(intOr(result.on_time_score, 50), 0, 100),
      quality_score: clamp(intOr(result.quality_score, 50), 0, 100),
      price_consistency_score: clamp(intOr(result.price_consistency_score, 50), 0, 100),
      summary: stringOr(result.summary, ''),
      strengths: Array.isArray(result.strengths) ? result.strengths.map((s) => stringOr(s)).filter(Boolean) : [],
      concerns: Array.isArray(result.concerns) ? result.concerns.map((c) => stringOr(c)).filter(Boolean) : [],
    };
  } catch (err) {
    if (String(err.message || '').includes('OPENAI_API_KEY')) throw err;
    return heuristicVendorScore(vendor, purchaseOrders);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DRIVER ASSIGNMENT OPTIMIZATION
// ─────────────────────────────────────────────────────────────────────────────

const DRIVER_ASSIGNMENTS_SYSTEM_PROMPT = `You are a delivery operations manager for a food wholesale distribution company.
Match available drivers to routes based on workload, performance history, and capacity.

Rules:
1. Each route gets exactly one driver recommendation.
2. Balance workload fairly across drivers.
3. Prefer drivers with successful history on similar routes.
4. If a route cannot be confidently assigned, add it to unassignable_routes.`;

const DRIVER_ASSIGNMENTS_SCHEMA = {
  name: 'driver_assignments',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['assignments', 'unassignable_routes', 'summary'],
    properties: {
      summary: { type: 'string' },
      unassignable_routes: { type: 'array', items: { type: 'string' } },
      assignments: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['route_id', 'route_name', 'recommended_driver_name', 'reasoning', 'confidence'],
          properties: {
            route_id: { type: 'string' },
            route_name: { type: 'string' },
            recommended_driver_name: { type: 'string' },
            reasoning: { type: 'string' },
            confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
          },
        },
      },
    },
  },
};

function heuristicDriverAssignments(drivers, routes) {
  const assignments = [];
  // Track batch load so we don't pile routes onto one driver
  const batchLoad = {};
  (drivers || []).forEach((d) => { batchLoad[d.id || d.name] = d.active_count || 0; });

  (routes || []).forEach((route) => {
    const driverList = drivers || [];
    // Prefer driver already named on the route
    let best = driverList.find((d) => d.name && route.driver && d.name === route.driver);
    const retained = !!best;
    if (!best) {
      // Pick driver with lowest total load (existing active + batch-assigned so far), experience as tiebreak
      best = [...driverList].sort((a, b) => {
        const loadDiff = (batchLoad[a.id || a.name] || 0) - (batchLoad[b.id || b.name] || 0);
        return loadDiff !== 0 ? loadDiff : (b.completed_count || 0) - (a.completed_count || 0);
      })[0];
    }
    if (best) batchLoad[best.id || best.name] = (batchLoad[best.id || best.name] || 0) + 1;
    assignments.push({
      route_id: String(route.id),
      route_name: stringOr(route.name, `Route ${route.id}`),
      recommended_driver_name: best ? stringOr(best.name, 'Unknown') : 'Unassigned',
      reasoning: retained
        ? 'Retained existing driver assignment.'
        : 'Assigned to least-loaded available driver.',
      confidence: best ? 'medium' : 'low',
    });
  });
  return {
    assignments,
    unassignable_routes: [],
    summary: `Fallback: ${assignments.length} route(s) assigned by workload balancing.`,
  };
}

async function optimizeDriverAssignments(drivers = [], routes = []) {
  if (!drivers.length || !routes.length) {
    return { assignments: [], unassignable_routes: routes.map((r) => String(r.id)), summary: 'No drivers or routes provided.' };
  }

  const driverSummary = (drivers || []).map((d) =>
    `- ${stringOr(d.name, 'Unknown')} (completed deliveries: ${d.completed_count || 0}, active routes: ${d.active_count || 0})`
  ).join('\n');

  const routeSummary = (routes || []).map((r) =>
    `- Route "${stringOr(r.name, r.id)}" (ID: ${r.id}, stops: ${r.stop_count || 'unknown'}, area: ${r.area || 'unknown'})`
  ).join('\n');

  const userMessage = `Assign drivers to routes for today's deliveries.

Available Drivers:
${driverSummary}

Routes to Assign:
${routeSummary}

Match each route to the best available driver. Balance workload.`;

  try {
    const result = await callAI({
      systemPrompt: DRIVER_ASSIGNMENTS_SYSTEM_PROMPT,
      userMessage,
      schema: DRIVER_ASSIGNMENTS_SCHEMA,
      maxTokens: 700,
    });
    return {
      assignments: Array.isArray(result.assignments) ? result.assignments : [],
      unassignable_routes: Array.isArray(result.unassignable_routes) ? result.unassignable_routes : [],
      summary: stringOr(result.summary, ''),
    };
  } catch (err) {
    if (String(err.message || '').includes('OPENAI_API_KEY')) throw err;
    return heuristicDriverAssignments(drivers, routes);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SPOILAGE MARKDOWN RECOMMENDATIONS
// ─────────────────────────────────────────────────────────────────────────────

const MARKDOWN_SYSTEM_PROMPT = `You are a perishable inventory manager for a food wholesale distribution company.
Recommend markdown discounts for items approaching expiry to maximize revenue and minimize waste.

Rules:
1. Items expiring in 1-2 days: recommend 30-50% discount (urgency: immediate).
2. Items expiring in 3-5 days: recommend 15-30% discount (urgency: soon).
3. Items expiring in 6-10 days: recommend 5-15% discount (urgency: plan_ahead).
4. Message should be a brief customer-facing promo note.
5. suggested_action should be an internal ops step.`;

const MARKDOWN_SCHEMA = {
  name: 'markdown_recommendations',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['recommendations', 'summary'],
    properties: {
      summary: { type: 'string' },
      recommendations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['product_id', 'product_name', 'lot_number', 'days_until_expiry', 'current_stock', 'suggested_discount_pct', 'urgency', 'message', 'suggested_action'],
          properties: {
            product_id: { type: 'string' },
            product_name: { type: 'string' },
            lot_number: { type: ['string', 'null'] },
            days_until_expiry: { type: 'integer' },
            current_stock: { type: 'integer' },
            suggested_discount_pct: { type: 'integer' },
            urgency: { type: 'string', enum: ['immediate', 'soon', 'plan_ahead'] },
            message: { type: 'string' },
            suggested_action: { type: 'string' },
          },
        },
      },
    },
  },
};

function heuristicMarkdownRecommendations(expiringItems) {
  const recommendations = (expiringItems || []).map((item) => {
    const days = intOr(item.days_until_expiry, 0);
    const urgency = days <= 2 ? 'immediate' : days <= 5 ? 'soon' : 'plan_ahead';
    const discount = days <= 2 ? 40 : days <= 5 ? 20 : 10;
    return {
      product_id: stringOr(item.item_number, 'unknown'),
      product_name: stringOr(item.description, 'Unknown product'),
      lot_number: item.lot_number || null,
      days_until_expiry: days,
      current_stock: intOr(item.on_hand_qty, 0),
      suggested_discount_pct: discount,
      urgency,
      message: `Special pricing on ${item.description} — ${discount}% off while supplies last.`,
      suggested_action: urgency === 'immediate'
        ? `Contact top buyers immediately. Move ${item.description} before ${item.expiry_date}.`
        : `Feature in next order communication. Target accounts that buy ${item.description} regularly.`,
    };
  });

  return {
    recommendations,
    summary: `${recommendations.length} item(s) flagged for markdown to reduce spoilage loss.`,
  };
}

async function generateMarkdownRecommendations(expiringItems = []) {
  if (!expiringItems.length) {
    return { recommendations: [], summary: 'No items approaching expiry.' };
  }

  const itemList = expiringItems.map((item) =>
    `- ${stringOr(item.description, 'Unknown')} (ID: ${item.item_number}, Lot: ${item.lot_number || 'N/A'}, Stock: ${intOr(item.on_hand_qty, 0)} ${item.unit || 'units'}, Expires: ${item.expiry_date}, Days left: ${intOr(item.days_until_expiry, 0)})`
  ).join('\n');

  const userMessage = `Generate markdown recommendations for these expiring items:

${itemList}

Recommend discounts that will move product before spoilage while protecting margin.`;

  try {
    const result = await callAI({
      systemPrompt: MARKDOWN_SYSTEM_PROMPT,
      userMessage,
      schema: MARKDOWN_SCHEMA,
      maxTokens: 900,
    });
    return {
      recommendations: Array.isArray(result.recommendations) ? result.recommendations.map((r) => ({
        product_id: stringOr(r.product_id, 'unknown'),
        product_name: stringOr(r.product_name, 'Unknown'),
        lot_number: r.lot_number || null,
        days_until_expiry: intOr(r.days_until_expiry, 0),
        current_stock: intOr(r.current_stock, 0),
        suggested_discount_pct: clamp(intOr(r.suggested_discount_pct, 10), 0, 90),
        urgency: ['immediate', 'soon', 'plan_ahead'].includes(r.urgency) ? r.urgency : 'plan_ahead',
        message: stringOr(r.message, ''),
        suggested_action: stringOr(r.suggested_action, ''),
      })) : [],
      summary: stringOr(result.summary, ''),
    };
  } catch (err) {
    if (String(err.message || '').includes('OPENAI_API_KEY')) throw err;
    return heuristicMarkdownRecommendations(expiringItems);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// INVOICE FOLLOW-UP DRAFT
// ─────────────────────────────────────────────────────────────────────────────

const INVOICE_FOLLOWUP_SYSTEM_PROMPT = `You are an accounts receivable assistant for a food wholesale distribution company.
Draft payment follow-up messages for overdue invoices. Match tone to days overdue.

Rules:
1. tone friendly: 1-14 days overdue — polite reminder.
2. tone firm: 15-30 days overdue — firm but professional.
3. tone urgent: 31+ days overdue — direct, escalation implied.
4. Body must mention the invoice amount and due date.
5. key_points are internal notes for the AR team, not customer-facing.`;

const INVOICE_FOLLOWUP_SCHEMA = {
  name: 'invoice_followup',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['subject', 'body', 'tone', 'key_points'],
    properties: {
      subject: { type: 'string' },
      body: { type: 'string' },
      tone: { type: 'string', enum: ['friendly', 'firm', 'urgent'] },
      key_points: { type: 'array', items: { type: 'string' } },
    },
  },
};

function heuristicInvoiceFollowUp(invoice, customer, daysOverdue) {
  const tone = daysOverdue >= 31 ? 'urgent' : daysOverdue >= 15 ? 'firm' : 'friendly';
  const amount = numberOr(invoice.total, 0).toFixed(2);
  const customerName = stringOr(customer && customer.company_name, invoice.customer_name || 'Valued Customer');
  const invoiceNum = stringOr(invoice.invoice_number || invoice.id, 'your invoice');

  const bodies = {
    friendly: `Hi ${customerName},\n\nThis is a friendly reminder that invoice ${invoiceNum} for $${amount} was due ${daysOverdue} day(s) ago. If payment has already been sent, please disregard this notice.\n\nYou can pay online through our customer portal. Please let us know if you have any questions.\n\nThank you,\nNodeRoute Accounts Receivable`,
    firm: `Dear ${customerName},\n\nOur records show that invoice ${invoiceNum} for $${amount} is now ${daysOverdue} days past due. Please arrange payment at your earliest convenience to avoid any service interruption.\n\nIf there is a dispute or issue with this invoice, please contact us immediately.\n\nRegards,\nNodeRoute Accounts Receivable`,
    urgent: `Dear ${customerName},\n\nThis is an urgent notice. Invoice ${invoiceNum} for $${amount} is ${daysOverdue} days overdue. Immediate payment or contact from your accounts payable team is required.\n\nFailure to respond may result in a hold on future orders.\n\nNodeRoute Accounts Receivable`,
  };

  return {
    subject: tone === 'urgent'
      ? `URGENT: Invoice ${invoiceNum} — ${daysOverdue} Days Overdue`
      : tone === 'firm'
        ? `Invoice ${invoiceNum} — Payment Required`
        : `Payment Reminder: Invoice ${invoiceNum}`,
    body: bodies[tone],
    tone,
    key_points: [`Invoice ${invoiceNum} is ${daysOverdue} days overdue for $${amount}.`, `Customer: ${customerName}.`],
  };
}

async function generateInvoiceFollowUp(invoice, customer = {}, daysOverdue = 0) {
  const amount = numberOr(invoice.total, 0).toFixed(2);
  const customerName = stringOr(customer.company_name, invoice.customer_name || 'Customer');
  const invoiceNum = stringOr(invoice.invoice_number || invoice.id, 'unknown');

  const userMessage = `Draft a payment follow-up for this overdue invoice.

Customer: ${customerName}
Invoice #: ${invoiceNum}
Amount: $${amount}
Due date: ${invoice.due_date || 'Unknown'}
Days overdue: ${daysOverdue}
Payment terms: ${customer.payment_terms || invoice.payment_terms || 'Net 30'}
Prior invoices on this account: ${invoice.prior_invoice_count || 'Unknown'}`;

  try {
    const result = await callAI({
      systemPrompt: INVOICE_FOLLOWUP_SYSTEM_PROMPT,
      userMessage,
      schema: INVOICE_FOLLOWUP_SCHEMA,
      maxTokens: 600,
    });
    return {
      subject: stringOr(result.subject, ''),
      body: stringOr(result.body, ''),
      tone: ['friendly', 'firm', 'urgent'].includes(result.tone) ? result.tone : 'friendly',
      key_points: Array.isArray(result.key_points) ? result.key_points.map((k) => stringOr(k)).filter(Boolean) : [],
    };
  } catch (err) {
    if (String(err.message || '').includes('OPENAI_API_KEY')) throw err;
    return heuristicInvoiceFollowUp(invoice, customer, daysOverdue);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ENHANCED CHAT WITH LIVE DB CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

async function generateChatReplyWithContext(userName, userRole, message, history = [], dbContext = {}) {
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

// ── BULK REORDER ALERTS ────────────────────────────────────────────────────────
async function generateBulkReorderAlerts(items) {
  // items: [{ item_number, description, on_hand_qty, unit, cost, daily_usage, days_until_stockout, reorder_qty }]
  const urgentOnly = items
    .filter((i) => i.days_until_stockout !== null && i.days_until_stockout <= 14)
    .sort((a, b) => (a.days_until_stockout ?? 99) - (b.days_until_stockout ?? 99))
    .slice(0, 25);

  if (!urgentOnly.length) {
    return { alerts: [], summary: 'No items require immediate reordering.' };
  }

  const itemList = urgentOnly.map((i) =>
    `${i.description} (#${i.item_number}): ${i.on_hand_qty} ${i.unit} on hand, ${i.daily_usage.toFixed(2)} ${i.unit}/day, ${i.days_until_stockout}d until stockout, suggest ${i.reorder_qty} ${i.unit}`
  ).join('\n');

  const userMessage = `You are a seafood inventory manager. Analyze these items nearing stockout and return a ranked reorder plan:\n\n${itemList}\n\nReturn a JSON object with:\n- alerts: array of { item_number, description, urgency ("CRITICAL"|"WARNING"|"LOW"), days_until_stockout, suggested_order_qty, unit, reason }\n- summary: one-sentence overview`;

  const BULK_REORDER_SCHEMA = {
    name: 'bulk_reorder_alerts',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['alerts', 'summary'],
      properties: {
        summary: { type: 'string' },
        alerts: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['item_number', 'description', 'urgency', 'days_until_stockout', 'suggested_order_qty', 'unit', 'reason'],
            properties: {
              item_number:        { type: 'string' },
              description:        { type: 'string' },
              urgency:            { type: 'string', enum: ['CRITICAL', 'WARNING', 'LOW'] },
              days_until_stockout:{ type: 'integer' },
              suggested_order_qty:{ type: 'number' },
              unit:               { type: 'string' },
              reason:             { type: 'string' },
            },
          },
        },
      },
    },
  };

  try {
    const result = await callAI({
      systemPrompt: 'You are an expert seafood inventory analyst. Return only valid JSON.',
      userMessage,
      maxTokens: 800,
      schema: BULK_REORDER_SCHEMA,
    });
    if (result && Array.isArray(result.alerts)) return result;
    return { alerts: urgentOnly.map((i) => ({
      item_number: i.item_number,
      description: i.description,
      urgency: i.days_until_stockout <= 3 ? 'CRITICAL' : i.days_until_stockout <= 7 ? 'WARNING' : 'LOW',
      days_until_stockout: i.days_until_stockout,
      suggested_order_qty: i.reorder_qty,
      unit: i.unit,
      reason: `${i.days_until_stockout} days of stock remaining at current velocity`,
    })), summary: `${urgentOnly.length} items need restocking.` };
  } catch (err) {
    if (String(err.message || '').includes('OPENAI_API_KEY')) throw err;
    return { alerts: urgentOnly.map((i) => ({
      item_number: i.item_number,
      description: i.description,
      urgency: i.days_until_stockout <= 3 ? 'CRITICAL' : i.days_until_stockout <= 7 ? 'WARNING' : 'LOW',
      days_until_stockout: i.days_until_stockout,
      suggested_order_qty: i.reorder_qty,
      unit: i.unit,
      reason: `${i.days_until_stockout} days of stock remaining at current velocity`,
    })), summary: `${urgentOnly.length} items need restocking.` };
  }
}

// ── LATE PAYMENT RISK SCORING ──────────────────────────────────────────────────
const LATE_PAYMENT_RISK_SCHEMA = {
  name: 'late_payment_risk',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['risks', 'summary'],
    properties: {
      summary: { type: 'string' },
      risks: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['customer_name', 'risk_level', 'risk_score', 'flag_reason', 'recommended_action'],
          properties: {
            customer_name:       { type: 'string' },
            risk_level:          { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
            risk_score:          { type: 'integer' },
            flag_reason:         { type: 'string' },
            recommended_action:  { type: 'string' },
          },
        },
      },
    },
  },
};

async function scoreLatePaymentRisk(customerData) {
  // customerData: [{ customer_name, total_open, days_overdue_max, invoice_count, oldest_invoice_days, buckets }]
  const atRisk = customerData.filter((c) => c.total_open > 0).slice(0, 30);
  if (!atRisk.length) return { risks: [], summary: 'No open AR to analyze.' };

  const customerList = atRisk.map((c) =>
    `${c.customer_name}: $${c.total_open.toFixed(2)} open, ${c.invoice_count} invoices, oldest ${c.oldest_invoice_days}d, max overdue ${c.days_overdue_max}d`
  ).join('\n');

  const userMessage = `You are an AR collections analyst. Score the late payment risk for each customer:\n\n${customerList}\n\nReturn JSON with:\n- risks: array of { customer_name, risk_level ("HIGH"|"MEDIUM"|"LOW"), risk_score (0-100), flag_reason, recommended_action }\n- summary: one-sentence overview of portfolio risk`;

  try {
    const result = await callAI({
      systemPrompt: 'You are an expert accounts receivable analyst. Return only valid JSON.',
      userMessage,
      maxTokens: 900,
      schema: LATE_PAYMENT_RISK_SCHEMA,
    });
    if (result && Array.isArray(result.risks)) return result;
    throw new Error('bad shape');
  } catch (err) {
    if (String(err.message || '').includes('OPENAI_API_KEY')) throw err;
    const risks = atRisk.map((c) => {
      const score = Math.min(100, Math.round((c.days_overdue_max / 90) * 50 + (c.total_open / 5000) * 50));
      return {
        customer_name: c.customer_name,
        risk_level: score >= 70 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW',
        risk_score: score,
        flag_reason: c.days_overdue_max > 60 ? 'Invoice 60+ days overdue' : c.total_open > 2000 ? 'High balance outstanding' : 'Open AR',
        recommended_action: score >= 70 ? 'Escalate — call immediately' : score >= 40 ? 'Send payment reminder' : 'Monitor',
      };
    });
    return { risks, summary: `${risks.filter((r) => r.risk_level === 'HIGH').length} high-risk accounts identified.` };
  }
}

// ── PRICING ANOMALY DETECTION ──────────────────────────────────────────────────
function detectPricingAnomalies(orders) {
  // Compute per-item average price from all orders, then flag outliers > 25% below average
  const priceSums = {};   // item_number → { sum, count, description }
  for (const order of orders) {
    for (const item of (order.items || [])) {
      const num = String(item.item_number || '').trim();
      if (!num) continue;
      const price = Number(item.unit_price ?? item.price_per_lb ?? 0);
      if (!Number.isFinite(price) || price <= 0) continue;
      if (!priceSums[num]) priceSums[num] = { sum: 0, count: 0, description: item.name || item.description || num };
      priceSums[num].sum += price;
      priceSums[num].count += 1;
    }
  }

  const anomalies = [];
  for (const order of orders) {
    for (const item of (order.items || [])) {
      const num = String(item.item_number || '').trim();
      if (!num || !priceSums[num] || priceSums[num].count < 2) continue;
      const avg = priceSums[num].sum / priceSums[num].count;
      const price = Number(item.unit_price ?? item.price_per_lb ?? 0);
      if (!Number.isFinite(price) || price <= 0) continue;
      const pct_below = (avg - price) / avg;
      if (pct_below >= 0.25) {
        anomalies.push({
          order_id: order.id,
          order_number: order.order_number,
          customer_name: order.customer_name,
          item_number: num,
          description: priceSums[num].description,
          sale_price: price,
          avg_price: Math.round(avg * 100) / 100,
          pct_below: Math.round(pct_below * 1000) / 10,
          severity: pct_below >= 0.5 ? 'HIGH' : 'MEDIUM',
        });
      }
    }
  }

  return {
    anomalies: anomalies.sort((a, b) => b.pct_below - a.pct_below).slice(0, 50),
    summary: anomalies.length
      ? `${anomalies.length} pricing anomaly${anomalies.length > 1 ? 'ies' : ''} detected.`
      : 'No significant pricing anomalies found.',
  };
}

const REORDER_CONFIDENCE_SCHEMA = {
  name: 'reorder_confidence_score',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['score'],
    properties: {
      score: { type: 'number' },
    },
  },
};

const REORDER_REASON_SCHEMA = {
  name: 'reorder_reason_enhancement',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['reason'],
    properties: {
      reason: { type: 'string' },
    },
  },
};

function heuristicReorderConfidence(input = {}) {
  const historyDays = numberOr(input.days_of_history_available, 0);
  const usage = numberOr(input.avg_daily_usage, 0);
  const upcoming = numberOr(input.upcoming_demand, 0);
  let score = 0.45;
  if (historyDays >= 365) score += 0.25;
  else if (historyDays >= 30) score += 0.18;
  else if (historyDays >= 14) score += 0.12;
  else if (historyDays >= 7) score += 0.08;
  if (usage > 0) score += 0.15;
  if (String(input.usage_trend || 'stable') === 'stable') score += 0.05;
  if (Math.abs(numberOr(input.seasonal_adjustment, 0)) > 25) score -= 0.05;
  if (upcoming > usage * 7 && usage > 0) score -= 0.05;
  return clamp(Number(score.toFixed(3)), 0, 1);
}

async function scoreReorderConfidence(input = {}) {
  if (!process.env.OPENAI_API_KEY) return heuristicReorderConfidence(input);
  const userMessage = `How confident are you in this reorder suggestion on a scale of 0 to 1? Return JSON with only { "score": number }.

${JSON.stringify(input, null, 2)}`;
  try {
    const result = await callAI({
      systemPrompt: 'You score inventory reorder suggestion confidence for food distributors. Use sparse history, trend volatility, seasonality, and upcoming demand. Return only valid JSON.',
      userMessage,
      schema: REORDER_CONFIDENCE_SCHEMA,
      maxTokens: 60,
    });
    return clamp(numberOr(result.score, heuristicReorderConfidence(input)), 0, 1);
  } catch (err) {
    if (String(err.message || '').includes('OPENAI_API_KEY')) throw err;
    return heuristicReorderConfidence(input);
  }
}

async function enhanceReorderReason(calculationData = {}, fallbackReason = '') {
  if (!process.env.OPENAI_API_KEY) return fallbackReason;
  const userMessage = `Rewrite this reorder explanation in clear, plain business English for a food distribution manager. Keep all important numbers and avoid hype.

Fallback reason:
${fallbackReason}

Calculation data:
${JSON.stringify(calculationData, null, 2)}`;
  try {
    const result = await callAI({
      systemPrompt: 'You write concise operational reorder explanations. Sound like a smart inventory manager, not a robot.',
      userMessage,
      schema: REORDER_REASON_SCHEMA,
      maxTokens: 260,
    });
    return stringOr(result.reason, fallbackReason);
  } catch (err) {
    if (String(err.message || '').includes('OPENAI_API_KEY')) throw err;
    return fallbackReason;
  }
}

// ── VENDOR LIST SCORING ────────────────────────────────────────────────────────
const VENDOR_LIST_SCORE_SCHEMA = {
  name: 'vendor_list_scores',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['scores', 'summary'],
    properties: {
      summary: { type: 'string' },
      scores: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['vendor', 'score', 'grade', 'strengths', 'risks'],
          properties: {
            vendor:    { type: 'string' },
            score:     { type: 'integer' },
            grade:     { type: 'string', enum: ['A', 'B', 'C', 'D', 'F'] },
            strengths: { type: 'array', items: { type: 'string' } },
            risks:     { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  },
};

async function scoreVendorList(vendorSummaries) {
  // vendorSummaries: [{ vendor, po_count, total_value, short_ship_count, avg_lead_days }]
  if (!vendorSummaries.length) return { scores: [], summary: 'No vendor data.' };

  const list = vendorSummaries.map((v) =>
    `${v.vendor}: ${v.po_count} POs, $${v.total_value.toFixed(2)} total, ${v.short_ship_count} exceptions, ~${v.avg_lead_days}d lead time`
  ).join('\n');

  const userMessage = `Score these vendors on reliability, fill rate, and value:\n\n${list}\n\nReturn JSON:\n- scores: array of { vendor, score (0-100), grade ("A"|"B"|"C"|"D"|"F"), strengths: string[], risks: string[] }\n- summary: one-sentence overview`;

  try {
    const result = await callAI({
      systemPrompt: 'You are a vendor performance analyst for a seafood distributor. Return only valid JSON.',
      userMessage,
      maxTokens: 700,
      schema: VENDOR_LIST_SCORE_SCHEMA,
    });
    if (result && Array.isArray(result.scores)) return result;
    throw new Error('bad shape');
  } catch (err) {
    if (String(err.message || '').includes('OPENAI_API_KEY')) throw err;
    const scores = vendorSummaries.map((v) => {
      const score = Math.max(0, Math.min(100, Math.round(100 - (v.short_ship_count / Math.max(1, v.po_count)) * 60)));
      const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';
      return { vendor: v.vendor, score, grade, strengths: score >= 80 ? ['Consistent delivery'] : [], risks: v.short_ship_count > 0 ? [`${v.short_ship_count} exceptions`] : [] };
    });
    return { scores, summary: 'Vendor scores estimated from PO data.' };
  }
}

module.exports = {
  forecastDemand,
  analyzeInventory,
  generateReorderAlert,
  generateBulkReorderAlerts,
  scoreReorderConfidence,
  enhanceReorderReason,
  scoreLatePaymentRisk,
  detectPricingAnomalies,
  generateWalkthrough,
  generateOrderIntakeDraft,
  normalizePOScan,
  parsePurchaseOrderImage,
  buildWeeklyBuckets,
  generateChatReply,
  generateChatReplyWithContext,
  checkChatRateLimit,
  heuristicChatReply,
  optimizeRoute,
  scoreCustomerRisk,
  detectAnomalies,
  scoreVendorPerformance,
  scoreVendorList,
  optimizeDriverAssignments,
  generateMarkdownRecommendations,
  generateInvoiceFollowUp,
  heuristicRouteOptimization,
  coordinateRouteOptimization,
};
