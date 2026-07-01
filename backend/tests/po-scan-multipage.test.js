const test = require('node:test');
const assert = require('node:assert/strict');

const aiServicePath = require.resolve('../services/ai');
const openaiPath = require.resolve('openai');

// Capture the chat.completions.create payload by mocking the openai module
// before requiring the AI service, then exercising the real
// parsePurchaseOrderImage so we assert how many image blocks it sends.
function loadAiServiceWithCapturingClient() {
  const calls = [];
  function FakeOpenAI() {
    return {
      chat: {
        completions: {
          create: async (payload) => {
            calls.push(payload);
            return {
              choices: [{ message: { content: JSON.stringify({ items: [] }) } }],
            };
          },
        },
      },
    };
  }

  delete require.cache[aiServicePath];
  const previous = require.cache[openaiPath];
  require.cache[openaiPath] = { id: openaiPath, filename: openaiPath, loaded: true, exports: FakeOpenAI };

  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'sk-test-key';

  const service = require(aiServicePath);

  const restore = () => {
    if (previous) require.cache[openaiPath] = previous;
    else delete require.cache[openaiPath];
    delete require.cache[aiServicePath];
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  };

  return { service, calls, restore };
}

function imageBlocks(payload) {
  return payload.messages[0].content.filter((block) => block.type === 'image_url');
}

test('parsePurchaseOrderImage sends one image block per page for multi-page scans', async (t) => {
  const { service, calls, restore } = loadAiServiceWithCapturingClient();
  t.after(restore);

  await service.parsePurchaseOrderImage([
    { base64: 'AAAA', mimeType: 'image/png' },
    { base64: 'BBBB', mimeType: 'application/pdf' },
  ]);

  assert.equal(calls.length, 1);
  const blocks = imageBlocks(calls[0]);
  assert.equal(blocks.length, 2);
  assert.match(blocks[0].image_url.url, /^data:image\/png;base64,AAAA$/);
  assert.match(blocks[1].image_url.url, /^data:application\/pdf;base64,BBBB$/);
});

test('parsePurchaseOrderImage stays backward compatible with the single-arg call', async (t) => {
  const { service, calls, restore } = loadAiServiceWithCapturingClient();
  t.after(restore);

  await service.parsePurchaseOrderImage('CCCC', 'image/jpeg');

  assert.equal(calls.length, 1);
  const blocks = imageBlocks(calls[0]);
  assert.equal(blocks.length, 1);
  assert.match(blocks[0].image_url.url, /^data:image\/jpeg;base64,CCCC$/);
});

test('parsePurchaseOrderImage rejects an empty page list before calling the model', async (t) => {
  const { service, calls, restore } = loadAiServiceWithCapturingClient();
  t.after(restore);

  await assert.rejects(() => service.parsePurchaseOrderImage([]), /at least one image/);
  assert.equal(calls.length, 0);
});
