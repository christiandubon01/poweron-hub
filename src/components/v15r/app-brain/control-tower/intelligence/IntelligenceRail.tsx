import { useState, type KeyboardEvent } from 'react'
import { ArrowLeft, Cpu } from 'lucide-react'
import type { HostPresenceView } from '@/features/control-tower/controlTowerAdapter'
import type { NextRunRouting } from '@/features/control-tower/nextRunRouting'
import type { ScopeStorageState } from '@/features/control-tower/scopeStorage'
import type { ScopePackContract } from '@/features/control-tower/scopePack/types'
import { TowerPanel } from '../ControlTowerPrimitives'
import type { PreviewTask } from '../controlTowerTypes'
import type { AgentTeamTopology, TeamRoleId } from '../agentTeamTopology'
import type { TowerSession } from '../sessionPresentation'
import TeamMode from './TeamMode'
import ModelsMode from './ModelsMode'
import SignalsMode from './SignalsMode'
import ScopeMode from './ScopeMode'

export const INTELLIGENCE_MODES = ['team', 'models', 'signals', 'scope'] as const
export type IntelligenceMode = (typeof INTELLIGENCE_MODES)[number]
const MODE_LABEL: Record<IntelligenceMode, string> = {
  team: 'TEAM',
  models: 'MODELS',
  signals: 'SIGNALS',
  scope: 'SCOPE',
}

export default function IntelligenceRail({
  run, presence, task, nodeId, team, selectedRoleId, onClear, onSelectRole, onSelectNode,
  mode, onModeChange, routing, onRoutingChange, scopePack, scopePhaseId, scopeStorage, preview,
}: {
  run: TowerSession | null
  presence?: HostPresenceView
  task: PreviewTask | null
  nodeId: string | null
  team?: AgentTeamTopology | null
  selectedRoleId?: TeamRoleId | null
  onClear: () => void
  onSelectRole: (role: TeamRoleId | null) => void
  onSelectNode: (id: string | null) => void
  mode: IntelligenceMode
  onModeChange: (mode: IntelligenceMode) => void
  routing: NextRunRouting
  onRoutingChange: (next: NextRunRouting) => void
  scopePack: ScopePackContract | null
  scopePhaseId?: string | null
  scopeStorage: ScopeStorageState
  preview: boolean
}) {
  const [focusIndex, setFocusIndex] = useState(0)
  const roleNode = team && selectedRoleId
  const nodeSelected = Boolean(nodeId)
  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const delta = event.key === 'ArrowRight' ? 1 : -1
    const next = (INTELLIGENCE_MODES.indexOf(mode) + delta + INTELLIGENCE_MODES.length) % INTELLIGENCE_MODES.length
    onModeChange(INTELLIGENCE_MODES[next])
    setFocusIndex(next)
  }
  const title = roleNode && mode === 'team' ? 'Team detail' : nodeSelected && mode === 'team' ? 'Architecture detail' : task && mode === 'team' ? 'Task detail' : 'Intelligence'
  return <TowerPanel title={title} className="ct-intelligence ct-inspector" action={<Cpu size={16} aria-hidden="true" />}>
    <div className="ct-intel-tabs" role="tablist" aria-label="Intelligence modes" onKeyDown={onTabKey}>
      {INTELLIGENCE_MODES.map((item, index) => (
        <button
          key={item}
          type="button"
          role="tab"
          id={`ct-intel-tab-${item}`}
          aria-selected={mode === item}
          aria-controls={`ct-intel-panel-${item}`}
          tabIndex={mode === item ? 0 : -1}
          onClick={() => { onModeChange(item); setFocusIndex(index) }}
          data-focus={focusIndex === index || undefined}
        >{MODE_LABEL[item]}</button>
      ))}
    </div>
    <div className="ct-intelligence-body" id={`ct-intel-panel-${mode}`} role="tabpanel" aria-labelledby={`ct-intel-tab-${mode}`}>
      {(roleNode || nodeSelected || task) && mode === 'team' && <button type="button" className="ct-intelligence-back" onClick={onClear}><ArrowLeft size={14} aria-hidden="true" />Intelligence</button>}
      {mode === 'team' && <TeamMode run={run} task={task} nodeId={nodeId} team={team ?? null} selectedRoleId={selectedRoleId ?? null} onSelectRole={onSelectRole} />}
      {mode === 'models' && <ModelsMode presence={presence} routing={routing} onRoutingChange={onRoutingChange} preview={preview} />}
      {mode === 'signals' && <SignalsMode run={run} onSelectRole={onSelectRole} onSelectNode={onSelectNode} />}
      {mode === 'scope' && <ScopeMode pack={scopePack} selectedPhaseId={scopePhaseId} storage={scopeStorage} preview={preview} />}
    </div>
  </TowerPanel>
}
