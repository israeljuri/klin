import 'dotenv/config';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const apiKey = process.env.META_API_KEY;
const model = process.env.META_MODEL ?? 'muse-spark-1.2-contributor';
const url = process.env.META_API_URL ?? 'https://api.meta.ai/v1/responses';

if (!apiKey) {
  console.error('Missing META_API_KEY. Put it in .env');
  process.exit(1);
}

type Usage = {
  input_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
  output_tokens?: number;
  output_tokens_details?: { reasoning_tokens?: number };
  total_tokens?: number;
};

type ApiResponse = {
  id?: string;
  status?: string;
  usage?: Usage;
  output?: Array<{
    type?: string;
    role?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
};

type Edit = { file: string; old_text: string; new_text: string };

type EditResponse = { edits: Edit[] };

const fixtureRoot = join(process.cwd(), 'lab', 'coding-task');
const resultsRoot = join(process.cwd(), 'results');

const files = [
  'ARCHITECTURE.md',
  'src/cart.js',
  'src/pricing.js',
  'src/cart.test.js',
  'src/pricing.test.js',
];

async function loadContext(): Promise<string> {
  const sections: string[] = [];
  for (const relativePath of files) {
    const content = await readFile(join(fixtureRoot, relativePath), 'utf8');
    sections.push(`===== ${relativePath} =====\n${content}`);
  }
  return sections.join('\n\n');
}

function usageOf(data: ApiResponse) {
  const usage = data.usage ?? {};
  return {
    input_tokens: usage.input_tokens ?? 0,
    cached_tokens: usage.input_tokens_details?.cached_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
    reasoning_tokens: usage.output_tokens_details?.reasoning_tokens ?? 0,
    total_tokens: usage.total_tokens ?? 0,
  };
}

function extractText(data: ApiResponse): string {
  return (data.output ?? [])
    .flatMap((item) => item.content ?? [])
    .map((item) => item.text ?? '')
    .filter(Boolean)
    .join('');
}

function stripCodeFence(raw: string): string {
  return raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
}

function parseEdits(raw: string): EditResponse {
  const text = stripCodeFence(raw);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('Model output was not valid JSON');
    value = JSON.parse(text.slice(start, end + 1));
  }

  if (!value || typeof value !== 'object' || !Array.isArray((value as { edits?: unknown }).edits)) {
    throw new Error('Model JSON must contain an edits array');
  }

  const edits = (value as { edits: unknown[] }).edits;
  for (const edit of edits) {
    if (!edit || typeof edit !== 'object') throw new Error('Every edit must be an object');
    const e = edit as Record<string, unknown>;
    if (typeof e.file !== 'string' || typeof e.old_text !== 'string' || typeof e.new_text !== 'string') {
      throw new Error('Every edit requires string file, old_text, and new_text fields');
    }
  }
  return { edits: edits as Edit[] };
}

async function validateEdits(edits: Edit[]): Promise<void> {
  if (edits.length === 0) throw new Error('Model returned no edits');
  const seen = new Set<string>();
  for (const edit of edits) {
    if (!edit.file || edit.file.includes('\0') || edit.file.startsWith('/') || edit.file.split('/').includes('..')) {
      throw new Error(`Unsafe edit path: ${edit.file}`);
    }
    if (seen.has(edit.file)) throw new Error(`Duplicate edit file: ${edit.file}`);
    seen.add(edit.file);
    const path = join(fixtureRoot, edit.file);
    const current = await readFile(path, 'utf8');
    if (!edit.old_text) throw new Error(`Empty old_text is not allowed: ${edit.file}`);
    const occurrences = current.split(edit.old_text).length - 1;
    if (occurrences === 0) throw new Error(`old_text was not found in ${edit.file}`);
    if (occurrences > 1) throw new Error(`old_text is ambiguous in ${edit.file}: found ${occurrences} matches`);
  }
}

async function main() {
  console.log('Klin — structured-edit coding experiment');
  console.log(`Model: ${model}`);

  const context = await loadContext();
  const prompt = [
    'You are the implementation model in a controlled software-engineering experiment.',
    'Implement the requested task using the supplied repository context.',
    '',
    'TASK',
    'Implement applyDiscount in src/pricing.js.',
    'Requirements:',
    '- Accept a percentage from 0 through 100 inclusive.',
    '- Reject negative percentages and percentages above 100 with RangeError.',
    '- Calculate the discount from the cart subtotal.',
    '- Preserve integer-cent money behavior by rounding to the nearest cent.',
    '- A 100% discount produces 0.',
    '- Do not mutate the cart.',
    '- Add tests covering the new behavior.',
    '- Do not add dependencies or refactor unrelated code.',
    '',
    'OUTPUT CONTRACT',
    'Return ONLY valid JSON. Do not use markdown fences or explanations.',
    'The JSON must have exactly this top-level shape:',
    '{"edits":[{"file":"relative/path","old_text":"exact existing text","new_text":"replacement text"}]}',
    'Each edit must replace an exact, unique piece of existing file content.',
    'Do not return Git diff syntax, line numbers, blob hashes, or complete unchanged files.',
    '',
    'REPOSITORY CONTEXT',
    context,
  ].join('\n');

  console.log(`Context characters: ${context.length.toLocaleString()}`);
  console.log(`Prompt characters: ${prompt.length.toLocaleString()}`);
  console.log('Sending ONE controlled implementation request...');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, input: prompt }),
  });

  const raw = await response.text();
  let data: ApiResponse;
  try {
    data = JSON.parse(raw) as ApiResponse;
  } catch {
    throw new Error(`Meta returned non-JSON (HTTP ${response.status})`);
  }
  if (!response.ok) throw new Error(`Meta API error (HTTP ${response.status}): ${raw}`);

  const usage = usageOf(data);
  const rawOutput = extractText(data);
  const parsed = parseEdits(rawOutput);
  await validateEdits(parsed.edits);

  await mkdir(resultsRoot, { recursive: true });
  await writeFile(join(resultsRoot, 'coding-task-structured-raw-response.json'), raw + '\n');
  await writeFile(join(resultsRoot, 'coding-task-edits.json'), JSON.stringify(parsed, null, 2) + '\n');

  console.log(`HTTP ${response.status} ${data.status ?? ''}`);
  console.log(`Response ID: ${data.id ?? 'unknown'}`);
  console.log(`Input tokens: ${usage.input_tokens.toLocaleString()}`);
  console.log(`Cached tokens: ${usage.cached_tokens.toLocaleString()}`);
  console.log(`Output tokens: ${usage.output_tokens.toLocaleString()}`);
  console.log(`Reasoning tokens: ${usage.reasoning_tokens.toLocaleString()}`);
  console.log(`Total tokens: ${usage.total_tokens.toLocaleString()}`);
  console.log(`Returned output characters: ${rawOutput.length.toLocaleString()}`);
  console.log(`Validated edits: ${parsed.edits.length}`);
  console.log('\nStructured edit validation: PASS');
  console.log('No files were modified.');
  console.log('\nResults written:');
  console.log('  results/coding-task-structured-raw-response.json');
  console.log('  results/coding-task-edits.json');
}

main().catch((error) => {
  console.error('\nStructured coding experiment failed:');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
