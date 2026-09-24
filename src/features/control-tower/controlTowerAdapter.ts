/**
 * CT-CORE-1: PURE mapping from real Control Tower wire data to view models.
 *
 * No Supabase, no network, no fixture fallback — every function is pure and
 * fake-testable. Honesty rules (§29-§35):
 *   - Missing data maps to honest unavailable states, never fabricated values.
 *   - A requested model is NEVER copied into a reported slot.
 *   - The verifier verdict is fail-closed: 'unknown' renders as unavailable,
 *     never as a pass.
 *   - A run with a ready changeset renders "not applied" — completion never
 *     implies applied.
 */
import type {
  AttentionEntry,
  EffortLevel,
  HandoffParty,
  HandoffPayloadType,
  HandoffStatus,
  HandoffView,
  InterimVerdictView,
  ModelCapabilityView,
  ModelIdentity,
  PreviewTask,
  ProviderCapabilityView,
  RecommendedAction,
  RetryState,
  Role,
  RunState,
  SignalCategory,
  SignalView,
  TaskState,
  TelemetryRole,
  TelemetrySeverity,
  VerdictState,
  VerificationState,
} from '@/components/v15r/app-brain/control-tower/controlTowerTypes'
import type { AppBrainNode } from '@/components/v15r/appBrainMap'
import type { HostPresenceRow, RunSnapshotRow } from './controlTowerService'

/* ATB-1 defensive caps mirroring the Host projection (bounded even if a Host over-publishes). */
const MAX_INTERIM_VERDICTS = 20
const MAX_HANDOFFS = 30
const MAX_SIGNALS = 30
const VERDICT_STATES: VerdictState[] = ['CONTINUE', 'WATCH', 'BLOCKED', 'NEEDS_OWNER', 'PASS', 'FAIL']
const TELEMETRY_ROLES: TelemetryRole[] = ['architect', 'implementer', 'verifier', 'guard', 'host']
const HANDOFF_PARTIES: HandoffParty[] = ['architect', 'implementer', 'verifier', 'guard', 'host', 'owner']
const SEVERITIES: TelemetrySeverity[] = ['info', 'notice', 'warning', 'critical']
const RECOMMENDED_ACTIONS: RecommendedAction[] = ['none', 'watch', 'owner-review', 'cancel', 'approve-gate']
const HANDOFF_PAYLOAD_TYPES: HandoffPayloadType[] = ['plan', 'changeset', 'verification', 'gate', 'policy-finding', 'run-result', 'task-ready']
const HANDOFF_STATUSES: HandoffStatus[] = ['queued', 'delivered', 'accepted', 'rejected', 'blocked']
const SIGNAL_CATEGORIES: SignalCategory[] = [
  'out-of-scope-write', 'protected-path', 'dependency-mutation', 'db-mutation', 'migration-outside-plan',
  'unexpected-head-move', 'changeset-oversized', 'unplanned-area', 'new-untracked-files', 'model-routing-mismatch',
  'provider-fallback', 'attempt-stalled', 'excessive-retry', 'policy-gate', 'human-gate',
  'verifier-implementer-disagreement', 'scope-pack-stale', 'unknown-command',
]
const SIGNAL_SOURCES: SignalView['source'][] = ['guard', 'host', 'supervisor']

export const HOST_STALE_MS = 30_000

/* ── Host presence ─────────────────────────────────────────────────────── */

export interface HostPresenceView {
  state: 'connected' | 'stale' | 'unavailable'
  repoKey: string | null
  /** Provider display names (derived) — kept for existing UI consumers. */
  providers: string[]
  /** ATB-2 safe provider/model capability fleet (empty for pre-ATB-2 Hosts). */
  providerFleet: ProviderCapabilityView[]
  hostVersion: string | null
  lastSeenAt: string | null
  hostInstanceId: string | null
}

const UNAVAILABLE_HOST_PRESENCE: HostPresenceView = {
  state: 'unavailable', repoKey: null, providers: [], providerFleet: [], hostVersion: null, lastSeenAt: null, hostInstanceId: null,
}

export function computeHostPresence(rows: HostPresenceRow[], nowMs: number): HostPresenceView {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ...UNAVAILABLE_HOST_PRESENCE }
  }
  // Newest VALID presence wins: an old/stale row can NEVER override a newer Host,
  // and an unparseable last_seen_at is skipped instead of poisoning the selection
  // (a NaN timestamp must never be treated as "latest").
  let freshest: HostPresenceRow | null = null
  let freshestMs = Number.NEGATIVE_INFINITY
  for (const row of rows) {
    const ms = Date.parse(row.last_seen_at)
    if (Number.isFinite(ms) && ms > freshestMs) {
      freshest = row
      freshestMs = ms
    }
  }
  if (!freshest) {
    return { ...UNAVAILABLE_HOST_PRESENCE }
  }
  // Fresh = within the stale window of the reader's clock. A heartbeat AT or just
  // AHEAD of now (forward clock skew on the same machine, an NTP correction, or a
  // timezone-parse landing slightly in the future) is a LIVE Host: the old
  // `ageMs >= 0` guard wrongly flipped exactly that fresh, newest row to "stale".
  // The symmetric window keeps a genuinely fresh heartbeat connected while still
  // reporting stale (>= 30s old) and rejecting absurd far-future timestamps.
  const ageMs = nowMs - freshestMs
  const connected = ageMs < HOST_STALE_MS && ageMs > -HOST_STALE_MS
  const providerFleet = mapProviderFleet(freshest.providers)
  return {
    state: connected ? 'connected' : 'stale',
    repoKey: freshest.repo_key,
    providers: deriveProviderNames(freshest.providers, providerFleet),
    providerFleet,
    hostVersion: typeof freshest.host_version === 'string' ? freshest.host_version : null,
    lastSeenAt: freshest.last_seen_at,
    hostInstanceId: freshest.host_instance_id,
  }
}

/* ── ATB-2 provider fleet mapping (honest; tolerant of old string[] shape) ─── */

const MODEL_AVAILABILITY = ['available', 'configured-unverified', 'unavailable'] as const
const MODEL_AVAILABILITY_SOURCE = ['provider-enumeration', 'local-runtime', 'configured-allowlist', 'execution-evidence', 'unavailable'] as const
const PROVIDER_AVAILABILITY_SOURCE = ['runtime-probe', 'configured', 'unavailable'] as const
const PROVIDER_KINDS = ['provider', 'diagnostic'] as const
const EFFORT_LEVELS: EffortLevel[] = ['low', 'medium', 'high', 'extra-high']
const ROLES: Array<'architect' | 'implementer' | 'verifier'> = ['architect', 'implementer', 'verifier']
const MAX_FLEET = 24
const MAX_MODELS = 64

function deriveProviderNames(raw: unknown, fleet: ProviderCapabilityView[]): string[] {
  if (fleet.length > 0) return fleet.map((p) => p.providerDisplayName)
  // Legacy pre-ATB-2 Host: a plain string[] of names.
  return Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === 'string') : []
}

/**
 * Map the safe provider fleet. Objects map to typed capability views; a legacy
 * string[] maps to an empty fleet (names only, via deriveProviderNames). Unknown
 * enum values fall back safely; nothing is fabricated.
 */
export function mapProviderFleet(raw: unknown): ProviderCapabilityView[] {
  if (!Array.isArray(raw)) return []
  const out: ProviderCapabilityView[] = []
  for (const entry of raw) {
    if (!isRecord(entry)) continue // legacy string entries carry no capability detail
    const providerId = typeof entry.providerId === 'string' ? entry.providerId : null
    if (!providerId) continue
    out.push({
      providerId,
      providerDisplayName: typeof entry.providerDisplayName === 'string' ? entry.providerDisplayName : providerId,
      providerKind: oneOf(entry.providerKind, PROVIDER_KINDS, 'provider'),
      providerLogoKey: typeof entry.providerLogoKey === 'string' ? entry.providerLogoKey : 'generic',
      installed: entry.installed === true,
      available: entry.available === true,
      availabilitySource: oneOf(entry.availabilitySource, PROVIDER_AVAILABILITY_SOURCE, 'unavailable'),
      cliVersion: typeof entry.cliVersion === 'string' ? entry.cliVersion : null,
      workerCapable: entry.workerCapable === true,
      supportedRoles: Array.isArray(entry.supportedRoles) ? entry.supportedRoles.filter((r): r is (typeof ROLES)[number] => (ROLES as string[]).includes(r as string)) : [],
      local: entry.local === true,
      models: mapModelFleet(entry.models),
      lastRefreshedAt: typeof entry.lastRefreshedAt === 'string' ? entry.lastRefreshedAt : '',
    })
    if (out.length >= MAX_FLEET) break
  }
  return out
}

function mapModelFleet(raw: unknown): ModelCapabilityView[] {
  if (!Array.isArray(raw)) return []
  const out: ModelCapabilityView[] = []
  for (const entry of raw) {
    if (!isRecord(entry)) continue
    const modelId = typeof entry.modelId === 'string' ? entry.modelId : null
    if (!modelId) continue
    const usage = isRecord(entry.usageCapabilities) ? entry.usageCapabilities : {}
    out.push({
      modelId,
      modelDisplayName: typeof entry.modelDisplayName === 'string' ? entry.modelDisplayName : modelId,
      availability: oneOf(entry.availability, MODEL_AVAILABILITY, 'unavailable'),
      availabilitySource: oneOf(entry.availabilitySource, MODEL_AVAILABILITY_SOURCE, 'unavailable'),
      effortLevels: Array.isArray(entry.effortLevels) ? entry.effortLevels.filter((e): e is EffortLevel => EFFORT_LEVELS.includes(e as EffortLevel)) : [],
      defaultEffort: EFFORT_LEVELS.includes(entry.defaultEffort as EffortLevel) ? (entry.defaultEffort as EffortLevel) : null,
      reportedRuntimeModel: typeof entry.reportedRuntimeModel === 'string' ? entry.reportedRuntimeModel : null,
      configuredModel: typeof entry.configuredModel === 'string' ? entry.configuredModel : null,
      contextWindow: typeof entry.contextWindow === 'number' && Number.isFinite(entry.contextWindow) ? entry.contextWindow : null,
      usageCapabilities: {
        executionTokens: (usage as Record<string, unknown>).executionTokens === true,
        quotaRemaining: (usage as Record<string, unknown>).quotaRemaining === true,
        quotaPercent: (usage as Record<string, unknown>).quotaPercent === true,
        resetAt: (usage as Record<string, unknown>).resetAt === true,
      },
    })
    if (out.length >= MAX_MODELS) break
  }
  return out
}

/* ── Run snapshot → view model ──────────────────────────────────────────── */

/** The §29 whitelist payload the local Host publishes (mirror of agent-host/control/types.ts RunSnapshot). */
interface SnapshotTaskWire {
  taskId: string
  clientTaskKey: string
  title: string
  role: 'implementer' | 'verifier' | 'architect'
  status: string
  position: number
  dependencies: string[]
  plannedAreas: string[]
  permissionProfile: string
  /** ATB-3 additive fields — absent on pre-ATB-3 Hosts (map to null, never fabricated). */
  provider?: unknown
  reasoningEffort?: unknown
}
interface SnapshotAttemptWire {
  attemptId: string
  taskId: string
  ordinal: number
  status: string
  requestedModel: string | null
  reportedModel: string | null
  reportedModelSource: string | null
}
export interface SnapshotWire {
  schemaVersion: number
  run: {
    runId: string
    title: string
    objective: string | null
    status: RunState
    createdAt: string
    updatedAt: string
    startedAt: string | null
    completedAt: string | null
  }
  tasks: SnapshotTaskWire[]
  attempts: SnapshotAttemptWire[]
  gate: { gateKind: string; reason: string } | null
  changeset: { ready: boolean; changeCount: number; safePaths: string[] } | null
  verification: { verdict: 'pass' | 'fail' | 'unknown'; summary: string | null } | null
  /** ATB-1 telemetry — optional so pre-ATB-1 snapshots stay valid (missing → []). */
  interimVerdicts?: unknown
  handoffs?: unknown
  signals?: unknown
}

export interface ControlTowerRunView {
  provenance: 'Live'
  runId: string
  objective: string
  runState: RunState
  phase: string
  currentRole: Role
  verification: VerificationState
  changeset: 'none' | 'not-applied'
  scope: string
  source: string
  attention: AttentionEntry[]
  tasks: PreviewTask[]
  publishedAt: string
  title?: string
  createdAt?: string | null
  startedAt?: string | null
  completedAt?: string | null
  attemptCount?: number
  candidateCount?: number | null
  candidatePaths?: string[]
  verificationSummary?: string | null
  /**
   * ATB-1 telemetry. Optional so preview fixtures / pre-ATB-1 sessions remain
   * valid TowerSessions; the live adapter (mapRunSnapshotRow) always populates
   * them (empty arrays when a snapshot carries no telemetry).
   */
  interimVerdicts?: InterimVerdictView[]
  handoffs?: HandoffView[]
  signals?: SignalView[]
}

const RUN_PHASE_LABEL: Record<RunState, string> = {
  pending: 'Run starting · tasks created',
  running: 'Supervisor executing · one task at a time',
  paused: 'Paused at a human gate · your authority is required',
  completed: 'Run completed · changes not applied',
  failed: 'Run failed · see task states',
  cancelled: 'Run cancelled',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? (value as string[]) : []
}

const ROLE_LABEL: Record<SnapshotTaskWire['role'], Role> = { implementer: 'Implementer', verifier: 'Verifier', architect: 'Architect' }

function normalizeTaskState(rawStatus: string, dependenciesPassed: boolean): TaskState {
  if (rawStatus === 'pending') return dependenciesPassed ? 'pending-ready' : 'pending-waiting'
  if (rawStatus === 'running' || rawStatus === 'passed' || rawStatus === 'blocked' || rawStatus === 'failed' || rawStatus === 'cancelled') return rawStatus
  return 'pending-waiting'
}

function normalizeRunState(rawStatus: string): RunState {
  if (rawStatus === 'pending' || rawStatus === 'running' || rawStatus === 'paused' || rawStatus === 'completed' || rawStatus === 'failed' || rawStatus === 'cancelled') return rawStatus
  return 'failed'
}

function attemptModelIdentity(attempt: SnapshotAttemptWire | undefined, reported: boolean): ModelIdentity {
  if (!attempt) return { state: 'unavailable' }
  if (reported) {
    return attempt.reportedModel
      ? { state: 'reported', model: attempt.reportedModel }
      : { state: 'unreported' }
  }
  return attempt.requestedModel ? { state: 'requested', model: attempt.requestedModel } : { state: 'unavailable' }
}

/**
 * Map one published run snapshot row to the live view model. Returns null when
 * the snapshot payload is not the expected whitelist shape (honest failure,
 * never a fabricated run).
 */
export function mapRunSnapshotRow(row: RunSnapshotRow): ControlTowerRunView | null {
  const wire = row.snapshot as unknown
  if (!isRecord(wire)) return null
  const run = wire.run as unknown
  const tasksWire = wire.tasks as unknown
  if (!isRecord(run) || !Array.isArray(tasksWire)) return null

  const tasks = tasksWire.filter(isRecord).map((raw) => raw as unknown as SnapshotTaskWire)
  if (tasks.length === 0 || typeof tasks[0].taskId !== 'string') return null

  const attemptsWire = Array.isArray(wire.attempts) ? (wire.attempts as unknown[]).filter(isRecord).map((raw) => raw as unknown as SnapshotAttemptWire) : []
  const attemptsByTask = new Map<string, SnapshotAttemptWire[]>()
  for (const attempt of attemptsWire) {
    const list = attemptsByTask.get(attempt.taskId) ?? []
    list.push(attempt)
    attemptsByTask.set(attempt.taskId, list)
  }
  const passedKeys = new Set(tasks.filter((task) => task.status === 'passed').map((task) => task.clientTaskKey))

  const viewTasks: PreviewTask[] = tasks.map((task) => {
    const attempts = (attemptsByTask.get(task.taskId) ?? []).sort((a, b) => b.ordinal - a.ordinal)
    const latest = attempts[0]
    const state = normalizeTaskState(task.status, (task.dependencies ?? []).every((dep) => passedKeys.has(dep)))
    const plannedAreas = asStringArray(task.plannedAreas)
    const role = ROLE_LABEL[task.role] ?? 'Implementer'
    return {
      id: task.clientTaskKey,
      taskId: task.taskId,
      title: task.title,
      role,
      state,
      summary: latest ? `Attempt ${latest.ordinal} · ${latest.status}` : state === 'running' ? 'No Attempt reported yet' : 'No Attempt started',
      detail: plannedAreas.length > 0 ? `Planned areas: ${plannedAreas.join(', ')}` : 'No planned areas reported in this snapshot.',
      attempt: latest ? `Attempt ${latest.ordinal} · ${latest.status}` : 'No Attempt started',
      retry: (state === 'running' ? 'attempt-active' : 'none') as RetryState,
      dependencies: (task.dependencies ?? []).length > 0 ? task.dependencies.join(', ') : 'None',
      requested: attemptModelIdentity(latest, false),
      reported: attemptModelIdentity(latest, true),
      provider: optString(task.provider),
      effort: EFFORT_LEVELS.includes(task.reasoningEffort as EffortLevel) ? (task.reasoningEffort as EffortLevel) : null,
      plannedAreas,
    }
  })

  const runState = normalizeRunState(String(run.status ?? 'failed'))
  const runningTask = viewTasks.find((task) => task.state === 'running')
  const currentRole: Role = runningTask
    ? runningTask.role
    : viewTasks.every((task) => task.state === 'passed')
      ? 'Verifier'
      : (viewTasks.find((task) => task.state !== 'passed')?.role ?? 'Architect')

  const verifierRunning = viewTasks.some((task) => task.role === 'Verifier' && task.state === 'running')
  const verificationWire = isRecord(wire.verification) ? (wire.verification as SnapshotWire['verification']) : null
  let verification: VerificationState
  if (verificationWire?.verdict === 'pass') verification = 'passed'
  else if (verificationWire?.verdict === 'fail') verification = 'rejected'
  else if (verificationWire && verificationWire.verdict === 'unknown') verification = 'unavailable'
  else verification = verifierRunning ? 'active' : 'not-started'

  const changesetReady = isRecord(wire.changeset) && wire.changeset.ready === true
  const changeset: 'none' | 'not-applied' = changesetReady ? 'not-applied' : 'none'

  const attention: AttentionEntry[] = []
  if (runState === 'paused' && isRecord(wire.gate)) {
    attention.push({
      id: `gate:${row.run_id}`,
      kind: 'gate',
      title: 'Run paused at a human gate',
      consequence: `Host reason: ${typeof wire.gate.reason === 'string' ? wire.gate.reason : 'unknown'}. Approving or resuming happens only through the Host.`,
    })
  }
  if (verification === 'rejected') {
    const verifierTask = viewTasks.find((task) => task.role === 'Verifier')
    attention.push({
      id: `verifier:${row.run_id}`,
      kind: 'verifier-rejected',
      title: 'The Verifier rejected the work',
      consequence: 'The run records the failed verification. Review the task states.',
      taskId: verifierTask?.id,
    })
  }

  return {
    provenance: 'Live',
    runId: row.run_id,
    objective: typeof row.objective === 'string' && row.objective ? row.objective : (typeof run.title === 'string' && run.title ? run.title : row.run_id),
    runState,
    phase: RUN_PHASE_LABEL[runState],
    currentRole,
    verification,
    changeset,
    scope: typeof run.objective === 'string' ? run.objective : '',
    source: 'Local Agent Host · live run snapshot',
    attention,
    tasks: viewTasks,
    publishedAt: row.updated_at,
    title: typeof run.title === 'string' && run.title.trim() ? run.title : 'Untitled session',
    createdAt: typeof run.createdAt === 'string' ? run.createdAt : null,
    startedAt: typeof run.startedAt === 'string' ? run.startedAt : null,
    completedAt: typeof run.completedAt === 'string' ? run.completedAt : null,
    attemptCount: attemptsWire.length,
    candidateCount: isRecord(wire.changeset) && typeof wire.changeset.changeCount === 'number' ? wire.changeset.changeCount : null,
    candidatePaths: isRecord(wire.changeset) ? asStringArray(wire.changeset.safePaths) : [],
    verificationSummary: typeof verificationWire?.summary === 'string' ? verificationWire.summary : null,
    interimVerdicts: mapInterimVerdicts(wire.interimVerdicts),
    handoffs: mapHandoffs(wire.handoffs),
    signals: mapSignals(wire.signals),
  }
}

/* ── ATB-1 telemetry mappers (honest; malformed entries dropped, never faked) ─ */

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

function optString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function safeRefs(value: unknown): string[] {
  const refs = asStringArray(value)
  return refs.slice(0, MAX_INTERIM_VERDICTS).map((entry) => (entry.length > 256 ? entry.slice(0, 256) : entry))
}

/**
 * Map the Host's interim-verdict projection to view models. Each entry must have
 * a verdictId + timestamp to be trusted; anything malformed is dropped so a
 * broken payload can never surface as a fabricated verdict.
 */
export function mapInterimVerdicts(value: unknown): InterimVerdictView[] {
  if (!Array.isArray(value)) return []
  const out: InterimVerdictView[] = []
  for (const raw of value) {
    if (!isRecord(raw)) continue
    const verdictId = optString(raw.verdictId)
    const timestamp = optString(raw.timestamp)
    if (!verdictId || !timestamp) continue
    out.push({
      verdictId,
      role: oneOf(raw.role, TELEMETRY_ROLES, 'host'),
      taskId: optString(raw.taskId),
      attemptId: optString(raw.attemptId),
      state: oneOf(raw.state, VERDICT_STATES, 'CONTINUE'),
      summary: optString(raw.summary) ?? '',
      evidenceRefs: safeRefs(raw.evidenceRefs),
      evidenceCount: typeof raw.evidenceCount === 'number' && Number.isFinite(raw.evidenceCount) ? raw.evidenceCount : 0,
      severity: oneOf(raw.severity, SEVERITIES, 'info'),
      recommendedAction: oneOf(raw.recommendedAction, RECOMMENDED_ACTIONS, 'none'),
      mayContinue: raw.mayContinue !== false,
      timestamp,
    })
    if (out.length >= MAX_INTERIM_VERDICTS) break
  }
  return out
}

export function mapHandoffs(value: unknown): HandoffView[] {
  if (!Array.isArray(value)) return []
  const out: HandoffView[] = []
  for (const raw of value) {
    if (!isRecord(raw)) continue
    const handoffId = optString(raw.handoffId)
    const timestamp = optString(raw.timestamp)
    if (!handoffId || !timestamp) continue
    out.push({
      handoffId,
      from: oneOf(raw.from, HANDOFF_PARTIES, 'host'),
      to: oneOf(raw.to, HANDOFF_PARTIES, 'owner'),
      taskId: optString(raw.taskId),
      payloadType: oneOf(raw.payloadType, HANDOFF_PAYLOAD_TYPES, 'task-ready'),
      summary: optString(raw.summary) ?? '',
      evidenceCount: typeof raw.evidenceCount === 'number' && Number.isFinite(raw.evidenceCount) ? raw.evidenceCount : 0,
      status: oneOf(raw.status, HANDOFF_STATUSES, 'delivered'),
      timestamp,
      latencyMs: typeof raw.latencyMs === 'number' && Number.isFinite(raw.latencyMs) ? raw.latencyMs : null,
      resultingVerdict: typeof raw.resultingVerdict === 'string' && (VERDICT_STATES as string[]).includes(raw.resultingVerdict) ? (raw.resultingVerdict as VerdictState) : null,
    })
    if (out.length >= MAX_HANDOFFS) break
  }
  return out
}

export function mapSignals(value: unknown): SignalView[] {
  if (!Array.isArray(value)) return []
  const out: SignalView[] = []
  for (const raw of value) {
    if (!isRecord(raw)) continue
    const signalId = optString(raw.signalId)
    const firstSeen = optString(raw.firstSeen)
    const lastSeen = optString(raw.lastSeen)
    // A signal must have a known category and timestamps; unknown categories are
    // dropped rather than shown as a fabricated/misleading warning.
    if (!signalId || !firstSeen || !lastSeen) continue
    if (typeof raw.category !== 'string' || !(SIGNAL_CATEGORIES as string[]).includes(raw.category)) continue
    out.push({
      signalId,
      category: raw.category as SignalCategory,
      severity: oneOf(raw.severity, SEVERITIES, 'notice'),
      source: oneOf(raw.source, SIGNAL_SOURCES, 'host'),
      taskId: optString(raw.taskId),
      attemptId: optString(raw.attemptId),
      message: optString(raw.message) ?? '',
      evidenceCount: typeof raw.evidenceCount === 'number' && Number.isFinite(raw.evidenceCount) ? raw.evidenceCount : 0,
      evidenceRefs: safeRefs(raw.evidenceRefs),
      firstSeen,
      lastSeen,
      resolvedAt: optString(raw.resolvedAt),
      ownerActionRequired: raw.ownerActionRequired === true,
    })
    if (out.length >= MAX_SIGNALS) break
  }
  return out
}

/* ── create_plan result → plan review model ────────────────────────────── */

export interface PlanReviewTask {
  clientTaskKey: string
  title: string
  goal: string
  role: 'Implementer' | 'Verifier' | 'Architect'
  dependencies: string[]
  authorizedWritePaths: string[]
  plannedAreas: string[]
  validationRequirements: string[]
  provider: string
  requestedModel: string | null
}

export interface PlanArchitectIdentity {
  provider: string
  requestedModel: string | null
  reportedModel: string | null
  reportedModelSource: string | null
}

export interface PlanReviewModel {
  planId: string
  planHash: string
  objective: string
  constraints: string[]
  riskSummary: string | null
  tasks: PlanReviewTask[]
  /** Honest Architect model truth — reportedModel is never copied from requested. */
  architect: PlanArchitectIdentity | null
  executionIntent?: 'audit' | 'implementation' | 'verification' | 'research'
  reconciliationState?: 'unverified' | 'current' | 'stale' | 'conflict'
  architectVerdict?: { state: string; summary: string } | null
  approval?: {
    canApproveImplementation: boolean
    requiresOwnerReview: boolean
    requiresStaleAcknowledgment: boolean
    reason: string | null
  } | null
}

const PLAN_REVIEW_ROLE: Record<string, PlanReviewTask['role']> = {
  implementer: 'Implementer',
  verifier: 'Verifier',
  architect: 'Architect',
}

/**
 * Map the completed create_plan request result to the plan review model.
 * Returns null when the result is not the expected shape (the UI shows the
 * honest failure, never a reconstructed plan).
 */
export function mapPlanResult(result: Record<string, unknown> | null): PlanReviewModel | null {
  if (!isRecord(result)) return null
  const planId = result.planId
  const planHash = result.planHash
  const plan = result.plan as unknown
  if (typeof planId !== 'string' || typeof planHash !== 'string' || !isRecord(plan)) return null
  const rawTasks = plan.tasks
  const executionIntent = plan.executionIntent === 'audit' || plan.executionIntent === 'research' || plan.executionIntent === 'verification' || plan.executionIntent === 'implementation'
    ? plan.executionIntent
    : undefined
  if (!Array.isArray(rawTasks)) return null
  if (rawTasks.length === 0 && executionIntent !== 'audit' && executionIntent !== 'research') return null

  const tasks: PlanReviewTask[] = []
  for (const rawTask of rawTasks) {
    if (!isRecord(rawTask)) return null
    const role = PLAN_REVIEW_ROLE[String(rawTask.role)]
    if (!role) return null
    tasks.push({
      clientTaskKey: String(rawTask.clientTaskKey ?? ''),
      title: String(rawTask.title ?? ''),
      goal: String(rawTask.goal ?? ''),
      role,
      dependencies: asStringArray(rawTask.dependencies),
      authorizedWritePaths: asStringArray(rawTask.authorizedWritePaths),
      plannedAreas: asStringArray(rawTask.plannedAreas),
      validationRequirements: asStringArray(rawTask.validationRequirements),
      provider: String(rawTask.provider ?? ''),
      requestedModel: typeof rawTask.requestedModel === 'string' && rawTask.requestedModel ? rawTask.requestedModel : null,
    })
  }

  const architectWire = isRecord(result.architect) ? result.architect : null
  const architect: PlanArchitectIdentity | null = architectWire
    ? {
        provider: String(architectWire.provider ?? ''),
        requestedModel: typeof architectWire.requestedModel === 'string' && architectWire.requestedModel ? architectWire.requestedModel : null,
        reportedModel: typeof architectWire.reportedModel === 'string' && architectWire.reportedModel ? architectWire.reportedModel : null,
        reportedModelSource: typeof architectWire.reportedModelSource === 'string' ? architectWire.reportedModelSource : null,
      }
    : null

  const approval = isRecord(result.approval) ? {
    canApproveImplementation: result.approval.canApproveImplementation === true,
    requiresOwnerReview: result.approval.requiresOwnerReview === true,
    requiresStaleAcknowledgment: result.approval.requiresStaleAcknowledgment === true,
    reason: typeof result.approval.reason === 'string' ? result.approval.reason : null,
  } : null
  const verdict = isRecord(result.architectVerdict) ? {
    state: String(result.architectVerdict.state ?? ''),
    summary: String(result.architectVerdict.summary ?? ''),
  } : null
  const reconciliation = isRecord(result.reconciliation) ? result.reconciliation : null

  return {
    planId,
    planHash,
    objective: String(plan.objective ?? ''),
    constraints: asStringArray(plan.constraints),
    riskSummary: typeof plan.riskSummary === 'string' ? plan.riskSummary : null,
    tasks,
    architect,
    executionIntent,
    reconciliationState: reconciliation && typeof reconciliation.state === 'string'
      ? reconciliation.state as PlanReviewModel['reconciliationState']
      : undefined,
    architectVerdict: verdict,
    approval,
  }
}

/* ── App Brain association (§31 — honest, no fake movement) ────────────── */

/**
 * Match the REAL planned areas of a task to App Brain nodes via their
 * relatedFiles. Returns matching node ids — empty when nothing matches
 * (the UI then says there is no association, honestly).
 */
export function matchNodesForPlannedAreas(nodes: AppBrainNode[], plannedAreas: string[]): string[] {
  if (plannedAreas.length === 0) return []
  const matched: string[] = []
  for (const area of plannedAreas) {
    for (const node of nodes) {
      const hits = node.relatedFiles.some((file) => file === area || file.startsWith(`${area}/`) || area.startsWith(`${file}/`) || area.startsWith(`${file}\\`))
      if (hits && !matched.includes(node.id)) matched.push(node.id)
    }
  }
  return matched
}
