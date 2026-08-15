import test from 'node:test';
import assert from 'node:assert/strict';
import { rankContext } from './context-selection.js';

test('rankContext prefers higher priority files within the character budget', () => {
  assert.deepEqual(rankContext([
    { file: 'low.ts', characters: 100, priority: 1 },
    { file: 'high.ts', characters: 100, priority: 10 },
    { file: 'too-large.ts', characters: 500, priority: 20 },
  ], 200), ['high.ts', 'low.ts']);
});
