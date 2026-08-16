import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Edit } from './reconcile.js';
import { reconcileAndVerify } from './reconcile.js';

export type Task = { id: string; description: string; files: string[]; test_command?: string };
export type ContextBundle = { files: Array<{ path: string; content: string }>; characters: number };
export type ModelRequest = { task: Task; context: ContextBundle; prompt: string };
export type ModelUsage = { input_tokens: number; cached_tokens: number; output_tokens: number; reasoning_tokens: number; total_tokens: number };
export type ModelResult = { edits: Edit[]; usage?: ModelUsage; response_id?: string };
export type TaskResult = {
  task_id: string;
  status: 'pending-model' | 'completed' | 'failed';
  context: ContextBundle;
  model_usage?: ModelUsage;
  response_id?: string;
  changed_files?: string[];
  estimated_cost_usd?: number;
  actual_cost_usd?: number;
  error?: string;
};
export type Model = (request: ModelRequest) => Promise<ModelResult>;

export async function assembleContext(task: Task, root: string): Promise<ContextBundle> {
  const files: ContextBundle['files'] = [];
  let characters = 0;
  for (const relativePath of task.files) {
    const content = await readFile(join(root, relativePath), 'utf8');
    files.push({ path: relativePath, content });
    characters += content.length;
  }
  return { files, characters };
}

export function buildModelPrompt(request: Omit<ModelRequest, 'prompt'>): string {
  const context = request.context.files.map(({ path, content }) => `===== ${path} =====\n${content}`).join('\n\n');
  return [
    "You are Klin's implementation model.", 'Implement the task using only the supplied repository context.',
    '', 'TASK', request.task.description, '', 'OUTPUT CONTRACT', 'Return ONLY valid JSON with this shape:',
    '{"edits":[{"file":"relative/path","old_text":"exact existing text","new_text":"replacement text"]}',
    'Each old_text must match exactly one existing location.', 'Do not return Git diffs, blob hashes, line numbers, markdown, or explanations.',
    '', 'REPOSITORY CONTEXT', context,
  ].join('\n');
}

export async function executeTask(task: Task, root: string, model: Model): Promise<TaskResult> {
  const context = await assembleContext(task, root);
  const prompt = buildModelPrompt({ task, context });
  try {
    const modelResult = await model({ task, context, prompt });
    const verification = await reconcileAndVerify(modelResult.edits, root, task.test_command ?? 'node --test');
    return { task_id: task.id, status: 'completed', context, model_usage: modelResult.usage, response_id: modelResult.response_id, changed_files: verification.result.changed_files };
  } catch (error) {
    return { task_id: task.id, status: 'failed', context, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function writeTaskResult(result: TaskResult, root: string): Promise<void> {
  const directory = join(root, '.klin', 'tasks');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${result.task_id}.json`), JSON.stringify(result, null, 2) + '\n');
} 
