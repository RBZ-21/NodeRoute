const OpenAI = require('openai');

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const DEFAULT_VISION_MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-4o';

const FORECAST_SYSTEM_PROMPT = `You are a demand forecasting analyst for a seafood and perishable goods delivery warehouse.
Your job is to analyze historical sales data and predict future demand accurately.

Rules you MUST follow:
1. Focus on recent consumption patterns first, then adjust for trend.
2. Perishable goods should avoid aggressive over-ordering.
3. If history is sparse, lower confidence instead of inventing certainty.
4. Use whole integers for all unit counts.
5. Keep reasoning practical and concise.`;

const INVENTORY_SYSTEM_PROMPT = `You are a warehouse inventory management AI for a seafood distribution and delivery business.
You specialize in perishable goods, spoilage prevention, and waste reduction.

Rules:
1. Prioritize CRITICAL first, then WARNING, then INFO.
2. Any item expiring within 3 days should be treated as urgent.
3. Keep reasons short and operationally useful.
4. Suggested actions should be specific next steps, not generic advice.`;

const REORDER_ALERT_SYSTEM_PROMPT = `You are an operations alert writer for a seafood warehouse delivery company.
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

const ORDER_INTAKE_SYSTEM_PROMPT = `You are an order-intake assistant for a seafood and perishable delivery operation.
Convert unstructured customer messages into clean line items for order entry.

Rules:
1. Extract only what is present in the message. Do not invent products.
2. Prefer quantity + unit + item name.
3. Use unit "lb" for weight-based items and "each" for piece/count items.
4. If quantity is missing but item is clearly requested, set amount to 1.
5. Keep notes short and operational.
6. Return structured JSON only.`;

const PO_SCAN_PROMPT = `You are a purchase order scanner for a seafood distribution warehouse.
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
  const userMessage = `Analyze demand for this seafood/perishable product and provide a ${forecastDays}-day forecast.

Product:
- ID: ${stringOr(product.item_number, 'unknown')}
- Name: ${stringOr(product.description, 'Unknown product')}
- Category: ${stringOr(product.category, 'Seafood')}
- Unit: ${stringOr(product.unit, 'lb')}
- Current stock on hand: ${numberOr(product.on_hand_qty, 0)} ${stringOr(product.unit, 'lb')}
- Cost per unit: $${numberOr(product.cost, 0)}

Weekly usage history (last ${weeklyBuckets.length} weeks, oldest to newest):
${weeklyBuckets.map((week) => `- Week of ${week.week}: used ${week.used} ${stringOr(product.unit, 'units')}`).join('\n')}

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
  const qtyFirst = line.match(/^(\d+(?:\.\d+)?)\s*(lb|lbs|pound|pounds|ea|each|ct|count|pc|pcs|piece|pieces)?\s+(.+?)(?:\s*(?:@|at)\s*\$?(\d+(?:\.\d+)?))?$/i);
  if (qtyFirst) {
    const amount = numberOr(qtyFirst[1], 1);
    const unit = normalizeUnitToken(qtyFirst[2]) || 'each';
    const name = stringOr(qtyFirst[3]).replace(/\s{2,}/g, ' ');
    const unitPrice = qtyFirst[4] ? numberOr(qtyFirst[4], 0) : 0;
    if (name) return { name, unit, amount, unit_price: unitPrice, notes: '', item_number: '' };
  }

  const qtyLast = line.match(/^(.+?)\s*(?:-|:|,)?\s*(\d+(?:\.\d+)?)\s*(lb|lbs|pound|pounds|ea|each|ct|count|pc|pcs|piece|pieces)(?:\s*(?:@|at)\s*\$?(\d+(?:\.\d+)?))?$/i);
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

  const userMessage = `Parse this order intake message into structured order-entry fields.

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

module.exports = {
  forecastDemand,
  analyzeInventory,
  generateReorderAlert,
  generateWalkthrough,
  generateOrderIntakeDraft,
  parsePurchaseOrderImage,
  buildWeeklyBuckets,
};
