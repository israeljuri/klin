import test from 'node:test';
import assert from 'node:assert/strict';
import { assertContextWithinLimit, estimateContext, estimateInputTokens } from './context-budget.js';

test('estimateInputTokens uses a transparent planning heuristic', () => {
  assert.equal(estimateInputTokens(1), 1);
  assert.equal(estimateInputTokens(400), 100);
  assert.equal(estimateInputTokens(401), 101);
});

test('estimateContext includes prompt overhead', () => {
  const estimate = estimateContext({ id: 't', description: 'do it', files: ['a.ts'] }, { files: [{ path: 'a.ts', content: 'x'.repeat(100) }], characters: 100 });
  assert.ok(estimate.characters > 100);
  assert.ok(estimate.estimated_input_tokens > 25);
});

test('context limit is enforced before a model call', () => {
  const estimate = estimateContext({ id: 't', description: 'x', files: ['a.ts'] }, { files: [], characters: 1000 }, { max_characters: 100 });
  assert.equal(estimate.over_limit, true);
  assert.throws(() => assertContextWithinLimit(estimate), /exceeds configured/);
});
