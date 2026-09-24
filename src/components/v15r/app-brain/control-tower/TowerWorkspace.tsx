import { useEffect, useMemo, useState } from 'react'
import type { HostPresenceView } from '@/features/control-tower/controlTowerAdapter'
import { EMPTY_NEXT_RUN_ROUTING, loadNextRunRouting, saveNextRunRouting, type NextRunRouting } from '@/features/control-tower/nextRunRouting'
import type { ScopePackContract } from '@/features/control-tower/scopePack/types'
import type { ScopeStorageState } from '@/features/control-tower/scopeStorage'
import { buildAgentTeamTopology, type TeamRoleId } from './agentTeamTopology'
import IntelligenceRail, { type IntelligenceMode } from './intelligence/IntelligenceRail'
import LinkedAppBrain from './LinkedAppBrain'
import SessionHistory from './SessionHistory'
import type { TowerSession } from './sessionPresentation'

export default function TowerWorkspace({
  run, sessions, presence, selectedTaskId, onSelectRun, onSelectTask,
  routing, onRoutingChange, scopePack, scopePhaseId, scopeStorage = 'unknown', preview = false,
}: {
  run: TowerSession | null; sessions: TowerSession[]; presence?: HostPresenceView; selectedTaskId: string | null;
  onSelectRun: (id: string) => void; onSelectTask: (runId: string, taskId: string | null) => void
  routing?: NextRunRouting
  onRoutingChange?: (next: NextRunRouting) => void
  scopePack?: ScopePackContract | null
  scopePhaseId?: string | null
  scopeStorage?: ScopeStorageState
  preview?: boolean
}) {
  const [nodeId, setNodeId] = useState<string | null>(null)
  const [selectedRoleId, setSelectedRoleId] = useState<TeamRoleId | null>(null)
  const [mode, setMode] = useState<IntelligenceMode>('team')
  const [localRouting, setLocalRouting] = useState<NextRunRouting>(() => routing ?? loadNextRunRouting(presence?.repoKey ?? null))
  useEffect(() => { setNodeId(null); setSelectedRoleId(null) }, [run?.runId])
  useEffect(() => {
    if (routing) setLocalRouting(routing)
  }, [routing])
  const team = useMemo(() => buildAgentTeamTopology(run), [run])
  const selectedTask = run?.tasks.find(task => task.id === selectedTaskId) ?? null
  const activeTask = run?.runState === 'running' ? run.tasks.find(task => task.state === 'running') : null
  const mapTask = selectedTask ?? activeTask ?? run?.tasks.find(task => task.state === 'failed')
  const selectRun = (id: string) => { setNodeId(null); setSelectedRoleId(null); onSelectRun(id) }
  const selectRole = (role: TeamRoleId | null) => { setSelectedRoleId(role); if (role) { setNodeId(null); setMode('team') } }
  const changeRouting = (next: NextRunRouting) => {
    setLocalRouting(next)
    saveNextRunRouting(presence?.repoKey ?? null, next)
    onRoutingChange?.(next)
  }
  return <div className="ct-workspace ct-console-workspace ct-workspace-atb6">
    <SessionHistory sessions={sessions} selected={run} onSelect={selectRun} onTask={(runId, taskId) => { setNodeId(null); setSelectedRoleId(null); onSelectTask(runId, taskId) }} />
    <LinkedAppBrain live={run?.provenance !== 'Preview'} scope={run?.scope || run?.objective || ''} taskTitle={mapTask?.title} taskRole={mapTask?.role} taskState={mapTask?.state} plannedAreas={mapTask?.plannedAreas ?? []} activeAreas={activeTask?.plannedAreas ?? []} activeRole={activeTask?.role} runState={run?.runState} selectedNodeId={nodeId} onSelectNode={setNodeId} team={team} teamRun={run} selectedRoleId={selectedRoleId} onSelectRole={selectRole} />
    <IntelligenceRail
      run={run}
      presence={presence}
      task={selectedTask}
      nodeId={nodeId}
      team={team}
      selectedRoleId={selectedRoleId}
      onClear={() => { setNodeId(null); setSelectedRoleId(null); if (run) onSelectTask(run.runId, null) }}
      onSelectRole={selectRole}
      onSelectNode={setNodeId}
      mode={mode}
      onModeChange={setMode}
      routing={localRouting ?? EMPTY_NEXT_RUN_ROUTING}
      onRoutingChange={changeRouting}
      scopePack={scopePack ?? null}
      scopePhaseId={scopePhaseId}
      scopeStorage={scopeStorage}
      preview={preview || run?.provenance === 'Preview'}
    />
  </div>
}
