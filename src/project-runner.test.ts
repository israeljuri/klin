import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadProjectState, runProject } from './project-runner.js';

test('project runner respects dependencies and completes tasks in order', async () => {
  const root = await mkdtemp(join(tmpdir(), 'klin-runner-'));
  await writeFile(join(root, 'a.ts'), 'export const a = 1;\n');
  await writeFile(join(root, 'b.ts'), "import { a } from './a.js'; export const b = a + 1;\n");
  const statePath = join(root, 'project.json');
  await writeFile(statePath, JSON.stringify({
    milestones: [],
    tasks: [
      { id: 'a', title: 'A', description: 'A', dependencies: [], files: ['a.ts'], status: 'ready' },
      { id: 'b', title: 'B', description: 'B', dependencies: ['a'], files: ['b.ts'], status: 'ready' },
    ],
  }));

  const calls: string[] = [];
  const model = async ({ task }: { task: { id: string } }) => {
    calls.push(task.id);
    return { response_id: task.id, edits: [], usage: { input_tokens: 1, cached_tokens: 0, output_tokens: 1, reasoning_tokens: 0, total_tokens: 2 } };
  };

  // Dry-run is intentionally used here: it exercises graph ordering/context discovery without modifying files.
  const result = await runProject({ root, statePath, model, modelName: 'test', dryRun: true });
  assert.equal(result.status, 'pending-model');
  assert.deepEqual(calls, ['a']);
  const state = await loadProjectState(statePath);
  assert.equal(state.tasks[0].status, 'ready');
  assert.equal(state.tasks[1].status, 'ready');
});

test('project runner reports blocked projects instead of inventing executable tasks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'klin-blocked-'));
  await writeFile(join(root, 'a.ts'), 'export const a = 1;\n');
  const statePath = join(root, 'project.json');
  await writeFile(statePath, JSON.stringify({
    milestones: [],
    tasks: [{ id: 'a', title: 'A', description: 'A', dependencies: ['missing'], files: ['a.ts'], status: 'blocked' }],
  }));

  await assert.rejects(() => loadProjectState(statePath), /Unknown dependency/);
});
