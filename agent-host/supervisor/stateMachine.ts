import type { RunStatus, TaskStatus } from '../lib/orchestrationTypes.ts';
import {
  DEFAULT_MAX_ATTEMPTS,
  MAX_SUPERVISOR_ATTEMPTS,
  type AttemptTaskDecisionInput,
  type RetryBudgetDecision,
  type RetryBudgetInput,
  type RetryCause,
  type RunLifecycleInput,
  type SupervisorAction,
  type TaskSpec,
} from './types.ts';

const RETRYABLE_CAUSES: ReadonlySet<RetryCause> = new Set([
  'provider-process-failure',
  'execution-timeout',
  'host-interrupted',
]);

/** Invalid, absent, or out-of-range retry configuration fails closed to one total Attempt. */
export function normalizeMaxAttempts(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_SUPERVISOR_ATTEMPTS) {
    return DEFAULT_MAX_ATTEMPTS;
  }
  return value;
}

export function resolveMaxAttempts(taskSpec: TaskSpec): number {
  if (!isJsonObject(taskSpec)) {
    return DEFAULT_MAX_ATTEMPTS;
  }
  const supervisor = taskSpec.supervisor;
  if (!isJsonObject(supervisor)) {
    return DEFAULT_MAX_ATTEMPTS;
  }
  return normalizeMaxAttempts(supervisor.maxAttempts);
}

export function evaluateRetryBudget(input: RetryBudgetInput): RetryBudgetDecision {
  const maxAttempts = normalizeMaxAttempts(input.maxAttempts);
  if (!Number.isInteger(input.attemptOrdinal) || input.attemptOrdinal < 1) {
    return {
      retryAllowed: false,
      attemptOrdinal: input.attemptOrdinal,
      maxAttempts,
      nextAttemptOrdinal: null,
      reason: 'invalid-attempt-ordinal',
    };
  }
  if (!RETRYABLE_CAUSES.has(input.cause)) {
    return {
      retryAllowed: false,
      attemptOrdinal: input.attemptOrdinal,
      maxAttempts,
      nextAttemptOrdinal: null,
      reason: 'non-retryable-cause',
    };
  }
  if (input.attemptOrdinal >= maxAttempts) {
    return {
      retryAllowed: false,
      attemptOrdinal: input.attemptOrdinal,
      maxAttempts,
      nextAttemptOrdinal: null,
      reason: 'budget-exhausted',
    };
  }
  return {
    retryAllowed: true,
    attemptOrdinal: input.attemptOrdinal,
    maxAttempts,
    nextAttemptOrdinal: input.attemptOrdinal + 1,
    reason: 'retry-permitted',
  };
}

export function decideTaskAfterAttempt(input: AttemptTaskDecisionInput): SupervisorAction {
  const { task, attempt } = input;
  if (attempt.taskId !== task.taskId) {
    return noAction('task', 'attempt-task-mismatch');
  }
  if (attempt.status === 'running') {
    return noAction('task', 'attempt-still-running');
  }
  if (task.status === 'cancelled') {
    return noAction('task', 'task-already-cancelled');
  }
  if (task.status === 'passed') {
    return noAction('task', 'task-already-passed');
  }
  if (attempt.status === 'passed') {
    return { type: 'MARK_TASK_PASSED', taskId: task.taskId };
  }
  if (attempt.status === 'cancelled') {
    return { type: 'MARK_TASK_CANCELLED', taskId: task.taskId };
  }

  const cause: RetryCause = attempt.status === 'interrupted'
    ? 'host-interrupted'
    : input.failure?.cause ?? 'unknown';
  if (cause === 'human-gate') {
    const gate = input.failure?.gate;
    return {
      type: 'PAUSE_FOR_GATE',
      scope: 'task',
      taskId: task.taskId,
      gateKind: gate?.gateKind ?? 'human-approval',
      reason: gate?.reason ?? 'Human approval is required before this Task can continue.',
      transitionPath: [],
    };
  }

  const retry = evaluateRetryBudget({
    attemptOrdinal: attempt.ordinal,
    maxAttempts: resolveMaxAttempts(task.spec),
    cause,
  });
  if (retry.retryAllowed && retry.nextAttemptOrdinal !== null) {
    return {
      type: 'SCHEDULE_RETRY',
      taskId: task.taskId,
      completedAttemptOrdinal: attempt.ordinal,
      nextAttemptOrdinal: retry.nextAttemptOrdinal,
      maxAttempts: retry.maxAttempts,
      transitionPath: retryTransitionPath(task.status),
      requiresDependencyReevaluation: true,
    };
  }
  if (task.status === 'failed') {
    return noAction('task', 'task-already-failed');
  }
  return { type: 'MARK_TASK_FAILED', taskId: task.taskId, reason: retry.reason };
}

export function evaluateRunLifecycle(input: RunLifecycleInput): SupervisorAction {
  const { run, tasks } = input;
  if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
    return noAction('run', `run-already-${run.status}`);
  }
  if (input.cancellationRequested) {
    return { type: 'MARK_RUN_CANCELLED', runId: run.runId, transitionPath: ['cancelled'] };
  }
  if (tasks.length === 0) {
    return noAction('run', 'zero-tasks-no-progress');
  }
  if (tasks.every((task) => task.status === 'passed')) {
    return {
      type: 'MARK_RUN_COMPLETED',
      runId: run.runId,
      transitionPath: runTerminalPath(run.status, 'completed'),
    };
  }

  const humanGate = input.blockedByHumanGate && tasks.some(
    (task) => task.taskId === input.blockedByHumanGate?.taskId && task.status !== 'passed' && task.status !== 'cancelled',
  )
    ? input.blockedByHumanGate
    : undefined;
  const terminalFailure = [...tasks]
    .sort((left, right) => left.taskId.localeCompare(right.taskId))
    .find((task) => {
      if (task.status === 'cancelled' || task.status === 'failed') {
        return !task.retryAvailable;
      }
      if (task.status === 'blocked') {
        return !task.retryAvailable && humanGate?.taskId !== task.taskId;
      }
      return false;
    });
  if (terminalFailure) {
    return {
      type: 'MARK_RUN_FAILED',
      runId: run.runId,
      taskId: terminalFailure.taskId,
      transitionPath: runTerminalPath(run.status, 'failed'),
    };
  }

  const hasRunningTask = tasks.some((task) => task.status === 'running');
  const hasRetryPath = tasks.some(
    (task) => (task.status === 'failed' || task.status === 'blocked') && task.retryAvailable === true,
  );
  if (humanGate && !hasRunningTask && !hasRetryPath) {
    if (run.status === 'paused') {
      return noAction('run', 'run-already-paused-for-gate');
    }
    return {
      type: 'PAUSE_FOR_GATE',
      scope: 'run',
      runId: run.runId,
      taskId: humanGate.taskId,
      gateKind: humanGate.gateKind,
      reason: humanGate.reason,
      transitionPath: runTerminalPath(run.status, 'paused'),
    };
  }
  if (run.status === 'running') {
    return noAction('run', 'run-still-progressing');
  }
  return { type: 'MARK_RUN_RUNNING', runId: run.runId, transitionPath: ['running'] };
}

function retryTransitionPath(status: TaskStatus): readonly TaskStatus[] {
  switch (status) {
    case 'running':
      return ['failed', 'blocked', 'pending'];
    case 'failed':
      return ['blocked', 'pending'];
    case 'blocked':
      return ['pending'];
    case 'pending':
    case 'passed':
    case 'cancelled':
      return [];
  }
}

function runTerminalPath(current: RunStatus, terminal: 'completed' | 'failed' | 'paused'): readonly RunStatus[] {
  if (current === 'pending') {
    return ['running', terminal];
  }
  if (current === 'paused' && terminal === 'completed') {
    return ['running', 'completed'];
  }
  return [terminal];
}

function noAction(scope: 'task' | 'run', reason: string): SupervisorAction {
  return { type: 'NO_ACTION', scope, reason };
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
