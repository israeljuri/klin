import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ModelUsage, TaskResult } from './orchestrator.js';

export type LedgerEntry = {
  task_id: string;
  status: TaskResult['status'];
  model?: string;
  attempts: number;
  context_characters: number;
  input_tokens: number;
  cached_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number;
  changed_files: string[];
  error?: string;
};

export type Budget = {
  limit_usd: number;
  spent_usd: number;
  remaining_usd: number;
};

export type BudgetGuard = {
  limit_usd: number;
  spent_usd: number;
};

export const LEDGER_FILE = join('.klin', 'ledger.json');

export function estimateCostUsd(usage: ModelUsage, inputRatePerMillion: number, outputRatePerMillion: number): number {
  return (usage.input_tokens * inputRatePerMillion + usage.output_tokens * outputRatePerMillion) / 1_000_000;
}

export function assertWithinBudget(guard: BudgetGuard, estimatedAdditionalCostUsd: number): void {
  if (!Number.isFinite(estimatedAdditionalCostUsd) || estimatedAdditionalCostUsd < 0) {
    throw new Error('Estimated additional cost must be a non-negative finite number');
  }
  if (guard.spent_usd + estimatedAdditionalCostUsd > guard.limit_usd) {
    throw new Error(
      `Budget exceeded: spent $${guard.spent_usd.toFixed(6)} + estimated $${estimatedAdditionalCostUsd.toFixed(6)} > limit $${guard.limit_usd.toFixed(6)}`,
    );
  }
}

export function budgetSummary(limitUsd: number, entries: LedgerEntry[]): Budget {
  const spent_usd = entries.reduce((sum, entry) => sum + entry.estimated_cost_usd, 0);
  return { limit_usd: limitUsd, spent_usd, remaining_usd: Math.max(0, limitUsd - spent_usd) };
}

export async function loadLedger(root: string): Promise<LedgerEntry[]> {
  try {
    return JSON.parse(await readFile(join(root, LEDGER_FILE), 'utf8')) as LedgerEntry[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export async function appendLedger(root: string, entry: LedgerEntry): Promise<void> {
  const entries = await loadLedger(root);
  entries.push(entry);
  const path = join(root, LEDGER_FILE);
  await mkdir(join(root, '.klin'), { recursive: true });
  await writeFile(path, JSON.stringify(entries, null, 2) + '\n');
}
