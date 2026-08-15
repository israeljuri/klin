import { readdir, readFile } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';

export type ProjectFile = { path: string; characters: number; extension: string; imports: string[] };
export type ProjectManifest = { root: string; files: ProjectFile[]; generated_at: string };

const IGNORED = new Set(['.git', 'node_modules', '.klin', 'dist', 'build', 'coverage']);
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

export async function scanProject(root: string): Promise<ProjectManifest> {
  const paths = await collectFiles(root, root);
  const files: ProjectFile[] = [];
  for (const path of paths) {
    const extension = extname(path);
    if (!CODE_EXTENSIONS.has(extension)) continue;
    const content = await readFile(join(root, path), 'utf8');
    files.push({ path, characters: content.length, extension, imports: extractImports(content) });
  }
  return { root, files: files.sort((a, b) => a.path.localeCompare(b.path)), generated_at: new Date().toISOString() };
}

async function collectFiles(root: string, current: string): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED.has(entry.name)) continue;
    const absolute = join(current, entry.name);
    if (entry.isDirectory()) result.push(...await collectFiles(root, absolute));
    else result.push(relative(root, absolute));
  }
  return result;
}

export function extractImports(content: string): string[] {
  const imports = new Set<string>();
  const patterns = [ /from\s+['"]([^'"]+)['"]/g, /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g, /require\(\s*['"]([^'"]+)['"]\s*\)/g ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const value = match[1];
      if (value?.startsWith('.')) imports.add(value);
    }
  }
  return [...imports];
}

export function selectContextFiles(manifest: ProjectManifest, requestedFiles: string[]): string[] {
  const available = new Set(manifest.files.map(file => file.path));
  const selected = new Set<string>();
  for (const requested of requestedFiles) {
    if (available.has(requested)) selected.add(requested);
  }
  return [...selected].sort();
}
