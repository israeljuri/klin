import { resolve } from 'node:path';
import { createDryRunModel, createLiveModelFromEnv, loadTask, runPipeline } from './pipeline.js';

const args = process.argv.slice(2);
const taskPath = args.find((arg) => !arg.startsWith('--')) ?? 'tasks/apply-discount.json';
const dryRun = args.includes('--dry-run');
const confirmSpend = args.includes('--confirm-spend');

if (!dryRun && !confirmSpend) {
  console.error('Refusing a live model request. Use --dry-run for zero-cost execution or --confirm-spend for one explicit paid request.');
  process.exit(2);
}

if (!dryRun && process.env.KLIN_LIVE !== '1') {
  console.error('Refusing a live model request. Set KLIN_LIVE=1 explicitly.');
  process.exit(2);
}

if (!dryRun && !process.env.META_API_KEY) {
  console.error('Refusing a live model request. META_API_KEY is not set.');
  process.exit(2);
}

const root = process.cwd();
const task = await loadTask(taskPath);
const selected = dryRun ? createDryRunModel() : createLiveModelFromEnv();

console.log('Klin pipeline');
console.log(`Task: ${task.id}`);
console.log(`Mode: ${dryRun ? 'DRY RUN (no API call)' : 'LIVE MODEL REQUEST (explicitly confirmed)'}`);
console.log(`Model: ${selected.modelName}`);
console.log(`Context files: ${task.files.length}`);

const result = await runPipeline({
  root: resolve(root), task, model: selected.model, modelName: selected.modelName, dryRun,
  budgetUsd: process.env.KLIN_BUDGET_USD ? Number(process.env.KLIN_BUDGET_USD) : undefined,
  inputRatePerMillion: process.env.KLIN_INPUT_RATE_PER_MILLION ? Number(process.env.KLIN_INPUT_RATE_PER_MILLION) : undefined,
  outputRatePerMillion: process.env.KLIN_OUTPUT_RATE_PER_MILLION ? Number(process.env.KLIN_OUTPUT_RATE_PER_MILLION) : undefined,
  contextMaxCharacters: process.env.KLIN_CONTEXT_MAX_CHARS ? Number(process.env.KLIN_CONTEXT_MAX_CHARS) : undefined,
});

console.log(JSON.stringify({ status: result.status, task_id: result.task_id, response_id: result.response_id, context_characters: result.context.characters, usage: result.model_usage, changed_files: result.changed_files ?? [] }, null, 2));
