import { Cpu, Gauge, ShieldCheck } from 'lucide-react'
import { getAppBrainNode } from '../../../appBrainMap'
import { CT_ROLES, ProviderModelBadge, TaskStatus } from '../ControlTowerPrimitives'
import { conciseTime, roleResult, sessionDuration, type TowerSession } from '../sessionPresentation'
import { TEAM_ROLE_LABEL, teamNodeByRole, type AgentTeamTopology, type TeamRoleId, type TeamRoleNode } from '../agentTeamTopology'
import type { PreviewTask } from '../controlTowerTypes'

const VERDICT_ACTION: Record<string, string> = {
  none: 'No action recommended', watch: 'Watch and continue', 'owner-review': 'Owner review recommended',
  cancel: 'Cancel recommended', 'approve-gate': 'Owner approval required',
}

function TeamRoleDetail({ roleNode, team, run }: { roleNode: TeamRoleNode; team: AgentTeamTopology; run: TowerSession | null }) {
  const node = roleNode
  const handoffHistory = team.edges
    .filter((edge) => edge.from === node.role || edge.to === node.role)
    .slice()
    .reverse()
    .slice(0, 6)
  return <>
    <section className="ct-intelligence-section"><span className="ct-eyebrow">{node.deterministic ? 'Deterministic orchestration' : 'Model-backed role'}</span>
      <h3>{node.label} · {node.state.replace('_', ' ').toLowerCase()}</h3>
      <p>{node.deterministic
        ? node.role === 'host' ? 'The Host is deterministic supervisor orchestration — it sequences work, it does not reason with a model.' : 'The Guard is deterministic policy enforcement — it never runs a model.'
        : node.taskLabel ? `Working on: ${node.taskLabel}` : 'No task reported for this role.'}</p>
    </section>
    {node.deterministic ? <dl className="ct-facts ct-model-facts">
      <div><dt>Provider</dt><dd>Not applicable</dd></div>
      <div><dt>Model</dt><dd>Not applicable</dd></div>
      <div><dt>Effort</dt><dd>Not applicable</dd></div>
    </dl> : <dl className="ct-facts ct-model-facts">
      <div><dt>Configured identity</dt><dd>{node.identity ?? 'Not reported'}</dd></div>
      <div><dt>Provider</dt><dd>{node.provider ?? 'Not reported'}</dd></div>
      <div><dt>Requested model</dt><dd>{node.requestedModel ?? 'Not reported'}</dd></div>
      <div><dt>Reported model</dt><dd>{node.reportedModel ?? 'Not reported'}</dd></div>
      <div><dt>Effort</dt><dd>{node.effort ?? 'Not reported'}</dd></div>
    </dl>}
    <section className="ct-intelligence-section"><h4>Current work</h4>
      <dl className="ct-facts">
        <div><dt>Objective</dt><dd>{run?.objective || 'Not reported'}</dd></div>
        {node.taskAttempt && <div><dt>Attempt</dt><dd>{node.taskAttempt}</dd></div>}
        <div><dt>Handoffs waiting</dt><dd>{node.handoffsWaiting}</dd></div>
        <div><dt>Last activity</dt><dd>{conciseTime(node.lastActivityAt)}</dd></div>
        {node.role === 'host' && node.hostFacts && <>
          <div><dt>Lifecycle</dt><dd>{node.hostFacts.lifecycleStage}</dd></div>
          <div><dt>Outstanding gate</dt><dd>{node.hostFacts.outstandingGate ? 'Yes' : 'None'}</dd></div>
          <div><dt>Recent handoffs</dt><dd>{node.hostFacts.recentHandoffCount}</dd></div>
        </>}
        {node.role === 'guard' && node.guardFacts && <>
          <div><dt>Highest severity</dt><dd>{node.guardFacts.highestSeverity ?? 'None'}</dd></div>
          <div><dt>Owner action</dt><dd>{node.guardFacts.ownerAction ? 'Required' : 'Not required'}</dd></div>
        </>}
      </dl>
    </section>
    <section className="ct-intelligence-section"><h4>Latest interim verdict</h4>
      {node.verdict ? <div className="ct-team-verdict-detail">
        <span className={`ct-team-verdict ct-team-verdict--${node.verdict.state.toLowerCase().replace('_', '-')}`}>{node.verdict.state}</span>
        <p>{node.verdict.summary || 'No summary published.'}</p>
        <dl className="ct-facts">
          <div><dt>Severity</dt><dd>{node.verdict.severity}</dd></div>
          <div><dt>Recommended action</dt><dd>{VERDICT_ACTION[node.verdict.recommendedAction] ?? node.verdict.recommendedAction}</dd></div>
          <div><dt>May continue</dt><dd>{node.verdict.mayContinue ? 'Yes' : 'No'}</dd></div>
          <div><dt>Evidence</dt><dd>{node.verdict.evidenceCount} references</dd></div>
          <div><dt>Timestamp</dt><dd>{conciseTime(node.verdict.timestamp)}</dd></div>
        </dl>
      </div> : <p className="ct-muted">No interim verdict published for this role.</p>}
    </section>
    <section className="ct-intelligence-section"><h4>Recent handoffs</h4>
      {handoffHistory.length === 0 ? <p className="ct-muted">No handoffs reported involving this member.</p> : <ul className="ct-team-handoff-history">
        {handoffHistory.map((edge) => <li key={edge.handoffId}>
          <span className="ct-team-handoff-route">{TEAM_ROLE_LABEL[edge.from as TeamRoleId] ?? 'Owner'} → {TEAM_ROLE_LABEL[edge.to as TeamRoleId] ?? 'Owner'}</span>
          <span className={`ct-team-handoff-status ct-team-handoff-status--${edge.status}`}>{edge.status}</span>
          <span className="ct-team-handoff-summary">{edge.payloadType}{edge.summary ? ` · ${edge.summary}` : ''}{edge.resultingVerdict ? ` · verdict ${edge.resultingVerdict}` : ''}</span>
          <span className="ct-team-handoff-time">{conciseTime(edge.timestamp)}</span>
        </li>)}
      </ul>}
    </section>
    {node.role === 'guard' && <section className="ct-intelligence-section"><h4><ShieldCheck size={15} aria-hidden="true" />Guard signals</h4>
      {team.guardSignals.length === 0 ? <p className="ct-muted">No signals reported.</p> : <ul className="ct-team-signal-list">
        {team.guardSignals.map((signal) => <li key={signal.signalId}>
          <span className={`ct-team-signal-severity ct-team-signal-severity--${signal.severity}`}>{signal.severity}</span>
          <span className="ct-team-signal-category">{signal.category}</span>
          <span className="ct-team-signal-message">{signal.message || 'No safe message published.'}</span>
          <dl className="ct-facts">
            <div><dt>Source</dt><dd>{signal.source}</dd></div>
            <div><dt>Evidence</dt><dd>{signal.evidenceCount}</dd></div>
            <div><dt>First seen</dt><dd>{conciseTime(signal.firstSeen)}</dd></div>
            <div><dt>Last seen</dt><dd>{conciseTime(signal.lastSeen)}</dd></div>
            <div><dt>Owner action</dt><dd>{signal.ownerActionRequired ? 'Required' : 'Not required'}</dd></div>
            <div><dt>Resolved</dt><dd>{signal.resolvedAt ? conciseTime(signal.resolvedAt) : 'Open'}</dd></div>
          </dl>
        </li>)}
      </ul>}
    </section>}
  </>
}

function TeamOverview({ team, onSelect }: { team: AgentTeamTopology; onSelect: (role: TeamRoleId) => void }) {
  return <ul className="ct-team-overview" aria-label="Team overview">
    {team.nodes.map((node) => {
      const chip = node.deterministic ? 'Not applicable' : [node.provider, node.reportedModel ?? node.requestedModel, node.effort].filter(Boolean).join(' · ') || 'Model not published'
      return <li key={node.role}>
        <button type="button" className={`ct-team-row ct-team-row--${node.state.toLowerCase().replace('_', '-')}`} onClick={() => onSelect(node.role)} aria-label={`${node.label} ${node.state.toLowerCase().replace('_', ' ')}`}>
          <span className="ct-team-row-name">{node.label}</span>
          <span className={`ct-team-node-state ct-team-state-${node.state.toLowerCase().replace('_', '-')}`}>{node.state.replace('_', ' ')}</span>
          <span className="ct-team-row-verdict">{node.verdict ? node.verdict.state : '—'}</span>
          {node.signalCount > 0 && <span className={`ct-team-badge ${node.ownerSignalCount > 0 ? 'ct-team-badge--owner' : 'ct-team-badge--warning'}`}>{node.signalCount}</span>}
          <span className="ct-team-row-model">{chip}</span>
        </button>
      </li>
    })}
  </ul>
}

export default function TeamMode({ run, task, nodeId, team, selectedRoleId, onSelectRole }: {
  run: TowerSession | null
  task: PreviewTask | null
  nodeId: string | null
  team: AgentTeamTopology | null
  selectedRoleId: TeamRoleId | null
  onSelectRole: (role: TeamRoleId | null) => void
}) {
  const node = getAppBrainNode(nodeId)
  const roleNode = team && selectedRoleId ? teamNodeByRole(team, selectedRoleId) : null
  const active = run?.runState === 'running' ? run.tasks.find(item => item.state === 'running') : null
  const relevant = task ?? active ?? run?.tasks.find(item => item.role === run.currentRole)
  if (roleNode && team) return <TeamRoleDetail roleNode={roleNode} team={team} run={run} />
  if (node) return <>
    <section className="ct-intelligence-section"><span className="ct-eyebrow">{node.ownerArea}</span><h3>{node.label}</h3><p>{node.description}</p></section>
    <section className="ct-intelligence-section"><h4>Connected systems</h4><p>{node.connectedSystems.join(' · ')}</p></section>
    <details className="ct-disclosure" open><summary>Files &amp; edit guidance</summary><p>{node.safeEditGuidance}</p><ul>{node.relatedFiles.map(file => <li key={file}><code>{file}</code></li>)}</ul></details>
    <p className="ct-muted">Architecture relationships describe the app. Activity is shown only when published planned areas match.</p>
  </>
  return <>
    {task && <section className="ct-intelligence-section"><h3>{task.title}</h3><TaskStatus state={task.state} freshness={run?.provenance === 'Preview' ? 'Snapshot' : 'Last reported'} /><p>{task.detail}</p><p>{task.attempt}</p><details className="ct-disclosure"><summary>Dependencies &amp; model evidence</summary><p>{task.dependencies}</p><ProviderModelBadge identity={task.requested} /><ProviderModelBadge identity={task.reported} /><p>Requested configuration is never reported as the model used.</p></details></section>}
    <section className="ct-intelligence-section ct-ai-identity">
      <div className="ct-ai-symbol"><Cpu size={21} aria-hidden="true" /></div>
      <div>
        <span className="ct-eyebrow">{active ? 'Active AI' : 'Session routing'}</span>
        <h3>{relevant?.role ?? 'Ready for work'}</h3>
        <p>{active ? 'Executing reported task' : run ? 'No active execution' : 'No session selected'}</p>
      </div>
    </section>
    {team && <TeamOverview team={team} onSelect={onSelectRole} />}
    <section className="ct-intelligence-section"><h4>Role / model routing</h4><div className="ct-routing">{CT_ROLES.map(role => {
      const roleTasks = run?.tasks.filter(item => item.role === role) ?? []
      const models = [...new Set(roleTasks.map(item => item.requested.state === 'requested' ? item.requested.model : null).filter(Boolean))]
      return <div key={role}><span><b>{role}</b>{models.length > 0 && <small>Requested · {models.join(', ')}</small>}</span><span className={`ct-result-${run ? roleResult(run, role).toLowerCase() : ''}`}>{run ? roleResult(run, role) : '—'}</span></div>
    })}</div></section>
    {run && <section className="ct-intelligence-section"><h4><Gauge size={15} aria-hidden="true" />Session stats</h4><dl className="ct-stats"><div><dt>Passed / tasks</dt><dd>{run.tasks.filter(item => item.state === 'passed').length}<small> / {run.tasks.length}</small></dd></div><div><dt>Attempts</dt><dd>{run.attemptCount ?? '—'}</dd></div><div><dt>Elapsed</dt><dd>{sessionDuration(run) ?? '—'}</dd></div><div><dt>Candidate files</dt><dd>{run.candidateCount ?? '—'}</dd></div></dl></section>}
  </>
}
