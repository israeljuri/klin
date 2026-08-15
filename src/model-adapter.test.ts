import test from 'node:test';
import assert from 'node:assert/strict';
import { createResponsesAdapter } from './model-adapter.js';

const request = { task: { id: 't1', description: 'demo', files: [] }, context: { files: [], characters: 0 }, prompt: 'demo' };

test('adapter dry-run makes no network request', async () => {
  let called = false;
  const model = createResponsesAdapter({ model: 'test', endpoint: 'https://example.invalid', dryRun: true, fetchImpl: async () => { called = true; throw new Error('network'); } });
  const result = await model(request);
  assert.equal(called, false);
  assert.equal(result.response_id, 'dry-run');
});

test('adapter parses structured response and usage', async () => {
  const model = createResponsesAdapter({
    model: 'test', endpoint: 'https://example.test', apiKey: 'test',
    fetchImpl: async () => new Response(JSON.stringify({
      id: 'resp_test',
      output: [{ type: 'message', content: [{ type: 'output_text', text: '{"edits":[{"file":"a.ts","old_text":"a","new_text":"b"}]}' }] }],
      usage: { input_tokens: 10, input_tokens_details: { cached_tokens: 2 }, output_tokens: 20, output_tokens_details: { reasoning_tokens: 15 }, total_tokens: 30 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }),
  });
  const result = await model(request);
  assert.equal(result.response_id, 'resp_test');
  assert.deepEqual(result.edits[0], { file: 'a.ts', old_text: 'a', new_text: 'b' });
  assert.equal(result.usage?.cached_tokens, 2);
  assert.equal(result.usage?.reasoning_tokens, 15);
});

test('adapter rejects malformed model output', async () => {
  const model = createResponsesAdapter({
    model: 'test', endpoint: 'https://example.test', apiKey: 'test',
    fetchImpl: async () => new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'not json' }] }] }), { status: 200 }),
  });
  await assert.rejects(() => model(request), /invalid JSON/);
});
