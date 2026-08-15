export type TaskStatus = 'ready' | 'blocked' | 'in-progress' | 'completed' | 'failed';

export type Task = {
  id: string;
  title: string;
  description: string;
  dependencies: string[];
  files?: string[];
  test_command?: string;
  status: TaskStatus;
  attempts?: number;
};

export type Milestone = { id: string; title: string; taskIds: string[] };
export type ProjectState = { milestones: Milestone[]; tasks: Task[] };

export function validateProjectState(state: ProjectState): void {
  const ids = new Set<string>();
  for (const task of state.tasks) {
    if (ids.has(task.id)) throw new Error(`Duplicate task id: ${task.id}`);
    ids.add(task.id);
    if (task.attempts !== undefined && (!Number.isInteger(task.attempts) || task.attempts < 0)) {
      throw new Error(`Invalid attempt count for task: ${task.id}`);
    }
  }
  for (const task of state.tasks) {
    for (const dependency of task.dependencies) {
      if (!ids.has(dependency)) throw new Error(`Unknown dependency: ${dependency}`);
      if (dependency === task.id) throw new Error(`Task cannot depend on itself: ${task.id}`);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(state.tasks.map(task => [task.id, task]));
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error(`Dependency cycle involving: ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)!.dependencies) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const task of state.tasks) visit(task.id);
}

export function getReadyTasks(state: ProjectState): Task[] {
  validateProjectState(state);
  const byId = new Map(state.tasks.map(task => [task.id, task]));
  return state.tasks.filter(task =>
    task.status === 'ready' && task.dependencies.every(id => byId.get(id)?.status === 'completed'),
  );
}

export function selectParallelReadyTasks(state: ProjectState, maxTasks: number): Task[] {
  if (!Number.isInteger(maxTasks) || maxTasks < 1) throw new Error('maxTasks must be a positive integer');
  const selected: Task[] = [];
  const claimedFiles = new Set<string>();
  for (const task of getReadyTasks(state)) {
    if (selected.length >= maxTasks) break;
    const files = task.files ?? [];
    // Tasks without an explicit file set are treated as exclusive because their edit scope is unknown.
    if (files.length === 0 && selected.length > 0) continue;
    const normalized = new Set(files);
    if (selected.some(candidate => (candidate.files ?? []).length === 0)) continue;
    if ([...normalized].some(file => claimedFiles.has(file))) continue;
    selected.push(task);
    for (const file of normalized) claimedFiles.add(file);
  }
  return selected;
}

export function nextTask(state: ProjectState): Task | undefined {
  return getReadyTasks(state)[0];
}
