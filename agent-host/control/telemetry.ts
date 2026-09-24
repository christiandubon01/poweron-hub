/**
 * ATB-1: Agent Team runtime telemetry projection.
 *
 * PURE projection of interim verdicts, role-to-role handoffs, and deterministic
 * signals from the EXISTING durable orchestration event log. This module:
 *
 *   - persists NOTHING (adds no event types, opens no store, no side effects);
 *   - is deterministic and idempotent (derived only from the immutable event
 *     stream + task/run records, with stable ids);
 *   - is fail-safe (every projector is wrapped; malformed evidence is skipped or
 *     truncated, never thrown). Telemetry is OBSERVABILITY only and can never
 *     strand a Task/Attempt or break the core snapshot.
 *
 * SAFETY (§ ATB-0 whitelist): only structured status, concise safe summaries,
 * counts, timestamps, safe repo-relative path metadata, and provider/model
 * truth already present in existing safe event payloads are emitted. NEVER
 * prompts, transcripts, chain-of-thought, source contents, raw diffs, secrets,
 * env, or unrestricted local paths.
 *
 * Host and Guard are DETERMINISTIC roles here — their verdicts are derived from
 * lifecycle/policy events, never from a model turn. No LLM call is ever made to
 * produce telemetry.
 */

import type {
  OrchestrationEventRecord,
  RunRecord,
  TaskRecord,
} from '../lib/orchestrationTypes.ts';
import type {
  SnapshotHandoff,
  SnapshotInterimVerdict,
  SnapshotSignal,
  HandoffParty,
  SignalCategory,
  TelemetryRole,
  VerdictState,
} from './types.ts';
import {
  MAX_SNAPSHOT_HANDOFFS,
  MAX_SNAPSHOT_INTERIM_VERDICTS,
  MAX_SNAPSHOT_SIGNALS,
  TELEMETRY_EVIDENCE_REF_MAX,
  TELEMETRY_EVIDENCE_REF_MAX_CHARS,
  TELEMETRY_MESSAGE_MAX_CHARS,
  TELEMETRY_SUMMARY_MAX_CHARS,
} from './types.ts';

/**
 * attempt-stalled honesty (ATB-1B): a normal long provider turn produces NO
 * mid-turn durable events, so "no event for N minutes" is NOT evidence of a
 * stall. An attempt is only flagged stalled once it has been open PAST its own
 * configured time budget (control.timeoutMs) plus this grace — i.e. it is
 * genuinely overdue relative to the bound the executor itself enforces. Below
 * that bound a long attempt is truthfully just RUNNING (elapsed is derivable
 * from the execution.started timestamp), never "stalled".
 */
export const TELEMETRY_STALL_GRACE_MS = 60_000;
/** Fallback attempt time budget when the task spec does not carry control.timeoutMs. */
export const TELEMETRY_DEFAULT_ATTEMPT_TIMEOUT_MS = 10 * 60_000;
/** Number of scheduled retries for one task that trips the excessive-retry signal. */
export const TELEMETRY_EXCESSIVE_RETRY_THRESHOLD = 2;

const TERMINAL_EXECUTION_EVENT_TYPES = new Set([
  'execution.completed',
  'execution.failed',
  'execution.timed_out',
  'execution.cancelled',
]);
const TERMINAL_RUN_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const ACTIVE_RUN_STATUSES = new Set(['pending', 'running', 'paused']);

export interface TelemetryProjectionInput {
  run: RunRecord;
  tasks: readonly TaskRecord[];
  /** Events already narrowed to this run. Order is not assumed (sorted here). */
  events: readonly OrchestrationEventRecord[];
  /** Injected clock for deterministic stall detection. Defaults to Date.now(). */
  nowMs?: number | undefined;
}

export interface RunTelemetryProjection {
  interimVerdicts: SnapshotInterimVerdict[];
  handoffs: SnapshotHandoff[];
  signals: SnapshotSignal[];
}

interface TaskMeta {
  role: TelemetryRole;
  title: string;
  plannedAreas: string[];
  authorizedWritePaths: string[];
  /** Configured attempt time budget (ms) from the task spec, when present. */
  timeoutMs: number | null;
}

/* -------------------------------------------------------------------------- */
/* Public entry                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Project all three telemetry streams. Each sub-projection is independently
 * wrapped: a failure in one never blanks the others and never throws.
 */
export function projectRunTelemetry(input: TelemetryProjectionInput): RunTelemetryProjection {
  return {
    interimVerdicts: safeList(() => projectInterimVerdicts(input)),
    handoffs: safeList(() => projectHandoffs(input)),
    signals: safeList(() => projectSignals(input)),
  };
}

function safeList<T>(fn: () => T[]): T[] {
  try {
    return fn();
  } catch {
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/* Interim verdicts                                                            */
/* -------------------------------------------------------------------------- */

export function projectInterimVerdicts(input: TelemetryProjectionInput): SnapshotInterimVerdict[] {
  const events = sortedEvents(input.events);
  const metaByTask = buildTaskMeta(input.tasks);
  const byId = new Map<string, SnapshotInterimVerdict>();

  const push = (verdict: SnapshotInterimVerdict): void => {
    if (!byId.has(verdict.verdictId)) {
      byId.set(verdict.verdictId, verdict);
    }
  };

  for (const event of events) {
    const meta = event.taskId ? metaByTask.get(event.taskId) : undefined;
    const role: TelemetryRole = meta?.role ?? 'host';
    const at = event.createdAt;

    switch (event.type) {
      case 'execution.started':
        push(verdict({
          id: `verdict:started:${refPart(event.attemptId, event.taskId)}`,
          role, taskId: event.taskId, attemptId: event.attemptId,
          state: 'CONTINUE', severity: 'info', recommendedAction: 'none', mayContinue: true,
          summary: `${roleLabel(role)} attempt started`,
          evidenceRefs: refs(event.attemptId), evidenceCount: 1, timestamp: at,
        }));
        break;
      case 'workspace.changeset.ready': {
        const changeCount = numField(event, 'changeCount') ?? 0;
        push(verdict({
          id: `verdict:changeset:${refPart(event.attemptId, event.taskId)}`,
          role: 'implementer', taskId: event.taskId, attemptId: event.attemptId,
          state: 'CONTINUE', severity: 'notice', recommendedAction: 'none', mayContinue: true,
          summary: `Candidate changeset ready · ${changeCount} file(s)`,
          evidenceRefs: refs(event.attemptId), evidenceCount: changeCount, timestamp: at,
        }));
        break;
      }
      case 'policy.evaluated': {
        const guard = evaluateGuard(event);
        if (!guard) {
          break;
        }
        push(verdict({
          id: `verdict:policy:${refPart(event.attemptId, event.taskId)}`,
          role: 'guard', taskId: event.taskId, attemptId: event.attemptId,
          state: guard.state, severity: guard.severity, recommendedAction: guard.recommendedAction,
          mayContinue: guard.mayContinue, summary: guard.summary,
          evidenceRefs: guard.evidenceRefs, evidenceCount: guard.evidenceCount, timestamp: at,
        }));
        break;
      }
      case 'supervisor.retry.scheduled': {
        const completed = numField(event, 'completedAttemptOrdinal');
        const next = numField(event, 'nextAttemptOrdinal');
        const maxAttempts = numField(event, 'maxAttempts');
        push(verdict({
          id: `verdict:retry:${refPart(event.attemptId, event.taskId)}`,
          role: 'host', taskId: event.taskId, attemptId: event.attemptId,
          state: 'WATCH', severity: 'notice', recommendedAction: 'watch', mayContinue: true,
          summary: `Retry scheduled · attempt ${completed ?? '?'}→${next ?? '?'} of ${maxAttempts ?? '?'}`,
          evidenceRefs: refs(event.attemptId), evidenceCount: 1, timestamp: at,
        }));
        break;
      }
      case 'supervisor.blocked': {
        const gateKind = strField(event, 'gateKind') ?? 'human-approval';
        push(verdict({
          id: `verdict:gate:${refPart(event.attemptId, event.taskId)}`,
          role: 'host', taskId: event.taskId, attemptId: event.attemptId,
          state: 'NEEDS_OWNER', severity: 'critical', recommendedAction: 'approve-gate', mayContinue: false,
          summary: `Run paused at human gate · ${gateKind}`,
          evidenceRefs: refs(event.taskId), evidenceCount: 1, timestamp: at,
        }));
        break;
      }
      case 'control.verifier.verdict': {
        const v = strField(event, 'verdict');
        const mapped = v === 'pass'
          ? { state: 'PASS' as VerdictState, severity: 'info' as const, action: 'none' as const, cont: true, text: 'Verifier verdict: PASS' }
          : v === 'fail'
            ? { state: 'FAIL' as VerdictState, severity: 'critical' as const, action: 'owner-review' as const, cont: false, text: 'Verifier verdict: FAIL' }
            : { state: 'WATCH' as VerdictState, severity: 'notice' as const, action: 'watch' as const, cont: true, text: 'Verifier verdict unavailable' };
        push(verdict({
          id: `verdict:verifier:${refPart(event.attemptId, event.taskId)}`,
          role: 'verifier', taskId: event.taskId, attemptId: event.attemptId,
          state: mapped.state, severity: mapped.severity, recommendedAction: mapped.action, mayContinue: mapped.cont,
          summary: mapped.text, evidenceRefs: refs(event.attemptId), evidenceCount: 1, timestamp: at,
        }));
        break;
      }
      case 'execution.failed':
      case 'execution.timed_out': {
        const kind = event.type === 'execution.timed_out' ? 'timed out' : 'failed';
        push(verdict({
          id: `verdict:exec-terminal:${refPart(event.attemptId, event.taskId)}`,
          role, taskId: event.taskId, attemptId: event.attemptId,
          state: 'WATCH', severity: 'warning', recommendedAction: 'watch', mayContinue: true,
          summary: `${roleLabel(role)} attempt ${kind}`,
          evidenceRefs: refs(event.attemptId), evidenceCount: 1, timestamp: at,
        }));
        break;
      }
      default:
        break;
    }
  }

  // Run-level terminal verdict (Host, deterministic from run status).
  if (TERMINAL_RUN_STATUSES.has(input.run.status)) {
    const mapped = input.run.status === 'completed'
      ? { state: 'PASS' as VerdictState, severity: 'info' as const, action: 'none' as const }
      : input.run.status === 'failed'
        ? { state: 'FAIL' as VerdictState, severity: 'critical' as const, action: 'owner-review' as const }
        : { state: 'WATCH' as VerdictState, severity: 'notice' as const, action: 'none' as const };
    push(verdict({
      id: `verdict:run:${input.run.runId}:${input.run.status}`,
      role: 'host', taskId: null, attemptId: null,
      state: mapped.state, severity: mapped.severity, recommendedAction: mapped.action, mayContinue: false,
      summary: `Run ${input.run.status}`,
      evidenceRefs: [], evidenceCount: 0,
      timestamp: input.run.completedAt ?? input.run.updatedAt,
    }));
  }

  return [...byId.values()].slice(-MAX_SNAPSHOT_INTERIM_VERDICTS);
}

interface GuardEvaluation {
  state: VerdictState;
  severity: SnapshotInterimVerdict['severity'];
  recommendedAction: SnapshotInterimVerdict['recommendedAction'];
  mayContinue: boolean;
  summary: string;
  evidenceRefs: string[];
  evidenceCount: number;
}

function evaluateGuard(event: OrchestrationEventRecord): GuardEvaluation | null {
  const accepted = boolField(event, 'accepted');
  const changes = changeList(event);
  const changeCount = numField(event, 'changeCount') ?? changes.length;
  const humanGated = changes.filter((change) => change.requiresHuman === true);
  const denied = changes.filter((change) => change.decision !== 'allow');

  if (humanGated.length > 0) {
    return {
      state: 'NEEDS_OWNER', severity: 'critical', recommendedAction: 'owner-review', mayContinue: false,
      summary: `Guard requires human approval · ${humanGated.length} change(s)`,
      evidenceRefs: pathRefs(humanGated), evidenceCount: humanGated.length,
    };
  }
  if (accepted === false || denied.length > 0) {
    return {
      state: 'BLOCKED', severity: 'warning', recommendedAction: 'owner-review', mayContinue: false,
      summary: `Guard denied ${denied.length || changeCount} change(s)`,
      evidenceRefs: pathRefs(denied), evidenceCount: denied.length || changeCount,
    };
  }
  if (changeCount > 0) {
    return {
      state: 'CONTINUE', severity: 'info', recommendedAction: 'none', mayContinue: true,
      summary: `Guard clean · ${changeCount} change(s) in scope`,
      evidenceRefs: [], evidenceCount: changeCount,
    };
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Handoffs                                                                    */
/* -------------------------------------------------------------------------- */

export function projectHandoffs(input: TelemetryProjectionInput): SnapshotHandoff[] {
  const events = sortedEvents(input.events);
  const metaByTask = buildTaskMeta(input.tasks);
  const byId = new Map<string, SnapshotHandoff>();
  const runCreatedMs = parseMs(input.run.createdAt);

  const push = (handoff: SnapshotHandoff): void => {
    if (!byId.has(handoff.handoffId)) {
      byId.set(handoff.handoffId, handoff);
    }
  };

  // Owner → Host: the plan the owner approved started this run (synthesized from
  // run creation; the run only exists because approve_plan succeeded).
  push(handoff({
    id: `handoff:plan-approved:${input.run.runId}`,
    from: 'owner', to: 'host', taskId: null, payloadType: 'plan',
    summary: 'Plan approved · run started', evidenceCount: input.tasks.length,
    status: 'accepted', timestamp: input.run.createdAt, latencyMs: null, resultingVerdict: null,
  }));

  const seenTaskReady = new Set<string>();
  for (const event of events) {
    const meta = event.taskId ? metaByTask.get(event.taskId) : undefined;
    const at = event.createdAt;

    switch (event.type) {
      case 'execution.started': {
        if (!event.taskId || seenTaskReady.has(event.taskId)) {
          break;
        }
        seenTaskReady.add(event.taskId);
        const role: TelemetryRole = meta?.role ?? 'implementer';
        push(handoff({
          id: `handoff:task-ready:${event.taskId}`,
          from: 'host', to: role, taskId: event.taskId, payloadType: 'task-ready',
          summary: `Task ready · ${trunc(meta?.title ?? event.taskId, 120)}`, evidenceCount: 1,
          status: 'delivered', timestamp: at, latencyMs: clampLatency(runCreatedMs, parseMs(at)), resultingVerdict: null,
        }));
        break;
      }
      case 'workspace.changeset.ready': {
        const changeCount = numField(event, 'changeCount') ?? 0;
        push(handoff({
          id: `handoff:changeset:${refPart(event.attemptId, event.taskId)}`,
          from: 'implementer', to: 'verifier', taskId: event.taskId, payloadType: 'changeset',
          summary: `Candidate changeset · ${changeCount} file(s)`, evidenceCount: changeCount,
          status: 'delivered', timestamp: at, latencyMs: null, resultingVerdict: null,
        }));
        break;
      }
      case 'policy.evaluated': {
        const guard = evaluateGuard(event);
        if (!guard || guard.state === 'CONTINUE') {
          break;
        }
        const isGate = guard.state === 'NEEDS_OWNER';
        push(handoff({
          id: `handoff:policy:${refPart(event.attemptId, event.taskId)}`,
          from: 'guard', to: 'host', taskId: event.taskId,
          payloadType: isGate ? 'gate' : 'policy-finding',
          summary: guard.summary, evidenceCount: guard.evidenceCount,
          status: 'blocked', timestamp: at, latencyMs: null,
          resultingVerdict: isGate ? 'NEEDS_OWNER' : 'BLOCKED',
        }));
        break;
      }
      case 'control.verifier.verdict': {
        const v = strField(event, 'verdict');
        const resultingVerdict: VerdictState = v === 'pass' ? 'PASS' : v === 'fail' ? 'FAIL' : 'WATCH';
        const status: SnapshotHandoff['status'] = v === 'pass' ? 'accepted' : v === 'fail' ? 'rejected' : 'delivered';
        push(handoff({
          id: `handoff:verification:${refPart(event.attemptId, event.taskId)}`,
          from: 'verifier', to: 'host', taskId: event.taskId, payloadType: 'verification',
          summary: `Verifier verdict: ${(v ?? 'unknown').toUpperCase()}`, evidenceCount: 1,
          status, timestamp: at, latencyMs: null, resultingVerdict,
        }));
        break;
      }
      case 'supervisor.blocked': {
        const gateKind = strField(event, 'gateKind') ?? 'human-approval';
        push(handoff({
          id: `handoff:gate:${refPart(event.attemptId, event.taskId)}`,
          from: 'host', to: 'owner', taskId: event.taskId, payloadType: 'gate',
          summary: `Human gate · ${gateKind}`, evidenceCount: 1,
          status: 'queued', timestamp: at, latencyMs: null, resultingVerdict: 'NEEDS_OWNER',
        }));
        break;
      }
      default:
        break;
    }
  }

  // Host → Owner: terminal run result.
  if (TERMINAL_RUN_STATUSES.has(input.run.status)) {
    const resultingVerdict: VerdictState | null = input.run.status === 'completed' ? 'PASS' : input.run.status === 'failed' ? 'FAIL' : null;
    push(handoff({
      id: `handoff:run-result:${input.run.runId}`,
      from: 'host', to: 'owner', taskId: null, payloadType: 'run-result',
      summary: `Run ${input.run.status}`, evidenceCount: input.tasks.length,
      status: 'delivered', timestamp: input.run.completedAt ?? input.run.updatedAt,
      latencyMs: null, resultingVerdict,
    }));
  }

  return [...byId.values()].slice(-MAX_SNAPSHOT_HANDOFFS);
}

/* -------------------------------------------------------------------------- */
/* Signals                                                                     */
/* -------------------------------------------------------------------------- */

export function projectSignals(input: TelemetryProjectionInput): SnapshotSignal[] {
  const events = sortedEvents(input.events);
  const metaByTask = buildTaskMeta(input.tasks);
  const nowMs = typeof input.nowMs === 'number' ? input.nowMs : Date.now();
  const byId = new Map<string, SnapshotSignal>();

  const retryCountByTask = new Map<string, number>();
  const openAttempts = new Map<string, { taskId: string | null; startedAt: string }>();
  let sawImplementerChangeset = false;
  let verifierFail: { taskId: string | null; attemptId: string | null; at: string } | null = null;

  const upsert = (partial: {
    id: string; category: SignalCategory; severity: SnapshotSignal['severity'];
    source: SnapshotSignal['source']; taskId: string | null; attemptId: string | null;
    message: string; evidenceRefs: string[]; at: string; ownerActionRequired: boolean;
  }): void => {
    const existing = byId.get(partial.id);
    if (existing) {
      existing.lastSeen = partial.at;
      existing.evidenceCount += 1;
      mergeRefs(existing.evidenceRefs, partial.evidenceRefs);
      return;
    }
    byId.set(partial.id, {
      signalId: partial.id, category: partial.category, severity: partial.severity, source: partial.source,
      taskId: partial.taskId, attemptId: partial.attemptId, message: trunc(partial.message, TELEMETRY_MESSAGE_MAX_CHARS),
      evidenceCount: 1, evidenceRefs: boundedRefs(partial.evidenceRefs),
      firstSeen: partial.at, lastSeen: partial.at, resolvedAt: null, ownerActionRequired: partial.ownerActionRequired,
    });
  };

  for (const event of events) {
    const meta = event.taskId ? metaByTask.get(event.taskId) : undefined;
    const at = event.createdAt;

    if (event.attemptId && event.type === 'execution.started') {
      openAttempts.set(event.attemptId, { taskId: event.taskId, startedAt: at });
    } else if (event.attemptId && openAttempts.has(event.attemptId) && TERMINAL_EXECUTION_EVENT_TYPES.has(event.type)) {
      openAttempts.delete(event.attemptId);
    }

    switch (event.type) {
      case 'policy.evaluated': {
        if (boolField(event, 'headMoved') === true) {
          upsert({
            id: `signal:unexpected-head-move:${event.taskId ?? 'run'}:${event.attemptId ?? ''}`,
            category: 'unexpected-head-move', severity: 'critical', source: 'guard',
            taskId: event.taskId, attemptId: event.attemptId,
            message: 'Repository HEAD moved during the attempt (unexpected).',
            evidenceRefs: ['.git/HEAD'], at, ownerActionRequired: true,
          });
        }
        for (const change of changeList(event)) {
          const signal = classifyChangeSignal(change, meta);
          if (!signal) {
            continue;
          }
          upsert({
            id: `signal:${signal.category}:${event.taskId ?? 'run'}:${signal.path}`,
            category: signal.category, severity: signal.severity, source: 'guard',
            taskId: event.taskId, attemptId: event.attemptId,
            message: signal.message, evidenceRefs: [signal.path], at, ownerActionRequired: signal.ownerActionRequired,
          });
        }
        break;
      }
      case 'workspace.changeset.ready': {
        sawImplementerChangeset = true;
        const changeCount = numField(event, 'changeCount') ?? 0;
        const authorized = meta?.authorizedWritePaths.length ?? 0;
        if (authorized > 0 && changeCount > authorized) {
          upsert({
            id: `signal:changeset-oversized:${event.taskId ?? 'run'}`,
            category: 'changeset-oversized', severity: 'notice', source: 'host',
            taskId: event.taskId, attemptId: event.attemptId,
            message: `Changeset (${changeCount}) exceeds authorized paths (${authorized}).`,
            evidenceRefs: [`changeCount=${changeCount}`, `authorized=${authorized}`], at, ownerActionRequired: false,
          });
        }
        break;
      }
      case 'control.verifier.verdict': {
        if (strField(event, 'verdict') === 'fail') {
          verifierFail = { taskId: event.taskId, attemptId: event.attemptId, at };
        }
        break;
      }
      case 'supervisor.retry.scheduled': {
        if (event.taskId) {
          const count = (retryCountByTask.get(event.taskId) ?? 0) + 1;
          retryCountByTask.set(event.taskId, count);
          if (count >= TELEMETRY_EXCESSIVE_RETRY_THRESHOLD) {
            upsert({
              id: `signal:excessive-retry:${event.taskId}`,
              category: 'excessive-retry', severity: 'warning', source: 'supervisor',
              taskId: event.taskId, attemptId: event.attemptId,
              message: `Task retried ${count} time(s).`,
              evidenceRefs: [`retries=${count}`], at, ownerActionRequired: false,
            });
          }
        }
        break;
      }
      case 'supervisor.blocked': {
        const gateKind = strField(event, 'gateKind') ?? 'human-approval';
        upsert({
          id: `signal:human-gate:${event.taskId ?? 'run'}:${event.attemptId ?? ''}`,
          category: 'human-gate', severity: 'critical', source: 'supervisor',
          taskId: event.taskId, attemptId: event.attemptId,
          message: `Human gate raised · ${gateKind}`,
          evidenceRefs: [], at, ownerActionRequired: true,
        });
        break;
      }
      case 'execution.completed':
      case 'execution.failed':
      case 'execution.timed_out':
      case 'execution.cancelled': {
        const requested = strField(event, 'requestedModel');
        const reported = strField(event, 'reportedModel');
        if (requested && reported && requested !== reported) {
          upsert({
            id: `signal:model-routing-mismatch:${event.attemptId ?? event.taskId ?? 'run'}`,
            category: 'model-routing-mismatch', severity: 'notice', source: 'host',
            taskId: event.taskId, attemptId: event.attemptId,
            message: `Requested model differs from reported model.`,
            evidenceRefs: [`requested=${trunc(requested, 120)}`, `reported=${trunc(reported, 120)}`], at, ownerActionRequired: false,
          });
        }
        const requestedProvider = strField(event, 'requestedProvider');
        const reportedProvider = strField(event, 'provider');
        if (boolField(event, 'fellBack') === true || (requestedProvider && reportedProvider && requestedProvider !== reportedProvider)) {
          upsert({
            id: `signal:provider-fallback:${event.attemptId ?? event.taskId ?? 'run'}`,
            category: 'provider-fallback', severity: 'notice', source: 'host',
            taskId: event.taskId, attemptId: event.attemptId,
            message: 'Execution used a fallback provider.',
            evidenceRefs: [
              ...(requestedProvider ? [`requestedProvider=${trunc(requestedProvider, 120)}`] : []),
              ...(reportedProvider ? [`provider=${trunc(reportedProvider, 120)}`] : []),
            ], at, ownerActionRequired: false,
          });
        }
        break;
      }
      default:
        break;
    }
  }

  if (sawImplementerChangeset && verifierFail) {
    upsert({
      id: `signal:verifier-implementer-disagreement:${verifierFail.attemptId ?? verifierFail.taskId ?? input.run.runId}`,
      category: 'verifier-implementer-disagreement', severity: 'warning', source: 'host',
      taskId: verifierFail.taskId, attemptId: verifierFail.attemptId,
      message: 'Verifier FAIL after an implementer changeset.',
      evidenceRefs: ['verdict=fail'], at: verifierFail.at, ownerActionRequired: false,
    });
  }

  // Attempt stalled (honest): a normal long provider turn emits no mid-turn
  // durable events, so elapsed-without-events is NOT a stall. Only flag an
  // attempt that is open PAST its configured time budget + grace — i.e. genuinely
  // overdue relative to the executor's own hard bound. Timestamp comparison only;
  // no new scheduler is introduced. Below the budget the attempt is truthfully
  // just running (elapsed derivable from execution.started).
  if (ACTIVE_RUN_STATUSES.has(input.run.status)) {
    for (const [attemptId, open] of openAttempts) {
      const startedMs = parseMs(open.startedAt);
      if (startedMs === null) {
        continue;
      }
      const budgetMs = (open.taskId ? metaByTask.get(open.taskId)?.timeoutMs : null) ?? TELEMETRY_DEFAULT_ATTEMPT_TIMEOUT_MS;
      const overdueThreshold = budgetMs + TELEMETRY_STALL_GRACE_MS;
      const elapsedMs = nowMs - startedMs;
      if (elapsedMs > overdueThreshold) {
        upsert({
          id: `signal:attempt-stalled:${attemptId}`,
          category: 'attempt-stalled', severity: 'warning', source: 'host',
          taskId: open.taskId, attemptId,
          message: `Attempt is overdue: open ${Math.floor(elapsedMs / 60_000)}m past its ${Math.floor(budgetMs / 60_000)}m budget without completing.`,
          evidenceRefs: [`elapsedMs=${elapsedMs}`, `budgetMs=${budgetMs}`], at: open.startedAt, ownerActionRequired: false,
        });
      }
    }
  }

  const packSignal = projectScopePackSignal(input.tasks, input.run.updatedAt);
  if (packSignal) {
    upsert({
      id: packSignal.signalId,
      category: packSignal.category,
      severity: packSignal.severity,
      source: packSignal.source,
      taskId: packSignal.taskId,
      attemptId: packSignal.attemptId,
      message: packSignal.message,
      evidenceRefs: packSignal.evidenceRefs,
      at: packSignal.lastSeen,
      ownerActionRequired: packSignal.ownerActionRequired,
    });
  }

  return [...byId.values()]
    .sort((left, right) => (parseMs(left.lastSeen) ?? 0) - (parseMs(right.lastSeen) ?? 0))
    .slice(-MAX_SNAPSHOT_SIGNALS);
}

function projectScopePackSignal(tasks: readonly TaskRecord[], at: string): SnapshotSignal | null {
  for (const task of tasks) {
    const spec = task.spec;
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
      continue;
    }
    const scopePack = (spec as Record<string, unknown>).scopePack;
    if (!scopePack || typeof scopePack !== 'object' || Array.isArray(scopePack)) {
      continue;
    }
    const record = scopePack as Record<string, unknown>;
    const state = typeof record.reconciliationState === 'string' ? record.reconciliationState : '';
    const packId = typeof record.packId === 'string' ? record.packId : '';
    if (!packId || (state !== 'stale' && state !== 'conflict')) {
      continue;
    }
    const conflict = state === 'conflict';
    return {
      signalId: `signal:scope-pack-stale:${packId}`,
      category: 'scope-pack-stale',
      severity: conflict ? 'critical' : 'warning',
      source: 'host',
      taskId: null,
      attemptId: null,
      message: conflict
        ? 'Scope Pack conflicts with current repository truth.'
        : 'Scope Pack foundation is stale relative to the current repository.',
      evidenceCount: 1,
      evidenceRefs: [`pack:${packId}`, `state:${state}`],
      firstSeen: at,
      lastSeen: at,
      resolvedAt: null,
      ownerActionRequired: conflict,
    };
  }
  return null;
}

interface ChangeSignal {
  category: SignalCategory;
  severity: SnapshotSignal['severity'];
  message: string;
  path: string;
  ownerActionRequired: boolean;
}

/** Most-specific single signal for one policy change (never double-counts). */
function classifyChangeSignal(change: PolicyChange, meta: TaskMeta | undefined): ChangeSignal | null {
  const path = typeof change.path === 'string' ? change.path : '';
  if (!path) {
    return null;
  }
  if (change.reasonCode === 'protected-path') {
    return { category: 'protected-path', severity: 'critical', message: `Protected path touched: ${path}`, path, ownerActionRequired: true };
  }
  if (change.reasonCode === 'out-of-scope-write') {
    return { category: 'out-of-scope-write', severity: 'warning', message: `Write outside authorized paths: ${path}`, path, ownerActionRequired: change.requiresHuman === true };
  }
  if (change.reasonCode === 'dependency-mutation') {
    return { category: 'dependency-mutation', severity: 'warning', message: `Dependency manifest changed: ${path}`, path, ownerActionRequired: true };
  }
  if (change.reasonCode === 'db-mutation') {
    return { category: 'db-mutation', severity: 'critical', message: `Database/migration change: ${path}`, path, ownerActionRequired: true };
  }
  if (change.reasonCode === 'migration-outside-plan') {
    return { category: 'migration-outside-plan', severity: 'critical', message: `Migration outside planned areas: ${path}`, path, ownerActionRequired: true };
  }
  if (change.reasonCode === 'unplanned-area') {
    return { category: 'unplanned-area', severity: 'warning', message: `Write outside planned areas: ${path}`, path, ownerActionRequired: true };
  }
  if (change.reasonCode === 'unknown-command') {
    return { category: 'unknown-command', severity: 'warning', message: `Unknown command gated on ${path}`, path, ownerActionRequired: true };
  }
  if (change.reasonCode === 'launch-contract') {
    return { category: 'policy-gate', severity: 'warning', message: 'Launch contract rejected the task before provider start.', path, ownerActionRequired: false };
  }
  if (change.reasonCode === 'unexpected-head-move') {
    return { category: 'unexpected-head-move', severity: 'critical', message: 'Repository HEAD moved during the attempt (unexpected).', path, ownerActionRequired: true };
  }
  if (change.category === 'UNTRACKED_FILE' && change.decision !== 'allow') {
    return { category: 'new-untracked-files', severity: 'notice', message: `Unexpected new file: ${path}`, path, ownerActionRequired: false };
  }
  if (change.decision !== 'allow') {
    return { category: 'policy-gate', severity: 'warning', message: `Policy gate on ${path}`, path, ownerActionRequired: change.requiresHuman === true };
  }
  // Legacy events that allowed a write outside plannedAreas still project as
  // informational drift. Runtime enforcement now emits reasonCode=unplanned-area.
  if (change.decision === 'allow' && meta && meta.plannedAreas.length > 0 && !underAnyArea(path, meta.plannedAreas)) {
    return { category: 'unplanned-area', severity: 'info', message: `Change outside planned areas: ${path}`, path, ownerActionRequired: false };
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                              */
/* -------------------------------------------------------------------------- */

interface PolicyChange {
  category?: string;
  path?: string;
  decision?: string;
  requiresHuman?: boolean;
  reasonCode?: string;
}

function sortedEvents(events: readonly OrchestrationEventRecord[]): OrchestrationEventRecord[] {
  return [...events].sort((left, right) => left.seq - right.seq);
}

function buildTaskMeta(tasks: readonly TaskRecord[]): Map<string, TaskMeta> {
  const map = new Map<string, TaskMeta>();
  for (const task of tasks) {
    map.set(task.taskId, extractTaskMeta(task));
  }
  return map;
}

/** Safe extraction of role/title/plannedAreas/authorizedWritePaths from a task spec. */
function extractTaskMeta(task: TaskRecord): TaskMeta {
  let role: TelemetryRole = 'implementer';
  let plannedAreas: string[] = [];
  let authorizedWritePaths: string[] = [];
  let timeoutMs: number | null = null;

  const spec = task.spec;
  if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
    const record = spec as Record<string, unknown>;
    const plan = record.plan;
    if (plan && typeof plan === 'object' && !Array.isArray(plan)) {
      const planRecord = plan as Record<string, unknown>;
      if (planRecord.role === 'implementer' || planRecord.role === 'verifier' || planRecord.role === 'architect') {
        role = planRecord.role;
      }
      if (Array.isArray(planRecord.plannedAreas)) {
        plannedAreas = planRecord.plannedAreas.filter((entry): entry is string => typeof entry === 'string');
      }
    }
    const policy = record.policy;
    if (policy && typeof policy === 'object' && !Array.isArray(policy)) {
      const authorized = (policy as Record<string, unknown>).authorizedWritePaths;
      if (Array.isArray(authorized)) {
        authorizedWritePaths = authorized.filter((entry): entry is string => typeof entry === 'string');
      }
    }
    const control = record.control;
    if (control && typeof control === 'object' && !Array.isArray(control)) {
      const candidate = (control as Record<string, unknown>).timeoutMs;
      if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
        timeoutMs = candidate;
      }
    }
  }

  return { role, title: task.title, plannedAreas, authorizedWritePaths, timeoutMs };
}

function eventPayload(event: OrchestrationEventRecord): Record<string, unknown> | null {
  const payload = event.payload;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  return null;
}

function strField(event: OrchestrationEventRecord, key: string): string | null {
  const value = eventPayload(event)?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numField(event: OrchestrationEventRecord, key: string): number | null {
  const value = eventPayload(event)?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function boolField(event: OrchestrationEventRecord, key: string): boolean | null {
  const value = eventPayload(event)?.[key];
  return typeof value === 'boolean' ? value : null;
}

function changeList(event: OrchestrationEventRecord): PolicyChange[] {
  const changes = eventPayload(event)?.changes;
  if (!Array.isArray(changes)) {
    return [];
  }
  const out: PolicyChange[] = [];
  for (const entry of changes) {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const record = entry as Record<string, unknown>;
      out.push({
        category: typeof record.category === 'string' ? record.category : undefined,
        path: typeof record.path === 'string' ? record.path : undefined,
        decision: typeof record.decision === 'string' ? record.decision : undefined,
        requiresHuman: record.requiresHuman === true,
        reasonCode: typeof record.reasonCode === 'string' ? record.reasonCode : undefined,
      });
    }
  }
  return out;
}

function underAnyArea(path: string, areas: readonly string[]): boolean {
  return areas.some((area) => path === area || path.startsWith(`${area}/`));
}

function refPart(attemptId: string | null, taskId: string | null): string {
  return attemptId ?? taskId ?? 'run';
}

function refs(value: string | null | undefined): string[] {
  return value ? [trunc(value, TELEMETRY_EVIDENCE_REF_MAX_CHARS)] : [];
}

function pathRefs(changes: readonly PolicyChange[]): string[] {
  const out: string[] = [];
  for (const change of changes) {
    if (typeof change.path === 'string' && change.path.length > 0) {
      out.push(trunc(change.path, TELEMETRY_EVIDENCE_REF_MAX_CHARS));
    }
    if (out.length >= TELEMETRY_EVIDENCE_REF_MAX) {
      break;
    }
  }
  return out;
}

function boundedRefs(input: readonly string[]): string[] {
  return input.slice(0, TELEMETRY_EVIDENCE_REF_MAX).map((entry) => trunc(entry, TELEMETRY_EVIDENCE_REF_MAX_CHARS));
}

function mergeRefs(target: string[], incoming: readonly string[]): void {
  for (const entry of incoming) {
    if (target.length >= TELEMETRY_EVIDENCE_REF_MAX) {
      break;
    }
    const safe = trunc(entry, TELEMETRY_EVIDENCE_REF_MAX_CHARS);
    if (!target.includes(safe)) {
      target.push(safe);
    }
  }
}

function parseMs(value: string | null | undefined): number | null {
  if (typeof value !== 'string') {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function clampLatency(fromMs: number | null, toMs: number | null): number | null {
  if (fromMs === null || toMs === null) {
    return null;
  }
  const delta = toMs - fromMs;
  return delta >= 0 ? delta : null;
}

function roleLabel(role: TelemetryRole): string {
  switch (role) {
    case 'architect': return 'Architect';
    case 'implementer': return 'Implementer';
    case 'verifier': return 'Verifier';
    case 'guard': return 'Guard';
    case 'host': default: return 'Host';
  }
}

function trunc(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : value.slice(0, maxChars);
}

interface VerdictArgs {
  id: string; role: TelemetryRole; taskId: string | null; attemptId: string | null;
  state: VerdictState; severity: SnapshotInterimVerdict['severity'];
  recommendedAction: SnapshotInterimVerdict['recommendedAction']; mayContinue: boolean;
  summary: string; evidenceRefs: string[]; evidenceCount: number; timestamp: string;
}

function verdict(args: VerdictArgs): SnapshotInterimVerdict {
  return {
    verdictId: args.id, role: args.role, taskId: args.taskId, attemptId: args.attemptId,
    state: args.state, summary: trunc(args.summary, TELEMETRY_SUMMARY_MAX_CHARS),
    evidenceRefs: boundedRefs(args.evidenceRefs), evidenceCount: args.evidenceCount,
    severity: args.severity, recommendedAction: args.recommendedAction, mayContinue: args.mayContinue,
    timestamp: args.timestamp,
  };
}

interface HandoffArgs {
  id: string; from: HandoffParty; to: HandoffParty; taskId: string | null;
  payloadType: SnapshotHandoff['payloadType']; summary: string; evidenceCount: number;
  status: SnapshotHandoff['status']; timestamp: string; latencyMs: number | null; resultingVerdict: VerdictState | null;
}

function handoff(args: HandoffArgs): SnapshotHandoff {
  return {
    handoffId: args.id, from: args.from, to: args.to, taskId: args.taskId,
    payloadType: args.payloadType, summary: trunc(args.summary, TELEMETRY_SUMMARY_MAX_CHARS),
    evidenceCount: args.evidenceCount, status: args.status, timestamp: args.timestamp,
    latencyMs: args.latencyMs, resultingVerdict: args.resultingVerdict,
  };
}
