import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { scanProject } from './project-brain.js';
import { expandContext } from './context-graph.js';
import { getReadyTasks, selectParallelReadyTasks, validateProjectState, type ProjectState, type Task as GraphTask } from './task-graph.js';
import { runPipeline, type Model } from './pipeline.js';
import { decideRetry } from './retry-policy.js';
import { BudgetCoordinator, loadLedger } from './ledger.js';

export type ProjectRunnerOptions = {
  root: string; statePath?: string; model: Model; modelName: string; budgetUsd?: number;
  inputRatePerMillion?: number; outputRatePerMillion?: number; contextMaxCharacters?: number;
  dryRun?: boolean; maxTasks?: number; maxAttemptsPerTask?: number; concurrency?: number;
};
export type ProjectRunResult = {
  status: 'completed' | 'blocked' | 'failed' | 'pending-model';
  completedTaskIds: string[];
  failedTaskId?: string;
  remainingTaskIds: string[];
};
type TaskContract = { id: string; description: string; files: string[]; test_command?: string; dependencies?: string[] };
type StateWriter = (state: ProjectState) => Promise<void>;

export async function loadProjectState(path: string): Promise<ProjectState> {
  try {
    const state = JSON.parse(await readFile(resolve(path), 'utf8')) as ProjectState;
    validateProjectState(state); return state;
  } catch (error) {
    if (!(error instanceof Error) || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const root = resolve(path, '..', '..');
    const tasksDir = join(root, 'tasks');
    const files = (await readdir(tasksDir)).filter(file => file.endsWith('.json')).sort();
    const tasks: GraphTask[] = [];
    for (const file of files) {
      const contract = JSON.parse(await readFile(join(tasksDir, file), 'utf8')) as TaskContract;
      tasks.push({ id: contract.id, title: contract.id, description: contract.description, dependencies: contract.dependencies ?? [], files: contract.files, test_command: contract.test_command, status: 'ready', attempts: 0 });
    }
    const state: ProjectState = { milestones: [], tasks };
    validateProjectState(state); await saveProjectState(path, state); return state;
  }
}

export async function saveProjectState(path: string, state: ProjectState): Promise<void> {
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(resolve(path), JSON.stringify(state, null, 2) + '\n');
}

function createStateWriter(path: string): StateWriter {
  let tail = Promise.resolve();
  return async (state: ProjectState) => {
    const snapshot = JSON.stringify(state);
    tail = tail.then(async () => {
      await mkdir(resolve(path, '..'), { recursive: true });
      await writeFile(resolve(path), JSON.stringify(JSON.parse(snapshot), null, 2) + '\n');
    });
    await tail;
  };
}

async function runTaskWithRetries(task: GraphTask, selectedFiles: string[], options: ProjectRunnerOptions, state: ProjectState, persist: StateWriter, budgetCoordinator?: BudgetCoordinator): Promise<{ status: 'completed' | 'failed'; error?: unknown }> {
  const maxAttempts = options.maxAttemptsPerTask ?? 2;
  let attempt = task.attempts ?? 0;
  task.status = 'in-progress';
  await persist(state);

  while (attempt < maxAttempts) {
    attempt += 1;
    task.attempts = attempt;
    await persist(state);
    try {
      const result = await runPipeline({
        root: options.root,
        task: { id: task.id, description: task.description, files: selectedFiles, test_command: task.test_command ?? 'node --test' },
        model: options.model,
        modelName: options.modelName,
        budgetUsd: options.budgetUsd,
        inputRatePerMillion: options.inputRatePerMillion,
        outputRatePerMillion: options.outputRatePerMillion,
        contextMaxCharacters: options.contextMaxCharacters,
        dryRun: options.dryRun,
        budgetCoordinator,
      });
      if (options.dryRun) { task.status = 'ready'; return { status: 'completed' }; }
      if (result.status !== 'completed') throw new Error(`Task ${task.id} did not complete`);
      task.status = 'completed';
      await persist(state);
      return { status: 'completed' };
    } catch (error) {
      const decision = decideRetry({ attempts: attempt, maxAttempts, error });
      if (!decision.retry) { task.status = 'failed'; await persist(state); return { status: 'failed', error }; }
      task.status = 'ready';
      await persist(state);
    }
  }

  task.status = 'failed';
  await persist(state);
  return { status: 'failed', error: new Error(`Task ${task.id} exhausted its attempt limit`) };
}

export async function runProject(options: ProjectRunnerOptions): Promise<ProjectRunResult> {
  const statePath = options.statePath ?? join(options.root, '.klin', 'project.json');
  const state = await loadProjectState(statePath);
  const persist = createStateWriter(statePath);
  const manifest = await scanProject(options.root);
  const completedTaskIds: string[] = [];
  let executed = 0;
  const concurrency = Math.max(1, options.concurrency ?? 1);
  const maxTasks = options.maxTasks ?? Number.MAX_SAFE_INTEGER;
  const budgetConfigured = options.budgetUsd !== undefined && options.inputRatePerMillion !== undefined && options.outputRatePerMillion !== undefined;
  const existingLedger = budgetConfigured ? await loadLedger(options.root) : [];
  const existingSpend = existingLedger.reduce((sum, entry) => sum + entry.estimated_cost_usd, 0);
  const budgetCoordinator = budgetConfigured ? new BudgetCoordinator(options.budgetUsd!, existingSpend) : undefined;

  while (executed < maxTasks) {
    const ready = getReadyTasks(state);
    if (!ready.length) {
      const remaining = state.tasks.filter(t => t.status !== 'completed').map(t => t.id);
      return { status: remaining.length ? 'blocked' : 'completed', completedTaskIds, remainingTaskIds: remaining };
    }
    const capacity = Math.min(concurrency, maxTasks - executed);
    const batch = selectParallelReadyTasks(state, capacity);
    if (!batch.length) return { status: 'blocked', completedTaskIds, remainingTaskIds: state.tasks.filter(t => t.status !== 'completed').map(t => t.id) };

    const prepared: Array<{ task: GraphTask; selectedFiles: string[] }> = [];
    for (const task of batch) {
      const selectedFiles = expandContext(manifest, task, 2);
      if (!selectedFiles.length) {
        task.status = 'failed';
        await persist(state);
        return { status: 'failed', completedTaskIds, failedTaskId: task.id, remainingTaskIds: state.tasks.filter(t => t.status !== 'completed').map(t => t.id) };
      }
      prepared.push({ task, selectedFiles });
    }

    if (options.dryRun) return { status: 'pending-model', completedTaskIds, remainingTaskIds: state.tasks.filter(t => t.status !== 'completed').map(t => t.id) };

    const results = await Promise.all(prepared.map(({ task, selectedFiles }) => runTaskWithRetries(task, selectedFiles, options, state, persist, budgetCoordinator)));
    for (let index = 0; index < results.length; index += 1) {
      if (results[index].status === 'completed') { completedTaskIds.push(prepared[index].task.id); executed += 1; }
    }

    const failed = results.find(result => result.status === 'failed');
    if (failed) {
      const failedIndex = results.indexOf(failed);
      return { status: 'failed', completedTaskIds, failedTaskId: prepared[failedIndex].task.id, remainingTaskIds: state.tasks.filter(t => t.status !== 'completed').map(t => t.id) };
    }
  }

  return { status: 'completed', completedTaskIds, remainingTaskIds: state.tasks.filter(t => t.status !== 'completed').map(t => t.id) };
}
