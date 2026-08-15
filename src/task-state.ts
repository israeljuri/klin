export type TaskState = 'planned' | 'ready' | 'model-running' | 'verifying' | 'completed' | 'failed' | 'blocked';

const transitions: Record<TaskState, TaskState[]> = {
  planned: ['ready', 'blocked'],
  ready: ['model-running', 'blocked'],
  'model-running': ['verifying', 'failed'],
  verifying: ['completed', 'failed'],
  completed: [],
  failed: ['ready', 'blocked'],
  blocked: ['ready'],
};

export function transitionTask(current: TaskState, next: TaskState): TaskState {
  if (!transitions[current].includes(next)) throw new Error(`Invalid task transition: ${current} -> ${next}`);
  return next;
}

export function canTransition(current: TaskState, next: TaskState): boolean {
  return transitions[current].includes(next);
}
