const OpenAI = require('openai');

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

You help users navigate the platform, understand features, troubleshoot issues, and optimize their workflows. Be concise, practical, and operational. Answer directly and avoid filler.

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

const PO_SCAN_PROMPT = `You are a purchase order scanner for a food wholesale distribution warehouse.
Extract every visible line item from this purchase order or vendor invoice image.

Rules:
1. Return structured JSON only.
2. Preserve the written product description exactly when possible.
3. Infer category from the product name if it is not explicit.
4. If a value is not legible, return null for that field.
5. Quantities and prices must be numbers, not strings.`;

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
    required: ['vendor', 'po_number', 'date', 'items', 'total_cost'],
    properties: {
      vendor: { type: ['string', 'null'] },
      po_number: { type: ['string', 'null'] },
      date: { type: ['string', 'null'] },
      total_cost: { type: ['number', 'null'] },
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['description', 'category', 'quantity', 'unit', 'unit_price', 'total'],
          properties: {
            description: { type: ['string', 'null'] },
            category: { type: ['string', 'null'] },
            quantity: { type: ['number', 'null'] },
            unit: { type: ['string', 'null'] },
            unit_price: { type: ['number', 'null'] },
            total: { type: ['number', 'null'] },
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
  return {
    title: stringOr(result && result.title, fallback.title),
    summary: stringOr(result && result.summary, fallback.summary),
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
  const normalizedItems = items.map((item) => {
    const quantity = item && item.quantity == null ? null : numberOr(item && item.quantity, null);
    const unitPrice = item && item.unit_price == null ? null : numberOr(item && item.unit_price, null);
    const total = item && item.total == null ? null : numberOr(item && item.total, null);
    return {
      description: item && item.description != null ? stringOr(item.description) : null,
      category: item && item.category != null ? stringOr(item.category) : null,
      quantity,
      unit: item && item.unit != null ? stringOr(item.unit) : null,
      unit_price: unitPrice,
      total: total != null ? total : (quantity != null && unitPrice != null ? Number((quantity * unitPrice).toFixed(2)) : null),
    };
  });

  const computedTotal = normalizedItems.reduce((sum, item) => sum + numberOr(item.total, 0), 0);

  return {
    vendor: result && result.vendor != null ? stringOr(result.vendor) || null : null,
    po_number: result && result.po_number != null ? stringOr(result.po_number) || null : null,
    date: result && result.date != null ? stringOr(result.date) || null : null,
    items: normalizedItems,
    total_cost: result && result.total_cost != null ? numberOr(result.total_cost, computedTotal) : Number(computedTotal.toFixed(2)),
  };
}

async function parsePurchaseOrderImage(base64Image, mimeType = 'image/jpeg') {
  const client = getClient();
  const response = await client.chat.completions.create({
    model: DEFAULT_VISION_MODEL,
    max_tokens: 1800,
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
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}`, detail: 'high' } },
      ],
    }],
  });

  const choice = response.choices && response.choices[0];
  const refusal = choice && choice.message && choice.message.refusal;
  if (refusal) throw new Error(`Model refused request: ${refusal}`);

  const raw = extractMessageContent(choice && choice.message && choice.message.content);
  const parsed = safeJsonParse(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('PO scan returned invalid structured JSON');
  }
  return normalizePOScan(parsed);
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

async function generateChatReply(userName, userRole, message, history = []) {
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

function heuristicRouteOptimization(stops) {
  // Simple heuristic: sort by address alphabetically as a placeholder
  const sorted = [...stops].sort((a, b) => String(a.address || '').localeCompare(String(b.address || '')));
  return {
    optimized_stop_ids: sorted.map((s) => String(s.id)),
    key_changes: ['Stops grouped alphabetically by address as a fallback sequence.'],
    estimated_efficiency_gain: 'Unknown — AI unavailable',
    reasoning: 'Heuristic fallback: stops sorted by address. Run again when AI is available for a proper geographic cluster.',
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

  const stopList = stops.map((s, i) => `${i + 1}. ID: ${s.id} | Customer: ${stringOr(s.customer_name, 'Unknown')} | Address: ${stringOr(s.address, 'No address')} | Window: ${s.preferred_delivery_window || 'Any'}`).join('\n');

  const userMessage = `Optimize the sequence for these ${stops.length} delivery stops:

${stopList}

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
  const driverList = [...(drivers || [])];
  (routes || []).forEach((route, i) => {
    const driver = driverList[i % Math.max(driverList.length, 1)];
    assignments.push({
      route_id: String(route.id),
      route_name: stringOr(route.name, `Route ${route.id}`),
      recommended_driver_name: driver ? stringOr(driver.name, 'Unknown') : 'Unassigned',
      reasoning: 'Round-robin fallback assignment — AI unavailable.',
      confidence: 'low',
    });
  });
  return {
    assignments,
    unassignable_routes: [],
    summary: 'Assignments generated via round-robin fallback.',
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
  if (dbContext.recentOrders && dbContext.recentOrders.length) {
    contextParts.push(`## Recent Orders (last 10)\n${dbContext.recentOrders.map((o) => `- Order for ${o.customer_name || 'unknown'}: status=${o.status}, date=${o.date || o.created_at}`).join('\n')}`);
  }
  if (dbContext.lowInventory && dbContext.lowInventory.length) {
    contextParts.push(`## Low Inventory Items\n${dbContext.lowInventory.map((i) => `- ${i.description}: ${i.on_hand_qty} ${i.unit} on hand`).join('\n')}`);
  }
  if (dbContext.overdueInvoices && dbContext.overdueInvoices.length) {
    contextParts.push(`## Overdue Invoices (${dbContext.overdueInvoices.length})\n${dbContext.overdueInvoices.slice(0, 10).map((inv) => `- ${inv.customer_name}: $${numberOr(inv.total, 0).toFixed(2)} overdue`).join('\n')}`);
  }
  if (dbContext.creditHoldCustomers && dbContext.creditHoldCustomers.length) {
    contextParts.push(`## Customers on Credit Hold\n${dbContext.creditHoldCustomers.map((c) => `- ${c.company_name}: ${c.credit_hold_reason}`).join('\n')}`);
  }
  if (dbContext.activeRoutes && dbContext.activeRoutes.length) {
    contextParts.push(`## Active Routes Today\n${dbContext.activeRoutes.map((r) => `- ${r.name}: driver=${r.driver || 'unassigned'}`).join('\n')}`);
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

  const response = await client.chat.completions.create({
    model: DEFAULT_MODEL,
    max_tokens: 600,
    messages,
  });

  const choice = response.choices && response.choices[0];
  const reply = extractMessageContent(choice && choice.message && choice.message.content);
  return reply || 'I was unable to generate a response. Please try again.';
}

module.exports = {
  forecastDemand,
  analyzeInventory,
  generateReorderAlert,
  generateWalkthrough,
  generateOrderIntakeDraft,
  parsePurchaseOrderImage,
  buildWeeklyBuckets,
  generateChatReply,
  generateChatReplyWithContext,
  checkChatRateLimit,
  optimizeRoute,
  scoreCustomerRisk,
  detectAnomalies,
  scoreVendorPerformance,
  optimizeDriverAssignments,
  generateMarkdownRecommendations,
  generateInvoiceFollowUp,
};
