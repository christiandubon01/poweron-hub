import { useEffect, useState } from 'react'
import { AlertTriangle, Plus } from 'lucide-react'
import { TowerPanel } from './ControlTowerPrimitives'
import ControlTower from './ControlTower'
import NewRunComposer, { rowToContract } from './NewRunComposer'
import PlanReview from './PlanReview'
import RunCommand from './RunCommand'
import TowerWorkspace from './TowerWorkspace'
import { isActiveSession } from './sessionPresentation'
import { useControlTowerReal, type ScopeDraft } from '@/features/control-tower/useControlTowerReal'
import { EMPTY_NEXT_RUN_ROUTING, loadNextRunRouting, type NextRunRouting } from '@/features/control-tower/nextRunRouting'

export default function ControlTowerReal(props: { pollIntervalMs?: number }) {
  const tower = useControlTowerReal({ pollIntervalMs: props.pollIntervalMs })
  const { phase, presence, plan, planError, runHistory, draft, busy, contextError } = tower
  const [mode, setMode] = useState<'live' | 'preview'>('live')
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [routing, setRouting] = useState<NextRunRouting>(() => loadNextRunRouting(null) ?? EMPTY_NEXT_RUN_ROUTING)
  useEffect(() => { setRouting(loadNextRunRouting(presence.repoKey)) }, [presence.repoKey])
  const run = runHistory.find(item => item.runId === selectedRunId) ?? runHistory.find(isActiveSession) ?? tower.run
  useEffect(() => { setSelectedRunId(null); setSelectedId(null) }, [tower.run?.runId])
  const selectRun = (id: string) => { setSelectedRunId(id); setSelectedId(null) }
  const hostConnected = presence.state === 'connected'
  const submit = (input: ScopeDraft) => {
    setSubmitError(null)
    tower.submitScope(input).catch(error => { setSubmitError(error instanceof Error ? error.message : String(error)) })
  }
  if (mode === 'preview') return <div className="ct-container"><div className="ct-real-modetoggle"><button type="button" onClick={() => setMode('live')}>Live</button><span className="ct-preview">Preview · demo data</span></div><ControlTower /></div>
  const newRun = <button type="button" className="ct-primary" disabled={!hostConnected || busy} onClick={tower.openComposer} title={hostConnected ? 'Plan a new run' : 'Requires a connected local Host'}><Plus size={15} aria-hidden="true" />New Run</button>
  return <div className="ct-container"><main className="ct-shell ct-real ct-console" aria-label="Control Tower">
    <header className="ct-page-header"><div><p className="ct-eyebrow">PowerOn / Operations</p><h1>Control Tower</h1></div><span className={`ct-host-state ct-host-${presence.state}`}><i />{hostConnected ? 'Host connected' : presence.state === 'stale' ? 'Host stale' : 'Host unavailable'}</span><button type="button" className="ct-preview-access" onClick={() => setMode('preview')}>Preview</button></header>
    {contextError && <section className="ct-unavailable" role="alert"><AlertTriangle size={16} aria-hidden="true" /><p>{contextError}</p></section>}

    {phase === 'composing' && <NewRunComposer presence={presence} busy={busy} draft={draft} onSubmit={submit} onCancel={tower.closeComposer} scopePacks={tower.scopePacks} scopePackRows={tower.scopePackRows} importWarning={tower.importWarning} importing={tower.importing} onImportScopePack={tower.importScopePack} surface="live" routing={routing} onRoutingChange={setRouting} />}
    {submitError && <section className="ct-unavailable" role="alert"><AlertTriangle size={16} aria-hidden="true" /><p>{submitError}</p></section>}

    {phase === 'planning' && <section className="ct-planning" aria-live="polite">
      <TowerPanel title="Planning" className="ct-planning-panel">
        <p className="ct-planning-line">The local Host Architect is reading this repository and preparing a plan.</p>
        <p className="ct-muted">This is a real provider turn — it can take a few minutes. Nothing executes until you approve the plan it produces.</p>
        <button type="button" className="ct-secondary" onClick={tower.cancelPlanReview}>Dismiss</button>
      </TowerPanel>
    </section>}

    {(phase === 'plan-error' || phase === 'approving-error') && planError && <section className="ct-unavailable" role="alert">
      <AlertTriangle size={16} aria-hidden="true" />
      <p>{planError}</p>
      <button type="button" className="ct-secondary" onClick={tower.editScope}>Edit Scope</button>
      <button type="button" className="ct-secondary" onClick={tower.cancelPlanReview}>Dismiss</button>
    </section>}

    {phase === 'plan-review' && plan && <PlanReview plan={plan} busy={busy} onApprove={() => tower.approvePlan().catch(error => { setSubmitError(error instanceof Error ? error.message : String(error)) })} onEditScope={tower.editScope} onCancel={tower.cancelPlanReview} />}

    {phase === 'approving' && <section className="ct-planning" aria-live="polite">
      <TowerPanel title="Run starting" className="ct-planning-panel">
        <p className="ct-planning-line">The approved plan is starting. The local Host is creating the Run and Tasks.</p>
        <p className="ct-muted">The live run view appears as soon as the first snapshot is published.</p>
      </TowerPanel>
    </section>}

    {(phase === 'run' || phase === 'idle' || phase === 'unavailable') && <>
      {run ? <RunCommand run={run} scopeTitle={tower.scopePacks[0]?.title} scopePhase={tower.scopePacks[0] ? `${tower.scopePacks[0].currentPhaseTitle ?? tower.scopePacks[0].currentPhaseId ?? ''}`.trim() || null : null} actions={<>{newRun}{isActiveSession(run) && <button type="button" className="ct-secondary" disabled={busy} onClick={() => tower.cancelRun(run.runId).catch(error => setSubmitError(error instanceof Error ? error.message : String(error)))}>Cancel Run</button>}</>} /> : <section className="ct-idle-command"><div><span className="ct-eyebrow">Ready when you are</span><h2>Plan your next run</h2><p>{hostConnected ? 'Describe the work. Review the plan before execution.' : 'No local Host is connected for this repository.'}</p></div>{newRun}</section>}
      {run && run.attention.length > 0 && <section className="ct-attention" aria-label="Owner attention">{run.attention.map(item => <div key={item.id}><AlertTriangle size={15} aria-hidden="true" /><span>{item.title}</span><button type="button" onClick={() => { setSelectedId(item.taskId ?? null); setSelectedRunId(run.runId) }}>Inspect</button><details className="ct-disclosure"><summary>Details</summary><p>{item.consequence}</p></details></div>)}</section>}
      <TowerWorkspace run={run} sessions={runHistory} presence={presence} selectedTaskId={selectedId} onSelectRun={selectRun} onSelectTask={(runId, taskId) => { setSelectedRunId(runId); setSelectedId(taskId) }} routing={routing} onRoutingChange={setRouting} scopePack={tower.scopePackRows[0] ? rowToContract(tower.scopePackRows[0]) : null} scopePhaseId={tower.scopePackRows[0]?.current_phase_id} scopeStorage={tower.scopeStorage} preview={false} />
    </>}
  </main></div>
}
