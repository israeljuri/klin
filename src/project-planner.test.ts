import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlannerPrompt, parsePlannerResult, planProject, projectPlanToState, validateProjectPlan, type ProjectManifest } from './project-planner.js';

const manifest: ProjectManifest = {
  root: '/tmp/project',
  generated_at: 'now',
  files: [
    { path: 'src/a.js', characters: 10, extension: '.js', imports: [] },
    { path: 'src/b.js', characters: 20, extension: '.js', imports: ['./a.js'] },
  ],
};

test('planner prompt contains goal and only manifest paths', () => {
  const prompt = buildPlannerPrompt('Add validation to the cart', manifest);
  assert.match(prompt, /Add validation to the cart/);
  assert.match(prompt, /src\/a\.js/);
  assert.match(prompt, /src\/b\.js/);
  assert.doesNotMatch(prompt, /node_modules/);
});

test('planner accepts valid tasks and defaults missing dependencies', () => {
  const plan = parsePlannerResult(JSON.stringify({ tasks: [{ id: 'validate-cart', title: 'Validate cart', description: 'Add validation.', files: ['src/a.js'] }] }), manifest);
  assert.deepEqual(plan.tasks[0].dependencies, []);
});

test('planner rejects unknown files', () => {
  assert.throws(() => parsePlannerResult(JSON.stringify({ tasks: [{ id: 'bad', title: 'Bad', description: 'Bad task.', files: ['src/missing.js'], dependencies: [] }] }), manifest), /unknown file/);
});

test('planner rejects dependency cycles', () => {
  assert.throws(() => validateProjectPlan({ tasks: [
    { id: 'a', title: 'A', description: 'A', files: ['src/a.js'], dependencies: ['b'] },
    { id: 'b', title: 'B', description: 'B', files: ['src/b.js'], dependencies: ['a'] },
  ] }, manifest), /dependency cycle/);
});

test('planner converts validated tasks into executable project state', () => {
  const plan = parsePlannerResult(JSON.stringify({ tasks: [
    { id: 'first', title: 'First', description: 'Do first.', files: ['src/a.js'], dependencies: [] },
    { id: 'second', title: 'Second', description: 'Do second.', files: ['src/b.js'], dependencies: ['first'] },
  ] }), manifest);
  const state = projectPlanToState(plan);
  assert.deepEqual(state.milestones, []);
  assert.deepEqual(state.tasks.map(task => ({ id: task.id, title: task.title, dependencies: task.dependencies, files: task.files, status: task.status, attempts: task.attempts })), [
    { id: 'first', title: 'First', dependencies: [], files: ['src/a.js'], status: 'ready', attempts: 0 },
    { id: 'second', title: 'Second', dependencies: ['first'], files: ['src/b.js'], status: 'ready', attempts: 0 },
  ]);
});

test('planProject passes a strict prompt to the model', async () => {
  const result = await planProject('Implement cart support', manifest, async request => {
    assert.equal(request.goal, 'Implement cart support');
    assert.match(request.prompt, /Return ONLY valid JSON/);
    return { plan: parsePlannerResult(JSON.stringify({ tasks: [{ id: 'cart-support', title: 'Cart support', description: 'Implement support.', files: ['src/a.js'], dependencies: [] }] }), manifest) };
  });
  assert.equal(result.plan.tasks[0].id, 'cart-support');
});
