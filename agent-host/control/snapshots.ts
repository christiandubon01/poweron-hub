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

import {
  SNAPSHOT_SCHEMA_VERSION,
  type RunSnapshot,
  type PlanRole,
  type SnapshotAttempt,
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

  return { clientTaskKey, role, plannedAreas, permissionProfile, provider, reasoningEffort };
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
  const clientTaskKeyByTaskId = new Map(tasks.map((task) => [task.taskId, extractTaskPlanMeta(task).clientTaskKey] as const));

  const snapshotTasks = tasks.map((task) => {
    const meta = extractTaskPlanMeta(task);
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

  const attempts: SnapshotAttempt[] = [];
  for (const task of tasks) {
    for (const attempt of store.listAttempts(task.taskId)) {
      attempts.push({
        attemptId: attempt.attemptId,
        taskId: task.taskId,
        ordinal: attempt.ordinal,
        status: attempt.status,
        requestedModel: attemptModel(events, attempt.attemptId).requestedModel,
        reportedModel: attemptModel(events, attempt.attemptId).reportedModel,
        reportedModelSource: attemptModel(events, attempt.attemptId).reportedModelSource,
      });
    }
  }

  const gate = buildSnapshotGate(events);
  const changeset = buildSnapshotChangeset(events);

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
    tasks: snapshotTasks,
    attempts,
    gate,
    changeset,
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

  return {
    ready: true,
    changeCount,
    safePaths: [...safePaths].sort(),
  };
}

interface AttemptModelInfo {
  requestedModel: string | null;
  reportedModel: string | null;
  reportedModelSource: string | null;
}

function attemptModel(events: OrchestrationEventRecord[], attemptId: string): AttemptModelInfo {
  const terminal = events.find(
    (event) => event.attemptId === attemptId && (event.type === 'execution.completed' || event.type === 'execution.failed' || event.type === 'execution.timed_out' || event.type === 'execution.cancelled'),
  );
  const payload = (terminal?.payload ?? null) as Record<string, unknown> | null;
  return {
    requestedModel: typeof payload?.requestedModel === 'string' ? payload.requestedModel : null,
    reportedModel: typeof payload?.reportedModel === 'string' ? payload.reportedModel : null,
    reportedModelSource: typeof payload?.reportedModelSource === 'string' ? payload.reportedModelSource : null,
  };
}