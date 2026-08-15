import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { runProject } from './project-runner.js';
import { loadLedger } from './ledger.js';
import type { Model } from './orchestrator.js';

const execFile = promisify(execFileCallback);

type Fixture = { root: string; statePath: string };

async function fixture(taskIds: string[]): Promise<Fixture> {
  const root = await mkdtemp(join('/tmp', 'klin-parallel-'));
  await mkdir(join(root, 'src'), { recursive: true });
  await execFile('git', ['init', '-q'], { cwd: root });
  await execFile('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  await execFile('git', ['config', 'user.name', 'Klin Test'], { cwd: root });

  for (const id of taskIds) {
    const name = id.replace(/[^a-z0-9-]/g, '-');
    await writeFile(join(root, 'src', `${name}.js`), 'export const value = 0;\n');
  }

  const tasksDir = join(root, 'tasks');
  await mkdir(tasksDir, { recursive: true });
  for (const id of taskIds) {
    const name = id.replace(/[^a-z0-9-]/g, '-');
    await writeFile(join(tasksDir, `${id}.json`), JSON.stringify({
      id,
      description: `update ${id}`,
      files: [`src/${name}.js`],
      test_command: 'true',
    }));
  }
  return { root, statePath: join(root, '.klin', 'project.json') };
}

function modelFor(root: string, active: { value: number; max: number }, delayMs = 40): Model {
  return async ({ task }) => {
    active.value += 1;
    active.max = Math.max(active.max, active.value);
    await new Promise(resolve => setTimeout(resolve, delayMs));
    active.value -= 1;
    const file = task.files[0];
    const current = await readFile(join(root, file), 'utf8');
    return {
      response_id: `test-${task.id}`,
      edits: [{ file, old_text: current, new_text: `export const value = ${JSON.stringify(task.id)};\n` }],
      usage: { input_tokens: 127, cached_tokens: 0, output_tokens: 0, reasoning_tokens: 0, total_tokens: 127 },
    };
  };
}

test('parallel runner executes independent tasks concurrently and preserves both ledger entries', async () => {
  const fx = await fixture(['task-a', 'task-b']);
  try {
    const active = { value: 0, max: 0 };
    const result = await runProject({ root: fx.root, statePath: fx.statePath, model: modelFor(fx.root, active), modelName: 'test', concurrency: 2, maxAttemptsPerTask: 1 });
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.completedTaskIds.sort(), ['task-a', 'task-b']);
    assert.equal(active.max, 2);
    assert.equal((await loadLedger(fx.root)).length, 2);
  } finally {
    await rm(fx.root, { recursive: true, force: true });
  }
});

test('parallel runner isolates a failed sibling and preserves the successful task', async () => {
  const fx = await fixture(['task-good', 'task-bad']);
  try {
    const model: Model = async ({ task }) => {
      if (task.id === 'task-bad') {
        return {
          response_id: 'bad',
          edits: [{ file: task.files[0], old_text: 'does-not-exist', new_text: 'broken' }],
          usage: { input_tokens: 10, cached_tokens: 0, output_tokens: 1, reasoning_tokens: 0, total_tokens: 11 },
        };
      }
      const file = task.files[0];
      const current = await readFile(join(fx.root, file), 'utf8');
      return {
        response_id: 'good',
        edits: [{ file, old_text: current, new_text: 'export const value = 1;\n' }],
        usage: { input_tokens: 10, cached_tokens: 0, output_tokens: 1, reasoning_tokens: 0, total_tokens: 11 },
      };
    };
    const result = await runProject({ root: fx.root, statePath: fx.statePath, model, modelName: 'test', concurrency: 2, maxAttemptsPerTask: 1 });
    assert.equal(result.status, 'failed');
    assert.equal(result.failedTaskId, 'task-bad');
    assert.deepEqual(result.completedTaskIds, ['task-good']);
    assert.equal(await readFile(join(fx.root, 'src', 'task-good.js'), 'utf8'), 'export const value = 1;\n');
  } finally {
    await rm(fx.root, { recursive: true, force: true });
  }
});

test('project state resumes completed work without rerunning it', async () => {
  const fx = await fixture(['task-a', 'task-b']);
  try {
    const calls: string[] = [];
    const active = { value: 0, max: 0 };
    const model: Model = async args => {
      calls.push(args.task.id);
      return modelFor(fx.root, active, 1)(args);
    };
    const first = await runProject({ root: fx.root, statePath: fx.statePath, model, modelName: 'test', concurrency: 2, maxTasks: 1, maxAttemptsPerTask: 1 });
    assert.equal(first.status, 'completed');
    assert.equal(first.completedTaskIds.length, 1);
    const firstTask = first.completedTaskIds[0];

    const second = await runProject({ root: fx.root, statePath: fx.statePath, model, modelName: 'test', concurrency: 2, maxAttemptsPerTask: 1 });
    assert.equal(second.status, 'completed');
    assert.equal(second.completedTaskIds.length, 1);
    assert.notEqual(second.completedTaskIds[0], firstTask);
    assert.deepEqual(calls.sort(), ['task-a', 'task-b']);
  } finally {
    await rm(fx.root, { recursive: true, force: true });
  }
});

test('concurrent budget reservations prevent two tasks from overspending the project budget', async () => {
  const fx = await fixture(['task-a', 'task-b']);
  try {
    let calls = 0;
    const active = { value: 0, max: 0 };
    const model = async (args: Parameters<Model>[0]) => {
      calls += 1;
      return modelFor(fx.root, active, 10)(args);
    };
    const result = await runProject({
      root: fx.root,
      statePath: fx.statePath,
      model,
      modelName: 'test',
      concurrency: 2,
      maxAttemptsPerTask: 1,
      budgetUsd: 0.15,
      inputRatePerMillion: 1000,
      outputRatePerMillion: 0,
    });
    assert.equal(result.status, 'failed');
    assert.equal(calls, 1);
    assert.equal(result.completedTaskIds.length, 1);
  } finally {
    await rm(fx.root, { recursive: true, force: true });
  }
});
