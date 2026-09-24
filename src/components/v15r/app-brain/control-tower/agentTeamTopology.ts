/**
 * ATB-3: PURE projection of the locked five-member Agent Team topology
 * (Host / Architect / Implementer / Verifier / Guard) from the ALREADY mapped
 * ATB-1/ATB-2 TowerSession data. No new runtime truth is invented here:
 *   - role node states derive ONLY from real task/attempt/run state, real
 *     interimVerdicts, real handoffs, and real signals;
 *   - model-backed roles show only the provider/requested/reported/effort truth
 *     the snapshot actually published (reported model is never copied from
 *     requested — a Codex attempt honestly renders "Not reported");
 *   - Host and Guard are deterministic orchestration/policy — never presented
 *     as model-backed reasoning agents;
 *   - handoff edges render ONLY real handoff records, and animate ONLY while
 *     the run is active AND the handoff is queued/delivered (a historical or
 *     terminal handoff is a settled static line);
 *   - app cross-links derive ONLY from published plannedAreas and never fire
 *     for unmapped work.
 * Every function is pure and fake-testable; the DOM overlay and the WebGL
 * scene consume this projection without re-deriving anything.
 */
import type {
  EffortLevel,
  HandoffParty,
  HandoffStatus,
  HandoffView,
  InterimVerdictView,
  PreviewTask,
  SignalView,
  VerdictState,
} from './controlTowerTypes'
import type { TowerSession } from './sessionPresentation'
import { isActiveSession } from './sessionPresentation'

export type TeamRoleId = 'host' | 'architect' | 'implementer' | 'verifier' | 'guard'
export type TeamNodeState = 'IDLE' | 'ACTIVE' | 'WARNING' | 'BLOCKED' | 'PASS' | 'FAIL' | 'WAITING_OWNER'

/** The locked baseline team, in constellation order. */
export const TEAM_ROLES: TeamRoleId[] = ['host', 'architect', 'implementer', 'verifier', 'guard']

export const TEAM_ROLE_LABEL: Record<TeamRoleId, string> = {
  host: 'Host',
  architect: 'Architect',
  implementer: 'Implementer',
  verifier: 'Verifier',
  guard: 'Guard',
}

/** Host and Guard are deterministic machinery — never model-backed agents. */
export const TEAM_ROLE_DETERMINISTIC: Record<TeamRoleId, boolean> = {
  host: true,
  architect: false,
  implementer: false,
  verifier: false,
  guard: true,
}

/**
 * Overlay anchor points (percent of the Brain frame) for every handoff party.
 * ATB-6E: cards inset so the team surrounds the application constellation
 * instead of hugging the panel border.
 * The owner is a non-interactive marker (work is handed TO the owner, never BY).
 */
export const TEAM_PARTY_ANCHORS: Record<HandoffParty, { x: number; y: number }> = {
  host: { x: 50, y: 7.5 },
  architect: { x: 14, y: 27 },
  implementer: { x: 14, y: 72 },
  verifier: { x: 86, y: 72 },
  guard: { x: 86, y: 27 },
  owner: { x: 50, y: 94.5 },
}

export interface TeamRoleNode {
  role: TeamRoleId
  label: string
  state: TeamNodeState
  deterministic: boolean
  /** True only while the run is ACTIVE and this role is engaged (drives motion). */
  engaged: boolean
  /* Provider / model truth — model-backed roles only; null for Host/Guard. */
  provider: string | null
  requestedModel: string | null
  reportedModel: string | null
  effort: EffortLevel | null
  /** Short label of the role's focus task (running task, else latest verdict's task, else first task). */
  taskLabel: string | null
  taskAttempt: string | null
  /** Latest relevant interim verdict for this role (never fabricated). */
  verdict: InterimVerdictView | null
  /** Unresolved warning/critical signals scoped to this role's tasks (badge count). */
  signalCount: number
  /** Unresolved signals requiring owner action across the run (Guard's headline number). */
  ownerSignalCount: number
  /** Handoffs queued TO this party while the run is active. */
  handoffsWaiting: number
  /** Latest telemetry timestamp involving this role (verdict or handoff), if any. */
  lastActivityAt: string | null
  /** The focus task backing the model/task truth (for the selected-role detail). */
  focusTask: PreviewTask | null
  /** Configured agent identity if the snapshot actually published one. Never invented. */
  identity: string | null
  hostFacts: { runTitle: string | null; lifecycleStage: string; outstandingGate: boolean; recentHandoffCount: number } | null
  guardFacts: { highestSeverity: SignalView['severity'] | null; ownerAction: boolean } | null
}

export interface TeamHandoffEdge {
  handoffId: string
  from: HandoffParty
  to: HandoffParty
  status: HandoffStatus
  payloadType: HandoffView['payloadType']
  summary: string
  timestamp: string
  resultingVerdict: VerdictState | null
  /** Animates ONLY while the run is active and the handoff is queued/delivered. */
  traveling: boolean
}

export interface TeamAppLinks {
  /** Areas the Implementer is actively changing (run running + implementer task running). */
  implementerAreas: string[]
  /** Areas the Verifier is actively checking (read-only path). */
  verifierAreas: string[]
  /** Areas the Architect is actively planning. */
  architectAreas: string[]
  /** Areas mapped from real signal evidence (Guard watch overlay). */
  guardAreas: string[]
}

export interface AgentTeamTopology {
  nodes: TeamRoleNode[]
  edges: TeamHandoffEdge[]
  appLinks: TeamAppLinks
  /** Real guard signals (unresolved first) for the selected-Guard detail. */
  guardSignals: SignalView[]
  runActive: boolean
  preview: boolean
}

/* State severity: a higher rank never gets downgraded by a weaker signal. */
const STATE_RANK: Record<TeamNodeState, number> = {
  IDLE: 0, ACTIVE: 1, PASS: 1, WARNING: 2, BLOCKED: 3, FAIL: 4, WAITING_OWNER: 5,
}

const MAX_STATE = (a: TeamNodeState, b: TeamNodeState): TeamNodeState => (STATE_RANK[b] > STATE_RANK[a] ? b : a)

const VERDICT_NODE_STATE: Partial<Record<VerdictState, TeamNodeState>> = {
  CONTINUE: 'ACTIVE',
  WATCH: 'WARNING',
  BLOCKED: 'BLOCKED',
  NEEDS_OWNER: 'WAITING_OWNER',
  PASS: 'PASS',
  FAIL: 'FAIL',
}

const MODEL_BACKED_ROLE_TASK: Record<Exclude<TeamRoleId, 'host' | 'guard'>, PreviewTask['role']> = {
  architect: 'Architect',
  implementer: 'Implementer',
  verifier: 'Verifier',
}

function latestVerdictFor(verdicts: InterimVerdictView[], role: TeamRoleId): InterimVerdictView | null {
  let latest: InterimVerdictView | null = null
  let latestMs = Number.NEGATIVE_INFINITY
  for (const verdict of verdicts) {
    if (verdict.role !== role) continue
    const ms = Date.parse(verdict.timestamp)
    // A verdict with an unparseable timestamp cannot out-rank a dated one, but
    // still wins if it is the only evidence (array order is the tie-break).
    const rank = Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY
    if (latest === null || rank >= latestMs) {
      latest = verdict
      latestMs = rank
    }
  }
  return latest
}

/** Task-state truth → base node state. Never derived from titles or scope text. */
function baseStateFromTasks(tasks: PreviewTask[]): TeamNodeState {
  if (tasks.some((task) => task.state === 'failed')) return 'FAIL'
  if (tasks.some((task) => task.state === 'blocked')) return 'BLOCKED'
  if (tasks.some((task) => task.state === 'running')) return 'ACTIVE'
  if (tasks.length > 0 && tasks.every((task) => task.state === 'passed')) return 'PASS'
  return 'IDLE'
}

function unresolvedSignals(signals: SignalView[]): SignalView[] {
  return signals.filter((signal) => !signal.resolvedAt)
}

function taskMatchesSignal(task: PreviewTask, signal: SignalView): boolean {
  // Telemetry references the INTERNAL Host taskId; preview fixtures may only
  // carry the client key — match either, but never invent a match.
  if (signal.taskId == null) return false
  return task.taskId === signal.taskId || (task.taskId == null && task.id === signal.taskId)
}

function roleSignalCount(tasks: PreviewTask[], signals: SignalView[]): number {
  return unresolvedSignals(signals).filter(
    (signal) => (signal.severity === 'warning' || signal.severity === 'critical') && tasks.some((task) => taskMatchesSignal(task, signal)),
  ).length
}

function focusTaskFor(tasks: PreviewTask[], verdict: InterimVerdictView | null): PreviewTask | null {
  if (tasks.length === 0) return null
  const running = tasks.find((task) => task.state === 'running')
  if (running) return running
  if (verdict?.taskId) {
    const byVerdict = tasks.find((task) => task.taskId === verdict.taskId || (task.taskId == null && task.id === verdict.taskId))
    if (byVerdict) return byVerdict
  }
  const nonIdle = tasks.find((task) => task.state !== 'pending-waiting' && task.state !== 'pending-ready')
  return nonIdle ?? tasks[0]
}

function lastActivity(verdicts: InterimVerdictView[], handoffs: HandoffView[], role: TeamRoleId): string | null {
  let latest: string | null = null
  let latestMs = Number.NEGATIVE_INFINITY
  const consider = (timestamp: string) => {
    const ms = Date.parse(timestamp)
    if (Number.isFinite(ms) && ms > latestMs) { latestMs = ms; latest = timestamp }
  }
  for (const verdict of verdicts) if (verdict.role === role) consider(verdict.timestamp)
  for (const handoff of handoffs) {
    if (handoff.from === role || handoff.to === role) consider(handoff.timestamp)
  }
  return latest
}

/** Builds the whole team topology for one session. Pure; null run → honest IDLE team. */
export function buildAgentTeamTopology(run: TowerSession | null): AgentTeamTopology {
  const runActive = run != null && isActiveSession(run)
  const preview = run?.provenance === 'Preview'
  const verdicts = run?.interimVerdicts ?? []
  const handoffs = run?.handoffs ?? []
  const signals = run?.signals ?? []
  const tasks = run?.tasks ?? []
  const open = unresolvedSignals(signals)
  const ownerNeeded = open.some((signal) => signal.ownerActionRequired || signal.severity === 'critical')

  const edges: TeamHandoffEdge[] = handoffs.map((handoff) => ({
    handoffId: handoff.handoffId,
    from: handoff.from,
    to: handoff.to,
    status: handoff.status,
    payloadType: handoff.payloadType,
    summary: handoff.summary,
    timestamp: handoff.timestamp,
    resultingVerdict: handoff.resultingVerdict,
    // §8/§24: motion ONLY for an in-flight handoff on an ACTIVE run. A terminal
    // or historical handoff — and every accepted/rejected/blocked one — settles.
    traveling: runActive && (handoff.status === 'queued' || handoff.status === 'delivered'),
  }))

  const handoffsWaitingFor = (party: HandoffParty) =>
    edges.filter((edge) => edge.to === party && edge.traveling && edge.status === 'queued').length

  const nodes: TeamRoleNode[] = TEAM_ROLES.map((role) => {
    const deterministic = TEAM_ROLE_DETERMINISTIC[role]
    const verdict = latestVerdictFor(verdicts, role)
    const verdictState = verdict ? VERDICT_NODE_STATE[verdict.state] ?? null : null

    let state: TeamNodeState = 'IDLE'
    let provider: string | null = null
    let requestedModel: string | null = null
    let reportedModel: string | null = null
    let effort: EffortLevel | null = null
    let taskLabel: string | null = null
    let taskAttempt: string | null = null
    let focusTask: PreviewTask | null = null
    let signalCount = 0
    let identity: string | null = null
    let hostFacts: TeamRoleNode['hostFacts'] = null
    let guardFacts: TeamRoleNode['guardFacts'] = null

    if (role === 'host') {
      if (run == null) state = 'IDLE'
      else if (run.runState === 'running' || run.runState === 'pending') state = 'ACTIVE'
      else if (run.runState === 'paused') state = 'WAITING_OWNER'
      else if (run.runState === 'completed') state = 'PASS'
      else if (run.runState === 'failed') state = 'FAIL'
      else state = 'IDLE' // cancelled: settled, never fabricated as failure
      hostFacts = {
        runTitle: run?.title ?? run?.objective ?? null,
        lifecycleStage: run?.phase || run?.currentRole || (run ? run.runState : 'idle'),
        outstandingGate: (run?.attention.length ?? 0) > 0 || run?.runState === 'paused',
        recentHandoffCount: handoffs.length,
      }
    } else if (role === 'guard') {
      if (ownerNeeded || (run != null && run.runState === 'paused')) state = 'WAITING_OWNER'
      else if (open.some((signal) => signal.category === 'policy-gate') && runActive) state = 'BLOCKED'
      else if (open.some((signal) => signal.severity === 'warning')) state = 'WARNING'
      else state = 'IDLE'
      signalCount = open.length
      const ranked = open.slice().sort((left, right) => {
        const order = ['critical', 'warning', 'notice', 'info']
        return order.indexOf(left.severity) - order.indexOf(right.severity)
      })
      guardFacts = {
        highestSeverity: ranked[0]?.severity ?? null,
        ownerAction: ownerNeeded,
      }
    } else {
      const roleTasks = tasks.filter((task) => task.role === MODEL_BACKED_ROLE_TASK[role])
      state = baseStateFromTasks(roleTasks)
      focusTask = focusTaskFor(roleTasks, verdict)
      provider = focusTask?.provider ?? null
      effort = focusTask?.effort ?? null
      requestedModel = focusTask && focusTask.requested.state === 'requested' ? focusTask.requested.model ?? null : null
      // Requested is NEVER copied into the reported slot (Codex stays "Not reported").
      reportedModel = focusTask && focusTask.reported.state === 'reported' ? focusTask.reported.model ?? null : null
      taskLabel = focusTask?.title ?? null
      taskAttempt = focusTask?.attempt ?? null
      signalCount = roleSignalCount(roleTasks, signals)
    }

    if (verdictState) state = MAX_STATE(state, verdictState)

    return {
      role,
      label: TEAM_ROLE_LABEL[role],
      state,
      deterministic,
      engaged: runActive && state === 'ACTIVE',
      provider,
      requestedModel,
      reportedModel,
      effort,
      taskLabel,
      taskAttempt,
      verdict,
      signalCount,
      ownerSignalCount: open.filter((signal) => signal.ownerActionRequired).length,
      handoffsWaiting: handoffsWaitingFor(role),
      lastActivityAt: lastActivity(verdicts, handoffs, role),
      focusTask,
      identity,
      hostFacts,
      guardFacts,
    }
  })

  const runningTasks = run?.runState === 'running' ? tasks.filter((task) => task.state === 'running') : []
  const areasOf = (role: Exclude<TeamRoleId, 'host' | 'guard'>) =>
    runningTasks.filter((task) => task.role === MODEL_BACKED_ROLE_TASK[role]).flatMap((task) => task.plannedAreas ?? [])

  // Guard overlays an app area ONLY when real signal evidence maps there.
  const guardAreas: string[] = []
  for (const signal of open) {
    for (const task of tasks) {
      if (taskMatchesSignal(task, signal)) for (const area of task.plannedAreas ?? []) if (!guardAreas.includes(area)) guardAreas.push(area)
    }
  }

  return {
    nodes,
    edges,
    appLinks: {
      implementerAreas: areasOf('implementer'),
      verifierAreas: areasOf('verifier'),
      architectAreas: areasOf('architect'),
      guardAreas,
    },
    guardSignals: [...open, ...signals.filter((signal) => signal.resolvedAt != null)],
    runActive,
    preview,
  }
}

export function teamNodeByRole(topology: AgentTeamTopology, role: TeamRoleId): TeamRoleNode | null {
  return topology.nodes.find((node) => node.role === role) ?? null
}