import test from 'node:test';
import assert from 'node:assert/strict';
import { canTransition, transitionTask } from './task-state.js';

test('normal task lifecycle is allowed', () => {
  assert.equal(transitionTask('planned', 'ready'), 'ready');
  assert.equal(transitionTask('ready', 'model-running'), 'model-running');
  assert.equal(transitionTask('model-running', 'verifying'), 'verifying');
  assert.equal(transitionTask('verifying', 'completed'), 'completed');
});

test('invalid lifecycle transitions are rejected', () => {
  assert.equal(canTransition('planned', 'completed'), false);
  assert.throws(() => transitionTask('planned', 'completed'), /Invalid task transition/);
});

test('failed work can return to ready for an intentional retry', () => {
  assert.equal(transitionTask('failed', 'ready'), 'ready');
});
