import 'dotenv/config';
import { resolve, join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { scanProject } from './project-brain.js';
import { createPlannerAdapter, planProject, projectPlanToState } from './project-planner.js';

const args = process.argv.slice(2);
const confirmSpend = args.includes('--confirm-spend');
const goal = args.filter(arg => arg !== '--confirm-spend').join(' ').trim();
const root = resolve(process.env.KLIN_ROOT ?? process.cwd());

if (!goal) {
  console.error('Usage: pnpm run project:plan -- "project goal" [--confirm-spend]');
  process.exit(2);
}
if (!confirmSpend) {
  console.error('Refusing a live planning request. Use --confirm-spend.');
  process.exit(2);
}
if (process.env.KLIN_LIVE !== '1') {
  console.error('Refusing a live planning request. Set KLIN_LIVE=1 explicitly.');
  process.exit(2);
}
if (!process.env.META_API_KEY) {
  console.error('Refusing a live planning request. META_API_KEY is not set.');
  process.exit(2);
}

const manifest = await scanProject(root);
const model = createPlannerAdapter({
  model: process.env.KLIN_MODEL ?? 'muse-spark-1.2-contributor',
  endpoint: process.env.KLIN_ENDPOINT ?? 'https://api.meta.ai/v1/responses',
  apiKey: process.env.META_API_KEY,
});
const result = await planProject(goal, manifest, model);

const state = projectPlanToState(result.plan);
const statePath = join(root, '.klin', 'project.json');
await mkdir(join(root, '.klin'), { recursive: true });
await writeFile(statePath, JSON.stringify(state, null, 2) + '\n');

const tasksDir = join(root, 'tasks');
await mkdir(tasksDir, { recursive: true });
for (const task of result.plan.tasks) {
  await writeFile(join(tasksDir, `${task.id}.json`), JSON.stringify({ ...task, dependencies: task.dependencies }, null, 2) + '\n');
}

console.log(JSON.stringify({ mode: 'live', model: process.env.KLIN_MODEL ?? 'muse-spark-1.2-contributor', taskCount: result.plan.tasks.length, taskIds: result.plan.tasks.map(task => task.id), statePath, usage: result.usage, responseId: result.response_id }, null, 2));
