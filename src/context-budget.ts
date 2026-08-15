import type { ContextBundle, Task } from './orchestrator.js';

export type ContextPolicy = { max_characters?: number; reserved_output_tokens?: number };
export type ContextEstimate = { characters: number; estimated_input_tokens: number; over_limit: boolean };

export function estimateInputTokens(characters: number): number {
  return Math.ceil(characters / 4);
}

export function estimateContext(task: Task, context: ContextBundle, policy: ContextPolicy = {}): ContextEstimate {
  const promptOverhead = task.description.length + task.files.join('').length + 500;
  const characters = context.characters + promptOverhead;
  const estimated_input_tokens = estimateInputTokens(characters);
  const over_limit = policy.max_characters !== undefined && characters > policy.max_characters;
  return { characters, estimated_input_tokens, over_limit: Boolean(over_limit) };
}

export function assertContextWithinLimit(estimate: ContextEstimate): void {
  if (estimate.over_limit) throw new Error(`Context exceeds configured character limit: ${estimate.characters}`);
}
