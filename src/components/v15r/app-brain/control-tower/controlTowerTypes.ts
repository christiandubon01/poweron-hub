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
}
export interface AttentionEntry {
  id: string
  kind: AttentionKind
  title: string
  consequence: string
  taskId?: string
}

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
}
