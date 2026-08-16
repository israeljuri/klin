import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectState, parsePlannerResult, type ProjectManifest } from './project-planner.js';

const manifest: ProjectManifest = {
  root: '/tmp/project',
  generated_at: 'now',
  files: [{ path: 'src/task.js', characters: 10, extension: '.js', imports: [] }],
};

test('planner state materialization starts every task ready with zero attempts', () => {
  const plan = parsePlannerResult(JSON.stringify({ tasks: [{
    id: 'task-one',
    title: 'Task one',
    description: 'Do task one.',
    files: ['src/task.js'],
    dependencies: [],
  }] }), manifest);
  const state = createProjectState(plan);
  assert.equal(state.tasks[0].status, 'ready');
  assert.equal(state.tasks[0].attempts, 0);
});
