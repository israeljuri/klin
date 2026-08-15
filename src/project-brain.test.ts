import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractImports, scanProject, selectContextFiles } from './project-brain.js';

test('extractImports finds relative imports and ignores packages', () => {
  assert.deepEqual(extractImports("import x from './x.js'; import z from 'zod'; const y = require('./y.js');"), ['./x.js', './y.js']);
});

test('scanProject builds a lightweight code manifest and ignores generated directories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'klin-brain-'));
  await mkdir(join(root, 'src'));
  await mkdir(join(root, 'node_modules'));
  await writeFile(join(root, 'src', 'a.ts'), "import { b } from './b.js';\nexport const a = b;\n");
  await writeFile(join(root, 'src', 'b.ts'), 'export const b = 1;\n');
  await writeFile(join(root, 'node_modules', 'ignored.ts'), 'export const nope = true;\n');
  const manifest = await scanProject(root);
  assert.deepEqual(manifest.files.map(file => file.path), ['src/a.ts', 'src/b.ts']);
  assert.deepEqual(manifest.files[0].imports, ['./b.js']);
});

test('selectContextFiles never invents paths', () => {
  const manifest = { root: '/tmp/project', generated_at: new Date().toISOString(), files: [
    { path: 'src/a.ts', characters: 10, extension: '.ts', imports: [] },
  ] };
  assert.deepEqual(selectContextFiles(manifest, ['src/a.ts', 'src/missing.ts']), ['src/a.ts']);
});
