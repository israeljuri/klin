import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, rename, rm, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const execFileAsync = promisify(execFile);

export type Edit = {
  file: string;
  old_text: string;
  new_text: string;
};

export type ReconcileResult = {
  changed_files: string[];
  backup_dir: string;
};

export type VerificationResult = {
  diff_check: { passed: boolean; output: string };
  tests: { passed: boolean; output: string };
};

function assertSafeRelativePath(file: string): void {
  if (!file || file.includes('\0') || resolve(file) !== resolve('.', file) || file.startsWith('../')) {
    throw new Error(`Unsafe edit path: ${file}`);
  }
}

export async function validateEdits(edits: Edit[], root = process.cwd()): Promise<void> {
  if (!Array.isArray(edits) || edits.length === 0) {
    throw new Error('No edits supplied');
  }

  const seen = new Set<string>();
  for (const edit of edits) {
    if (!edit || typeof edit.file !== 'string' || typeof edit.old_text !== 'string' || typeof edit.new_text !== 'string') {
      throw new Error('Each edit must contain string file, old_text, and new_text fields');
    }
    assertSafeRelativePath(edit.file);
    if (seen.has(edit.file)) throw new Error(`Duplicate edit file: ${edit.file}`);
    seen.add(edit.file);

    const path = resolve(root, edit.file);
    const current = await readFile(path, 'utf8');
    if (!edit.old_text) throw new Error(`Empty old_text is not allowed: ${edit.file}`);

    const occurrences = current.split(edit.old_text).length - 1;
    if (occurrences === 0) throw new Error(`old_text was not found in ${edit.file}`);
    if (occurrences > 1) throw new Error(`old_text is ambiguous in ${edit.file}: found ${occurrences} matches`);
  }
}

export async function applyEdits(
  edits: Edit[],
  root = process.cwd(),
  backupDir = resolve(root, '.klin', 'backups', `${Date.now()}`),
): Promise<ReconcileResult> {
  await validateEdits(edits, root);
  await mkdir(backupDir, { recursive: true });

  const changed: string[] = [];
  try {
    for (const edit of edits) {
      const path = resolve(root, edit.file);
      const current = await readFile(path, 'utf8');
      const updated = current.replace(edit.old_text, edit.new_text);

      const backupPath = resolve(backupDir, edit.file);
      await mkdir(dirname(backupPath), { recursive: true });
      await writeFile(backupPath, current);
      await writeFile(path, updated);
      changed.push(edit.file);
    }

    return { changed_files: changed, backup_dir: backupDir };
  } catch (error) {
    await rollback(changed, root, backupDir);
    throw error;
  }
}

export async function rollback(files: string[], root = process.cwd(), backupDir: string): Promise<void> {
  for (const file of [...files].reverse()) {
    const backupPath = resolve(backupDir, file);
    const targetPath = resolve(root, file);
    await mkdir(dirname(targetPath), { recursive: true });
    await rename(backupPath, targetPath);
  }
  await rm(backupDir, { recursive: true, force: true });
}

async function runCommand(root: string, command: string, args: string[]): Promise<{ passed: boolean; output: string }> {
  try {
    const result = await execFileAsync(command, args, { cwd: root, maxBuffer: 2 * 1024 * 1024 });
    return { passed: true, output: `${result.stdout}${result.stderr}` };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message?: string };
    return { passed: false, output: `${e.stdout ?? ''}${e.stderr ?? ''}${e.message ?? ''}` };
  }
}

export async function verifyChanges(root: string, testCommand = 'node --test'): Promise<VerificationResult> {
  const diff_check = await runCommand(root, 'git', ['diff', '--check']);
  const [testCommandName, ...testArgs] = testCommand.split(' ');
  const tests = await runCommand(root, testCommandName, testArgs);
  return { diff_check, tests };
}

export async function reconcileAndVerify(
  edits: Edit[],
  root = process.cwd(),
  testCommand = 'node --test',
): Promise<{ result: ReconcileResult; verification: VerificationResult }> {
  const result = await applyEdits(edits, root);
  const verification = await verifyChanges(root, testCommand);

  if (!verification.diff_check.passed || !verification.tests.passed) {
    await rollback(result.changed_files, root, result.backup_dir);
    throw new Error([
      'Reconciliation verification failed.',
      !verification.diff_check.passed ? `git diff --check:\n${verification.diff_check.output}` : '',
      !verification.tests.passed ? `tests:\n${verification.tests.output}` : '',
    ].filter(Boolean).join('\n\n'));
  }

  await rm(result.backup_dir, { recursive: true, force: true });
  return { result, verification };
}
