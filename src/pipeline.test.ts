import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDryRunModel, loadTask, runPipeline } from './pipeline.js';
import { loadLedger } from './ledger.js';

const execFileAsync = promisify(execFile);

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'klin-pipeline-'));
  await writeFile(join(root, 'pricing.js'), "export function applyDiscount() { throw new Error('TODO'); }\n");
  await writeFile(join(root, 'pricing.test.js'), "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { applyDiscount } from './pricing.js';\ntest('discount', () => assert.equal(applyDiscount(), 10));\n");
  await writeFile(join(root, 'package.json'), '{"type":"module"}\n');
  await execFileAsync('git', ['init'], { cwd: root });
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

test('cost estimate is recorded separately from actual model cost', async () => {
  const root = await fixture();
  const task = { id: 'cost-accounting', description: 'Implement the pricing function', files: ['pricing.js'], test_command: 'node --test pricing.test.js' };
  const model = async () => ({
    edits: [{
      file: 'pricing.js',
      old_text: "export function applyDiscount() { throw new Error('TODO'); }",
      new_text: "export function applyDiscount() { return 10; }",
    }],
    usage: { input_tokens: 100, cached_tokens: 0, output_tokens: 200, reasoning_tokens: 150, total_tokens: 300 },
    response_id: 'cost-test',
  });

  const result = await runPipeline({
    root,
    task,
    model,
    modelName: 'fake',
    inputRatePerMillion: 1,
    outputRatePerMillion: 2,
  });

  assert.equal(result.actual_cost_usd, 0.0005);
  assert.ok((result.estimated_cost_usd ?? 0) > 0);
  assert.notEqual(result.estimated_cost_usd, result.actual_cost_usd);

  const entries = await loadLedger(root);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].estimated_cost_usd, result.estimated_cost_usd);
  assert.equal(entries[0].actual_cost_usd, 0.0005);

  await rm(root, { recursive: true, force: true });
});
