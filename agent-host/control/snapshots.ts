/**
 * CT-CORE-1: Safe run snapshot builder.
 *
 * Produces the ONLY run data the browser may render, from the local Host's
 * orchestration store. Whitelist only (§29):
 *   run id/objective/status/timestamps, task ids/titles/roles/statuses/positions/
 *   deps/plannedAreas/profile labels, attempt ids/ordinal/status/requested +
 *   reported model, gate safe reason, changeset ready flag + safe path metadata,
 *   verifier verdict + safe summary.
 *
 * NEVER published: prompts, source content, diffs, env, tokens, credentials,
 * raw stdout/stderr, provider transcripts, filesystem paths outside normalized
 * repo-relative safe paths.
 */

import { projectCandidateApply } from './applyCandidate.ts';
import {
  SNAPSHOT_SCHEMA_VERSION,
  type RunSnapshot,
  type RunSnapshotArchitect,
  type PlanRole,
  type SnapshotAttempt,
  type SnapshotCandidateChange,
} from './types.ts';
import { EFFORT_LEVELS, type EffortLevel } from '../providers/effort.ts';
import { projectRunTelemetry } from './telemetry.ts';
import type { OrchestrationStore } from '../lib/store.ts';
import type { OrchestrationEventRecord, TaskRecord } from '../lib/orchestrationTypes.ts';

interface TaskPlanMeta {
  clientTaskKey: string;
  role: PlanRole;
  plannedAreas: string[];
  permissionProfile: string;
  provider: string | null;
  reasoningEffort: EffortLevel | null;
  /**
   * The validated Architect identity copied from spec.plan.architect (the plan
   * result). Null when the spec carries none or it fails validation. The plan
   * prompt and any transcript content are never copied out — only these safe
   * identity fields.
   */
  architect: RunSnapshotArchitect | null;
}

/**
 * Validate the Architect identity a task spec carries on its plan. provider
 * must be a non-empty string (≤200 chars); requestedModel and reportedModel are
 * a string or null (each ≤200 chars, otherwise null); reasoningEffort must be
 * one of EFFORT_LEVELS or null. requestedModel is NEVER copied into the
 * reported slot — an Architect that did not report a model stays "Not reported".
 */
function readPlanArchitect(value: unknown): RunSnapshotArchitect | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const wire = value as Record<string, unknown>;
  const cleanString = (input: unknown): string | null => {
    if (typeof input !== 'string' || input.length === 0 || input.length > 200) return null;
    return input;
  };
  const provider = cleanString(wire.provider);
  if (!provider) return null;
  const reasoningEffort = (EFFORT_LEVELS as readonly string[]).includes(wire.reasoningEffort as string)
    ? (wire.reasoningEffort as EffortLevel)
    : null;
  return {
    provider,
    requestedModel: cleanString(wire.requestedModel),
    reportedModel: cleanString(wire.reportedModel),
    reasoningEffort,
  };
}

/**
 * Extract the safe plan metadata (clientTaskKey/role/plannedAreas/profile, and
 * the ATB-3 provider/effort display truth) from a task's durable spec. The spec
 * also contains the prompt — which must never leave the Host — so only the
 * whitelisted fields are copied out.
 */
export function extractTaskPlanMeta(task: TaskRecord): TaskPlanMeta {
  let clientTaskKey = task.taskId;
  let role: PlanRole = 'implementer';
  let plannedAreas: string[] = [];
  let permissionProfile = 'task-implementer';
  let provider: string | null = null;
  let reasoningEffort: EffortLevel | null = null;
  let architect: RunSnapshotArchitect | null = null;

  const spec = task.spec;
  if (typeof spec === 'object' && spec !== null && !Array.isArray(spec)) {
    const plan = (spec as Record<string, unknown>).plan as Record<string, unknown> | undefined;
    if (plan && typeof plan === 'object') {
      if (typeof plan.clientTaskKey === 'string' && plan.clientTaskKey.length > 0) {
        clientTaskKey = plan.clientTaskKey;
      }
      if (plan.role === 'implementer' || plan.role === 'verifier' || plan.role === 'architect') {
        role = plan.role;
      }
      if (Array.isArray(plan.plannedAreas) && plan.plannedAreas.every((area) => typeof area === 'string')) {
        plannedAreas = plan.plannedAreas as string[];
      }
      architect = readPlanArchitect(plan.architect);
    }
    const control = (spec as Record<string, unknown>).control as Record<string, unknown> | undefined;
    if (control && typeof control === 'object') {
      if (typeof control.permissionProfile === 'string') {
        permissionProfile = control.permissionProfile;
      }
      if (typeof control.provider === 'string' && control.provider.length > 0) {
        provider = control.provider;
      }
      if ((EFFORT_LEVELS as readonly string[]).includes(control.reasoningEffort as string)) {
        reasoningEffort = control.reasoningEffort as EffortLevel;
      }
    }
  }

  return { clientTaskKey, role, plannedAreas, permissionProfile, provider, reasoningEffort, architect };
}

export function buildRunSnapshot(options: {
  store: OrchestrationStore;
  runId: string;
  verification: { verdict: 'pass' | 'fail' | 'unknown'; summary: string | null } | null;
  /** Injected clock for deterministic stall detection. Defaults to Date.now(). */
  nowMs?: number | undefined;
}): RunSnapshot | null {
  const { store, runId } = options;
  const run = store.getRun(runId);
  if (!run) {
    return null;
  }

  const tasks = store.listTasks(runId);
  const events = store.listEvents().filter((event) => event.runId === runId);
  const taskPlanMeta = new Map(tasks.map((task) => [task.taskId, extractTaskPlanMeta(task)] as const));
  const clientTaskKeyByTaskId = new Map(tasks.map((task) => [task.taskId, taskPlanMeta.get(task.taskId)!.clientTaskKey] as const));

  const snapshotTasks = tasks.map((task) => {
    const meta = taskPlanMeta.get(task.taskId)!;
    return {
      taskId: task.taskId,
      clientTaskKey: meta.clientTaskKey,
      title: task.title,
      role: meta.role,
      status: task.status,
      position: task.position,
      dependencies: store
        .listDependencies(runId)
        .filter((dep) => dep.taskId === task.taskId)
        .map((dep) => clientTaskKeyByTaskId.get(dep.dependsOnTaskId) ?? dep.dependsOnTaskId),
      plannedAreas: meta.plannedAreas,
      permissionProfile: meta.permissionProfile,
      provider: meta.provider,
      reasoningEffort: meta.reasoningEffort,
    };
  });

  // The run-level Architect identity is the plan result's architect, carried on
  // the FIRST task whose spec published one. A run whose specs carry none (a
  // legacy run, or one whose plan produced no valid architect) publishes null.
  const architect: RunSnapshotArchitect | null = tasks
    .map((task) => taskPlanMeta.get(task.taskId)?.architect ?? null)
    .find((value) => value != null) ?? null;

  const attempts: SnapshotAttempt[] = [];
  for (const task of tasks) {
    for (const attempt of store.listAttempts(task.taskId)) {
      const model = attemptModel(events, attempt.attemptId);
      const terminal = attemptTerminal(events, attempt.attemptId, attempt.startedAt);
      attempts.push({
        attemptId: attempt.attemptId,
        taskId: task.taskId,
        ordinal: attempt.ordinal,
        status: attempt.status,
        requestedModel: model.requestedModel,
        reportedModel: model.reportedModel,
        reportedModelSource: model.reportedModelSource,
        startedAt: terminal.startedAt,
        terminalErrorCode: terminal.terminalErrorCode,
        terminalErrorMessage: terminal.terminalErrorMessage,
        elapsedMs: terminal.elapsedMs,
        lastActivityAt: terminal.lastActivityAt,
        limitFired: terminal.limitFired,
        limitMs: terminal.limitMs,
        changedFileCount: terminal.changedFileCount,
        hostChecks: events.filter((event) => event.attemptId === attempt.attemptId && event.type === 'verification.host_check.completed').slice(0, 8).map((event) => {
          const payload = event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload) ? event.payload as Record<string, unknown> : {};
          return {
            command: typeof payload.command === 'string' ? payload.command.slice(0, 240) : 'unknown validation command',
            baselineExitCode: typeof payload.baselineExitCode === 'number' ? payload.baselineExitCode : null,
            candidateExitCode: typeof payload.candidateExitCode === 'number' ? payload.candidateExitCode : null,
            baselineTimedOut: payload.baselineTimedOut === true,
            candidateTimedOut: payload.candidateTimedOut === true,
            newFailureCount: typeof payload.newFailureCount === 'number' ? payload.newFailureCount : null,
            boundedOutput: null,
          };
        }),
        canonicalModified: events.some((event) => event.attemptId === attempt.attemptId && event.type === 'verification.host_check.canonical_modified'),
        hostCheckUnavailableReason: (() => {
          const event = events.findLast((entry) => entry.attemptId === attempt.attemptId && entry.type === 'verification.host_check.unavailable');
          const payload = event?.payload && typeof event.payload === 'object' && !Array.isArray(event.payload) ? event.payload as Record<string, unknown> : null;
          return typeof payload?.reason === 'string' ? payload.reason.slice(0, 240) : null;
        })(),
      });
    }
  }

  const gate = buildSnapshotGate(events);
  const changeset = buildSnapshotChangeset(events);
  const candidatePreview = projectCandidateApply({ runStatus: run.status, events });
  const attemptStatus = attempts.find((attempt) => attempt.attemptId === candidatePreview.attemptId)?.status ?? null;
  const candidateApply = projectCandidateApply({ runStatus: run.status, events, attemptStatus });

  // ATB-1 telemetry: a PURE, bounded projection of the existing event log.
  // Fully defensive — a projection failure must never blank or break the core
  // safe snapshot, and telemetry never persists anything or stalls orchestration.
  let interimVerdicts: RunSnapshot['interimVerdicts'] = [];
  let handoffs: RunSnapshot['handoffs'] = [];
  let signals: RunSnapshot['signals'] = [];
  try {
    const telemetry = projectRunTelemetry({ run, tasks, events, nowMs: options.nowMs });
    interimVerdicts = telemetry.interimVerdicts;
    handoffs = telemetry.handoffs;
    signals = telemetry.signals;
  } catch {
    // Observability is best-effort; the core snapshot below is authoritative.
  }

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    run: {
      runId: run.runId,
      title: run.title,
      objective: run.goal,
      status: run.status,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
    },
    architect,
    tasks: snapshotTasks,
    attempts,
    gate,
    changeset,
    candidateApply,
    verification: options.verification,
    interimVerdicts,
    handoffs,
    signals,
  };
}

function buildSnapshotGate(events: OrchestrationEventRecord[]): RunSnapshot['gate'] {
  const blocked = events.find((event) => event.type === 'supervisor.blocked');
  if (!blocked) {
    return null;
  }
  const payload = blocked.payload as Record<string, unknown> | null;
  return {
    gateKind: typeof payload?.gateKind === 'string' ? payload.gateKind : 'unknown',
    reason: typeof payload?.reason === 'string' ? payload.reason : 'unknown',
  };
}

/**
 * Safe changeset metadata: ready flag + repo-relative changed paths, read from
 * the durable workspace.changeset.ready and policy.evaluated events. File
 * CONTENT is never published — only normalized path strings.
 */
function buildSnapshotChangeset(events: OrchestrationEventRecord[]): RunSnapshot['changeset'] {
  const ready = events.find((event) => event.type === 'workspace.changeset.ready');
  if (!ready) {
    return null;
  }
  const payload = ready.payload as Record<string, unknown> | null;
  const changeCount = typeof payload?.changeCount === 'number' ? payload.changeCount : 0;

  const safePaths = new Set<string>();
  for (const event of events) {
    if (event.type !== 'policy.evaluated') {
      continue;
    }
    const policyPayload = event.payload as Record<string, unknown> | null;
    const changes = Array.isArray(policyPayload?.changes) ? (policyPayload?.changes as Record<string, unknown>[]) : [];
    for (const change of changes) {
      if (change.decision === 'allow' && typeof change.path === 'string') {
        safePaths.add(change.path);
      }
    }
  }

  const changes = readSnapshotChanges(payload?.changes, events);

  return {
    ready: true,
    changeCount,
    safePaths: [...safePaths].sort(),
    changes,
    attemptId: ready.attemptId,
  };
}

function readSnapshotChanges(value: unknown, events: OrchestrationEventRecord[]): SnapshotCandidateChange[] {
  if (Array.isArray(value)) {
    const parsed: SnapshotCandidateChange[] = [];
    for (const entry of value) {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
      const record = entry as Record<string, unknown>;
      if (typeof record.path !== 'string') continue;
      if (record.kind !== 'add' && record.kind !== 'modify' && record.kind !== 'delete') continue;
      parsed.push({ path: record.path, kind: record.kind });
    }
    if (parsed.length > 0) return parsed;
  }
  const fromPolicy: SnapshotCandidateChange[] = [];
  for (const event of events) {
    if (event.type !== 'policy.evaluated') continue;
    const policyPayload = event.payload as Record<string, unknown> | null;
    const policyChanges = Array.isArray(policyPayload?.changes) ? (policyPayload.changes as Record<string, unknown>[]) : [];
    for (const change of policyChanges) {
      if (change.decision !== 'allow' || typeof change.path !== 'string') continue;
      const status = typeof change.worktreeStatus === 'string' ? change.worktreeStatus : '';
      const category = typeof change.category === 'string' ? change.category : '';
      const kind = status === 'D' || category === 'DELETED_FILE'
        ? 'delete'
        : status === '?' || category === 'NEW' || category === 'UNTRACKED_FILE'
          ? 'add'
          : 'modify';
      fromPolicy.push({ path: change.path, kind });
    }
  }
  return fromPolicy;
}

interface AttemptModelInfo {
  requestedModel: string | null;
  reportedModel: string | null;
  reportedModelSource: string | null;
}

const TERMINAL_EXECUTION_TYPES = new Set([
  'execution.completed',
  'execution.failed',
  'execution.timed_out',
  'execution.cancelled',
]);

function latestAttemptEvent(
  events: OrchestrationEventRecord[],
  attemptId: string,
  types: ReadonlySet<string>,
): OrchestrationEventRecord | null {
  let best: OrchestrationEventRecord | null = null;
  for (const event of events) {
    if (event.attemptId !== attemptId || !types.has(event.type)) continue;
    if (!best || event.seq > best.seq) best = event;
  }
  return best;
}

function attemptModel(events: OrchestrationEventRecord[], attemptId: string): AttemptModelInfo {
  const terminal = latestAttemptEvent(events, attemptId, TERMINAL_EXECUTION_TYPES);
  const payload = (terminal?.payload ?? null) as Record<string, unknown> | null;
  return {
    requestedModel: typeof payload?.requestedModel === 'string' ? payload.requestedModel : null,
    reportedModel: typeof payload?.reportedModel === 'string' ? payload.reportedModel : null,
    reportedModelSource: typeof payload?.reportedModelSource === 'string' ? payload.reportedModelSource : null,
  };
}

function attemptTerminal(
  events: OrchestrationEventRecord[],
  attemptId: string,
  attemptStartedAt: string | null,
): { startedAt: string | null; terminalErrorCode: string | null; terminalErrorMessage: string | null; elapsedMs: number | null; lastActivityAt: string | null; limitFired: 'startup' | 'inactivity' | 'ceiling' | 'none'; limitMs: number | null; changedFileCount: number | null } {
  const started = latestAttemptEvent(events, attemptId, new Set(['execution.started']));
  const terminal = latestAttemptEvent(events, attemptId, TERMINAL_EXECUTION_TYPES);
  const payload = (terminal?.payload ?? null) as Record<string, unknown> | null;
  const evidence = latestAttemptEvent(events, attemptId, new Set(['execution.failure_evidence', 'execution.persistence.failed']));
  const detail = (evidence?.payload ?? null) as Record<string, unknown> | null;
  const errorCode = typeof detail?.errorCode === 'string' ? detail.errorCode.slice(0, 128) : typeof payload?.errorCode === 'string' ? payload.errorCode.slice(0, 128) : null;
  const errorMessage = typeof payload?.errorMessage === 'string' ? payload.errorMessage.slice(0, 512) : null;
  const limitFired = detail?.limitFired;
  return {
    startedAt: started?.createdAt ?? attemptStartedAt,
    terminalErrorCode: errorCode,
    terminalErrorMessage: errorMessage,
    elapsedMs: typeof detail?.elapsedMs === 'number' ? detail.elapsedMs : typeof payload?.durationMs === 'number' ? payload.durationMs : null,
    lastActivityAt: typeof detail?.lastActivityAt === 'string' ? detail.lastActivityAt : null,
    limitFired: limitFired === 'startup' || limitFired === 'inactivity' || limitFired === 'ceiling' ? limitFired : 'none',
    limitMs: typeof detail?.limitMs === 'number' ? detail.limitMs : null,
    changedFileCount: typeof detail?.changedFileCount === 'number' ? detail.changedFileCount : null,
  };
}
