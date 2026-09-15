import {
  TERMINAL_ATTEMPT_STATUSES,
  TERMINAL_RUN_STATUSES,
  OrchestrationError,
  type AttemptRecord,
  type RunRecord,
  type RunStatus,
  type TaskRecord,
} from '../lib/orchestrationTypes.ts';
import type { OrchestrationStore } from '../lib/store.ts';
import { decideTaskAfterAttempt, evaluateRunLifecycle } from './stateMachine.ts';
import type {
  AttemptFailureSummary,
  RunTaskSnapshot,
  SupervisorAction,
} from './types.ts';

/**
 * The narrow execution boundary the Supervisor drives. The port is handed an
 * already-created, durably-running Attempt and is responsible for terminalizing
 * that Attempt in the durable store (passed / failed / interrupted / cancelled)
 * before it returns. The Supervisor never trusts the returned value for the
 * Attempt status: it reloads the Attempt from the store afterwards. The optional
 * {@link AttemptExecutionResult.failure} summary only carries retry-classification
 * metadata, which is not persisted on the Attempt record itself.
 *
 * Production provider binding (Codex / Claude / model routing) is deliberately
 * deferred; ORCH-5C ships only the orchestration boundary and fake executors.
 */
export interface AttemptExecutionContext {
  runId: string;
  taskId: string;
  attemptId: string;
  attemptOrdinal: number;
  hostInstanceId: string;
  task: TaskRecord;
}

export interface AttemptExecutionResult {
  failure?: AttemptFailureSummary;
}

export interface ExecutionPort {
  execute(context: AttemptExecutionContext): Promise<AttemptExecutionResult | void> | AttemptExecutionResult | void;
}

export type SupervisorTickOutcome =
  /** Run was already terminal; nothing was scheduled or executed. */
  | 'run-terminal'
  /** Run has no Tasks; the Supervisor made no progress and did not churn the Run. */
  | 'zero-tasks'
  /** A ready Task was selected, one Attempt was created and executed, and state was reconciled. */
  | 'task-executed'
  /** A running Task with a durably-terminal latest Attempt was reconciled without executing. */
  | 'task-reconciled'
  /** A Task already has a running latest Attempt; no new Attempt was created. */
  | 'attempt-active'
  /** The latest Attempt failed but retry is permitted; the retry is deferred to ORCH-5D. */
  | 'retry-deferred'
  /** Tasks exist but none are ready or running; only the Run lifecycle was evaluated. */
  | 'no-ready-task'
  /** A human gate blocks further progress on the selected/running Task. */
  | 'paused-for-gate';

export interface SupervisorRetryDeferral {
  completedAttemptOrdinal: number;
  nextAttemptOrdinal: number;
  maxAttempts: number;
}

export interface SupervisorTickResult {
  runId: string;
  outcome: SupervisorTickOutcome;
  taskId: string | null;
  attemptId: string | null;
  /** True only when this tick created a new Attempt via the store. */
  attemptCreated: boolean;
  /** True only when this tick invoked the execution port. */
  executed: boolean;
  taskAction: SupervisorAction | null;
  runAction: SupervisorAction | null;
  /** Present only when {@link outcome} is `retry-deferred`. */
  retry: SupervisorRetryDeferral | null;
  /** The Run record as it stood at the end of the tick. */
  run: RunRecord;
}

export interface SupervisorTickOptions {
  store: OrchestrationStore;
  runId: string;
  /** Deterministic Host instance identity. Production supplies the live instance id. */
  hostInstanceId: string;
  executionPort: ExecutionPort;
  /** Attempt id generator. Defaults to crypto.randomUUID. */
  idGenerator?: (() => string) | undefined;
}

const TERMINAL_RUN_STATUS_SET: ReadonlySet<RunStatus> = new Set(TERMINAL_RUN_STATUSES);
const TERMINAL_ATTEMPT_STATUS_SET: ReadonlySet<string> = new Set(TERMINAL_ATTEMPT_STATUSES);

/**
 * Advance a single Run by at most one Task per invocation:
 *
 *   Run pending → running → select one ready Task → create one Attempt →
 *   invoke the injected execution port → reload the durable terminal Attempt →
 *   apply the ORCH-5B state machine → Task terminal → evaluate Run → Run terminal.
 *
 * The tick is intentionally single-task (full DAG sequencing is ORCH-5E) and
 * never performs a retry (ORCH-5D owns failed → blocked → pending → next Attempt).
 * It creates and reasons about at most one Attempt and never applies generated
 * workspace output to the canonical tree.
 */
export async function supervisorTick(options: SupervisorTickOptions): Promise<SupervisorTickResult> {
  const { store, runId, hostInstanceId, executionPort } = options;
  const idGenerator = options.idGenerator ?? globalThis.crypto.randomUUID.bind(globalThis.crypto);

  const run = store.getRun(runId);
  if (!run) {
    throw new OrchestrationError('NOT_FOUND', `Run ${runId} was not found.`);
  }

  // (A) A terminal Run is never resurrected: no Attempt, no execution.
  if (TERMINAL_RUN_STATUS_SET.has(run.status)) {
    return baseResult(run, {
      outcome: 'run-terminal',
      runAction: { type: 'NO_ACTION', scope: 'run', reason: `run-already-${run.status}` },
    });
  }

  // (B) Reconcile an already-running Task before starting anything new. A running
  // Task is never returned by getReadyTasks, so its terminal Attempt must be
  // reconciled here — and this must happen without invoking the execution port.
  const runningTask = pickRunningTask(store, runId);
  if (runningTask) {
    return reconcileRunningTask(store, run, runningTask);
  }

  // (C) Select at most one ready Task using the existing dependency-aware ordering.
  const readyTasks = store.getReadyTasks(runId);
  if (readyTasks.length === 0) {
    const tasks = store.listTasks(runId);
    if (tasks.length === 0) {
      // Zero-Task Run: make no progress and do not churn pending → running.
      return baseResult(run, {
        outcome: 'zero-tasks',
        runAction: { type: 'NO_ACTION', scope: 'run', reason: 'zero-tasks-no-progress' },
      });
    }
    // Tasks exist but none are ready or running: only evaluate the Run lifecycle
    // (it may legitimately complete or fail based on already-terminal Tasks).
    const { runAction, run: finalRun } = evaluateAndApplyRun(store, runId);
    return baseResult(finalRun, { outcome: 'no-ready-task', runAction });
  }

  const task = readyTasks[0] as TaskRecord;

  // (D) Bring the Run into `running` before its first Attempt, using normal
  // store transitions/events. transitionPath handling below tolerates a Run that
  // is still pending, but doing this here keeps the lifecycle events well-ordered.
  if (run.status === 'pending') {
    store.transitionRun(runId, 'running');
  }

  // (E) Create exactly one Attempt through the store (moves Task pending → running,
  // assigns the ordinal, records hostInstanceId and attempt.created).
  const attemptId = idGenerator();
  const createdAttempt = store.createAttempt({ attemptId, taskId: task.taskId, hostInstanceId });

  // (F) Invoke the injected execution boundary. The fake executor terminalizes the
  // Attempt durably; production binding is deferred.
  const executionResult = (await executionPort.execute({
    runId,
    taskId: task.taskId,
    attemptId,
    attemptOrdinal: createdAttempt.ordinal,
    hostInstanceId,
    task,
  })) ?? undefined;

  // (G) Reload the durable Attempt/Task. The effective Attempt status is read from
  // the store, never from the in-memory execution result.
  const durableAttempt = store.getAttempt(attemptId);
  if (!durableAttempt) {
    throw new OrchestrationError('NOT_FOUND', `Attempt ${attemptId} was not found after execution.`);
  }
  const durableTask = requireTask(store, task.taskId);

  // (H) The executor left the Attempt running: treat the Attempt as active and do
  // not fabricate a terminal Task outcome.
  if (!isTerminalAttempt(durableAttempt)) {
    return baseResult(requireRun(store, runId), {
      outcome: 'attempt-active',
      taskId: durableTask.taskId,
      attemptId,
      attemptCreated: true,
      executed: true,
      taskAction: { type: 'NO_ACTION', scope: 'task', reason: 'attempt-still-running' },
    });
  }

  // (I) Apply the ORCH-5B Attempt → Task decision using the durable Attempt status.
  const taskAction = decideTaskAfterAttempt({
    task: durableTask,
    attempt: durableAttempt,
    failure: executionResult?.failure,
  });

  return applyExecutedTaskAction(store, runId, durableTask.taskId, attemptId, taskAction, true, true);
}

function reconcileRunningTask(
  store: OrchestrationStore,
  run: RunRecord,
  runningTask: TaskRecord,
): SupervisorTickResult {
  const latestAttempt = latestAttemptFor(store, runningTask.taskId);

  // A running Task whose latest Attempt is still running (or which has no Attempt)
  // is actively owned: no new Attempt, no execution call.
  if (!latestAttempt || !isTerminalAttempt(latestAttempt)) {
    return baseResult(run, {
      outcome: 'attempt-active',
      taskId: runningTask.taskId,
      attemptId: latestAttempt?.attemptId ?? null,
      taskAction: { type: 'NO_ACTION', scope: 'task', reason: 'attempt-still-running' },
    });
  }

  // Reconcile the durably-terminal Attempt WITHOUT re-executing. No fresh failure
  // summary is available at reconciliation time, so retryable-cause metadata is not
  // reconstructed here; that is ORCH-5D's responsibility.
  const taskAction = decideTaskAfterAttempt({ task: runningTask, attempt: latestAttempt });
  return applyExecutedTaskAction(
    store,
    run.runId,
    runningTask.taskId,
    latestAttempt.attemptId,
    taskAction,
    false,
    false,
    'task-reconciled',
  );
}

function applyExecutedTaskAction(
  store: OrchestrationStore,
  runId: string,
  taskId: string,
  attemptId: string,
  taskAction: SupervisorAction,
  attemptCreated: boolean,
  executed: boolean,
  reconciledOutcome: 'task-executed' | 'task-reconciled' = 'task-executed',
): SupervisorTickResult {
  switch (taskAction.type) {
    case 'MARK_TASK_PASSED':
      store.transitionTask(taskId, 'passed');
      break;
    case 'MARK_TASK_FAILED':
      store.transitionTask(taskId, 'failed');
      break;
    case 'MARK_TASK_CANCELLED':
      store.transitionTask(taskId, 'cancelled');
      break;
    case 'SCHEDULE_RETRY': {
      // ORCH-5C does not perform the retry: no second Attempt, no Task transition,
      // and the Run is left progressing so it cannot be incorrectly completed.
      return baseResult(requireRun(store, runId), {
        outcome: 'retry-deferred',
        taskId,
        attemptId,
        attemptCreated,
        executed,
        taskAction,
        retry: {
          completedAttemptOrdinal: taskAction.completedAttemptOrdinal,
          nextAttemptOrdinal: taskAction.nextAttemptOrdinal,
          maxAttempts: taskAction.maxAttempts,
        },
      });
    }
    case 'PAUSE_FOR_GATE':
      // Human gate: defer without transitioning the Task; the Run stays active.
      return baseResult(requireRun(store, runId), {
        outcome: 'paused-for-gate',
        taskId,
        attemptId,
        attemptCreated,
        executed,
        taskAction,
      });
    case 'NO_ACTION':
      break;
    // MARK_RUN_* are never produced by decideTaskAfterAttempt.
    default:
      break;
  }

  const { runAction, run: finalRun } = evaluateAndApplyRun(store, runId);
  return baseResult(finalRun, {
    outcome: reconciledOutcome,
    taskId,
    attemptId,
    attemptCreated,
    executed,
    taskAction,
    runAction,
  });
}

function evaluateAndApplyRun(
  store: OrchestrationStore,
  runId: string,
): { runAction: SupervisorAction; run: RunRecord } {
  const run = requireRun(store, runId);
  const tasks = store.listTasks(runId);
  const snapshots: RunTaskSnapshot[] = tasks.map((task) => ({
    taskId: task.taskId,
    status: task.status,
    // ORCH-5C never leaves a Task `failed`/`blocked` with an outstanding retry:
    // a retryable failure is surfaced as `retry-deferred` with the Task left
    // running. Any `failed`/`blocked` Task here is therefore genuinely terminal.
    retryAvailable: false,
  }));

  const runAction = evaluateRunLifecycle({ run, tasks: snapshots });
  switch (runAction.type) {
    case 'MARK_RUN_RUNNING':
    case 'MARK_RUN_COMPLETED':
    case 'MARK_RUN_FAILED':
    case 'MARK_RUN_CANCELLED':
      applyRunTransitionPath(store, runId, runAction.transitionPath);
      break;
    case 'PAUSE_FOR_GATE':
      applyRunTransitionPath(store, runId, runAction.transitionPath);
      break;
    case 'NO_ACTION':
    default:
      break;
  }

  return { runAction, run: requireRun(store, runId) };
}

function applyRunTransitionPath(
  store: OrchestrationStore,
  runId: string,
  transitionPath: readonly RunStatus[],
): void {
  for (const status of transitionPath) {
    store.transitionRun(runId, status);
  }
}

function pickRunningTask(store: OrchestrationStore, runId: string): TaskRecord | null {
  const running = store
    .listTasks(runId)
    .filter((task) => task.status === 'running')
    .sort((left, right) => left.position - right.position || left.taskId.localeCompare(right.taskId));
  return running[0] ?? null;
}

function latestAttemptFor(store: OrchestrationStore, taskId: string): AttemptRecord | null {
  const attempts = store.listAttempts(taskId);
  return attempts.length === 0 ? null : (attempts[attempts.length - 1] as AttemptRecord);
}

function isTerminalAttempt(attempt: AttemptRecord): boolean {
  return TERMINAL_ATTEMPT_STATUS_SET.has(attempt.status);
}

function requireRun(store: OrchestrationStore, runId: string): RunRecord {
  const run = store.getRun(runId);
  if (!run) {
    throw new OrchestrationError('NOT_FOUND', `Run ${runId} was not found.`);
  }
  return run;
}

function requireTask(store: OrchestrationStore, taskId: string): TaskRecord {
  const task = store.getTask(taskId);
  if (!task) {
    throw new OrchestrationError('NOT_FOUND', `Task ${taskId} was not found.`);
  }
  return task;
}

interface BaseResultOverrides {
  outcome: SupervisorTickOutcome;
  taskId?: string | null;
  attemptId?: string | null;
  attemptCreated?: boolean;
  executed?: boolean;
  taskAction?: SupervisorAction | null;
  runAction?: SupervisorAction | null;
  retry?: SupervisorRetryDeferral | null;
}

function baseResult(run: RunRecord, overrides: BaseResultOverrides): SupervisorTickResult {
  return {
    runId: run.runId,
    outcome: overrides.outcome,
    taskId: overrides.taskId ?? null,
    attemptId: overrides.attemptId ?? null,
    attemptCreated: overrides.attemptCreated ?? false,
    executed: overrides.executed ?? false,
    taskAction: overrides.taskAction ?? null,
    runAction: overrides.runAction ?? null,
    retry: overrides.retry ?? null,
    run,
  };
}
