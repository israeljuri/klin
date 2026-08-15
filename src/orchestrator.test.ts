import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assembleContext, buildModelPrompt, executeTask } from './orchestrator.js';
import type { Model, Task } from './orchestrator.js';

async function makeRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'klin-orchestrator-'));
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'value.js'), 'export const value = 1;\n');
  await writeFile(join(root, 'src', 'value.test.js'), "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { value } from './value.js';\ntest('value', () => assert.equal(value, 2));\n");
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  await promisify(execFile)('git', ['init'], { cwd: root });
  await promisify(execFile)('git', ['add', '.'], { cwd: root });
  await promisify(execFile)('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=Klin Test', 'commit', '-m', 'fixture'], { cwd: root });
  return root;
}

test('assembleContext only loads task-selected files', async () => {
  const root = await makeRepo();
  try {
    const task: Task = { id: 'context', description: 'test', files: ['src/value.js'] };
    const context = await assembleContext(task, root);
    assert.deepEqual(context.files.map((file) => file.path), ['src/value.js']);
    assert.equal(context.characters, 'export const value = 1;\n'.length);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('buildModelPrompt contains task, context, and strict output contract', () => {
  const prompt = buildModelPrompt({
    task: { id: 'x', description: 'Change value to 2', files: ['src/value.js'] },
    context: { files: [{ path: 'src/value.js', content: 'export const value = 1;\n' }], characters: 25 },
  });
  assert.match(prompt, /Change value to 2/);
  assert.match(prompt, /src\/value\.js/);
  assert.match(prompt, /old_text/);
  assert.match(prompt, /Do not return Git diffs/);
});

test('executeTask applies model edits and records model usage without calling a real API', async () => {
  const root = await makeRepo();
  try {
    const task: Task = {
      id: 'change-value',
      description: 'Change value from 1 to 2.',
      files: ['src/value.js'],
      test_command: 'node --test src/value.test.js',
    };
    const model: Model = async () => ({
      edits: [{ file: 'src/value.js', old_text: 'export const value = 1;', new_text: 'export const value = 2;' }],
      response_id: 'local-fixture-response',
      usage: { input_tokens: 100, cached_tokens: 0, output_tokens: 50, reasoning_tokens: 40, total_tokens: 150 },
    });

    const result = await executeTask(task, root, model);
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.changed_files, ['src/value.js']);
    assert.equal(result.model_usage?.total_tokens, 150);
    assert.equal(await readFile(join(root, 'src/value.js'), 'utf8'), 'export const value = 2;\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
