import { useMemo, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import V15rAppBrainScene from '../../V15rAppBrainScene'
import { APP_BRAIN_NODES, getAppBrainNode } from '../../appBrainMap'
import { TowerPanel } from './ControlTowerPrimitives'
import AgentTeamOverlay from './AgentTeamOverlay'
import { matchNodesForPlannedAreas } from '@/features/control-tower/controlTowerAdapter'
import type { AgentTeamTopology, TeamRoleId } from './agentTeamTopology'
import type { TowerSession } from './sessionPresentation'
import type { Role, RunState, TaskState } from './controlTowerTypes'

export type BrainMotionMode = 'rest' | 'active' | 'halted'

const NODE_IDS = APP_BRAIN_NODES.map(node => node.id)
interface Props {
  scope: string; taskTitle?: string; taskRole?: Role; taskState?: TaskState; live?: boolean; plannedAreas?: string[]
  activeAreas?: string[]; activeRole?: Role; runState?: RunState; selectedNodeId?: string | null; onSelectNode?: (id: string | null) => void
  team?: AgentTeamTopology | null; teamRun?: TowerSession | null; selectedRoleId?: TeamRoleId | null; onSelectRole?: (role: TeamRoleId | null) => void
}
export default function LinkedAppBrain({ scope, taskTitle, taskState, live = false, plannedAreas = [], activeAreas = [], activeRole, runState, selectedNodeId: externalId, onSelectNode, team, teamRun, selectedRoleId, onSelectRole }: Props) {
  const [localId, setLocalId] = useState<string | null>(null)
  const selectedNodeId = externalId === undefined ? localId : externalId
  const selectNode = (id: string | null) => { setLocalId(id); onSelectNode?.(id) }
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const node = getAppBrainNode(selectedNodeId)
  const activityNodeIds = useMemo(() => runState === 'running' ? matchNodesForPlannedAreas(APP_BRAIN_NODES, activeAreas) : [], [runState, activeAreas])
  const associated = useMemo(() => matchNodesForPlannedAreas(APP_BRAIN_NODES, plannedAreas), [plannedAreas])
  const verifierNodeIds = useMemo(() => runState === 'running' && team ? matchNodesForPlannedAreas(APP_BRAIN_NODES, team.appLinks.verifierAreas) : [], [runState, team])
  const plannedNodeIds = useMemo(() => runState === 'running' && team ? matchNodesForPlannedAreas(APP_BRAIN_NODES, team.appLinks.architectAreas) : [], [runState, team])
  const guardNodeIds = useMemo(() => team ? matchNodesForPlannedAreas(APP_BRAIN_NODES, team.appLinks.guardAreas) : [], [team])
  const failedNodeIds = taskState === 'failed' && associated.length <= 3 ? associated : []
  const motionMode: BrainMotionMode = runState === 'running' && (activityNodeIds.length > 0 || verifierNodeIds.length > 0) ? 'active' : runState === 'failed' || runState === 'paused' ? 'halted' : 'rest'
  const state = runState === 'running' ? (activityNodeIds.length ? `${activeRole} active` : 'Active task · area unmapped') : runState === 'completed' ? 'Completed · at rest' : runState === 'failed' ? 'Run failed · at rest' : runState === 'paused' ? 'Paused · awaiting owner' : 'At rest'
  return <div className="ct-map-frame ct-focus-scope">
    <TowerPanel title="App Brain" className="ct-map" action={<button type="button" onClick={() => { selectNode(null); setResetKey(value => value + 1) }} aria-label="Reset Brain view"><RotateCcw size={14} aria-hidden="true" />Reset view</button>}>
      <div className="ct-map-toolbar"><p className="ct-breadcrumb">{node?.label ?? 'System overview'}</p><span className={`ct-brain-state ${activityNodeIds.length ? 'ct-state-running' : ''}`}>{state}</span></div>
      <div className="ct-map-scene ct-brain-stage" data-motion-mode={motionMode} data-ambient={motionMode === 'rest' || motionMode === 'halted' ? 'true' : 'false'}>
        <V15rAppBrainScene operational resetViewKey={resetKey} activityNodeIds={activityNodeIds} failedNodeIds={failedNodeIds} verifierNodeIds={verifierNodeIds} plannedNodeIds={plannedNodeIds} staticPresentation={false} selectedNodeId={selectedNodeId} hoveredNodeId={hoveredNodeId} visibleNodeIds={NODE_IDS} onSelectNode={selectNode} onDeselect={() => selectNode(null)} onHoverNode={setHoveredNodeId} motionMode={motionMode} />
        {team && <AgentTeamOverlay topology={team} run={teamRun ?? null} selectedRoleId={selectedRoleId ?? null} onSelectRole={onSelectRole ?? (() => {})} />}
      </div>
      <div className="ct-map-bottom"><label className="ct-map-select"><span>Inspect architecture area</span><select aria-label="Architecture area" value={selectedNodeId ?? ''} onChange={event => selectNode(event.target.value || null)}><option value="">System overview</option>{APP_BRAIN_NODES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><details className="ct-disclosure"><summary>{live ? 'Scope association' : 'Preview scope association'}</summary><p>{taskTitle || 'No task selected'}</p><p>{associated.length ? `Host planned areas: ${associated.map(id => getAppBrainNode(id)?.label).join(', ')}` : 'No mapped planned areas reported. No activity paths are inferred.'}</p><p>{guardNodeIds.length ? `Guard evidence areas: ${guardNodeIds.map(id => getAppBrainNode(id)?.label).join(', ')}` : ''}</p><p>{scope}</p></details></div>
    </TowerPanel>
  </div>
}
