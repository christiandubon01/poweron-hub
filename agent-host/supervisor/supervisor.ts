import {
  TERMINAL_ATTEMPT_STATUSES,
  TERMINAL_RUN_STATUSES,
  OrchestrationError,
  type AttemptRecord,
  type JsonValue,
  type OrchestrationEventRecord,
  type RunRecord,
  type RunStatus,
  type TaskRecord,
} from '../lib/orchestrationTypes.ts';
import type { OrchestrationStore } from '../lib/store.ts';
import { recoverInterruptedAttempts as defaultRecoverInterruptedAttempts } from '../providers/executor.ts';
import { decideTaskAfterAttempt, evaluateRunLifecycle } from './stateMachine.ts';
import type {
  AttemptFailureSummary,
  HumanGateMetadata,
  RetryCause,
  RunTaskSnapshot,
  SupervisorAction,
} from './types.ts';

/**
 * The narrow execution boundary the Supervisor drives. The port is handed an
 * already-created, durably-running Attempt and is responsible for terminalizing
 * that Attempt in the durable store (passed / failed / interrupted / cancelled)
 * before it returns. The Supervisor never trusts the returned value for the
 * Attempt status: it reloads the Attempt from the store afterwards. The optional
 * {@link AttemptExecutionResult.failure} summary is only a classification hint —
 * durable event evidence always takes precedence over it.
 *
 * Production provider binding (Codex / Claude / model routing) is deliberately
 * deferred; the Supervisor ships only the orchestration boundary and fake executors.
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

/** Recovery seam. Defaults to the shared {@link defaultRecoverInterruptedAttempts}. */
export type RecoverInterruptedAttemptsFn = (
  store: OrchestrationStore,
  liveHostInstanceId: string,
) => readonly AttemptRecord[];

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
  /**
   * The latest Attempt failed/interrupted, retry budget remains, and this tick has
   * durably driven the Task back to `pending` for a fresh Attempt on a later tick.
   * No Attempt is created and no execution runs in the scheduling tick.
   */
  | 'retry-scheduled'
  /** Tasks exist but none are ready or running; only the Run lifecycle was evaluated. */
  | 'no-ready-task'
  /**
   * This tick detected a durable human-gate on a Task's terminal Attempt and
   * durably blocked the Task + paused the Run, returning control to the owner.
   */
  | 'paused-for-gate'
  /** The Run is already paused (awaiting human approval); this tick was a no-op. */
  | 'run-paused';

export interface SupervisorRetryScheduled {
  completedAttemptId: string;
  completedAttemptOrdinal: number;
  nextAttemptOrdinal: number;
  maxAttempts: number;
  reasonCode: RetryCause;
}

export interface SupervisorGate {
  attemptId: string;
  gateKind: string;
  reason: string;
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
  /** Attempt ids stale-recovered (interrupted) at the start of this tick. */
  recoveredAttemptIds: readonly string[];
  /** Present only when {@link outcome} is `retry-scheduled`. */
  retry: SupervisorRetryScheduled | null;
  /** Present only when {@link outcome} is `paused-for-gate`. */
  gate: SupervisorGate | null;
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
  /** Stale-Attempt recovery seam. Defaults to the shared recovery helper. */
  recoverInterruptedAttempts?: RecoverInterruptedAttemptsFn | undefined;
  /** Emit the optional `supervisor.retry.scheduled` telemetry event. Defaults to true. */
  emitRetryEvent?: boolean | undefined;
}

export const SUPERVISOR_RETRY_SCHEDULED_EVENT = 'supervisor.retry.scheduled';
export const SUPERVISOR_BLOCKED_EVENT = 'supervisor.blocked';

const TERMINAL_RUN_STATUS_SET: ReadonlySet<RunStatus> = new Set(TERMINAL_RUN_STATUSES);
const TERMINAL_ATTEMPT_STATUS_SET: ReadonlySet<string> = new Set(TERMINAL_ATTEMPT_STATUSES);

interface TickContext {
  store: OrchestrationStore;
  runId: string;
  recoveredAttemptIds: readonly string[];
  emitRetryEvent: boolean;
}

/**
 * Advance a single Run by at most one Task per invocation:
 *
 *   recover stale in-flight Attempts → reconcile a running Task's durable terminal
 *   Attempt (retry / fail / pass, no execution) → else Run pending → running →
 *   select one ready Task → create one Attempt → invoke the injected execution port →
 *   reload the durable terminal Attempt → apply the ORCH-5B state machine →
 *   Task terminal or durably re-queued for retry → evaluate Run → Run terminal.
 *
 * Invariants: at most one execution-port invocation per tick; a retry is scheduled
 * durably (Task → failed → blocked → pending) but never executed in the same tick;
 * the next Attempt (and its incremented ordinal) is created only from durable
 * schedulable state on a later tick; no generated workspace output is ever applied
 * to the canonical tree. Full DAG sequencing remains ORCH-5E.
 */
export async function supervisorTick(options: SupervisorTickOptions): Promise<SupervisorTickResult> {
  const { store, runId, hostInstanceId, executionPort } = options;
  const idGenerator = options.idGenerator ?? globalThis.crypto.randomUUID.bind(globalThis.crypto);
  const recover = options.recoverInterruptedAttempts ?? defaultRecoverInterruptedAttempts;
  const emitRetryEvent = options.emitRetryEvent ?? true;

  const run = store.getRun(runId);
  if (!run) {
    throw new OrchestrationError('NOT_FOUND', `Run ${runId} was not found.`);
  }

  // (A) A terminal Run is never resurrected: no recovery, no Attempt, no execution.
  if (TERMINAL_RUN_STATUS_SET.has(run.status)) {
    return baseResult(run, [], {
      outcome: 'run-terminal',
      runAction: { type: 'NO_ACTION', scope: 'run', reason: `run-already-${run.status}` },
    });
  }

  // (A2) A paused Run is awaiting human approval. ORCH-5F owns stop-at-gate only:
  // no auto-resume, no new Attempt, no execution of any other (even independent)
  // Task, and no duplicate supervisor.blocked. Approval consumption/resume is a
  // future additive phase.
  if (run.status === 'paused') {
    return baseResult(run, [], {
      outcome: 'run-paused',
      runAction: { type: 'NO_ACTION', scope: 'run', reason: 'run-paused-for-human-gate' },
    });
  }

  // (B) Crash/interrupt recovery. Reuse the shared recovery helper, which turns
  // stale `running` Attempts owned by a non-live Host into `interrupted`. Attempts
  // owned by the current live Host are never touched. This never executes anything.
  const recoveredAttemptIds = recover(store, hostInstanceId).map((attempt) => attempt.attemptId);

  const ctx: TickContext = { store, runId, recoveredAttemptIds, emitRetryEvent };

  // (C) Reconcile an already-running Task before starting anything new. A running
  // Task is never returned by getReadyTasks, so a terminal (including a freshly
  // interrupted) latest Attempt must be reconciled here without invoking the port.
  const runningTask = pickRunningTask(store, runId);
  if (runningTask) {
    return reconcileRunningTask(ctx, run, runningTask);
  }

  // (D) Select at most one ready Task using the existing dependency-aware ordering.
  const readyTasks = store.getReadyTasks(runId);
  if (readyTasks.length === 0) {
    const tasks = store.listTasks(runId);
    if (tasks.length === 0) {
      // Zero-Task Run: make no progress and do not churn pending → running.
      return baseResult(run, recoveredAttemptIds, {
        outcome: 'zero-tasks',
        runAction: { type: 'NO_ACTION', scope: 'run', reason: 'zero-tasks-no-progress' },
      });
    }
    // Tasks exist but none are ready or running: only evaluate the Run lifecycle
    // (it may legitimately complete or fail based on already-terminal Tasks).
    const { runAction, run: finalRun } = evaluateAndApplyRun(store, runId);
    return baseResult(finalRun, recoveredAttemptIds, { outcome: 'no-ready-task', runAction });
  }

  const task = readyTasks[0] as TaskRecord;

  // (E) One-running-Attempt invariant: never create a second Attempt while one is
  // still running. A ready Task should never own a running Attempt, but this guards
  // the createAttempt boundary explicitly across all paths.
  const runningAttempt = store.listAttempts(task.taskId).find((attempt) => attempt.status === 'running');
  if (runningAttempt) {
    return baseResult(requireRun(store, runId), recoveredAttemptIds, {
      outcome: 'attempt-active',
      taskId: task.taskId,
      attemptId: runningAttempt.attemptId,
      taskAction: { type: 'NO_ACTION', scope: 'task', reason: 'attempt-still-running' },
    });
  }

  // (F) Bring the Run into `running` before its first Attempt, using normal
  // store transitions/events.
  if (run.status === 'pending') {
    store.transitionRun(runId, 'running');
  }

  // (G) Create exactly one Attempt through the store (moves Task pending → running,
  // assigns the ordinal, records hostInstanceId and attempt.created).
  const attemptId = idGenerator();
  const createdAttempt = store.createAttempt({ attemptId, taskId: task.taskId, hostInstanceId });

  // (H) Invoke the injected execution boundary. The fake executor terminalizes the
  // Attempt durably; production binding is deferred.
  const executionResult = (await executionPort.execute({
    runId,
    taskId: task.taskId,
    attemptId,
    attemptOrdinal: createdAttempt.ordinal,
    hostInstanceId,
    task,
  })) ?? undefined;

  // (I) Reload the durable Attempt/Task. The effective Attempt status is read from
  // the store, never from the in-memory execution result.
  const durableAttempt = store.getAttempt(attemptId);
  if (!durableAttempt) {
    throw new OrchestrationError('NOT_FOUND', `Attempt ${attemptId} was not found after execution.`);
  }
  const durableTask = requireTask(store, task.taskId);

  // (J) The executor left the Attempt running: treat the Attempt as active and do
  // not fabricate a terminal Task outcome.
  if (!isTerminalAttempt(durableAttempt)) {
    return baseResult(requireRun(store, runId), recoveredAttemptIds, {
      outcome: 'attempt-active',
      taskId: durableTask.taskId,
      attemptId,
      attemptCreated: true,
      executed: true,
      taskAction: { type: 'NO_ACTION', scope: 'task', reason: 'attempt-still-running' },
    });
  }

  // (K) Classify the durable Attempt outcome and apply the ORCH-5B decision. Durable
  // event evidence is authoritative; the port hint is only a fallback.
  const failure = classifyAttemptFailure(store, durableAttempt, executionResult?.failure);
  const taskAction = decideTaskAfterAttempt({
    task: durableTask,
    attempt: durableAttempt,
    failure,
  });

  return applyReconciledTaskAction(ctx, durableTask.taskId, attemptId, durableAttempt, failure, taskAction, true, true);
}

function reconcileRunningTask(
  ctx: TickContext,
  run: RunRecord,
  runningTask: TaskRecord,
): SupervisorTickResult {
  const { store } = ctx;
  const latestAttempt = latestAttemptFor(store, runningTask.taskId);

  // A running Task whose latest Attempt is still running (or which has no Attempt)
  // is actively owned: no new Attempt, no execution call.
  if (!latestAttempt || !isTerminalAttempt(latestAttempt)) {
    return baseResult(run, ctx.recoveredAttemptIds, {
      outcome: 'attempt-active',
      taskId: runningTask.taskId,
      attemptId: latestAttempt?.attemptId ?? null,
      taskAction: { type: 'NO_ACTION', scope: 'task', reason: 'attempt-still-running' },
    });
  }

  // Reconcile the durably-terminal Attempt WITHOUT re-executing. Classification is
  // derived from durable evidence (Attempt status + persisted execution/policy events).
  const failure = classifyAttemptFailure(store, latestAttempt);
  const taskAction = decideTaskAfterAttempt({ task: runningTask, attempt: latestAttempt, failure });
  return applyReconciledTaskAction(
    ctx,
    runningTask.taskId,
    latestAttempt.attemptId,
    latestAttempt,
    failure,
    taskAction,
    false,
    false,
    'task-reconciled',
  );
}

function applyReconciledTaskAction(
  ctx: TickContext,
  taskId: string,
  attemptId: string,
  attempt: AttemptRecord,
  failure: AttemptFailureSummary,
  taskAction: SupervisorAction,
  attemptCreated: boolean,
  executed: boolean,
  executedOutcome: 'task-executed' | 'task-reconciled' = 'task-executed',
): SupervisorTickResult {
  const { store, runId } = ctx;
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
    case 'SCHEDULE_RETRY':
      return scheduleRetry(ctx, taskId, attempt, failure.cause, taskAction, attemptCreated, executed);
    case 'PAUSE_FOR_GATE':
      return pauseForGate(ctx, taskId, attempt, taskAction, attemptCreated, executed);
    case 'NO_ACTION':
      break;
    // MARK_RUN_* are never produced by decideTaskAfterAttempt.
    default:
      break;
  }

  const { runAction, run: finalRun } = evaluateAndApplyRun(store, runId);
  return baseResult(finalRun, ctx.recoveredAttemptIds, {
    outcome: executedOutcome,
    taskId,
    attemptId,
    attemptCreated,
    executed,
    taskAction,
    runAction,
  });
}

/**
 * Durably schedule a retry: drive the Task through its ORCH-5B transition path
 * (running → failed → blocked → pending, or the appropriate suffix) so that the
 * terminal truth of the failed Attempt is recorded, retry intent is explicit, and
 * returning to `pending` forces dependency/readiness re-evaluation. No new Attempt
 * is created and the execution port is not invoked in this tick — the next tick
 * creates the next ordinal from durable schedulable state.
 */
function scheduleRetry(
  ctx: TickContext,
  taskId: string,
  completedAttempt: AttemptRecord,
  reasonCode: RetryCause,
  action: Extract<SupervisorAction, { type: 'SCHEDULE_RETRY' }>,
  attemptCreated: boolean,
  executed: boolean,
): SupervisorTickResult {
  const { store, runId } = ctx;
  for (const status of action.transitionPath) {
    store.transitionTask(taskId, status);
  }

  if (ctx.emitRetryEvent) {
    emitRetryScheduledEvent(store, runId, taskId, completedAttempt, action, reasonCode);
  }

  return baseResult(requireRun(store, runId), ctx.recoveredAttemptIds, {
    outcome: 'retry-scheduled',
    taskId,
    attemptId: completedAttempt.attemptId,
    attemptCreated,
    executed,
    taskAction: action,
    retry: {
      completedAttemptId: completedAttempt.attemptId,
      completedAttemptOrdinal: action.completedAttemptOrdinal,
      nextAttemptOrdinal: action.nextAttemptOrdinal,
      maxAttempts: action.maxAttempts,
      reasonCode,
    },
  });
}

/**
 * Durably stop at a human gate: block the Task and pause the Run using only valid
 * existing transitions, then append one deterministic supervisor.blocked event.
 * ORCH-5F owns stop-at-gate only — no approval is fabricated, no retry is scheduled,
 * no further Task executes, and the Run is never auto-resumed. maxAttempts is
 * irrelevant: a human gate always wins over the retry budget.
 */
function pauseForGate(
  ctx: TickContext,
  taskId: string,
  gatedAttempt: AttemptRecord,
  action: Extract<SupervisorAction, { type: 'PAUSE_FOR_GATE' }>,
  attemptCreated: boolean,
  executed: boolean,
): SupervisorTickResult {
  const { store, runId } = ctx;

  // The Run must be `running` before it can pause (pending → paused is invalid).
  const run = requireRun(store, runId);
  if (run.status === 'pending') {
    store.transitionRun(runId, 'running');
  }
  // Task running → blocked; Run running → paused (both valid existing transitions).
  store.transitionTask(taskId, 'blocked');
  store.transitionRun(runId, 'paused');

  // Exactly one durable supervisor.blocked event (deterministic id → no duplicates).
  store.appendEvent({
    eventId: `${SUPERVISOR_BLOCKED_EVENT}:${gatedAttempt.attemptId}`,
    runId,
    taskId,
    attemptId: gatedAttempt.attemptId,
    type: SUPERVISOR_BLOCKED_EVENT,
    payload: {
      reason: 'human-gate',
      gateKind: action.gateKind,
    },
  });

  return baseResult(requireRun(store, runId), ctx.recoveredAttemptIds, {
    outcome: 'paused-for-gate',
    taskId,
    attemptId: gatedAttempt.attemptId,
    attemptCreated,
    executed,
    taskAction: action,
    gate: {
      attemptId: gatedAttempt.attemptId,
      gateKind: action.gateKind,
      reason: action.reason,
    },
  });
}

/**
 * Emit optional retry telemetry. The event id is derived deterministically from the
 * completed Attempt so repeated evaluation cannot duplicate it (the store dedupes
 * identical event ids). Payload carries only safe metadata — no prompt/source/secrets.
 */
function emitRetryScheduledEvent(
  store: OrchestrationStore,
  runId: string,
  taskId: string,
  completedAttempt: AttemptRecord,
  action: Extract<SupervisorAction, { type: 'SCHEDULE_RETRY' }>,
  reasonCode: RetryCause,
): void {
  store.appendEvent({
    eventId: `${SUPERVISOR_RETRY_SCHEDULED_EVENT}:${completedAttempt.attemptId}`,
    runId,
    taskId,
    attemptId: completedAttempt.attemptId,
    type: SUPERVISOR_RETRY_SCHEDULED_EVENT,
    payload: {
      completedAttemptOrdinal: action.completedAttemptOrdinal,
      nextAttemptOrdinal: action.nextAttemptOrdinal,
      maxAttempts: action.maxAttempts,
      reasonCode,
    },
  });
}

/**
 * Translate durable evidence into an ORCH-5B failure classification. Interrupted and
 * cancelled Attempt statuses classify directly; a `failed` Attempt is classified from
 * persisted execution/policy events (authoritative), then from the caller's hint, and
 * finally fails closed to `unknown` (never automatically retryable).
 */
export function classifyAttemptFailure(
  store: OrchestrationStore,
  attempt: AttemptRecord,
  hint?: AttemptFailureSummary,
): AttemptFailureSummary {
  if (attempt.status === 'interrupted') {
    return { cause: 'host-interrupted' };
  }
  if (attempt.status === 'cancelled') {
    return { cause: 'cancelled' };
  }
  if (attempt.status !== 'failed') {
    // Not a failure (e.g. passed); the state machine ignores the summary here.
    return hint ?? { cause: 'unknown' };
  }

  const durable = classifyFromDurableEvents(store, attempt.attemptId);
  if (durable) {
    return durable;
  }
  if (hint) {
    return hint;
  }
  return { cause: 'unknown' };
}

function classifyFromDurableEvents(store: OrchestrationStore, attemptId: string): AttemptFailureSummary | null {
  const events = store.listEvents().filter((event) => event.attemptId === attemptId);

  let humanGate: HumanGateMetadata | null = null;
  let sawPolicyRejection = false;
  let sawCancelled = false;
  let sawTimeout = false;
  let sawProviderFailure = false;

  for (const event of events) {
    switch (event.type) {
      case 'policy.violation':
        humanGate = humanGate ?? extractHumanGate(event);
        sawPolicyRejection = true;
        break;
      case 'policy.evaluated':
        humanGate = humanGate ?? extractHumanGate(event);
        if (eventBool(event, 'accepted') === false) {
          sawPolicyRejection = true;
        }
        break;
      case 'execution.cancelled':
        sawCancelled = true;
        break;
      case 'execution.timed_out':
        sawTimeout = true;
        break;
      case 'execution.failed': {
        sawProviderFailure = true;
        const errorCode = eventString(event, 'errorCode');
        if (errorCode === 'EXECUTION_TIMEOUT') {
          sawTimeout = true;
        }
        if (errorCode === 'EXECUTION_CANCELLED') {
          sawCancelled = true;
        }
        if (nestedProcessTimedOut(event)) {
          sawTimeout = true;
        }
        break;
      }
      default:
        break;
    }
  }

  // Fail-safe ordering: a human gate wins over everything (it must never fall
  // through into a transient retry), then non-retryable classifications win over
  // retryable ones.
  if (humanGate) {
    return { cause: 'human-gate', gate: humanGate };
  }
  if (sawPolicyRejection) {
    return { cause: 'policy-rejection' };
  }
  if (sawCancelled) {
    return { cause: 'cancelled' };
  }
  if (sawTimeout) {
    return { cause: 'execution-timeout' };
  }
  if (sawProviderFailure) {
    return { cause: 'provider-process-failure' };
  }
  return null;
}

/**
 * Detect a human gate strictly from the explicit durable `requiresHuman` field on a
 * policy change (originating from PolicyDecisionKind === 'require-human'). Detection
 * NEVER derives from reasonCode/category/path — those are used only as safe,
 * non-secret descriptive metadata for the gate kind.
 */
function extractHumanGate(event: OrchestrationEventRecord): HumanGateMetadata | null {
  const payload = eventPayload(event);
  const changes = payload?.changes;
  if (!Array.isArray(changes)) {
    return null;
  }
  for (const change of changes) {
    if (change && typeof change === 'object' && !Array.isArray(change)) {
      const record = change as Record<string, JsonValue>;
      if (record.requiresHuman === true) {
        const reasonCode = typeof record.reasonCode === 'string' ? record.reasonCode : 'human-approval';
        return {
          taskId: event.taskId ?? '',
          gateKind: reasonCode,
          reason: 'Human approval is required before this Task can continue.',
        };
      }
    }
  }
  return null;
}

function eventPayload(event: OrchestrationEventRecord): Record<string, JsonValue> | null {
  const payload = event.payload;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return payload as Record<string, JsonValue>;
  }
  return null;
}

function eventBool(event: OrchestrationEventRecord, key: string): boolean | null {
  const payload = eventPayload(event);
  const value = payload?.[key];
  return typeof value === 'boolean' ? value : null;
}

function eventString(event: OrchestrationEventRecord, key: string): string | null {
  const payload = eventPayload(event);
  const value = payload?.[key];
  return typeof value === 'string' ? value : null;
}

function nestedProcessTimedOut(event: OrchestrationEventRecord): boolean {
  const payload = eventPayload(event);
  const process = payload?.process;
  if (process && typeof process === 'object' && !Array.isArray(process)) {
    return (process as Record<string, JsonValue>).timedOut === true;
  }
  return false;
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
    // A retryable failure is surfaced as `retry-scheduled` with the Task durably
    // returned to `pending`, so any `failed`/`blocked` Task observed here is
    // genuinely terminal (its retry budget is spent or its cause is non-retryable).
    retryAvailable: false,
  }));

  const runAction = evaluateRunLifecycle({ run, tasks: snapshots });
  switch (runAction.type) {
    case 'MARK_RUN_RUNNING':
    case 'MARK_RUN_COMPLETED':
    case 'MARK_RUN_FAILED':
    case 'MARK_RUN_CANCELLED':
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
  retry?: SupervisorRetryScheduled | null;
  gate?: SupervisorGate | null;
}

function baseResult(
  run: RunRecord,
  recoveredAttemptIds: readonly string[],
  overrides: BaseResultOverrides,
): SupervisorTickResult {
  return {
    runId: run.runId,
    outcome: overrides.outcome,
    taskId: overrides.taskId ?? null,
    attemptId: overrides.attemptId ?? null,
    attemptCreated: overrides.attemptCreated ?? false,
    executed: overrides.executed ?? false,
    taskAction: overrides.taskAction ?? null,
    runAction: overrides.runAction ?? null,
    recoveredAttemptIds,
    retry: overrides.retry ?? null,
    gate: overrides.gate ?? null,
    run,
  };
}
