const test = require('node:test');
const assert = require('node:assert/strict');

test('generateWalkthrough returns heuristic guidance when no API key is configured', async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete require.cache[require.resolve('../services/ai')];
  const { generateWalkthrough } = require('../services/ai');

  const walkthrough = await generateWalkthrough('Orders', 'How do I enter cut weights?');

  assert.equal(walkthrough.title, 'Orders Walkthrough');
  assert.match(walkthrough.summary, /cut weights/i);
  assert.ok(Array.isArray(walkthrough.steps));
  assert.ok(walkthrough.steps.length >= 3);
  assert.ok(Array.isArray(walkthrough.tips));
  assert.ok(Array.isArray(walkthrough.warnings));

  if (previousKey) process.env.OPENAI_API_KEY = previousKey;
  delete require.cache[require.resolve('../services/ai')];
});

test('generateOrderIntakeDraft returns structured intake draft when no API key is configured', async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete require.cache[require.resolve('../services/ai')];
  const { generateOrderIntakeDraft } = require('../services/ai');

  const draft = await generateOrderIntakeDraft(`Customer: Harbor Bistro
10 lb salmon fillet
4 each halibut steaks @ 18.5
Deliver before 9am`);

  assert.equal(draft.customer_name_hint, 'Harbor Bistro');
  assert.equal(Array.isArray(draft.items), true);
  assert.ok(draft.items.length >= 2);
  assert.equal(draft.items[0].unit, 'lb');
  assert.equal(draft.items[0].amount, 10);
  assert.match(draft.order_notes || '', /before 9am/i);

  if (previousKey) process.env.OPENAI_API_KEY = previousKey;
  delete require.cache[require.resolve('../services/ai')];
});
