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
  actual_cost_usd?: number;
  changed_files: string[];
  error?: string;
};

export type Budget = { limit_usd: number; spent_usd: number; remaining_usd: number };
export type BudgetGuard = { limit_usd: number; spent_usd: number };
export const LEDGER_FILE = join('.klin', 'ledger.json');

export function estimateCostUsd(usage: ModelUsage, inputRatePerMillion: number, outputRatePerMillion: number): number {
  return (usage.input_tokens * inputRatePerMillion + usage.output_tokens * outputRatePerMillion) / 1_000_000;
}

export function assertWithinBudget(guard: BudgetGuard, estimatedAdditionalCostUsd: number): void {
  if (!Number.isFinite(estimatedAdditionalCostUsd) || estimatedAdditionalCostUsd < 0) throw new Error('Estimated additional cost must be a non-negative finite number');
  if (guard.spent_usd + estimatedAdditionalCostUsd > guard.limit_usd) {
    throw new Error(`Budget exceeded: spent $${guard.spent_usd.toFixed(6)} + estimated $${estimatedAdditionalCostUsd.toFixed(6)} > limit $${guard.limit_usd.toFixed(6)}`);
  }
}

export class BudgetCoordinator {
  private tail = Promise.resolve();
  private reservedUsd = 0;
  constructor(private readonly limitUsd: number, private spentUsd = 0) {}

  async reserve(amountUsd: number): Promise<number> {
    if (!Number.isFinite(amountUsd) || amountUsd < 0) throw new Error('Budget reservation must be a non-negative finite number');
    const operation = this.tail.then(() => {
      assertWithinBudget({ limit_usd: this.limitUsd, spent_usd: this.spentUsd + this.reservedUsd }, amountUsd);
      this.reservedUsd += amountUsd;
      return amountUsd;
    });
    this.tail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async settle(reservedUsd: number, actualCostUsd: number): Promise<void> {
    if (!Number.isFinite(actualCostUsd) || actualCostUsd < 0) throw new Error('Actual cost must be a non-negative finite number');
    const operation = this.tail.then(() => {
      this.reservedUsd = Math.max(0, this.reservedUsd - reservedUsd);
      this.spentUsd += actualCostUsd;
    });
    this.tail = operation.then(() => undefined, () => undefined);
    await operation;
  }

  get spent(): number { return this.spentUsd; }
  get reserved(): number { return this.reservedUsd; }
}

export function budgetSummary(limitUsd: number, entries: LedgerEntry[]): Budget {
  const spent_usd = entries.reduce((sum, entry) => sum + (entry.actual_cost_usd ?? entry.estimated_cost_usd), 0);
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

const ledgerTails = new Map<string, Promise<void>>();
export async function appendLedger(root: string, entry: LedgerEntry): Promise<void> {
  const previous = ledgerTails.get(root) ?? Promise.resolve();
  const operation = previous.then(async () => {
    const entries = await loadLedger(root);
    entries.push(entry);
    const path = join(root, LEDGER_FILE);
    await mkdir(join(root, '.klin'), { recursive: true });
    await writeFile(path, JSON.stringify(entries, null, 2) + '\n');
  });
  ledgerTails.set(root, operation.then(() => undefined, () => undefined));
  await operation;
}
