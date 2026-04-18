const OpenAI = require('openai');

const FORECAST_SYSTEM_PROMPT = `You are a demand forecasting analyst for a seafood and perishable goods delivery warehouse.
Your job is to analyze historical sales data and predict future demand accurately.

Rules you MUST follow:
1. Always respond with ONLY valid JSON — no markdown, no explanation outside the JSON.
2. Account for trends (is demand rising, falling, or flat?).
3. Account for perishable goods — overstocking causes spoilage and financial loss.
4. If fewer than 3 data points exist, return confidence: "low".
5. All quantity predictions must be whole integers.

Output format — always return exactly this structure:
{
  "product_id": "<string>",
  "product_name": "<string>",
  "forecast_period_days": <number>,
  "predicted_demand_units": <integer>,
  "reorder_recommended": <true|false>,
  "suggested_reorder_quantity": <integer>,
  "confidence": "<low|medium|high>",
  "trend": "<increasing|decreasing|stable>",
  "reasoning": "<1-2 sentence plain English explanation>"
}`;

const INVENTORY_SYSTEM_PROMPT = `You are a warehouse inventory management AI for a seafood distribution and delivery business.
You specialize in perishable goods — spoilage prevention and waste reduction are top priorities.

Rules:
1. Respond ONLY with valid JSON — no text outside the JSON object.
2. Prioritize: CRITICAL (act today) → WARNING (act this week) → INFO (monitor only).
3. Any perishable item expiring within 3 days is automatically CRITICAL.
4. Overstocked = current stock > 2x average weekly demand.
5. Keep all "reason" fields under 20 words.
6. Sort action_items: CRITICAL first, then WARNING, then INFO.

Output JSON format:
{
  "analysis_date": "<ISO date>",
  "total_skus_analyzed": <integer>,
  "summary": {
    "critical_items": <integer>,
    "warning_items": <integer>,
    "overstocked_items": <integer>,
    "healthy_items": <integer>
  },
  "action_items": [
    {
      "priority": "CRITICAL|WARNING|INFO",
      "action": "REORDER|EXPEDITE_SALE|REDUCE_ORDER|MONITOR",
      "product_id": "<string>",
      "product_name": "<string>",
      "current_stock": <integer>,
      "reason": "<under 20 words>",
      "suggested_action": "<specific next step>"
    }
  ]
}`;

const REORDER_ALERT_SYSTEM_PROMPT = `You are an operations alert writer for a seafood warehouse delivery company.
Write short, urgent reorder alert messages for the warehouse team.

Rules:
1. Keep messages under 3 sentences.
2. Always include: product name, days until stockout, and recommended order quantity.
3. Tone: professional and direct. No filler.
4. If expiry is a factor, mention it.
5. Return JSON with only "subject" and "body" string fields.`;

let _client = null;

function getClient() {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY environment variable is not set');
    _client = new OpenAI({ apiKey });
  }
  return _client;
}

async function callAI(systemPrompt, userMessage, maxTokens = 512) {
  const client = getClient();
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: maxTokens,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userMessage },
    ],
  });
  const raw = response.choices[0]?.message?.content?.trim() || '{}';
  return JSON.parse(raw);
}

/**
 * @param {Object} product  - { item_number, description, unit, on_hand_qty, cost, category }
 * @param {Array}  history  - array of { change_qty, change_type, created_at } (newest first)
 * @param {number} forecastDays - how many days ahead to forecast (default 14)
 */
async function forecastDemand(product, history, forecastDays = 14) {
  const weeklyBuckets = buildWeeklyBuckets(history, 12);

  const userMessage = `Analyze demand for this seafood/perishable product and provide a ${forecastDays}-day forecast.

Product:
- ID: ${product.item_number}
- Name: ${product.description}
- Category: ${product.category || 'Seafood'}
- Unit: ${product.unit || 'lb'}
- Current stock on hand: ${product.on_hand_qty} ${product.unit || 'lb'}
- Cost per unit: $${product.cost || 0}

Weekly usage history (last ${weeklyBuckets.length} weeks, oldest→newest):
${weeklyBuckets.map(w => `  Week of ${w.week}: used ${w.used} ${product.unit || 'units'}`).join('\n')}

Total data points available: ${weeklyBuckets.filter(w => w.used > 0).length}

Forecast period: ${forecastDays} days`;

  return callAI(FORECAST_SYSTEM_PROMPT, userMessage, 512);
}

function buildWeeklyBuckets(history, numWeeks) {
  const buckets = [];
  const now = Date.now();
  for (let i = numWeeks - 1; i >= 0; i--) {
    const weekStart = new Date(now - (i + 1) * 7 * 86400000);
    const weekEnd   = new Date(now - i * 7 * 86400000);
    const label = weekStart.toISOString().split('T')[0];
    const used = (history || [])
      .filter(h => {
        const d = new Date(h.created_at);
        return d >= weekStart && d < weekEnd && parseFloat(h.change_qty) < 0;
      })
      .reduce((sum, h) => sum + Math.abs(parseFloat(h.change_qty)), 0);
    buckets.push({ week: label, used: parseFloat(used.toFixed(2)) });
  }
  return buckets;
}

/**
 * @param {Array} products       - [{ item_number, description, category, unit, on_hand_qty, cost }]
 * @param {Object} historyByItem - { [item_number]: [{ change_qty, created_at }] }
 * @param {Array} expiringLots   - [{ item_number, lot_number, expiry_date, qty_on_hand }]
 */
async function analyzeInventory(products, historyByItem, expiringLots) {
  const today = new Date().toISOString().split('T')[0];

  const inventoryPayload = products.map(p => {
    const history = historyByItem[p.item_number] || [];
    const weeklyBuckets = buildWeeklyBuckets(history, 4);
    const avgWeeklyDemand = parseFloat(
      (weeklyBuckets.reduce((s, w) => s + w.used, 0) / 4).toFixed(2)
    );
    const expiring = expiringLots.filter(l => l.item_number === p.item_number);
    const soonestExpiry = expiring.length
      ? expiring.sort((a, b) => new Date(a.expiry_date) - new Date(b.expiry_date))[0]
      : null;

    return {
      product_id:          p.item_number,
      product_name:        p.description,
      current_stock:       Math.round(p.on_hand_qty || 0),
      unit:                p.unit || 'lb',
      min_stock_threshold: Math.round(avgWeeklyDemand * 0.5),
      avg_weekly_demand:   avgWeeklyDemand,
      expiry_date:         soonestExpiry ? soonestExpiry.expiry_date : null,
      cost_per_unit:       parseFloat(p.cost) || 0,
    };
  });

  const userMessage = `Analyze this warehouse inventory snapshot taken on ${today}.

Inventory data:
${JSON.stringify(inventoryPayload, null, 2)}

Today is ${today}. CRITICAL items first. Return only the JSON.`;

  return callAI(INVENTORY_SYSTEM_PROMPT, userMessage, 4096);
}

/**
 * @param {Object} product     - { item_number, description, unit, on_hand_qty, cost }
 * @param {number} dailyUsage  - average daily usage
 * @param {number} reorderQty  - suggested reorder quantity
 * @param {string|null} expiryDate - ISO date string or null
 */
async function generateReorderAlert(product, dailyUsage, reorderQty, expiryDate = null) {
  const currentStock = Math.round(parseFloat(product.on_hand_qty) || 0);
  const daysUntilStockout = dailyUsage > 0
    ? Math.round(currentStock / dailyUsage)
    : null;

  const userMessage = `Write a reorder alert for this item:

Product: ${product.description}
Current Stock: ${currentStock} ${product.unit || 'lb'}
Daily Average Usage: ${parseFloat(dailyUsage).toFixed(2)} ${product.unit || 'lb'}
Recommended Reorder Quantity: ${reorderQty} ${product.unit || 'lb'}
Expiry Date: ${expiryDate || 'N/A'}
Days Until Stockout: ${daysUntilStockout !== null ? daysUntilStockout : 'Unknown'}

Return JSON with "subject" and "body" only.`;

  return callAI(REORDER_ALERT_SYSTEM_PROMPT, userMessage, 256);
}

module.exports = { forecastDemand, analyzeInventory, generateReorderAlert };
