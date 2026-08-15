import type { ProjectManifest } from './project-brain.js';
import type { Task } from './task-graph.js';
import { posix } from 'node:path';

function resolveImport(from: string, specifier: string, available: Set<string>): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const base = from.split('/').slice(0, -1).join('/');
  const raw = posix.normalize(base ? `${base}/${specifier}` : specifier);
  const extensionless = raw.replace(/\.(?:js|jsx|mjs|cjs|ts|tsx)$/, '');
  const candidates = [
    raw,
    extensionless,
    `${extensionless}.ts`,
    `${extensionless}.tsx`,
    `${extensionless}.js`,
    `${extensionless}.jsx`,
    `${extensionless}/index.ts`,
    `${extensionless}/index.js`,
  ];
  return candidates.find(candidate => available.has(candidate));
}

export function expandContext(manifest: ProjectManifest, task: Task, maxDepth = 1): string[] {
  const available = new Set(manifest.files.map(file => file.path));
  const selected = new Set(task.files?.filter(file => available.has(file)) ?? []);
  let frontier = [...selected];
  for (let depth = 0; depth < maxDepth; depth++) {
    const next: string[] = [];
    for (const filePath of frontier) {
      const file = manifest.files.find(candidate => candidate.path === filePath);
      if (!file) continue;
      for (const specifier of file.imports) {
        const resolved = resolveImport(filePath, specifier, available);
        if (resolved && !selected.has(resolved)) {
          selected.add(resolved);
          next.push(resolved);
        }
      }
    }
    frontier = next;
  }
  return [...selected].sort();
}
