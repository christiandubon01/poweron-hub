import type { ReactNode } from 'react'
import { AlertTriangle, Ban, CheckCircle2, Circle, Clock3, FileCheck2, GitBranch, Hourglass, PauseCircle, PlayCircle, RotateCcw, ShieldCheck, XCircle } from 'lucide-react'
import type { AttentionEntry, EvidenceKind, Freshness, ModelIdentity, PreviewTask, RetryState, Role, RunState, TaskState, VerificationState } from './controlTowerTypes'

const RUN_META = {
  pending: { label: 'Pending', icon: Clock3 }, running: { label: 'Running', icon: PlayCircle },
  paused: { label: 'Paused', icon: PauseCircle }, completed: { label: 'Completed', icon: CheckCircle2 },
  failed: { label: 'Failed', icon: XCircle }, cancelled: { label: 'Cancelled', icon: Ban },
} satisfies Record<RunState, { label: string; icon: typeof Circle }>

const TASK_META = {
  'pending-ready': { label: 'Pending · ready', icon: Circle },
  'pending-waiting': { label: 'Pending · waiting', icon: Hourglass },
  running: { label: 'Running', icon: PlayCircle }, passed: { label: 'Passed', icon: CheckCircle2 },
  blocked: { label: 'Blocked', icon: PauseCircle }, failed: { label: 'Failed', icon: XCircle },
  cancelled: { label: 'Cancelled', icon: Ban },
} satisfies Record<TaskState, { label: string; icon: typeof Circle }>

export function RunStatus({ state }: { state: RunState }) {
  const { icon: Icon, label } = RUN_META[state]
  return <span className={`ct-status ct-state-${state}`}><Icon size={14} aria-hidden="true" />Run {label.toLowerCase()}</span>
}

export function RoleBadge({ role }: { role: Role }) {
  return <span className={`ct-role ${role === 'Verifier' ? 'ct-verifier' : ''}`}>{role === 'Verifier' && <ShieldCheck size={13} aria-hidden="true" />}{role}</span>
}

/** Never substitute a requested identity for missing reported fields. */
export function ProviderModelBadge({ identity }: { identity: ModelIdentity }) {
  if (identity.state === 'unreported' || identity.state === 'unavailable') {
    return <span className="ct-model">Model {identity.state}</span>
  }
  return <span className="ct-model">{identity.state === 'requested' ? 'Requested' : 'Reported'} · Provider: {identity.provider || 'unreported'} · Model: {identity.model || 'unreported'}</span>
}

export function ConnectionFreshness({ freshness, detail }: { freshness: Freshness; detail?: string }) {
  return <span className="ct-freshness"><Clock3 size={13} aria-hidden="true" />{freshness}{detail && <span> · {detail}</span>}</span>
}

export function EvidenceProvenance({ kind, source, freshness }: { kind: EvidenceKind; source: string; freshness: Freshness }) {
  return <div className="ct-provenance"><span><GitBranch size={13} aria-hidden="true" />{kind}</span><ConnectionFreshness freshness={freshness} /><p>{source}</p></div>
}

export function RetryIndicator({ state }: { state: RetryState }) {
  const label = { none: 'No retry scheduled', scheduled: 'Retry scheduled · no active Attempt', 'attempt-active': 'Attempt active', exhausted: 'Retry budget exhausted' }[state]
  return <span className="ct-status"><RotateCcw size={13} aria-hidden="true" />{label}</span>
}

export function VerifierState({ state }: { state: VerificationState }) {
  const label = { 'not-started': 'Not started', active: 'Active', passed: 'Passed', rejected: 'Rejected', unavailable: 'Unavailable' }[state]
  return <span className="ct-status ct-verifier"><ShieldCheck size={14} aria-hidden="true" />Verifier · {label}</span>
}

export function ChangesetSummary({ state }: { state: 'none' | 'not-applied' | 'applied' | 'unavailable' }) {
  const label = { none: 'No candidate changes reported', 'not-applied': 'Changes not applied', applied: 'Changes applied', unavailable: 'Changeset unavailable' }[state]
  return <div className="ct-changeset"><FileCheck2 size={15} aria-hidden="true" /><span>{label}</span></div>
}

const ATTENTION_LABEL = { gate: 'Scope gate', 'plan-review': 'Plan review', exhausted: 'Retries exhausted', 'verifier-rejected': 'Verifier rejected', 'review-available': 'Review available' }

export function AttentionItem({ item, onInspect, onEvidence, mode = 'Preview' }: { item: AttentionEntry; onInspect: () => void; onEvidence?: () => void; mode?: 'Preview' | 'Live' }) {
  return <article className="ct-attention-item" data-kind={item.kind}>
    <AlertTriangle className="ct-amber" size={17} aria-hidden="true" />
    <div><span className="ct-eyebrow">{ATTENTION_LABEL[item.kind]} · {mode === 'Live' ? 'Live · Host gate' : 'Preview · Snapshot'}</span><h3>{item.title}</h3><p>{item.consequence}</p></div>
    <div className="ct-attention-actions"><button type="button" onClick={onInspect} aria-label={`Inspect ${mode === 'Live' ? 'live gate' : 'preview'}: ${item.title}`}>{item.kind === 'gate' ? 'Inspect proposed change' : 'Inspect'}</button>{onEvidence && <button type="button" onClick={onEvidence}>Open task evidence</button>}</div>
  </article>
}

export const CT_ROLES: Role[] = ['Architect', 'Implementer', 'Verifier']

/** Frozen CT-3F relay: the workflow team, not the provider, is the operational identity. */
export function RoleRelay({ currentRole }: { currentRole: Role }) {
  const current = CT_ROLES.indexOf(currentRole)
  return <div className="ct-relay" aria-label="Role relay">
    {CT_ROLES.map((role, index) => <span key={role} className={`ct-relay-step ct-relay-${role.toLowerCase()} ${index === current ? 'ct-relay-current' : index < current ? 'ct-relay-settled' : 'ct-relay-future'}`}>
      {index > 0 && <span className="ct-relay-arrow" aria-hidden="true">→</span>}
      <RoleBadge role={role} />
    </span>)}
  </div>
}

/** Frozen CT-3F execution spine row. Node and halo styling live on the rail step; the button remains the durable, inspectable task surface. */
export function TaskRow({ task, selected, onSelect }: { task: PreviewTask; selected: boolean; onSelect: () => void }) {
  const { icon: Icon, label } = TASK_META[task.state]
  return <button type="button" className={`ct-task-row ct-task-${task.state} ${selected ? 'ct-selected' : ''}`} onClick={onSelect} aria-pressed={selected}>
    <span className="ct-task-copy"><span className="ct-task-title">{task.title}</span>
      <span className="ct-task-meta"><RoleBadge role={task.role} /><span className={`ct-status ct-state-${task.state}`}><Icon size={13} aria-hidden="true" />{label}</span></span>
      <span className="ct-task-summary">{task.summary}</span>
      {task.state === 'running' && <span className="ct-task-attempt">{task.attempt}</span>}
      {task.state === 'blocked' && <span className="ct-task-flag">needs you</span>}
    </span>
  </button>
}

export function TaskStatus({ state, freshness = 'Snapshot' as Freshness }: { state: TaskState; freshness?: Freshness }) {
  const { icon: Icon, label } = TASK_META[state]
  return <span className={`ct-status ct-state-${state}`}><Icon size={14} aria-hidden="true" />{label} · {freshness}</span>
}

export function TowerPanel({ title, children, className = '', action, modal = false }: { title: string; children: ReactNode; className?: string; action?: ReactNode; modal?: boolean }) {
  return <section className={`ct-panel ${className}`} aria-label={title} role={modal ? 'dialog' : undefined} aria-modal={modal || undefined}><header className="ct-panel-heading"><h2>{title}</h2>{action}</header>{children}</section>
}
