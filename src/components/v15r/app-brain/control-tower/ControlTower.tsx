import { useMemo, useState } from 'react'
import { CONTROL_TOWER_SCENARIOS } from './controlTowerPreview'
import RunCommand from './RunCommand'
import TowerWorkspace from './TowerWorkspace'
import { PREVIEW_SCOPE_PACK } from '@/features/control-tower/scopePack/preview'
import { PREVIEW_PROVIDER_FLEET } from '@/features/control-tower/previewFleet'
import { EMPTY_NEXT_RUN_ROUTING, type NextRunRouting } from '@/features/control-tower/nextRunRouting'
import type { HostPresenceView } from '@/features/control-tower/controlTowerAdapter'
import type { TowerSession } from './sessionPresentation'

const sessions: TowerSession[] = Object.entries(CONTROL_TOWER_SCENARIOS).map(([id, fixture]) => ({ ...fixture, runId: `preview-${id}`, publishedAt: '', title: 'Invoice draft editing' }))
const completed = sessions.find(item => item.runId === 'preview-completed')!
sessions.push({
  ...completed, runId: 'preview-failed', title: 'Invoice validation review', runState: 'failed', verification: 'rejected', verificationSummary: 'Preview example: approval boundary check did not pass.',
  tasks: completed.tasks.map(task => task.role === 'Verifier' ? { ...task, state: 'failed', summary: 'Attempt 1 failed · approval boundary check', attempt: 'Attempt 1 · failed at snapshot' } : task),
  interimVerdicts: [
    { verdictId: 'f-verify-fail', role: 'verifier', taskId: 't-verify', attemptId: 'a-verify', state: 'FAIL', summary: 'Independent verification failed: an edit bypassed the approval boundary.', evidenceRefs: [], evidenceCount: 4, severity: 'critical', recommendedAction: 'cancel', mayContinue: false, timestamp: '2026-09-22T11:31:00Z' },
  ],
  handoffs: [
    { handoffId: 'f-h-result', from: 'verifier', to: 'owner', taskId: 't-verify', payloadType: 'run-result', summary: 'Run failed — approval boundary violated', evidenceCount: 1, status: 'delivered', timestamp: '2026-09-22T11:32:00Z', latencyMs: 140, resultingVerdict: 'FAIL' },
  ],
  signals: [
    { signalId: 'f-s-boundary', category: 'protected-path', severity: 'critical', source: 'guard', taskId: 't-verify', attemptId: 'a-verify', message: 'A candidate change touched a protected approval path. Verification failed.', evidenceCount: 3, evidenceRefs: [], firstSeen: '2026-09-22T11:30:00Z', lastSeen: '2026-09-22T11:31:00Z', resolvedAt: null, ownerActionRequired: true },
  ],
})

const PREVIEW_PRESENCE: HostPresenceView = {
  state: 'unavailable',
  repoKey: null,
  providers: PREVIEW_PROVIDER_FLEET.map((item) => item.providerDisplayName),
  providerFleet: PREVIEW_PROVIDER_FLEET,
  hostVersion: 'preview',
  lastSeenAt: null,
  hostInstanceId: null,
}

export default function ControlTower() {
  const [runId, setRunId] = useState(sessions[0].runId)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [routing, setRouting] = useState<NextRunRouting>(EMPTY_NEXT_RUN_ROUTING)
  const run = sessions.find(item => item.runId === runId)!
  const scopePack = useMemo(() => PREVIEW_SCOPE_PACK, [])
  return <div className="ct-container"><main className="ct-shell ct-console" aria-label="Control Tower preview">
    <header className="ct-page-header"><h1>Control Tower <span className="ct-preview">Preview</span></h1><p className="ct-muted">Demo sessions · no live execution or usage data</p></header>
    <RunCommand run={run} scopeTitle={scopePack.title} scopePhase={`${scopePack.roadmapPhases[0]?.id ?? ''} · ${scopePack.roadmapPhases[0]?.executionIntent ?? 'audit'}`} actions={<label className="ct-scenario">Scenario<select aria-label="Preview snapshot" value={runId} onChange={event => { setRunId(event.target.value); setTaskId(null) }}><option value="preview-working">Work in progress</option><option value="preview-gate">Owner gate</option><option value="preview-verify">Verification active</option><option value="preview-completed">Completed</option><option value="preview-failed">Failed</option></select></label>} />
    {run.attention.length > 0 && <section className="ct-attention"><p>{run.attention[0].title}</p><p className="ct-muted">Preview gate · approval and execution unavailable</p></section>}
    <TowerWorkspace run={run} sessions={sessions} presence={PREVIEW_PRESENCE} selectedTaskId={taskId} onSelectRun={id => { setRunId(id); setTaskId(null) }} onSelectTask={(id, task) => { setRunId(id); setTaskId(task) }} routing={routing} onRoutingChange={setRouting} scopePack={scopePack} scopePhaseId={scopePack.currentPhaseId} scopeStorage="ready" preview />
  </main></div>
}
