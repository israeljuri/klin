import 'dotenv/config';
import { resolve } from 'node:path';
import { createDryRunModel, createLiveModelFromEnv } from './pipeline.js';
import { runProject } from './project-runner.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const confirmSpend = args.includes('--confirm-spend');
const root = resolve(args.find(arg => !arg.startsWith('--')) ?? process.cwd());
const concurrency = Number(process.env.KLIN_CONCURRENCY ?? '2');

if (!dryRun && !confirmSpend) {
  console.error('Refusing a live project run. Use --dry-run or --confirm-spend.');
  process.exit(2);
}
if (!dryRun && process.env.KLIN_LIVE !== '1') {
  console.error('Refusing a live project run. Set KLIN_LIVE=1 explicitly.');
  process.exit(2);
}
if (!dryRun && !process.env.META_API_KEY) {
  console.error('Refusing a live project run. META_API_KEY is not set.');
  process.exit(2);
}
if (!Number.isInteger(concurrency) || concurrency < 1) {
  console.error('KLIN_CONCURRENCY must be a positive integer.');
  process.exit(2);
}

const selected = dryRun ? createDryRunModel() : createLiveModelFromEnv();
const result = await runProject({
  root,
  model: selected.model,
  modelName: selected.modelName,
  dryRun,
  concurrency,
  budgetUsd: process.env.KLIN_BUDGET_USD ? Number(process.env.KLIN_BUDGET_USD) : undefined,
  inputRatePerMillion: process.env.KLIN_INPUT_RATE_PER_MILLION ? Number(process.env.KLIN_INPUT_RATE_PER_MILLION) : undefined,
  outputRatePerMillion: process.env.KLIN_OUTPUT_RATE_PER_MILLION ? Number(process.env.KLIN_OUTPUT_RATE_PER_MILLION) : undefined,
  contextMaxCharacters: process.env.KLIN_CONTEXT_MAX_CHARS ? Number(process.env.KLIN_CONTEXT_MAX_CHARS) : undefined,
  maxTasks: process.env.KLIN_MAX_TASKS ? Number(process.env.KLIN_MAX_TASKS) : undefined,
  maxAttemptsPerTask: process.env.KLIN_MAX_ATTEMPTS ? Number(process.env.KLIN_MAX_ATTEMPTS) : undefined,
});

console.log(JSON.stringify({ mode: dryRun ? 'dry-run' : 'live', model: selected.modelName, concurrency, ...result }, null, 2));
