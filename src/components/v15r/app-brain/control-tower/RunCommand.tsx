import type { ReactNode } from 'react'
import { CT_ROLES, ChangesetSummary, RunStatus } from './ControlTowerPrimitives'
import { executionRejectedByVerifier, roleResult, sessionDuration, sessionTitle, type TowerSession } from './sessionPresentation'

export default function RunCommand({ run, actions, scopeTitle, scopePhase }: { run: TowerSession; actions: ReactNode; scopeTitle?: string | null; scopePhase?: string | null }) {
  const passed = run.tasks.filter(task => task.state === 'passed').length
  const active = run.runState === 'running' && run.tasks.some(task => task.state === 'running')
  const rejected = executionRejectedByVerifier(run)
  const statusNote = rejected
    ? 'Execution completed'
    : run.provenance === 'Preview' ? 'Preview · demo data' : active ? `${run.currentRole} active` : run.runState === 'paused' ? 'Owner attention required' : 'Selected session'
  return <section className={`ct-run ct-command ct-run-state-${run.runState}`} aria-label="Run command">
    <div className="ct-command-main"><div className="ct-command-status">{rejected ? <span className="ct-status ct-state-failed">Verification failed</span> : <RunStatus state={run.runState} />}<span>{statusNote}</span>{scopeTitle && <span className="ct-command-scope">{scopeTitle}{scopePhase ? ` · ${scopePhase}` : ''}</span>}</div><h2 title={sessionTitle(run)}>{sessionTitle(run)}</h2></div>
    <div className="ct-command-actions">{actions}</div>
    <div className="ct-command-footer"><div className="ct-stage-progress" aria-label="Architect to Implementer to Verifier progression">{CT_ROLES.map((role, index) => <span key={role} className={`ct-stage ct-result-${roleResult(run, role).toLowerCase()}`} title={`${role}: ${roleResult(run, role)}`}>{index > 0 && <i aria-hidden="true">→</i>}<b>{role}</b><span>{roleResult(run, role) === 'Passed' ? '✓' : roleResult(run, role) === 'Failed' ? '×' : ''}</span></span>)}</div><span className="ct-command-count">{rejected ? `${run.tasks.length} tasks executed` : `${passed}/${run.tasks.length} tasks passed`}</span>{rejected ? <span className="ct-changeset">Candidate rejected</span> : <ChangesetSummary state={run.changeset} />}{sessionDuration(run) && <span>{sessionDuration(run)}</span>}</div>
  </section>
}
