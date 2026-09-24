import { memo } from 'react'
import { AlertTriangle, CheckCircle2, Circle, Cpu, PlayCircle, ShieldCheck, User, XCircle } from 'lucide-react'
import { TEAM_PARTY_ANCHORS, type AgentTeamTopology, type TeamRoleNode, type TeamRoleId } from './agentTeamTopology'
import type { TowerSession } from './sessionPresentation'

/* Collapsed-node state treatment: color is NEVER the only indicator — every
 * state also carries an icon and a text label (§4, §27). */
const STATE_META: Record<TeamRoleNode['state'], { label: string; icon: typeof Circle }> = {
  IDLE: { label: 'Idle', icon: Circle },
  ACTIVE: { label: 'Active', icon: PlayCircle },
  WARNING: { label: 'Watch', icon: AlertTriangle },
  BLOCKED: { label: 'Blocked', icon: XCircle },
  PASS: { label: 'Passed', icon: CheckCircle2 },
  FAIL: { label: 'Failed', icon: XCircle },
  WAITING_OWNER: { label: 'Needs you', icon: User },
}

/** ATB-6D: bow handoffs away from the application cluster so they travel the frame. */
function bowControl(from: { x: number; y: number }, to: { x: number; y: number }): { x: number; y: number } {
  const mx = (from.x + to.x) / 2
  const my = (from.y + to.y) / 2
  let px = -(to.y - from.y)
  let py = to.x - from.x
  const plen = Math.hypot(px, py) || 1
  px /= plen
  py /= plen
  if ((mx - 50) * px + (my - 50) * py < 0) { px = -px; py = -py }
  const bow = Math.min(8, Math.hypot(to.x - from.x, to.y - from.y) * 0.14)
  return { x: mx + px * bow, y: my + py * bow }
}

const ROLE_SUBLINE: Record<TeamRoleId, string> = {
  host: 'Deterministic · supervisor',
  guard: 'Deterministic · policy',
  architect: '',
  implementer: '',
  verifier: '',
}

function hostRunLine(run: TowerSession | null, node: TeamRoleNode): string {
  if (!run || !node.hostFacts) return 'No session'
  const facts = node.hostFacts
  const gate = facts.outstandingGate ? ' · gate' : ''
  if (run.runState === 'running' || run.runState === 'pending') {
    const passed = run.tasks.filter((task) => task.state === 'passed').length
    return `${passed}/${run.tasks.length} · ${facts.lifecycleStage}${gate}`
  }
  if (run.runState === 'paused') return `Paused · ${facts.recentHandoffCount} handoffs`
  if (run.runState === 'completed') return 'Run completed'
  if (run.runState === 'failed') return 'Run failed'
  return `${facts.recentHandoffCount} handoffs`
}

function guardSignalLine(node: TeamRoleNode): string {
  const severity = node.guardFacts?.highestSeverity
  if (node.state === 'IDLE') return node.signalCount === 0 ? 'No open signals' : `${node.signalCount} open`
  return `${node.signalCount} open${severity ? ` · ${severity}` : ''}${node.ownerSignalCount > 0 ? ' · need you' : ''}`
}

function modelChip(node: TeamRoleNode): string | null {
  const parts = [node.identity, node.provider, node.reportedModel ?? node.requestedModel].filter((part): part is string => Boolean(part))
  if (parts.length === 0) return null
  return node.effort ? `${parts.join(' · ')} · ${node.effort}` : parts.join(' · ')
}

/** Compact collapsed role node — high-level truth only, never long text (§5). */
function TeamNode({ node, run, selected, onSelect }: {
  node: TeamRoleNode; run: TowerSession | null; selected: boolean; onSelect: () => void
}) {
  const meta = STATE_META[node.state]
  const StateIcon = meta.icon
  const chip = modelChip(node)
  const ariaParts = [
    `${node.label} team member`,
    meta.label,
    node.deterministic ? 'deterministic orchestration, not a model' : null,
    chip ? `using ${chip}` : null,
    node.taskLabel ? `working on ${node.taskLabel}` : null,
    node.verdict ? `latest verdict ${node.verdict.state}` : null,
    node.signalCount > 0 ? `${node.signalCount} open warning signals` : null,
    node.state === 'WAITING_OWNER' ? 'owner attention required' : null,
  ]
  return <button
    type="button"
    className={`ct-team-node ct-team-node--${node.role} ct-team-node-state-${node.state.toLowerCase().replace('_', '-')} ${node.engaged ? 'ct-team-node--engaged' : ''} ${selected ? 'ct-team-node--selected' : ''}`}
    style={{ left: `${TEAM_PARTY_ANCHORS[node.role].x}%`, top: `${TEAM_PARTY_ANCHORS[node.role].y}%` }}
    aria-pressed={selected}
    aria-label={ariaParts.filter(Boolean).join(' · ')}
    onClick={onSelect}
  >
    <span className="ct-team-node-head">
      <span className="ct-team-node-name">{node.deterministic && node.role === 'guard' ? <ShieldCheck size={12} aria-hidden="true" /> : node.deterministic ? <Cpu size={12} aria-hidden="true" /> : null}{node.label}</span>
      <span className={`ct-team-node-state ct-team-state-${node.state.toLowerCase().replace('_', '-')}`}><StateIcon size={12} aria-hidden="true" />{meta.label}</span>
    </span>
    {node.role === 'host' && <span className="ct-team-node-sub">{hostRunLine(run, node)}</span>}
    {node.role === 'guard' && <span className="ct-team-node-sub">{guardSignalLine(node)}</span>}
    {!node.deterministic && <span className="ct-team-node-sub">{chip ? <span className="ct-team-chip">{chip}</span> : <span className="ct-team-chip ct-team-chip-unknown">Model not published</span>}</span>}
    {!node.deterministic && node.taskLabel && <span className="ct-team-node-task">{node.taskLabel}</span>}
    {node.verdict && <span className={`ct-team-verdict ct-team-verdict--${node.verdict.state.toLowerCase().replace('_', '-')}`}>Verdict {node.verdict.state}</span>}
    {node.signalCount > 0 && node.role !== 'guard' && <span className={`ct-team-badge ${node.ownerSignalCount > 0 || node.state === 'WAITING_OWNER' ? 'ct-team-badge--owner' : 'ct-team-badge--warning'}`} aria-hidden="true">{node.signalCount}</span>}
    {node.handoffsWaiting > 0 && <span className="ct-team-handoffs" aria-hidden="true">⇄ {node.handoffsWaiting}</span>}
  </button>
}

interface Props {
  topology: AgentTeamTopology
  run: TowerSession | null
  selectedRoleId: TeamRoleId | null
  onSelectRole: (role: TeamRoleId | null) => void
}

/**
 * ATB-3: the live Agent Team constellation rendered as an accessible DOM
 * overlay INSIDE the current Brain frame. ATB-6E insets cards so the
 * team surrounds the application constellation.
 * Handoff edges are real handoff records only; the traveling dash animates
 * solely for in-flight handoffs on an active run and is disabled under
 * prefers-reduced-motion (see controlTower.css).
 */
function AgentTeamOverlay({ topology, run, selectedRoleId, onSelectRole }: Props) {
  // One visible edge per party pair: the latest record wins (in-flight beats
  // settled); full history lives in the selected-role detail, not the Brain.
  const edgeByPair = new Map<string, AgentTeamTopology['edges'][number]>()
  for (const edge of topology.edges) {
    const key = `${edge.from}→${edge.to}`
    const current = edgeByPair.get(key)
    if (!current || (edge.traveling && !current.traveling)) edgeByPair.set(key, edge)
  }
  const edges = [...edgeByPair.values()]

  return <div className={`ct-team-overlay ${topology.preview ? 'ct-team-overlay--preview' : ''}`} aria-label="Agent team">
    <svg className="ct-team-edges" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {edges.map((edge) => {
        const from = TEAM_PARTY_ANCHORS[edge.from]
        const to = TEAM_PARTY_ANCHORS[edge.to]
        const mid = bowControl(from, to)
        return <path
          key={edge.handoffId}
          d={`M ${from.x} ${from.y} Q ${mid.x} ${mid.y} ${to.x} ${to.y}`}
          vectorEffect="non-scaling-stroke"
          className={`ct-team-edge ct-team-edge--${edge.status} ${edge.traveling ? 'ct-team-edge--traveling' : ''}`}
          data-traveling={edge.traveling ? 'true' : 'false'}
        />
      })}
      {edges.map((edge) => {
        const from = TEAM_PARTY_ANCHORS[edge.from]
        const to = TEAM_PARTY_ANCHORS[edge.to]
        const mid = bowControl(from, to)
        const dx = to.x - mid.x
        const dy = to.y - mid.y
        const len = Math.hypot(dx, dy) || 1
        const tipX = to.x - (dx / len) * 3.4
        const tipY = to.y - (dy / len) * 3.4
        const px = -(dy / len) * 1.3
        const py = (dx / len) * 1.3
        const baseX = tipX - (dx / len) * 2.6
        const baseY = tipY - (dy / len) * 2.6
        return <polygon key={edge.handoffId} points={`${tipX},${tipY} ${baseX + px},${baseY + py} ${baseX - px},${baseY - py}`} className={`ct-team-arrow ct-team-arrow--${edge.status}`} />
      })}
    </svg>
    {topology.nodes.map((node) => <TeamNode
      key={node.role}
      node={node}
      run={run}
      selected={selectedRoleId === node.role}
      onSelect={() => onSelectRole(selectedRoleId === node.role ? null : node.role)}
    />)}
    <span className="ct-team-owner" style={{ left: `${TEAM_PARTY_ANCHORS.owner.x}%`, top: `${TEAM_PARTY_ANCHORS.owner.y}%` }}><User size={11} aria-hidden="true" />Owner (you)</span>
  </div>
}

export default memo(AgentTeamOverlay)