import { OrchestrationError, type AttemptStatus, type RunStatus, type TaskStatus } from './orchestrationTypes.ts';

const RUN_TRANSITIONS: Record<RunStatus, ReadonlySet<RunStatus>> = {
  pending: new Set(['running', 'cancelled']),
  running: new Set(['paused', 'completed', 'failed', 'cancelled']),
  paused: new Set(['running', 'failed', 'cancelled']),
  completed: new Set(),
  failed: new Set(),
  cancelled: new Set(),
};

const TASK_TRANSITIONS: Record<TaskStatus, ReadonlySet<TaskStatus>> = {
  pending: new Set(['blocked', 'cancelled']),
  running: new Set(['passed', 'failed', 'blocked', 'cancelled']),
  passed: new Set(),
  failed: new Set(['blocked', 'cancelled']),
  blocked: new Set(['pending', 'failed', 'cancelled']),
  cancelled: new Set(),
};

const ATTEMPT_TRANSITIONS: Record<AttemptStatus, ReadonlySet<AttemptStatus>> = {
  running: new Set(['passed', 'failed', 'interrupted', 'cancelled']),
  passed: new Set(),
  failed: new Set(),
  interrupted: new Set(),
  cancelled: new Set(),
};

function assertTransition<TStatus extends string>(
  kind: string,
  currentStatus: TStatus,
  nextStatus: TStatus,
  transitions: Record<TStatus, ReadonlySet<TStatus>>,
): void {
  if (currentStatus === nextStatus) {
    return;
  }

  if (!transitions[currentStatus].has(nextStatus)) {
    throw new OrchestrationError(
      'INVALID_TRANSITION',
      `${kind} cannot transition from ${currentStatus} to ${nextStatus}.`,
    );
  }
}

export function assertRunTransition(currentStatus: RunStatus, nextStatus: RunStatus): void {
  assertTransition('Run', currentStatus, nextStatus, RUN_TRANSITIONS);
}

export function assertTaskTransition(currentStatus: TaskStatus, nextStatus: TaskStatus): void {
  if (nextStatus === 'running') {
    throw new OrchestrationError(
      'INVALID_TRANSITION',
      'Task cannot transition to running without creating an Attempt.',
    );
  }

  assertTransition('Task', currentStatus, nextStatus, TASK_TRANSITIONS);
}

export function assertAttemptTransition(currentStatus: AttemptStatus, nextStatus: AttemptStatus): void {
  assertTransition('Attempt', currentStatus, nextStatus, ATTEMPT_TRANSITIONS);
}
