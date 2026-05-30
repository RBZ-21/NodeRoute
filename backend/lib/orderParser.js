'use strict';

const Anthropic = require('@anthropic-ai/sdk');

const CATALOG = `Fish: Amberjack, Branzini, Catfish Fresh, Catfish Frozen, Flounder Medium, Flounder Jumbo, Golden Tile, Grouper Black, Grouper Gag, Halibut, Mahi, Salmon, Snapper Mutton, Swordfish, Tuna Yellowfin, Tuna Chunks, Whitefish Chunks
Shrimp: U-10 Dry Packed, U-15 Dry Packed, 10-20 Dry Packed, 20-30 Dry Packed, Royal Red Frozen, Fresh Shrimp 21-25, Fresh-Frozen 21-25, Fresh-Frozen 26-30, Domestic P&D 26-30
Crabmeat: Jumbo Lump, Super Lump, Lump, Backfin, Special, Claw, Cocktail Claws Fresh, Cocktail Claws
Lobster: Lobster 1lb, Lobster 1.25lb, Lobster 1.5lb, Lobster 2-3lb, Lobster 3-4lb
Oysters: Blue Points, Five Points, High Tides, James River, Salty Hogs, Salty Bays, Cupid Choice, Momma Mia, Sweet Petite, Wellfleet, Oyster Gallon, Mussels
Caviar: American Pride, Hackleback, Paddlefish, Osetra Royal Amber, White Sturgeon Classic, Keta Salmon Malossol, Trout Roe, Trout Roe Smoked, Truffle Pearlz, Tobikko Black, Tobikko Orange, Tobikko Red, Tobikko Wasabi`;

const SYSTEM_PROMPT = `You are an order-intake parser for Crosby's Seafood, a wholesale seafood distributor.
Extract a structured order from a phone call transcript and optional summary.

Rules:
1. Match spoken product names to the closest item in the product catalog. Set confidence 0.0-1.0.
2. Use confidence < 0.7 for ambiguous matches. Set needsCallback true if a critical item cannot be matched at all.
3. Extract quantities and units. Use "lb" for weight-based items, "each" for count items, "dozen" for oysters if stated.
4. If a delivery date is mentioned, parse it to YYYY-MM-DD. Resolve relative day names (e.g. "Thursday") relative to today.
5. Return ONLY valid JSON — no markdown fences, no prose.

Response schema (all fields required; use null when unknown):
{
  "customerName": string | null,
  "businessName": string | null,
  "requestedDeliveryDate": string | null,
  "items": [
    { "product": string, "quantity": number, "unit": string, "confidence": number, "rawText": string }
  ],
  "notes": string | null,
  "needsCallback": boolean,
  "callbackReason": string | null
}`;

async function parseOrderFromTranscript(transcript, summary) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const parts = [
    'PRODUCT CATALOG:\n' + CATALOG,
    summary ? ('CALL SUMMARY:\n' + summary) : null,
    'FULL TRANSCRIPT:\n' + transcript,
    'Parse this into the JSON schema described in your instructions.',
  ].filter(Boolean);

  const message = await client.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: parts.join('\n\n') }],
  });

  let raw = message.content[0]?.text ?? '';
  // Strip any markdown code fences the model may have added
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Failed to parse order JSON from Claude: ${err.message}. ` +
      `Raw (first 300 chars): ${raw.slice(0, 300)}`
    );
  }
}

module.exports = { parseOrderFromTranscript };
