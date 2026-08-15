import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';

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
  model?: string;
  status?: string;
  usage?: Usage;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function buildFixture(targetChars: number, label: string): string {
  const block = `// ${label} — synthetic source fixture\n` +
    `export function calculate${label.replace(/[^a-zA-Z0-9]/g, '')}(value: number): number {\n` +
    `  const adjusted = value * 1.0175 + 42;\n` +
    `  return Math.round(adjusted * 100) / 100;\n` +
    `}\n\n`;

  return Array.from({ length: Math.ceil(targetChars / block.length) }, () => block)
    .join('')
    .slice(0, targetChars);
}

function extractText(data: ApiResponse): string {
  return (data.output ?? [])
    .flatMap((item) => item.content ?? [])
    .map((item) => item.text ?? '')
    .filter(Boolean)
    .join('');
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

async function callModel(input: string, label: string): Promise<ApiResponse> {
  console.log(`\n--- ${label} ---`);
  console.log(`Input characters: ${input.length.toLocaleString()}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input,
    }),
  });

  const text = await response.text();
  let data: ApiResponse;

  try {
    data = JSON.parse(text) as ApiResponse;
  } catch {
    throw new Error(`Meta returned non-JSON (HTTP ${response.status}): ${text}`);
  }

  if (!response.ok) {
    throw new Error(`Meta API error (HTTP ${response.status}): ${text}`);
  }

  const usage = usageOf(data);
  console.log(`Response: ${response.status} ${data.status ?? ''}`);
  console.log(`Input tokens: ${usage.input_tokens.toLocaleString()}`);
  console.log(`Cached tokens: ${usage.cached_tokens.toLocaleString()}`);
  console.log(`Output tokens: ${usage.output_tokens.toLocaleString()}`);
  console.log(`Reasoning tokens: ${usage.reasoning_tokens.toLocaleString()}`);
  console.log(`Total tokens: ${usage.total_tokens.toLocaleString()}`);
  console.log(`Visible output chars: ${extractText(data).length.toLocaleString()}`);

  return data;
}

async function main() {
  console.log('Klin — Muse Spark 1.2 Contributor controlled experiment');
  console.log(`Model: ${model}`);
  console.log(`Endpoint: ${url}`);

  const results: Array<Record<string, unknown>> = [];

  // Experiment A: token scaling. These are approximate character sizes;
  // Meta's usage response is the source of truth for actual tokens.
  const sizes = [2_000, 20_000, 100_000];

  for (const chars of sizes) {
    const fixture = buildFixture(chars, `Scale${chars}`);
    const prompt = [
      'Klin token-scaling experiment.',
      'Read the synthetic source below. Do not reproduce it.',
      'Return exactly: KLIN_SCALE_OK',
      '',
      'BEGIN SYNTHETIC SOURCE',
      fixture,
      'END SYNTHETIC SOURCE',
    ].join('\n');

    const data = await callModel(prompt, `A${chars.toLocaleString()} chars`);
    results.push({
      experiment: 'token-scaling',
      input_chars: prompt.length,
      usage: usageOf(data),
      response_id: data.id,
    });
  }

  // Experiment B: cache behavior. Keep the large prefix byte-for-byte identical
  // and change only the final task text between the two calls.
  const stableContext = [
    'Klin cache experiment.',
    'The following project context is intentionally identical between requests.',
    'Do not reproduce it. Return only the requested marker.',
    '',
    'BEGIN STABLE PROJECT CONTEXT',
    buildFixture(100_000, 'StableContext'),
    'END STABLE PROJECT CONTEXT',
  ].join('\n');

  const cacheFirst = await callModel(
    `${stableContext}\n\nTask A: return exactly KLIN_CACHE_A`,
    'B1 cache warm-up',
  );
  results.push({
    experiment: 'cache',
    request: 'warm-up',
    input_chars: stableContext.length + '\n\nTask A: return exactly KLIN_CACHE_A'.length,
    usage: usageOf(cacheFirst),
    response_id: cacheFirst.id,
  });

  // Give the service a moment before the repeated request.
  await sleep(1_000);

  const cacheSecond = await callModel(
    `${stableContext}\n\nTask B: return exactly KLIN_CACHE_B`,
    'B2 cache repeat',
  );
  results.push({
    experiment: 'cache',
    request: 'repeat',
    input_chars: stableContext.length + '\n\nTask B: return exactly KLIN_CACHE_B'.length,
    usage: usageOf(cacheSecond),
    response_id: cacheSecond.id,
  });

  const cacheFirstUsage = usageOf(cacheFirst);
  const cacheSecondUsage = usageOf(cacheSecond);
  const cacheHitRate = cacheSecondUsage.input_tokens > 0
    ? cacheSecondUsage.cached_tokens / cacheSecondUsage.input_tokens
    : 0;

  const report = {
    generated_at: new Date().toISOString(),
    model,
    endpoint: url,
    experiments: results,
    cache_comparison: {
      first_input_tokens: cacheFirstUsage.input_tokens,
      second_input_tokens: cacheSecondUsage.input_tokens,
      second_cached_tokens: cacheSecondUsage.cached_tokens,
      second_cache_hit_rate: cacheHitRate,
    },
    notes: [
      'Actual token counts come from Meta API usage fields, not a local tokenizer.',
      'The cache experiment keeps the stable context identical and changes only the final task.',
      'This report intentionally does not store the API key or raw response bodies.',
    ],
  };

  await mkdir('results', { recursive: true });
  await writeFile('results/experiment-report.json', JSON.stringify(report, null, 2) + '\n');

  console.log('\n==================================================');
  console.log('KLIN EXPERIMENT COMPLETE');
  console.log('==================================================');
  console.log(`Report: results/experiment-report.json`);
  console.log(`Second-request cache hit rate: ${(cacheHitRate * 100).toFixed(2)}%`);
  console.log('Paste the report contents here when finished.');
}

main().catch((error) => {
  console.error('\nExperiment failed:');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
