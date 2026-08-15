import test from 'node:test';
import assert from 'node:assert/strict';
import { getReadyTasks, nextTask, validateProjectState, type ProjectState } from './task-graph.js';

const state: ProjectState = {
  milestones: [{ id: 'm1', title: 'Feature', taskIds: ['a', 'b', 'c'] }],
  tasks: [
    { id: 'a', title: 'Foundation', description: '', dependencies: [], status: 'completed' },
    { id: 'b', title: 'Implementation', description: '', dependencies: ['a'], status: 'ready' },
    { id: 'c', title: 'Integration', description: '', dependencies: ['b'], status: 'blocked' },
  ],
};

test('ready tasks respect completed dependencies', () => {
  assert.deepEqual(getReadyTasks(state).map(task => task.id), ['b']);
  assert.equal(nextTask(state)?.id, 'b');
});

test('invalid dependency is rejected', () => {
  assert.throws(() => validateProjectState({ ...state, tasks: [{ ...state.tasks[0], dependencies: ['missing'] }] }), /Unknown dependency/);
});

test('dependency cycles are rejected', () => {
  assert.throws(() => validateProjectState({ ...state, tasks: [
    { id: 'a', title: 'A', description: '', dependencies: ['b'], status: 'ready' },
    { id: 'b', title: 'B', description: '', dependencies: ['a'], status: 'ready' },
  ] }), /Dependency cycle/);
});
