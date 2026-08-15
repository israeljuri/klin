import test from 'node:test';
import assert from 'node:assert/strict';
import { expandContext } from './context-graph.js';

const manifest = {
  root: '.', generated_at: '',
  files: [
    { path: 'src/a.ts', characters: 10, extension: '.ts', imports: ['./b.js'] },
    { path: 'src/b.ts', characters: 10, extension: '.ts', imports: ['./c.ts'] },
    { path: 'src/c.ts', characters: 10, extension: '.ts', imports: [] },
    { path: 'src/unrelated.ts', characters: 10, extension: '.ts', imports: [] },
  ],
};

test('expands selected context through local imports', () => {
  assert.deepEqual(expandContext(manifest, { id: 't', title: 'T', description: '', dependencies: [], files: ['src/a.ts'], status: 'ready' }, 2), ['src/a.ts', 'src/b.ts', 'src/c.ts']);
});

test('does not include unrelated files', () => {
  assert.deepEqual(expandContext(manifest, { id: 't', title: 'T', description: '', dependencies: [], files: ['src/a.ts'], status: 'ready' }, 1), ['src/a.ts', 'src/b.ts']);
});
