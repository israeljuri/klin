import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDryRunModel, loadTask, runPipeline } from './pipeline.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'klin-pipeline-'));
  await writeFile(join(root, 'pricing.js'), "export function applyDiscount() { throw new Error('TODO'); }\n");
  await writeFile(join(root, 'pricing.test.js'), "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { applyDiscount } from './pricing.js';\ntest('discount', () => assert.equal(applyDiscount(), 10));\n");
  await writeFile(join(root, 'package.json'), '{"type":"module"}\n');
  return root;
}

test('loadTask reads the explicit task contract', async () => {
  const task = await loadTask('tasks/apply-discount.json');
  assert.equal(task.id, 'apply-discount-live-001');
  assert.equal(task.files.length, 2);
});

test('dry-run pipeline builds context and never modifies files', async () => {
  const root = await fixture();
  const before = await readFile(join(root, 'pricing.js'), 'utf8');
  const task = { id: 'dry', description: 'demo', files: ['pricing.js', 'pricing.test.js'], test_command: 'node --test pricing.test.js' };
  const selected = createDryRunModel();
  const result = await runPipeline({ root, task, model: selected.model, modelName: selected.modelName, dryRun: true });
  assert.equal(result.status, 'pending-model');
  assert.equal(await readFile(join(root, 'pricing.js'), 'utf8'), before);
  await rm(root, { recursive: true, force: true });
});

test('dry-run honors a context limit before model execution', async () => {
  const root = await fixture();
  const task = { id: 'limit', description: 'demo', files: ['pricing.js'], test_command: 'node --test pricing.test.js' };
  let called = false;
  const model = async () => { called = true; return { edits: [] }; };
  await assert.rejects(() => runPipeline({ root, task, model, modelName: 'fake', contextMaxCharacters: 1 }), /exceeds configured/);
  assert.equal(called, false);
  await rm(root, { recursive: true, force: true });
});
