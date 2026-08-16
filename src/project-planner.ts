import type { ProjectManifest } from './project-brain.js';
import type { ProjectState } from './task-graph.js';

export type PlannedTask = {
  id: string;
  title: string;
  description: string;
  files: string[];
  test_command?: string;
  dependencies: string[];
};

export type ProjectPlan = { tasks: PlannedTask[] };

export type PlannerRequest = { goal: string; manifest: ProjectManifest; prompt: string };
export type PlannerUsage = { input_tokens: number; cached_tokens: number; output_tokens: number; reasoning_tokens: number; total_tokens: number };
export type PlannerResult = { plan: ProjectPlan; usage?: PlannerUsage; response_id?: string };
export type PlannerModel = (request: PlannerRequest) => Promise<PlannerResult>;

export function buildPlannerPrompt(goal: string, manifest: ProjectManifest): string {
  const files = manifest.files.map(file => ({ path: file.path, characters: file.characters, imports: file.imports }));
  const packages = manifest.packages ?? [];
  const documents = manifest.documents ?? [];
  return [
    "You are Klin's project planning model.",
    'Turn the project goal into the smallest executable task graph that can complete it.',
    'Tasks must be concrete implementation units, not vague phases.',
    'Prefer independent tasks when they can safely touch different files.',
    'Use dependencies only when a task genuinely requires another task first.',
    'Every task must list only files that exist in the supplied manifest.',
    'Treat supplied repository documentation and package scripts as authoritative project context.',
    'Do not invent requirements, behavior, APIs, test cases, or new semantics that are not supported by the goal or repository context.',
    'When the goal is underspecified, preserve existing behavior and make the smallest change that satisfies it.',
    'Do not claim support for additional modes (for example fixed discounts when only percentage discounts are described) unless the repository context explicitly requires them.',
    'Every test_command must be executable from the repository root.',
    'Prefer node --test with repository-relative test paths when no package test script is declared.',
    'For a nested package with an npm script, use npm --prefix <package-dir> <script> -- <path relative to that package> so the command remains valid from the repository root.',
    'Keep the number of tasks minimal while preserving safe parallelism.',
    '',
    'PROJECT GOAL', goal,
    '',
    'OUTPUT CONTRACT',
    'Return ONLY valid JSON with this shape:',
    '{"tasks":[{"id":"stable-task-id","title":"short title","description":"precise implementation work","files":["relative/path"],"test_command":"optional command","dependencies":["other-task-id"]}]}',
    'Use lowercase kebab-case task IDs when possible; simple alphanumeric/camelCase IDs are also accepted.',
    'IDs must be unique and dependencies must refer to task IDs in this same response.',
    '',
    'PROJECT PACKAGES',
    JSON.stringify(packages, null, 2),
    '',
    'PROJECT DOCUMENTATION',
    JSON.stringify(documents, null, 2),
    '',
    'PROJECT MANIFEST',
    JSON.stringify(files, null, 2),
  ].join('\n');
}

export function validateProjectPlan(plan: ProjectPlan, manifest: ProjectManifest): ProjectPlan {
  if (!plan || !Array.isArray(plan.tasks) || plan.tasks.length === 0) throw new Error('Project plan must contain at least one task');
  const available = new Set(manifest.files.map(file => file.path));
  const ids = new Set<string>();

  for (const task of plan.tasks) {
    if (!task || typeof task !== 'object') throw new Error('Each planned task must be an object');
    if (!task.id || !/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(task.id)) throw new Error(`Invalid task id: ${task.id}`);
    if (ids.has(task.id)) throw new Error(`Duplicate task id: ${task.id}`);
    ids.add(task.id);
    if (!task.title || !task.description) throw new Error(`Task ${task.id} must have a title and description`);
    if (!Array.isArray(task.files) || task.files.length === 0) throw new Error(`Task ${task.id} must declare at least one file`);
    for (const file of task.files) if (!available.has(file)) throw new Error(`Task ${task.id} references unknown file: ${file}`);
    if (!Array.isArray(task.dependencies)) throw new Error(`Task ${task.id} dependencies must be an array`);
  }

  for (const task of plan.tasks) {
    for (const dependency of task.dependencies) {
      if (!ids.has(dependency)) throw new Error(`Task ${task.id} references unknown dependency: ${dependency}`);
      if (dependency === task.id) throw new Error(`Task ${task.id} cannot depend on itself`);
    }
  }

  assertAcyclic(plan.tasks);
  return plan;
}

export function createProjectState(plan: ProjectPlan): ProjectState {
  return {
    milestones: [],
    tasks: plan.tasks.map(task => ({
      id: task.id,
      title: task.title,
      description: task.description,
      dependencies: [...task.dependencies],
      files: [...task.files],
      ...(task.test_command ? { test_command: task.test_command } : {}),
      status: 'ready',
      attempts: 0,
    })),
  };
}

function assertAcyclic(tasks: PlannedTask[]): void {
  const byId = new Map(tasks.map(task => [task.id, task]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error(`Project plan contains a dependency cycle involving ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)!.dependencies) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };

  for (const task of tasks) visit(task.id);
}

export function parsePlannerResult(text: string, manifest: ProjectManifest): ProjectPlan {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('Planner returned invalid JSON'); }
  const raw = parsed as { tasks?: PlannedTask[] };
  const tasks = Array.isArray(raw?.tasks) ? raw.tasks : [];
  return validateProjectPlan({ tasks: tasks.map(task => ({ ...task, dependencies: task.dependencies ?? [] })) }, manifest);
}

export function createPlannerAdapter(options: { apiKey?: string; model: string; endpoint: string; fetchImpl?: typeof fetch }): PlannerModel {
  const fetchImpl = options.fetchImpl ?? fetch;
  return async (request: PlannerRequest): Promise<PlannerResult> => {
    if (!options.apiKey) throw new Error('API key is required for a live planner request');
    const response = await fetchImpl(options.endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${options.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: options.model, input: request.prompt }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(`Planner API ${response.status}: ${body?.error?.message ?? 'request failed'}`);
    const message = body?.output?.find((item: any) => item?.type === 'message');
    const text = message?.content?.find((item: any) => item?.type === 'output_text')?.text;
    if (typeof text !== 'string') throw new Error('Planner response did not contain output_text');
    const u = body?.usage;
    const usage = u ? {
      input_tokens: u.input_tokens ?? 0,
      cached_tokens: u.input_tokens_details?.cached_tokens ?? 0,
      output_tokens: u.output_tokens ?? 0,
      reasoning_tokens: u.output_tokens_details?.reasoning_tokens ?? 0,
      total_tokens: u.total_tokens ?? 0,
    } : undefined;
    return { plan: parsePlannerResult(text, request.manifest), usage, response_id: body?.id };
  };
}

export async function planProject(goal: string, manifest: ProjectManifest, model: PlannerModel): Promise<PlannerResult> {
  if (!goal.trim()) throw new Error('Project goal cannot be empty');
  const prompt = buildPlannerPrompt(goal.trim(), manifest);
  return model({ goal: goal.trim(), manifest, prompt });
}
