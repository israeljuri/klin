import { readdir, readFile } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';

export type ProjectFile = { path: string; characters: number; extension: string; imports: string[] };
export type ProjectPackage = { path: string; scripts: Record<string, string> };
export type ProjectDocument = { path: string; content: string };
export type ProjectManifest = {
  root: string;
  files: ProjectFile[];
  generated_at: string;
  packages?: ProjectPackage[];
  documents?: ProjectDocument[];
};

const IGNORED = new Set(['.git', 'node_modules', '.klin', 'dist', 'build', 'coverage']);
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const DOCUMENT_NAMES = new Set(['README.md', 'ARCHITECTURE.md', 'CONTRIBUTING.md']);
const MAX_DOCUMENT_CHARACTERS = 8000;

export async function scanProject(root: string): Promise<ProjectManifest> {
  const paths = await collectFiles(root, root);
  const files: ProjectFile[] = [];
  const packages: ProjectPackage[] = [];
  const documents: ProjectDocument[] = [];

  for (const path of paths) {
    const extension = extname(path);
    if (CODE_EXTENSIONS.has(extension)) {
      const content = await readFile(join(root, path), 'utf8');
      files.push({ path, characters: content.length, extension, imports: extractImports(content) });
      continue;
    }

    if (path.endsWith('package.json')) {
      try {
        const parsed = JSON.parse(await readFile(join(root, path), 'utf8')) as { scripts?: Record<string, string> };
        packages.push({ path, scripts: parsed.scripts ?? {} });
      } catch {
        // Invalid package metadata is left for normal project validation to report.
      }
      continue;
    }

    if (DOCUMENT_NAMES.has(path.split('/').pop() ?? '')) {
      const content = await readFile(join(root, path), 'utf8');
      documents.push({ path, content: content.slice(0, MAX_DOCUMENT_CHARACTERS) });
    }
  }

  return {
    root,
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
    packages: packages.sort((a, b) => a.path.localeCompare(b.path)),
    documents: documents.sort((a, b) => a.path.localeCompare(b.path)),
    generated_at: new Date().toISOString(),
  };
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
