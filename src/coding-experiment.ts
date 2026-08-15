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

const fixtureRoot = join(process.cwd(), 'lab', 'coding-task');

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

async function main() {
  console.log('Klin — realistic coding task experiment');
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
    'Return ONLY a unified git diff that can be applied with git apply.',
    'Do not return explanations, markdown fences, or complete unchanged files.',
    '',
    'REPOSITORY CONTEXT',
    context,
  ].join('\n');

  console.log(`Context characters: ${context.length.toLocaleString()}`);
  console.log(`Prompt characters: ${prompt.length.toLocaleString()}`);
  console.log('Sending implementation request...');

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
    throw new Error(`Meta returned non-JSON (HTTP ${response.status}): ${raw}`);
  }

  if (!response.ok) {
    throw new Error(`Meta API error (HTTP ${response.status}): ${raw}`);
  }

  const usage = usageOf(data);
  const patch = extractText(data);

  console.log(`HTTP ${response.status} ${data.status ?? ''}`);
  console.log(`Response ID: ${data.id ?? 'unknown'}`);
  console.log(`Input tokens: ${usage.input_tokens.toLocaleString()}`);
  console.log(`Cached tokens: ${usage.cached_tokens.toLocaleString()}`);
  console.log(`Output tokens: ${usage.output_tokens.toLocaleString()}`);
  console.log(`Reasoning tokens: ${usage.reasoning_tokens.toLocaleString()}`);
  console.log(`Total tokens: ${usage.total_tokens.toLocaleString()}`);
  console.log(`Returned patch characters: ${patch.length.toLocaleString()}`);

  await mkdir(join(process.cwd(), 'results'), { recursive: true });
  await writeFile(join(process.cwd(), 'results', 'coding-task.patch'), patch + '\n');
  await writeFile(
    join(process.cwd(), 'results', 'coding-task-report.json'),
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        model,
        endpoint: url,
        task: 'Implement applyDiscount and tests',
        context_files: files,
        context_characters: context.length,
        prompt_characters: prompt.length,
        response_id: data.id,
        usage,
        patch_characters: patch.length,
        patch_file: 'results/coding-task.patch',
        notes: [
          'The model was explicitly required to return a unified git diff only.',
          'Klin does not automatically apply the patch in this experiment.',
          'Run git apply --check results/coding-task.patch before applying it.',
        ],
      },
      null,
      2,
    ) + '\n',
  );

  console.log('\nResults written:');
  console.log('  results/coding-task.patch');
  console.log('  results/coding-task-report.json');
  console.log('\nNext safety check:');
  console.log('  git apply --check results/coding-task.patch');
}

main().catch((error) => {
  console.error('\nCoding experiment failed:');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
