import type { Model, ModelRequest, ModelResult, ModelUsage } from './orchestrator.js';

export type ResponsesAdapterOptions = {
  apiKey?: string;
  model: string;
  endpoint: string;
  dryRun?: boolean;
  fetchImpl?: typeof fetch;
};

function extractOutputText(body: any): string {
  const message = body?.output?.find((item: any) => item?.type === 'message');
  const text = message?.content?.find((item: any) => item?.type === 'output_text')?.text;
  if (typeof text !== 'string') throw new Error('Model response did not contain output_text');
  return text;
}

function parseModelResult(text: string): ModelResult {
  let parsed: any;
  try { parsed = JSON.parse(text); } catch { throw new Error('Model returned invalid JSON'); }
  if (!parsed || !Array.isArray(parsed.edits)) throw new Error('Model response must contain an edits array');
  return { edits: parsed.edits };
}

export function createResponsesAdapter(options: ResponsesAdapterOptions): Model {
  const fetchImpl = options.fetchImpl ?? fetch;
  return async (request: ModelRequest): Promise<ModelResult> => {
    if (options.dryRun) return { edits: [], response_id: 'dry-run' };
    if (!options.apiKey) throw new Error('API key is required for a live model request');
    const response = await fetchImpl(options.endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${options.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: options.model, input: request.prompt }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(`Model API ${response.status}: ${body?.error?.message ?? 'request failed'}`);
    const u = body?.usage;
    const usage: ModelUsage | undefined = u ? {
      input_tokens: u.input_tokens ?? 0,
      cached_tokens: u.input_tokens_details?.cached_tokens ?? 0,
      output_tokens: u.output_tokens ?? 0,
      reasoning_tokens: u.output_tokens_details?.reasoning_tokens ?? 0,
      total_tokens: u.total_tokens ?? 0,
    } : undefined;
    return { ...parseModelResult(extractOutputText(body)), usage, response_id: body?.id };
  };
}
