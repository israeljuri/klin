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
const isContributor = selected.modelName === 'muse-spark-1.2-contributor';
const inputRatePerMillion = process.env.KLIN_INPUT_RATE_PER_MILLION
  ? Number(process.env.KLIN_INPUT_RATE_PER_MILLION)
  : isContributor ? 0.10 : undefined;
const cachedInputRatePerMillion = process.env.KLIN_CACHED_INPUT_RATE_PER_MILLION
  ? Number(process.env.KLIN_CACHED_INPUT_RATE_PER_MILLION)
  : isContributor ? 0.002 : undefined;
const outputRatePerMillion = process.env.KLIN_OUTPUT_RATE_PER_MILLION
  ? Number(process.env.KLIN_OUTPUT_RATE_PER_MILLION)
  : isContributor ? 0.20 : undefined;

if (!dryRun && (inputRatePerMillion === undefined || outputRatePerMillion === undefined)) {
  console.error('Cost accounting rates are not configured for this model. Set KLIN_INPUT_RATE_PER_MILLION and KLIN_OUTPUT_RATE_PER_MILLION.');
  process.exit(2);
}

const result = await runProject({
  root,
  model: selected.model,
  modelName: selected.modelName,
  dryRun,
  concurrency,
  budgetUsd: process.env.KLIN_BUDGET_USD ? Number(process.env.KLIN_BUDGET_USD) : undefined,
  inputRatePerMillion,
  cachedInputRatePerMillion,
  outputRatePerMillion,
  contextMaxCharacters: process.env.KLIN_CONTEXT_MAX_CHARS ? Number(process.env.KLIN_CONTEXT_MAX_CHARS) : undefined,
  maxTasks: process.env.KLIN_MAX_TASKS ? Number(process.env.KLIN_MAX_TASKS) : undefined,
  maxAttemptsPerTask: process.env.KLIN_MAX_ATTEMPTS ? Number(process.env.KLIN_MAX_ATTEMPTS) : undefined,
});

console.log(JSON.stringify({
  mode: dryRun ? 'dry-run' : 'live',
  model: selected.modelName,
  concurrency,
  pricing: {
    input_per_million_usd: inputRatePerMillion,
    cached_input_per_million_usd: cachedInputRatePerMillion,
    output_per_million_usd: outputRatePerMillion,
  },
  ...result,
}, null, 2));
