import test from 'node:test';
import assert from 'node:assert/strict';
import { selectParallelReadyTasks, type ProjectState } from './task-graph.js';

function state(tasks: ProjectState['tasks']): ProjectState {
  return { milestones: [], tasks };
}

test('selectParallelReadyTasks chooses independent file scopes', () => {
  const result = selectParallelReadyTasks(state([
    { id: 'a', title: 'a', description: 'a', dependencies: [], files: ['src/a.ts'], status: 'ready' },
    { id: 'b', title: 'b', description: 'b', dependencies: [], files: ['src/b.ts'], status: 'ready' },
    { id: 'c', title: 'c', description: 'c', dependencies: [], files: ['src/a.ts'], status: 'ready' },
  ]), 3);
  assert.deepEqual(result.map(task => task.id), ['a', 'b']);
});

test('selectParallelReadyTasks respects dependency readiness and concurrency limit', () => {
  const result = selectParallelReadyTasks(state([
    { id: 'a', title: 'a', description: 'a', dependencies: [], files: ['src/a.ts'], status: 'ready' },
    { id: 'b', title: 'b', description: 'b', dependencies: ['a'], files: ['src/b.ts'], status: 'ready' },
    { id: 'c', title: 'c', description: 'c', dependencies: [], files: ['src/c.ts'], status: 'ready' },
  ]), 1);
  assert.deepEqual(result.map(task => task.id), ['a']);
});

test('tasks without file scope are exclusive', () => {
  const result = selectParallelReadyTasks(state([
    { id: 'a', title: 'a', description: 'a', dependencies: [], files: [], status: 'ready' },
    { id: 'b', title: 'b', description: 'b', dependencies: [], files: ['src/b.ts'], status: 'ready' },
  ]), 2);
  assert.deepEqual(result.map(task => task.id), ['a']);
});
