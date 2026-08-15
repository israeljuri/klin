import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { scanProject } from './project-brain.js';
import { expandContext } from './context-graph.js';
import { getReadyTasks, validateProjectState, type ProjectState, type Task as GraphTask } from './task-graph.js';
import { runPipeline, type Model } from './pipeline.js';

export type ProjectRunnerOptions = {
  root: string; statePath?: string; model: Model; modelName: string; budgetUsd?: number;
  inputRatePerMillion?: number; outputRatePerMillion?: number; contextMaxCharacters?: number;
  dryRun?: boolean; maxTasks?: number;
};
export type ProjectRunResult = { status: 'completed' | 'blocked' | 'failed' | 'pending-model'; completedTaskIds: string[]; failedTaskId?: string; remainingTaskIds: string[] };
type TaskContract = { id: string; description: string; files: string[]; test_command?: string };

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
      tasks.push({ id: contract.id, title: contract.id, description: contract.description, dependencies: [], files: contract.files, status: 'ready' });
    }
    const state: ProjectState = { milestones: [], tasks };
    validateProjectState(state); await saveProjectState(path, state); return state;
  }
}

export async function saveProjectState(path: string, state: ProjectState): Promise<void> {
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(resolve(path), JSON.stringify(state, null, 2) + '\n');
}

export async function runProject(options: ProjectRunnerOptions): Promise<ProjectRunResult> {
  const statePath = options.statePath ?? join(options.root, '.klin', 'project.json');
  const state = await loadProjectState(statePath);
  const manifest = await scanProject(options.root);
  const completedTaskIds: string[] = [];
  let executed = 0;
  while (executed < (options.maxTasks ?? Number.MAX_SAFE_INTEGER)) {
    const ready = getReadyTasks(state);
    if (!ready.length) {
      const remaining = state.tasks.filter(t => t.status !== 'completed').map(t => t.id);
      return { status: remaining.length ? 'blocked' : 'completed', completedTaskIds, remainingTaskIds: remaining };
    }
    const task = ready[0];
    const selectedFiles = expandContext(manifest, task, 2);
    if (!selectedFiles.length) {
      task.status = 'failed'; await saveProjectState(statePath, state);
      return { status: 'failed', completedTaskIds, failedTaskId: task.id, remainingTaskIds: state.tasks.filter(t => t.status !== 'completed').map(t => t.id) };
    }
    task.status = 'in-progress'; await saveProjectState(statePath, state);
    try {
      const result = await runPipeline({
        root: options.root,
        task: { id: task.id, description: task.description, files: selectedFiles, test_command: 'pnpm --dir lab/coding-task test' },
        model: options.model, modelName: options.modelName, budgetUsd: options.budgetUsd,
        inputRatePerMillion: options.inputRatePerMillion, outputRatePerMillion: options.outputRatePerMillion,
        contextMaxCharacters: options.contextMaxCharacters, dryRun: options.dryRun,
      });
      if (options.dryRun) {
        task.status = 'ready'; await saveProjectState(statePath, state);
        return { status: 'pending-model', completedTaskIds, remainingTaskIds: state.tasks.filter(t => t.status !== 'completed').map(t => t.id) };
      }
      if (result.status !== 'completed') throw new Error(`Task ${task.id} did not complete`);
      task.status = 'completed'; completedTaskIds.push(task.id); executed += 1; await saveProjectState(statePath, state);
    } catch {
      task.status = 'failed'; await saveProjectState(statePath, state);
      return { status: 'failed', completedTaskIds, failedTaskId: task.id, remainingTaskIds: state.tasks.filter(t => t.status !== 'completed').map(t => t.id) };
    }
  }
  return { status: 'completed', completedTaskIds, remainingTaskIds: state.tasks.filter(t => t.status !== 'completed').map(t => t.id) };
}
