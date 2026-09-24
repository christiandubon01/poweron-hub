import { useEffect, useState } from 'react'
import { ChevronDown, History } from 'lucide-react'
import { CT_ROLES, RunStatus, TowerPanel } from './ControlTowerPrimitives'
import { conciseTime, isActiveSession, roleResult, sessionDuration, sessionTitle, type TowerSession } from './sessionPresentation'

type Filter = 'active' | 'completed' | 'failed' | 'cancelled'
const filterFor = (run?: TowerSession | null): Filter => run && !isActiveSession(run) ? run.runState as Filter : 'active'
export default function SessionHistory({ sessions, selected, onSelect, onTask }: {
  sessions: TowerSession[]; selected: TowerSession | null; onSelect: (id: string) => void; onTask: (runId: string, taskId: string) => void
}) {
  const [filter, setFilter] = useState<Filter>(filterFor(selected))
  const [expanded, setExpanded] = useState<string | null>(null)
  useEffect(() => { setFilter(filterFor(selected)) }, [selected?.runId, selected?.runState])
  const matches = (run: TowerSession, value: Filter) => value === 'active' ? isActiveSession(run) : run.runState === value
  const visible = sessions.filter(run => matches(run, filter))
  return <TowerPanel title="Session History" className="ct-history" action={<History size={16} aria-hidden="true" />}>
    <nav className="ct-history-filters" aria-label="Session history filters">
      {(['active', 'completed', 'failed', 'cancelled'] as const).map(value => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
        <span>{ { active: 'Active', completed: 'Completed Runs', failed: 'Failed Runs', cancelled: 'Cancelled' }[value]}</span><span className="ct-count">{sessions.filter(run => matches(run, value)).length}</span>
      </button>)}
    </nav>
    <div className="ct-history-list">
      {!visible.length && <div className="ct-empty"><History size={24} aria-hidden="true" /><h3>No {filter === 'active' ? 'active sessions' : `${filter} runs`}</h3><p>{filter === 'active' ? 'New work will appear here when a run starts.' : 'No matching sessions in the published history.'}</p></div>}
      {visible.map(run => <article key={run.runId} className={`ct-session ct-session-${run.runState} ${selected?.runId === run.runId ? 'ct-session-selected' : ''}`}>
        <button type="button" className="ct-session-select" onClick={() => onSelect(run.runId)} aria-pressed={selected?.runId === run.runId}>
          <span className="ct-session-meta"><RunStatus state={run.runState} /><time>{conciseTime(run.completedAt || run.startedAt || run.publishedAt)}</time></span>
          <strong title={sessionTitle(run)}>{sessionTitle(run)}</strong>
          <span className="ct-session-results">{CT_ROLES.map(role => <span key={role} title={`${role}: ${roleResult(run, role)}`}><b>{role.slice(0, 1)}</b><span className={`ct-result-${roleResult(run, role).toLowerCase().replace(' ', '-')}`}>{roleResult(run, role)}</span></span>)}</span>
          <span className="ct-session-meta"><span>{run.tasks.filter(task => task.state === 'passed').length}/{run.tasks.length} passed{run.tasks.some(task => task.state === 'failed') && ` · ${run.tasks.filter(task => task.state === 'failed').length} failed`}</span><span>{sessionDuration(run)}</span></span>
          {run.runState === 'failed' && <span className="ct-failure-summary">{run.tasks.find(task => task.state === 'failed')?.role ?? 'Run'} · {run.verificationSummary || run.tasks.find(task => task.state === 'failed')?.title || 'Failure detail not reported'}</span>}
          {(() => {
          const models = [...new Set(run.tasks.filter(task => task.reported.state === 'reported').map(task => task.reported.model).filter(Boolean))] as string[]
          if (!models.length) return null
          // Card stays scannable; full reported-model truth remains in the hover title and System Intelligence.
          return <span className="ct-history-model" title={models.join(' · ')}>{models.length > 2 ? models.slice(0, 2).join(' · ') + ' · +' + (models.length - 2) : models.join(' · ')}</span>
        })()}
        </button>
        <button className="ct-session-expand" type="button" aria-expanded={expanded === run.runId} aria-controls={`session-${run.runId}`} onClick={() => setExpanded(expanded === run.runId ? null : run.runId)}>Session details<ChevronDown size={14} aria-hidden="true" /></button>
        {expanded === run.runId && <div id={`session-${run.runId}`} className="ct-session-details">
          <dl className="ct-facts"><div><dt>Created</dt><dd>{conciseTime(run.createdAt)}</dd></div><div><dt>Started</dt><dd>{conciseTime(run.startedAt)}</dd></div><div><dt>Completed</dt><dd>{conciseTime(run.completedAt)}</dd></div><div><dt>Attempts</dt><dd>{run.attemptCount ?? 'Not reported'}</dd></div><div><dt>Candidate files</dt><dd>{run.candidateCount ?? 'Not reported'}</dd></div></dl>
          <p className="ct-muted">{run.changeset === 'not-applied' ? 'Changes not applied · isolated candidate' : 'No candidate changes reported'}</p>
          <div className="ct-session-task-list">{run.tasks.map(task => <button key={task.id} type="button" onClick={() => onTask(run.runId, task.id)}><span>{task.title}</span><span className={`ct-state-${task.state}`}>{task.state.replace('pending-', '')}</span></button>)}</div>
          {run.attention.map(item => <p key={item.id} className="ct-muted">{item.consequence}</p>)}
          <details className="ct-disclosure"><summary>Run identifier</summary><code>{run.runId}</code></details>
        </div>}
      </article>)}
    </div>
    <footer className="ct-history-footer">{sessions[0]?.provenance === 'Preview' ? 'Preview fixtures · no execution' : 'Recent Host-published sessions'}<span>A · Architect / I · Implementer / V · Verifier</span></footer>
  </TowerPanel>
}
