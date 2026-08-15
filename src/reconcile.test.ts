import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyEdits, validateEdits } from './reconcile.js';

test('validateEdits accepts an exact unique replacement', async () => {
  const root = await mkdtemp(join(tmpdir(), 'klin-reconcile-'));
  try {
    await writeFile(join(root, 'example.js'), 'const value = 1;\n');
    await validateEdits([{ file: 'example.js', old_text: 'const value = 1;', new_text: 'const value = 2;' }], root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('validateEdits rejects missing old_text', async () => {
  const root = await mkdtemp(join(tmpdir(), 'klin-reconcile-'));
  try {
    await writeFile(join(root, 'example.js'), 'const value = 1;\n');
    await assert.rejects(
      validateEdits([{ file: 'example.js', old_text: 'missing', new_text: 'replacement' }], root),
      /old_text was not found/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('validateEdits rejects ambiguous old_text', async () => {
  const root = await mkdtemp(join(tmpdir(), 'klin-reconcile-'));
  try {
    await writeFile(join(root, 'example.js'), 'return value;\nreturn value;\n');
    await assert.rejects(
      validateEdits([{ file: 'example.js', old_text: 'return value;', new_text: 'return other;' }], root),
      /ambiguous/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('applyEdits changes files and creates a backup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'klin-reconcile-'));
  try {
    await writeFile(join(root, 'example.js'), 'const value = 1;\n');
    const result = await applyEdits(
      [{ file: 'example.js', old_text: 'const value = 1;', new_text: 'const value = 2;' }],
      root,
    );
    assert.equal(await readFile(join(root, 'example.js'), 'utf8'), 'const value = 2;\n');
    assert.deepEqual(result.changed_files, ['example.js']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
