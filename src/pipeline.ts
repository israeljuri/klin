import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assembleContext, buildModelPrompt, type Model, type Task, type TaskResult } from './orchestrator.js';
import { estimateContext, assertContextWithinLimit } from './context-budget.js';
import { appendLedger, estimateCostUsd, loadLedger, assertWithinBudget, type LedgerEntry } from './ledger.js';
import { createResponsesAdapter } from './model-adapter.js';
import { reconcileAndVerify, type Edit } from './reconcile.js';

export type PipelineOptions = {
  root: string;
  task: Task;
  model: Model;
  modelName: string;
  budgetUsd?: number;
  inputRatePerMillion?: number;
  outputRatePerMillion?: number;
  contextMaxCharacters?: number;
  dryRun?: boolean;
};

export async function runPipeline(options: PipelineOptions): Promise<TaskResult> {
  const context = await assembleContext(options.task, options.root);
  const estimate = estimateContext(options.task, context, { max_characters: options.contextMaxCharacters });
  assertContextWithinLimit(estimate);

  const ledger = await loadLedger(options.root);
  const spent = ledger.reduce((sum, entry) => sum + entry.estimated_cost_usd, 0);
  if (options.budgetUsd !== undefined && options.inputRatePerMillion !== undefined && options.outputRatePerMillion !== undefined) {
    const estimatedInputCost = estimate.estimated_input_tokens * options.inputRatePerMillion / 1_000_000;
    assertWithinBudget({ limit_usd: options.budgetUsd, spent_usd: spent }, estimatedInputCost);
  }

  const prompt = buildModelPrompt({ task: options.task, context });
  const modelResult = await options.model({ task: options.task, context, prompt });

  if (options.dryRun) {
    return { task_id: options.task.id, status: 'pending-model', context, model_usage: modelResult.usage, response_id: modelResult.response_id };
  }

  try {
    const verification = await reconcileAndVerify(modelResult.edits, options.root, options.task.test_command ?? 'node --test');
    const usage = modelResult.usage;
    const cost = usage && options.inputRatePerMillion !== undefined && options.outputRatePerMillion !== undefined
      ? estimateCostUsd(usage, options.inputRatePerMillion, options.outputRatePerMillion) : 0;
    // The model's actual usage is authoritative. We never reject after applying verified edits,
    // because doing so would leave a successful change in place while reporting a budget failure.
    await appendLedger(options.root, makeLedgerEntry(options, 'completed', cost, usage, verification.result.changed_files, context.characters));
    return { task_id: options.task.id, status: 'completed', context, model_usage: usage, response_id: modelResult.response_id, changed_files: verification.result.changed_files };
  } catch (error) {
    const usage = modelResult.usage;
    const cost = usage && options.inputRatePerMillion !== undefined && options.outputRatePerMillion !== undefined
      ? estimateCostUsd(usage, options.inputRatePerMillion, options.outputRatePerMillion) : 0;
    await appendLedger(options.root, makeLedgerEntry(options, 'failed', cost, usage, [], context.characters, error instanceof Error ? error.message : String(error)));
    throw error;
  }
}

function makeLedgerEntry(options: PipelineOptions, status: LedgerEntry['status'], cost: number, usage: TaskResult['model_usage'], changedFiles: string[], contextCharacters: number, error?: string): LedgerEntry {
  return {
    task_id: options.task.id, status, model: options.modelName, attempts: 1,
    context_characters: contextCharacters, input_tokens: usage?.input_tokens ?? 0, cached_tokens: usage?.cached_tokens ?? 0,
    output_tokens: usage?.output_tokens ?? 0, reasoning_tokens: usage?.reasoning_tokens ?? 0, total_tokens: usage?.total_tokens ?? 0,
    estimated_cost_usd: cost, changed_files: changedFiles, ...(error ? { error } : {}),
  };
}

export async function loadTask(path: string): Promise<Task> {
  return JSON.parse(await readFile(resolve(path), 'utf8')) as Task;
}

export function createLiveModelFromEnv(): { model: Model; modelName: string } {
  const modelName = process.env.KLIN_MODEL ?? 'muse-spark-1.2-contributor';
  const endpoint = process.env.KLIN_ENDPOINT ?? 'https://api.meta.ai/v1/responses';
  return { modelName, model: createResponsesAdapter({ model: modelName, endpoint, apiKey: process.env.META_API_KEY, dryRun: false }) };
}

export function createDryRunModel(): { model: Model; modelName: string } {
  return {
    modelName: 'dry-run',
    model: async () => ({
      response_id: 'dry-run',
      edits: [{ file: 'lab/coding-task/src/pricing.js', old_text: "import { subtotalCents } from './cart.js';\n\nexport function applyDiscount(cart, discountPercent) {\n  throw new Error('TODO: implement applyDiscount');\n}", new_text: "import { subtotalCents } from './cart.js';\n\nexport function applyDiscount(cart, discountPercent) {\n  if (discountPercent < 0 || discountPercent > 100) throw new RangeError('discountPercent must be between 0 and 100 inclusive');\n  return Math.round(subtotalCents(cart) * (100 - discountPercent) / 100);\n}" } as Edit],
      usage: { input_tokens: 0, cached_tokens: 0, output_tokens: 0, reasoning_tokens: 0, total_tokens: 0 },
    }),
  };
}
