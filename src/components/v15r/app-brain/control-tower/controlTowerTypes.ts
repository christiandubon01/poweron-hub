export type RunState = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
export type TaskState = 'pending-ready' | 'pending-waiting' | 'running' | 'passed' | 'blocked' | 'failed' | 'cancelled'
export type Role = 'Architect' | 'Implementer' | 'Verifier'
export type ModelIdentity = {
  state: 'requested' | 'reported' | 'unreported' | 'unavailable'
  provider?: string
  model?: string
}
export type EvidenceKind = 'Planned scope' | 'Task active in area' | 'Reported activity' | 'Confirmed changed files' | 'Verifier activity'
export type Freshness = 'Snapshot' | 'Last reported' | 'Current feed' | 'Stale' | 'Unavailable'
export type AttentionKind = 'gate' | 'plan-review' | 'exhausted' | 'verifier-rejected' | 'review-available'
export type RetryState = 'none' | 'scheduled' | 'attempt-active' | 'exhausted'
export type VerificationState = 'not-started' | 'active' | 'passed' | 'rejected' | 'unavailable'
export interface PreviewTask {
  id: string
  /** Internal Host taskId — the key telemetry (verdicts/handoffs/signals) references. */
  taskId?: string | null
  title: string
  role: Role
  state: TaskState
  summary: string
  detail: string
  attempt: string
  retry: RetryState
  dependencies: string
  requested: ModelIdentity
  reported: ModelIdentity
  /** ATB-3: execution provider id (from task spec). null/absent = not published (legacy Host). */
  provider?: string | null
  /** ATB-3: normalized reasoning effort (from task spec). null/absent = provider default or not published. */
  effort?: EffortLevel | null
  /** CT-CORE-1 live view: real planned areas from the Host snapshot (absent in the fixture preview). */
  plannedAreas?: string[]
}
export interface AttentionEntry {
  id: string
  kind: AttentionKind
  title: string
  consequence: string
  taskId?: string
}

/* ── ATB-1: Agent Team runtime telemetry view models ─────────────────────── */
export type VerdictState = 'CONTINUE' | 'WATCH' | 'BLOCKED' | 'NEEDS_OWNER' | 'PASS' | 'FAIL'
export type TelemetryRole = 'architect' | 'implementer' | 'verifier' | 'guard' | 'host'
export type HandoffParty = TelemetryRole | 'owner'
export type TelemetrySeverity = 'info' | 'notice' | 'warning' | 'critical'
export type RecommendedAction = 'none' | 'watch' | 'owner-review' | 'cancel' | 'approve-gate'
export type HandoffPayloadType = 'plan' | 'changeset' | 'verification' | 'gate' | 'policy-finding' | 'run-result' | 'task-ready'
export type HandoffStatus = 'queued' | 'delivered' | 'accepted' | 'rejected' | 'blocked'
export type SignalCategory =
  | 'out-of-scope-write' | 'protected-path' | 'dependency-mutation' | 'db-mutation'
  | 'migration-outside-plan' | 'unexpected-head-move' | 'changeset-oversized' | 'unplanned-area'
  | 'new-untracked-files' | 'model-routing-mismatch' | 'provider-fallback' | 'attempt-stalled'
  | 'excessive-retry' | 'policy-gate' | 'human-gate' | 'verifier-implementer-disagreement'
  | 'scope-pack-stale' | 'unknown-command'

export interface InterimVerdictView {
  verdictId: string
  role: TelemetryRole
  taskId: string | null
  attemptId: string | null
  state: VerdictState
  summary: string
  evidenceRefs: string[]
  evidenceCount: number
  severity: TelemetrySeverity
  recommendedAction: RecommendedAction
  mayContinue: boolean
  timestamp: string
}

export interface HandoffView {
  handoffId: string
  from: HandoffParty
  to: HandoffParty
  taskId: string | null
  payloadType: HandoffPayloadType
  summary: string
  evidenceCount: number
  status: HandoffStatus
  timestamp: string
  latencyMs: number | null
  resultingVerdict: VerdictState | null
}

export interface SignalView {
  signalId: string
  category: SignalCategory
  severity: TelemetrySeverity
  source: 'guard' | 'host' | 'supervisor'
  taskId: string | null
  attemptId: string | null
  message: string
  evidenceCount: number
  evidenceRefs: string[]
  firstSeen: string
  lastSeen: string
  resolvedAt: string | null
  ownerActionRequired: boolean
}

/* ── ATB-2: provider / model capability fleet view models ────────────────── */
export type EffortLevel = 'low' | 'medium' | 'high' | 'extra-high'

export interface ModelCapabilityView {
  modelId: string
  modelDisplayName: string
  availability: 'available' | 'configured-unverified' | 'unavailable'
  availabilitySource: 'provider-enumeration' | 'local-runtime' | 'configured-allowlist' | 'execution-evidence' | 'unavailable'
  effortLevels: EffortLevel[]
  defaultEffort: EffortLevel | null
  reportedRuntimeModel: string | null
  configuredModel: string | null
  contextWindow: number | null
  usageCapabilities: { executionTokens: boolean; quotaRemaining: boolean; quotaPercent: boolean; resetAt: boolean }
}

export interface ProviderCapabilityView {
  providerId: string
  providerDisplayName: string
  providerKind: 'provider' | 'diagnostic'
  providerLogoKey: string
  installed: boolean
  available: boolean
  availabilitySource: 'runtime-probe' | 'configured' | 'unavailable'
  cliVersion: string | null
  workerCapable: boolean
  supportedRoles: Array<'architect' | 'implementer' | 'verifier'>
  local: boolean
  models: ModelCapabilityView[]
  lastRefreshedAt: string
}

/** Approved local provider-logo keys the fleet may reference (frontend maps these to assets). */
export const KNOWN_PROVIDER_LOGO_KEYS = ['claude', 'codex', 'ollama', 'cursor', 'generic'] as const
export type ProviderLogoKey = (typeof KNOWN_PROVIDER_LOGO_KEYS)[number]

export interface ControlTowerPreview {
  provenance: 'Preview'
  freshness: 'Snapshot'
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
  /** ATB-3 §21: illustrative telemetry so preview fixtures exercise the honest
   *  team states. Same shapes as Live — never merged into Host truth. */
  interimVerdicts?: InterimVerdictView[]
  handoffs?: HandoffView[]
  signals?: SignalView[]
}
