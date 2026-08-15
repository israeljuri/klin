import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { scanProject } from './project-brain.js';
import { expandContext } from './context-graph.js';
import { getReadyTasks, validateProjectState, type ProjectState, type Task as GraphTask } from './task-graph.js';
import { runPipeline, type Model } from './pipeline.js';

export type ProjectRunnerOptions = {
  root: string;
  statePath?: string;
  model: Model;
  modelName: string;
  budgetUsd?: number;
  inputRatePerMillion?: number;
  outputRatePerMillion?: number;
  contextMaxCharacters?: number;
  dryRun?: boolean;
  maxTasks?: number;
};

export type ProjectRunResult = {
  status: 'completed' | 'blocked' | 'failed' | 'pending-model';
  completedTaskIds: string[];
  failedTaskId?: string;
  remainingTaskIds: string[];
};

export async function loadProjectState(path: string): Promise<ProjectState> {
  const state = JSON.parse(await readFile(resolve(path), 'utf8')) as ProjectState;
  validateProjectState(state);
  return state;
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
    if (ready.length === 0) {
      const remaining = state.tasks.filter(task => task.status !== 'completed').map(task => task.id);
      return {
        status: remaining.length === 0 ? 'completed' : 'blocked',
        completedTaskIds,
        remainingTaskIds: remaining,
      };
    }

    const task = ready[0];
    const selectedFiles = expandContext(manifest, task, 2);
    if (selectedFiles.length === 0) {
      task.status = 'failed';
      await saveProjectState(statePath, state);
      return { status: 'failed', completedTaskIds, failedTaskId: task.id, remainingTaskIds: state.tasks.filter(t => t.status !== 'completed').map(t => t.id) };
    }

    task.status = 'in-progress';
    await saveProjectState(statePath, state);

    const pipelineTask = {
      id: task.id,
      description: task.description,
      files: selectedFiles,
      test_command: undefined,
    };

    try {
      const result = await runPipeline({
        root: options.root,
        task: pipelineTask,
        model: options.model,
        modelName: options.modelName,
        budgetUsd: options.budgetUsd,
        inputRatePerMillion: options.inputRatePerMillion,
        outputRatePerMillion: options.outputRatePerMillion,
        contextMaxCharacters: options.contextMaxCharacters,
        dryRun: options.dryRun,
      });

      if (options.dryRun) {
        task.status = 'ready';
        await saveProjectState(statePath, state);
        return {
          status: 'pending-model',
          completedTaskIds,
          remainingTaskIds: state.tasks.filter(t => t.status !== 'completed').map(t => t.id),
        };
      }

      task.status = 'completed';
      completedTaskIds.push(task.id);
      executed += 1;
      await saveProjectState(statePath, state);

      if (result.status !== 'completed') {
        task.status = 'failed';
        await saveProjectState(statePath, state);
        return { status: 'failed', completedTaskIds, failedTaskId: task.id, remainingTaskIds: state.tasks.filter(t => t.status !== 'completed').map(t => t.id) };
      }
    } catch {
      task.status = 'failed';
      await saveProjectState(statePath, state);
      return {
        status: 'failed',
        completedTaskIds,
        failedTaskId: task.id,
        remainingTaskIds: state.tasks.filter(t => t.status !== 'completed').map(t => t.id),
      };
    }
  }

  return {
    status: 'completed',
    completedTaskIds,
    remainingTaskIds: state.tasks.filter(task => task.status !== 'completed').map(task => task.id),
  };
}
