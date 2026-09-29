import { useEffect, useState } from 'react'
import { formatArchitectElapsed, formatPlanningElapsed } from '@/features/control-tower/planPresentation'
import { AlertTriangle, Plus } from 'lucide-react'
import { TowerPanel } from './ControlTowerPrimitives'
import ControlTower from './ControlTower'
import NewRunComposer, { rowToContract } from './NewRunComposer'
import PlanReview from './PlanReview'
import RunCommand from './RunCommand'
import TowerWorkspace from './TowerWorkspace'
import { isActiveSession } from './sessionPresentation'
import { VerifierRejectionBanner } from './VerifierFailure'
import CandidateApplyPanel from './CandidateApplyPanel'
import HostRestartNotice from '@/features/control-tower/HostRestartNotice'
import { isHostUsable } from '@/features/control-tower/controlTowerAdapter'
import { useControlTowerReal, type ScopeDraft } from '@/features/control-tower/useControlTowerReal'
import { EMPTY_NEXT_RUN_ROUTING, loadNextRunRouting, type NextRunRouting } from '@/features/control-tower/nextRunRouting'

export default function ControlTowerReal(props: { pollIntervalMs?: number }) {
  const tower = useControlTowerReal({ pollIntervalMs: props.pollIntervalMs })
  const { phase, presence, plan, planError, planningStatus, planningStartedAt, providerStartedAt, approvalStatus, runHistory, draft, busy, contextError } = tower
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (phase !== 'planning') return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [phase])
  const [mode, setMode] = useState<'live' | 'preview'>('live')
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [failureFocus, setFailureFocus] = useState(0)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [routing, setRouting] = useState<NextRunRouting>(() => loadNextRunRouting(null) ?? EMPTY_NEXT_RUN_ROUTING)
  useEffect(() => { setRouting(loadNextRunRouting(presence.repoKey)) }, [presence.repoKey])
  const run = runHistory.find(item => item.runId === selectedRunId) ?? runHistory.find(isActiveSession) ?? tower.run
  useEffect(() => { setSelectedRunId(null); setSelectedId(null) }, [tower.run?.runId])
  const selectRun = (id: string) => { setSelectedRunId(id); setSelectedId(null) }
  const inspectFailure = () => {
    if (!run) return
    setSelectedRunId(run.runId)
    setSelectedId(null)
    setFailureFocus((value) => value + 1)
  }
  // CT-REL-2: healthy or merely "heartbeat delayed" (amendment 1) both count as
  // usable for NEW plan work; degraded/offline do not. Restart-required is
  // enforced Host-side — the banner below only reports it.
  const hostConnected = isHostUsable(presence)
  const hostStateLabel = presence.state === 'healthy'
    ? 'Host connected'
    : presence.state === 'delayed'
      ? 'Host heartbeat delayed'
      : presence.state === 'degraded'
        ? 'Host connection degraded'
        : 'Host offline'
  const submit = (input: ScopeDraft) => {
    setSubmitError(null)
    tower.submitScope(input).catch(error => { setSubmitError(error instanceof Error ? error.message : String(error)) })
  }
  if (mode === 'preview') return <div className="ct-container"><div className="ct-real-modetoggle"><button type="button" onClick={() => setMode('live')}>Live</button><span className="ct-preview">Preview · demo data</span></div><ControlTower /></div>
  const newRun = <button type="button" className="ct-primary" disabled={!hostConnected || busy} onClick={tower.openComposer} title={hostConnected ? 'Plan a new run' : 'Requires a connected local Host'}><Plus size={15} aria-hidden="true" />New Run</button>
  return <div className="ct-container"><main className="ct-shell ct-real ct-console" aria-label="Control Tower">
    <header className="ct-page-header"><div><p className="ct-eyebrow">PowerOn / Operations</p><h1>Control Tower</h1></div><span className={`ct-host-state ct-host-${presence.state}`}><i />{hostStateLabel}</span><button type="button" className="ct-preview-access" onClick={() => setMode('preview')}>Preview</button></header>
    <HostRestartNotice required={tower.hostRestartRequired} />
    {contextError && <section className="ct-unavailable" role="alert"><AlertTriangle size={16} aria-hidden="true" /><p>{contextError}</p></section>}

    {phase === 'composing' && <NewRunComposer presence={presence} busy={busy} draft={draft} onSubmit={submit} onCancel={tower.closeComposer} scopePacks={tower.scopePacks} scopePackRows={tower.scopePackRows} importWarning={tower.importWarning} importing={tower.importing} onImportScopePack={tower.importScopePack} surface="live" routing={routing} onRoutingChange={setRouting} />}
    {submitError && <section className="ct-unavailable" role="alert"><AlertTriangle size={16} aria-hidden="true" /><p>{submitError}</p></section>}

    {phase === 'planning' && <section className="ct-planning" aria-live="polite">
      <TowerPanel title="Planning" className="ct-planning-panel">
        <p className="ct-planning-line">{planningStatus ?? 'Request received'}</p>
        <p className="ct-planning-elapsed">{providerStartedAt ? formatArchitectElapsed(now - providerStartedAt) : planningStartedAt ? formatPlanningElapsed(now - planningStartedAt) : 'Planning · 0s'}</p>
        <p className="ct-muted">Nothing executes until you approve the plan.</p>
        <button type="button" className="ct-secondary" onClick={tower.cancelPlanReview}>Dismiss</button>
      </TowerPanel>
    </section>}

    {(phase === 'plan-error' || phase === 'approving-error') && planError && <section className="ct-unavailable" role="alert">
      <AlertTriangle size={16} aria-hidden="true" />
      <p>{planError}</p>
      {phase === 'plan-error' && <button type="button" className="ct-secondary" onClick={() => tower.retryPlanning().catch(error => { setSubmitError(error instanceof Error ? error.message : String(error)) })}>Try Planning Again</button>}
      {phase === 'approving-error' && planError.startsWith('Run could not be created.') && <button type="button" className="ct-secondary" onClick={() => tower.approvePlan().catch(error => { setSubmitError(error instanceof Error ? error.message : String(error)) })}>Try approval again</button>}
      <button type="button" className="ct-secondary" onClick={tower.editScope}>Edit Scope</button>
      <button type="button" className="ct-secondary" onClick={tower.cancelPlanReview}>{phase === 'approving-error' ? 'Cancel' : 'Dismiss'}</button>
    </section>}

    {(phase === 'plan-review' || (phase === 'approving-error' && plan)) && plan && <PlanReview plan={plan} busy={busy} onApprove={() => tower.approvePlan().catch(error => { setSubmitError(error instanceof Error ? error.message : String(error)) })} onEditScope={tower.editScope} onCancel={tower.cancelPlanReview} />}

    {phase === 'approving' && <section className="ct-planning" aria-live="polite">
      <TowerPanel title="Run starting" className="ct-planning-panel">
        <p className="ct-planning-line">{approvalStatus ?? 'Submitting approval'}</p>
        <p className="ct-muted">The run appears here only after the Host publishes it. Nothing is shown as started before that.</p>
      </TowerPanel>
    </section>}

    {phase === 'run' && approvalStatus === 'Starting tasks' && <p className="ct-planning-line" aria-live="polite">Starting tasks</p>}

    {(phase === 'run' || phase === 'idle' || phase === 'unavailable') && <>
      {run ? <RunCommand run={run} scopeTitle={tower.scopePacks[0]?.title} scopePhase={tower.scopePacks[0] ? `${tower.scopePacks[0].currentPhaseTitle ?? tower.scopePacks[0].currentPhaseId ?? ''}`.trim() || null : null} actions={<>{newRun}{isActiveSession(run) && <button type="button" className="ct-secondary" disabled={busy} onClick={() => tower.cancelRun(run.runId).catch(error => setSubmitError(error instanceof Error ? error.message : String(error)))}>Cancel Run</button>}</>} /> : <section className="ct-idle-command"><div><span className="ct-eyebrow">Ready when you are</span><h2>Plan your next run</h2><p>{hostConnected ? 'Describe the work. Review the plan before execution.' : 'No local Host is connected for this repository.'}</p></div>{newRun}</section>}
      {tower.cancelStatus && <p className="ct-planning-line" aria-live="polite">{tower.cancelStatus}</p>}
      {run?.verification === 'rejected' && <VerifierRejectionBanner run={run} onInspect={inspectFailure} />}
      {run && (run.candidateEligible || run.candidateApplied || run.candidateApplyReason || tower.applyNotice) && <CandidateApplyPanel changeCount={run.candidateCount ?? run.candidateChanges?.length ?? 0} changes={run.candidateChanges ?? []} eligible={run.candidateEligible === true} reason={run.candidateApplyReason ?? null} applied={run.candidateApplied === true} busy={busy} progress={tower.applyProgress} notice={tower.applyNotice} onApply={() => { if (run.candidateAttemptId) tower.requestApplyCandidate(run.runId, run.candidateAttemptId).catch(error => setSubmitError(error instanceof Error ? error.message : String(error))) }} />}
      {run && run.attention.some(item => item.kind !== 'verifier-rejected') && <section className="ct-attention" aria-label="Owner attention">{run.attention.filter(item => item.kind !== 'verifier-rejected').map(item => <div key={item.id}><AlertTriangle size={15} aria-hidden="true" /><span>{item.title}</span><button type="button" onClick={() => { setSelectedId(item.taskId ?? null); setSelectedRunId(run.runId) }}>Inspect</button><details className="ct-disclosure"><summary>Details</summary><p>{item.consequence}</p></details></div>)}</section>}
      <TowerWorkspace run={run} sessions={runHistory} presence={presence} selectedTaskId={selectedId} failureFocus={failureFocus} onSelectRun={selectRun} onSelectTask={(runId, taskId) => { setSelectedRunId(runId); setSelectedId(taskId) }} routing={routing} onRoutingChange={setRouting} scopePack={tower.scopePackRows[0] ? rowToContract(tower.scopePackRows[0]) : null} scopePhaseId={tower.scopePackRows[0]?.current_phase_id} scopeStorage={tower.scopeStorage} preview={false} />
    </>}
  </main></div>
}
