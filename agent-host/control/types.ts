/**
 * CT-CORE-1: Control-plane types for the local Agent Host control worker.
 *
 * This module defines the SAFE, typed contracts between:
 *   - the browser (via Supabase control requests — payload fields only),
 *   - the Architect's structured plan output, and
 *   - the safe run snapshots published back to the browser.
 *
 * NOTHING here may carry filesystem paths from the browser, prompts, source
 * content, secrets, env data, or provider transcripts. repo_key is the only
 * repo identifier the browser ever sees (16-hex hash created host-side).
 */

import { createHash } from 'node:crypto';
import type { ProviderId, PermissionProfile } from '../providers/types.ts';
import type { EffortLevel } from '../providers/effort.ts';

/* -------------------------------------------------------------------------- */
/* Plan roles / task kinds                                                     */
/* -------------------------------------------------------------------------- */

export const PLAN_ROLES = ['implementer', 'verifier', 'architect'] as const;
export type PlanRole = (typeof PLAN_ROLES)[number];

export const ROLE_TO_PERMISSION_PROFILE: Readonly<Record<PlanRole, PermissionProfile>> = {
  implementer: 'task-implementer',
  verifier: 'verifier',
  architect: 'read-only-reviewer',
};

export const PLAN_PROVIDER_IDS = ['claude', 'codex', 'ollama'] as const satisfies readonly ProviderId[];

/* -------------------------------------------------------------------------- */
/* Structured plan (Architect output contract, §13-§17)                        */
/* -------------------------------------------------------------------------- */

export const CLIENT_TASK_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;

export interface PlanTask {
  clientTaskKey: string;
  title: string;
  /** What this task must accomplish. Host-side prompt input, never published raw. */
  goal: string;
  role: PlanRole;
  /** Other tasks' clientTaskKeys that must pass before this task becomes ready. */
  dependencies: string[];
  permissionProfile: PermissionProfile;
  /**
   * Repo-relative normalized POSIX paths this task is authorized to write.
   * Must be empty for verifier/architect (reviewer-immutability).
   */
  authorizedWritePaths: string[];
  /** Repo-relative areas the task is expected to touch. ATB-4: also a drift fence. */
  plannedAreas: string[];
  /** What the Verifier must check for implementer tasks; the check list for verifier tasks. */
  validationRequirements: string[];
  provider: ProviderId;
  /** null = no preference — provider default. Never copied into reportedModel. */
  requestedModel: string | null;
}

export interface ControlPlan {
  planId: string;
  /** The Architect's interpretation of the owner's scope. */
  objective: string;
  constraints: string[];
  tasks: PlanTask[];
  riskSummary: string | null;
  /** ATB-5: omitted or 'implementation' preserves the existing implementer+verifier contract. */
  executionIntent?: PhaseExecutionIntent;
  scopePack?: {
    packId: string;
    version: number;
    phaseId: string;
    reconciliationState?: string;
  };
}

export const PLAN_FIELD_LIMITS = {
  objectiveMaxChars: 4_000,
  titleMaxChars: 200,
  goalMaxChars: 4_000,
  riskSummaryMaxChars: 2_000,
  constraintMaxChars: 1_000,
  validationRequirementMaxChars: 1_000,
  maxTasks: 24,
  maxConstraints: 16,
  maxValidationRequirements: 16,
  maxAuthorizedWritePaths: 64,
  maxPlannedAreas: 16,
  maxDependencies: 16,
  requestedModelMaxChars: 200,
  pathMaxChars: 256,
} as const;

/* -------------------------------------------------------------------------- */
/* Plan validation                                                             */
/* -------------------------------------------------------------------------- */

export type PlanValidationCode =
  | 'PLAN_NOT_OBJECT'
  | 'OBJECTIVE_MISSING'
  | 'OBJECTIVE_TOO_LONG'
  | 'TASKS_EMPTY'
  | 'TASKS_NOT_ARRAY'
  | 'TOO_MANY_TASKS'
  | 'TASK_NOT_OBJECT'
  | 'CLIENT_TASK_KEY_INVALID'
  | 'CLIENT_TASK_KEY_DUPLICATE'
  | 'TITLE_MISSING'
  | 'TITLE_TOO_LONG'
  | 'GOAL_MISSING'
  | 'GOAL_TOO_LONG'
  | 'ROLE_UNKNOWN'
  | 'PROFILE_MISMATCH'
  | 'DEPENDENCIES_NOT_ARRAY'
  | 'DEPENDENCY_TOO_MANY'
  | 'DEPENDENCY_SELF'
  | 'DEPENDENCY_UNKNOWN'
  | 'DEPENDENCY_DUPLICATE'
  | 'DEPENDENCY_CYCLE'
  | 'WRITE_PATHS_NOT_ARRAY'
  | 'WRITE_PATH_TOO_MANY'
  | 'WRITE_PATH_INVALID'
  | 'WRITE_PATHS_FOR_REVIEWER'
  | 'PLANNED_AREAS_NOT_ARRAY'
  | 'PLANNED_AREA_TOO_MANY'
  | 'PLANNED_AREA_INVALID'
  | 'VALIDATION_REQUIREMENTS_INVALID'
  | 'PROVIDER_UNKNOWN'
  | 'REQUESTED_MODEL_INVALID'
  | 'IMPLEMENTER_MISSING'
  | 'VERIFIER_MISSING'
  | 'VERIFIER_DEPENDENCY_MISSING'
  | 'RISK_SUMMARY_TOO_LONG'
  | 'CONSTRAINT_INVALID'
  | 'AUDIT_WRITE_FORBIDDEN';

export interface PlanValidationResult {
  ok: boolean;
  errors: PlanValidationCode[];
  plan: ControlPlan | null;
}

/* -------------------------------------------------------------------------- */
/* Control requests (browser → Host via Supabase, §7-§8)                      */
/* -------------------------------------------------------------------------- */

export type ControlRequestType = 'create_plan' | 'approve_plan' | 'cancel_run' | 'import_scope_pack';
export type PhaseExecutionIntent = 'audit' | 'implementation' | 'verification' | 'research';

export interface CreatePlanPayload {
  scope: string;
  constraints: string[];
  /** Optional provider/model preference from the owner. Never a guarantee. */
  requestedRouting: { provider?: string; requestedModel?: string } | null;
  /** Optional Scope Pack binding. Absent = existing create_plan behavior. */
  scopePackId?: string;
  scopePackVersion?: number;
  scopePackPhaseId?: string;
  staleAcknowledged?: boolean;
  ownerReviewedConflict?: boolean;
}

export interface ApprovePlanPayload {
  planId: string;
  planHash: string;
}

export const SCOPE_MAX_CHARS = 8_000;
export const CONSTRAINTS_MAX = 16;
export const CONSTRAINT_MAX_CHARS = 1_000;

export interface CreatePlanRequestResult {
  plan: ControlPlan;
  planHash: string;
  architect: {
    provider: ProviderId;
    requestedModel: string | null;
    reportedModel: string | null;
    reportedModelSource: string;
  };
}

/* -------------------------------------------------------------------------- */
/* Task execution spec (durable task.spec contract used by the production port) */
/* -------------------------------------------------------------------------- */

export interface TaskControlSpec {
  control: {
    provider: ProviderId;
    requestedModel: string | null;
    /** Normalized effort for this task. null = provider/adapter default. */
    reasoningEffort: EffortLevel | null;
    permissionProfile: PermissionProfile;
    prompt: string;
    timeoutMs: number;
  };
  policy: {
    authorizedWritePaths: string[];
    /** ATB-5: unambiguous repo-relative do-not-touch paths from a Scope Pack. */
    doNotTouchPaths?: string[];
  };
  scopePack?: {
    packId: string;
    version: number;
    phaseId: string;
    reconciliationState: string;
  };
}

/* -------------------------------------------------------------------------- */
/* Safe run snapshot (§29 whitelist — the ONLY run data published)              */
/* -------------------------------------------------------------------------- */

export const SNAPSHOT_SCHEMA_VERSION = 1;

export interface SnapshotAttempt {
  attemptId: string;
  taskId: string;
  ordinal: number;
  status: string;
  requestedModel: string | null;
  reportedModel: string | null;
  reportedModelSource: string | null;
}

export interface SnapshotTask {
  taskId: string;
  clientTaskKey: string;
  title: string;
  role: PlanRole;
  status: string;
  position: number;
  dependencies: string[];
  plannedAreas: string[];
  permissionProfile: string;
  /** ATB-3: execution provider id from spec.control (safe enum-like id, never a path/credential). null = legacy/unset spec. */
  provider: string | null;
  /** ATB-3: normalized reasoning effort from spec.control. null = provider default / legacy spec. */
  reasoningEffort: EffortLevel | null;
}

export interface SnapshotGate {
  gateKind: string;
  reason: string;
}

export interface SnapshotChangeset {
  ready: boolean;
  changeCount: number;
  safePaths: string[];
}

/* -------------------------------------------------------------------------- */
/* ATB-1: Agent Team runtime telemetry (interim verdicts / handoffs / signals) */
/*                                                                             */
/* These are a SAFE, bounded projection of the local durable event log; they   */
/* add NO new durable event types and persist nothing. runId is implied by the */
/* enclosing RunSnapshot, so it is not repeated on each item.                   */
/* -------------------------------------------------------------------------- */

export type VerdictState = 'CONTINUE' | 'WATCH' | 'BLOCKED' | 'NEEDS_OWNER' | 'PASS' | 'FAIL';
export type TelemetryRole = 'architect' | 'implementer' | 'verifier' | 'guard' | 'host';
export type HandoffParty = TelemetryRole | 'owner';
export type TelemetrySeverity = 'info' | 'notice' | 'warning' | 'critical';
export type RecommendedAction = 'none' | 'watch' | 'owner-review' | 'cancel' | 'approve-gate';

export type SignalCategory =
  | 'out-of-scope-write'
  | 'protected-path'
  | 'dependency-mutation'
  | 'db-mutation'
  | 'migration-outside-plan'
  | 'unexpected-head-move'
  | 'changeset-oversized'
  | 'unplanned-area'
  | 'new-untracked-files'
  | 'model-routing-mismatch'
  | 'provider-fallback'
  | 'attempt-stalled'
  | 'excessive-retry'
  | 'policy-gate'
  | 'human-gate'
  | 'verifier-implementer-disagreement'
  | 'scope-pack-stale'
  | 'unknown-command';

export type HandoffPayloadType =
  | 'plan'
  | 'changeset'
  | 'verification'
  | 'gate'
  | 'policy-finding'
  | 'run-result'
  | 'task-ready';

export type HandoffStatus = 'queued' | 'delivered' | 'accepted' | 'rejected' | 'blocked';

export interface SnapshotInterimVerdict {
  verdictId: string;
  role: TelemetryRole;
  taskId: string | null;
  attemptId: string | null;
  state: VerdictState;
  summary: string;
  evidenceRefs: string[];
  evidenceCount: number;
  severity: TelemetrySeverity;
  recommendedAction: RecommendedAction;
  mayContinue: boolean;
  timestamp: string;
}

export interface SnapshotHandoff {
  handoffId: string;
  from: HandoffParty;
  to: HandoffParty;
  taskId: string | null;
  payloadType: HandoffPayloadType;
  summary: string;
  evidenceCount: number;
  status: HandoffStatus;
  timestamp: string;
  latencyMs: number | null;
  resultingVerdict: VerdictState | null;
}

export interface SnapshotSignal {
  signalId: string;
  category: SignalCategory;
  severity: TelemetrySeverity;
  source: 'guard' | 'host' | 'supervisor';
  taskId: string | null;
  attemptId: string | null;
  message: string;
  evidenceCount: number;
  evidenceRefs: string[];
  firstSeen: string;
  lastSeen: string;
  resolvedAt: string | null;
  ownerActionRequired: boolean;
}

/** Bounded projection caps — keep the safe snapshot small and predictable. */
export const MAX_SNAPSHOT_INTERIM_VERDICTS = 20;
export const MAX_SNAPSHOT_HANDOFFS = 30;
export const MAX_SNAPSHOT_SIGNALS = 30;
export const TELEMETRY_SUMMARY_MAX_CHARS = 240;
export const TELEMETRY_MESSAGE_MAX_CHARS = 240;
export const TELEMETRY_EVIDENCE_REF_MAX = 8;
export const TELEMETRY_EVIDENCE_REF_MAX_CHARS = 256;

export interface RunSnapshot {
  schemaVersion: number;
  run: {
    runId: string;
    title: string;
    objective: string | null;
    status: string;
    createdAt: string;
    updatedAt: string;
    startedAt: string | null;
    completedAt: string | null;
  };
  tasks: SnapshotTask[];
  attempts: SnapshotAttempt[];
  gate: SnapshotGate | null;
  changeset: SnapshotChangeset | null;
  verification: { verdict: 'pass' | 'fail' | 'unknown'; summary: string | null } | null;
  /** ATB-1 telemetry projections (bounded, safe). Always present (possibly empty). */
  interimVerdicts: SnapshotInterimVerdict[];
  handoffs: SnapshotHandoff[];
  signals: SnapshotSignal[];
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Normalize a browser/plan-supplied path candidate to a safe repo-relative
 * POSIX path. Returns null when the path is absolute, escaping, empty,
 * back-slashed, or too long. This is the fail-closed normalization behind both
 * authorizedWritePaths and plannedAreas.
 */
export function normalizeSafeRepoRelativePath(raw: string): string | null {
  if (typeof raw !== 'string' || raw.length === 0) {
    return null;
  }
  if (raw.length > PLAN_FIELD_LIMITS.pathMaxChars) {
    return null;
  }
  if (raw.includes('\\') || raw.includes('\0')) {
    return null;
  }
  if (raw.startsWith('/') || raw.startsWith('~/') || raw === '~' || raw === '.') {
    return null;
  }
  if (/^[a-zA-Z]:/u.test(raw)) {
    return null;
  }
  const segments = raw.split('/');
  const seen = new Set<string>();
  for (const segment of segments) {
    if (segment.length === 0) {
      return null;
    }
    if (segment === '.' || segment === '..') {
      return null;
    }
    if (seen.has(segment)) {
      return null;
    }
    seen.add(segment);
    if (segment !== segment.trim()) {
      return null;
    }
    if (/[\r\n\t]/u.test(segment)) {
      return null;
    }
  }
  return segments.join('/');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readStringArray(value: unknown, maxEntries: number, maxChars: number): string[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  if (value.length > maxEntries) {
    return null;
  }
  const entries: string[] = [];
  for (const entry of value) {
    const text = readString(entry);
    if (!text || text.length > maxChars) {
      return null;
    }
    entries.push(text);
  }
  return entries;
}

function normalizeSafePathArray(value: unknown, maxEntries: number): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  if (value.length > maxEntries) {
    return null;
  }
  const entries: string[] = [];
  for (const entry of value) {
    const normalized = normalizeSafeRepoRelativePath(typeof entry === 'string' ? entry : '');
    if (!normalized) {
      return null;
    }
    entries.push(normalized);
  }
  return entries;
}

/**
 * Validate a parsed Architect plan object against the §17 rules:
 * unique clientTaskKeys, known dependency refs, acyclic DAG, known roles and
 * profiles, normalized non-traversal paths, ≥1 implementer, ≥1 verifier, and a
 * verifier that depends on at least one implementer task.
 */
export function validatePlan(input: unknown, options: { executionIntent?: PhaseExecutionIntent } = {}): PlanValidationResult {
  if (!isRecord(input)) {
    return { ok: false, errors: ['PLAN_NOT_OBJECT'], plan: null };
  }
  const planId = readString(input.planId);
  if (!planId) {
    return { ok: false, errors: ['PLAN_NOT_OBJECT'], plan: null };
  }

  const errors: PlanValidationCode[] = [];
  const objective = readString(input.objective);
  if (!objective) {
    errors.push('OBJECTIVE_MISSING');
  } else if (objective.length > PLAN_FIELD_LIMITS.objectiveMaxChars) {
    errors.push('OBJECTIVE_TOO_LONG');
  }

  let constraints: string[] = [];
  if (input.constraints !== undefined && input.constraints !== null) {
    if (Array.isArray(input.constraints) && input.constraints.length === 0) {
      constraints = [];
    } else {
      const parsed = readStringArray(input.constraints, PLAN_FIELD_LIMITS.maxConstraints, PLAN_FIELD_LIMITS.constraintMaxChars);
      if (!parsed) {
        errors.push('CONSTRAINT_INVALID');
      } else {
        constraints = parsed;
      }
    }
  }

  let riskSummary: string | null = null;
  if (input.riskSummary !== undefined && input.riskSummary !== null) {
    riskSummary = readString(input.riskSummary);
    if (riskSummary && riskSummary.length > PLAN_FIELD_LIMITS.riskSummaryMaxChars) {
      errors.push('RISK_SUMMARY_TOO_LONG');
    }
  }

  const auditLike = options.executionIntent === 'audit' || options.executionIntent === 'research';
  if (!Array.isArray(input.tasks) || input.tasks.length === 0) {
    if (auditLike) {
      if (errors.length > 0) {
        return { ok: false, errors, plan: null };
      }
      return {
        ok: true,
        errors: [],
        plan: {
          planId,
          objective: objective ?? '',
          constraints,
          riskSummary,
          tasks: [],
          executionIntent: options.executionIntent,
        },
      };
    }
    return { ok: false, errors: [...errors, 'TASKS_EMPTY'], plan: null };
  }
  if (input.tasks.length > PLAN_FIELD_LIMITS.maxTasks) {
    errors.push('TOO_MANY_TASKS');
  }

  const tasks: PlanTask[] = [];
  const keys = new Set<string>();
  const implementerKeys = new Set<string>();
  const verifierKeys = new Set<string>();
  const verifierDependsOnImplementer = new Set<string>();

  for (const rawTask of input.tasks) {
    if (!isRecord(rawTask)) {
      errors.push('TASK_NOT_OBJECT');
      continue;
    }

    const clientTaskKey = readString(rawTask.clientTaskKey);
    if (!clientTaskKey || !CLIENT_TASK_KEY_PATTERN.test(clientTaskKey)) {
      errors.push('CLIENT_TASK_KEY_INVALID');
      continue;
    }
    if (keys.has(clientTaskKey)) {
      errors.push('CLIENT_TASK_KEY_DUPLICATE');
      continue;
    }
    keys.add(clientTaskKey);

    const title = readString(rawTask.title);
    if (!title) {
      errors.push('TITLE_MISSING');
    } else if (title.length > PLAN_FIELD_LIMITS.titleMaxChars) {
      errors.push('TITLE_TOO_LONG');
    }

    const goal = readString(rawTask.goal);
    if (!goal) {
      errors.push('GOAL_MISSING');
    } else if (goal.length > PLAN_FIELD_LIMITS.goalMaxChars) {
      errors.push('GOAL_TOO_LONG');
    }

    const roleRaw = readString(rawTask.role);
    if (!roleRaw || !(PLAN_ROLES as readonly string[]).includes(roleRaw)) {
      errors.push('ROLE_UNKNOWN');
      continue;
    }
    const role = roleRaw as PlanRole;

    const profileRaw = readString(rawTask.permissionProfile);
    const expectedProfile = ROLE_TO_PERMISSION_PROFILE[role];
    if (profileRaw !== expectedProfile) {
      errors.push('PROFILE_MISMATCH');
    }

    let dependencies: string[] = [];
    if (rawTask.dependencies === undefined || rawTask.dependencies === null) {
      dependencies = [];
    } else if (Array.isArray(rawTask.dependencies) && rawTask.dependencies.length === 0) {
      dependencies = [];
    } else {
      if (!Array.isArray(rawTask.dependencies)) {
        errors.push('DEPENDENCIES_NOT_ARRAY');
      } else if (rawTask.dependencies.length > PLAN_FIELD_LIMITS.maxDependencies) {
        errors.push('DEPENDENCY_TOO_MANY');
      } else {
        const seen = new Set<string>();
        for (const dep of rawTask.dependencies) {
          const depKey = readString(dep);
          if (!depKey) {
            errors.push('DEPENDENCY_UNKNOWN');
            continue;
          }
          if (depKey === clientTaskKey) {
            errors.push('DEPENDENCY_SELF');
            continue;
          }
          if (seen.has(depKey)) {
            errors.push('DEPENDENCY_DUPLICATE');
            continue;
          }
          seen.add(depKey);
          dependencies.push(depKey);
        }
      }
    }

    let authorizedWritePaths: string[] = [];
    if (rawTask.authorizedWritePaths === undefined || rawTask.authorizedWritePaths === null) {
      authorizedWritePaths = [];
    } else {
      if (!Array.isArray(rawTask.authorizedWritePaths)) {
        errors.push('WRITE_PATHS_NOT_ARRAY');
      } else if (rawTask.authorizedWritePaths.length === 0) {
        authorizedWritePaths = [];
      } else {
        if (role !== 'implementer' || auditLike) {
          errors.push(auditLike ? 'AUDIT_WRITE_FORBIDDEN' : 'WRITE_PATHS_FOR_REVIEWER');
        }
        const normalized = normalizeSafePathArray(rawTask.authorizedWritePaths, PLAN_FIELD_LIMITS.maxAuthorizedWritePaths);
        if (!normalized) {
          errors.push('WRITE_PATH_INVALID');
        } else {
          authorizedWritePaths = normalized;
        }
      }
    }

    let plannedAreas: string[] = [];
    if (rawTask.plannedAreas === undefined || rawTask.plannedAreas === null) {
      plannedAreas = [];
    } else if (Array.isArray(rawTask.plannedAreas) && rawTask.plannedAreas.length === 0) {
      plannedAreas = [];
    } else {
      if (!Array.isArray(rawTask.plannedAreas)) {
        errors.push('PLANNED_AREAS_NOT_ARRAY');
      } else {
        const normalized = normalizeSafePathArray(rawTask.plannedAreas, PLAN_FIELD_LIMITS.maxPlannedAreas);
        if (!normalized) {
          errors.push('PLANNED_AREA_INVALID');
        } else {
          plannedAreas = normalized;
        }
      }
    }

    let validationRequirements: string[] = [];
    if (rawTask.validationRequirements === undefined || rawTask.validationRequirements === null) {
      validationRequirements = [];
    } else if (Array.isArray(rawTask.validationRequirements) && rawTask.validationRequirements.length === 0) {
      validationRequirements = [];
    } else {
      const parsed = readStringArray(
        rawTask.validationRequirements,
        PLAN_FIELD_LIMITS.maxValidationRequirements,
        PLAN_FIELD_LIMITS.validationRequirementMaxChars,
      );
      if (!parsed) {
        errors.push('VALIDATION_REQUIREMENTS_INVALID');
      } else {
        validationRequirements = parsed;
      }
    }

    const providerRaw = readString(rawTask.provider);
    if (!providerRaw || !(PLAN_PROVIDER_IDS as readonly string[]).includes(providerRaw)) {
      errors.push('PROVIDER_UNKNOWN');
      continue;
    }

    let requestedModel: string | null = null;
    if (rawTask.requestedModel !== undefined && rawTask.requestedModel !== null) {
      const model = readString(rawTask.requestedModel);
      if (!model || model.length > PLAN_FIELD_LIMITS.requestedModelMaxChars) {
        errors.push('REQUESTED_MODEL_INVALID');
      } else {
        requestedModel = model;
      }
    }

    if (role === 'implementer') {
      implementerKeys.add(clientTaskKey);
    }
    if (role === 'verifier') {
      verifierKeys.add(clientTaskKey);
    }

    tasks.push({
      clientTaskKey,
      title: title ?? '',
      goal: goal ?? '',
      role,
      dependencies,
      permissionProfile: expectedProfile,
      authorizedWritePaths,
      plannedAreas,
      validationRequirements,
      provider: providerRaw as ProviderId,
      requestedModel,
    });
  }

  // Dependency references must exist; collected above before all keys known.
  const knownKeys = new Set(tasks.map((task) => task.clientTaskKey));
  for (const task of tasks) {
    for (const dep of task.dependencies) {
      if (!knownKeys.has(dep)) {
        errors.push('DEPENDENCY_UNKNOWN');
      }
    }
    if (task.role === 'verifier' && task.dependencies.some((dep) => implementerKeys.has(dep))) {
      verifierDependsOnImplementer.add(task.clientTaskKey);
    }
  }

  if (hasCycle(tasks)) {
    errors.push('DEPENDENCY_CYCLE');
  }

  if (!auditLike && options.executionIntent !== 'verification') {
    if (!implementerKeys.size) {
      errors.push('IMPLEMENTER_MISSING');
    }
    if (!verifierKeys.size) {
      errors.push('VERIFIER_MISSING');
    } else if (!verifierDependsOnImplementer.size) {
      errors.push('VERIFIER_DEPENDENCY_MISSING');
    }
  } else if (options.executionIntent === 'verification') {
    if (!verifierKeys.size) {
      errors.push('VERIFIER_MISSING');
    }
  } else if (implementerKeys.size > 0) {
    errors.push('AUDIT_WRITE_FORBIDDEN');
  }

  if (errors.length > 0) {
    return { ok: false, errors, plan: null };
  }

  return {
    ok: true,
    errors: [],
    plan: {
      planId,
      objective: objective ?? '',
      constraints,
      riskSummary,
      tasks,
      executionIntent: options.executionIntent,
    },
  };
}

function hasCycle(tasks: PlanTask[]): boolean {
  const graph = new Map<string, string[]>();
  for (const task of tasks) {
    graph.set(task.clientTaskKey, task.dependencies);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (key: string): boolean => {
    if (visited.has(key)) {
      return false;
    }
    if (visiting.has(key)) {
      return true;
    }
    visiting.add(key);
    for (const dep of graph.get(key) ?? []) {
      if (visit(dep)) {
        return true;
      }
    }
    visiting.delete(key);
    visited.add(key);
    return false;
  };

  for (const key of graph.keys()) {
    if (visit(key)) {
      return true;
    }
  }
  return false;
}

/**
 * Canonical JSON for hashing: recursively key-sorted, no whitespace. Used to
 * compute planHash so approve_plan references the EXACT plan the Architect
 * produced — no silent plan swapping.
 */
export function canonicalJsonStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJsonStringify).join(',')}]`;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJsonStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function computePlanHash(plan: ControlPlan): string {
  const { planId: _planId, ...planBody } = plan;
  return createHash('sha256').update(canonicalJsonStringify(planBody), 'utf8').digest('hex');
}