import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendLedger, assertWithinBudget, budgetSummary, estimateCostUsd, loadLedger } from './ledger.js';
import type { ModelUsage } from './orchestrator.js';

const usage: ModelUsage = {
  input_tokens: 756,
  cached_tokens: 0,
  output_tokens: 3665,
  reasoning_tokens: 3179,
  total_tokens: 4421,
};

test('estimateCostUsd calculates from actual token counts and supplied rates', () => {
  assert.equal(estimateCostUsd(usage, 1, 2), (756 + 3665 * 2) / 1_000_000);
});

test('estimateCostUsd charges cached input at the cached rate', () => {
  const cachedUsage: ModelUsage = { ...usage, input_tokens: 1000, cached_tokens: 400, output_tokens: 500 };
  assert.equal(estimateCostUsd(cachedUsage, 0.10, 0.20, 0.002), (600 * 0.10 + 400 * 0.002 + 500 * 0.20) / 1_000_000);
});

test('assertWithinBudget permits work inside the limit', () => {
  assert.doesNotThrow(() => assertWithinBudget({ limit_usd: 1, spent_usd: 0.2 }, 0.3));
});

test('assertWithinBudget rejects work that would exceed the limit', () => {
  assert.throws(
    () => assertWithinBudget({ limit_usd: 1, spent_usd: 0.8 }, 0.3),
    /Budget exceeded/,
  );
});

test('budgetSummary aggregates actual ledger costs', () => {
  const summary = budgetSummary(1, [
    { task_id: 'a', status: 'completed', attempts: 1, context_characters: 100, input_tokens: 10, cached_tokens: 0, output_tokens: 20, reasoning_tokens: 10, total_tokens: 30, estimated_cost_usd: 0.1, actual_cost_usd: 0.15, changed_files: [] },
    { task_id: 'b', status: 'failed', attempts: 2, context_characters: 200, input_tokens: 30, cached_tokens: 5, output_tokens: 40, reasoning_tokens: 20, total_tokens: 70, estimated_cost_usd: 0.25, actual_cost_usd: 0.2, changed_files: [], error: 'test failure' },
  ]);
  assert.equal(summary.spent_usd, 0.35);
  assert.equal(summary.remaining_usd, 0.65);
});

test('ledger persists entries locally', async () => {
  const root = await mkdtemp(join(tmpdir(), 'klin-ledger-'));
  try {
    await appendLedger(root, {
      task_id: 'demo',
      status: 'completed',
      attempts: 1,
      context_characters: 100,
      input_tokens: 10,
      cached_tokens: 0,
      output_tokens: 20,
      reasoning_tokens: 5,
      total_tokens: 30,
      estimated_cost_usd: 0.001,
      actual_cost_usd: 0.0012,
      changed_files: ['src/a.ts'],
    });
    const entries = await loadLedger(root);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].task_id, 'demo');
    assert.equal(entries[0].actual_cost_usd, 0.0012);
    assert.match(await readFile(join(root, '.klin', 'ledger.json'), 'utf8'), /demo/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
