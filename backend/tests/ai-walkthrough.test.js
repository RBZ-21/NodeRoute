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
