import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { ProviderModelBadge, RoleBadge, TowerPanel } from './ControlTowerPrimitives'
import type { PlanReviewModel } from '@/features/control-tower/controlTowerAdapter'
import { elevatedChanges, planFactChips, planSummaryLines, taskPathCount, verificationRequirements } from '@/features/control-tower/planPresentation'

interface Props {
  plan: PlanReviewModel
  busy: boolean
  onApprove: () => void
  onEditScope: () => void
  onCancel: () => void
}

/**
 * CT-CORE-1 plan review, with a compact owner summary. Full task and
 * verification detail stays available by expansion.
 */
export default function PlanReview({ plan, busy, onApprove, onEditScope, onCancel }: Props) {
  const [acknowledged, setAcknowledged] = useState(false)
  const needsAck = plan.approval?.requiresStaleAcknowledgment === true || plan.approval?.requiresOwnerReview === true
  const audit = plan.executionIntent === 'audit' || plan.executionIntent === 'research'
  const canApprove = !busy && (!needsAck || acknowledged || audit)
  const elevated = elevatedChanges(plan)
  const checks = verificationRequirements(plan)
  const inspected = plan.planningEvidence?.inspectedFiles ?? []
  const revision = plan.planRevision
  return <TowerPanel title="Awaiting approval" className="ct-plan-review" action={<span className="ct-eyebrow ct-amber">Owner decision</span>}>
    <div className="ct-plan-body">
      <div className="ct-plan-intro">
        <p className="ct-authority"><ShieldCheck size={15} aria-hidden="true" />Nothing has executed yet. Approving this exact plan starts the Run.</p>
        {revision && revision.version > 1 && <p className="ct-plan-revision">Plan v{revision.version}</p>}
        {revision && revision.version > 1 && revision.changes.length > 0 && <div className="ct-plan-changed">
          <span className="ct-eyebrow">What changed</span>
          <ul>{revision.changes.map(change => <li key={change}>{change}</li>)}</ul>
        </div>}
        <ul className="ct-plan-summary" aria-label="Plan summary">
          {planSummaryLines(plan).map(line => <li key={line}>{line}</li>)}
        </ul>
        <ul className="ct-plan-facts" aria-label="Plan facts">
          {planFactChips(plan).map(chip => <li key={chip}>{chip}</li>)}
        </ul>
        <div className="ct-plan-elevated" aria-label="Elevated changes">
          <span className="ct-eyebrow">Elevated changes</span>
          {elevated.length === 0
            ? <p>No elevated changes</p>
            : <ul>{elevated.map(item => <li key={item}>{item}</li>)}</ul>}
        </div>
      </div>
      <ol className="ct-plan-tasks">
        {plan.tasks.map((task, index) => <li key={task.clientTaskKey} className="ct-plan-task">
          <details>
            <summary className="ct-plan-task-head">
              <span className="ct-plan-task-index">T{index + 1}</span>
              <RoleBadge role={task.role} />
              <h3>{task.title}</h3>
              <span className="ct-plan-task-provider">{taskPathCount(task)} authorized paths</span>
            </summary>
            <p className="ct-plan-task-goal">{task.goal}</p>
            <dl className="ct-plan-task-meta">
              <div><dt>Depends on</dt><dd>{task.dependencies.length > 0 ? task.dependencies.join(', ') : 'None'}</dd></div>
              <div><dt>Authorized write paths</dt><dd>{task.authorizedWritePaths.length > 0 ? task.authorizedWritePaths.join(', ') : 'Read-only — no writes'}</dd></div>
              <div><dt>Planned areas</dt><dd>{task.plannedAreas.length > 0 ? task.plannedAreas.join(', ') : 'None reported'}</dd></div>
              <div><dt>Verifier checks</dt><dd>{task.validationRequirements.length > 0 ? task.validationRequirements.join('; ') : 'None reported'}</dd></div>
              <div><dt>Provider</dt><dd>{task.provider}{task.requestedModel ? ` · requested ${task.requestedModel}` : ''}</dd></div>
            </dl>
          </details>
        </li>)}
      </ol>
      <details className="ct-plan-verification">
        <summary>Verification contract</summary>
        {checks.length > 0 ? <ul>{checks.map(check => <li key={check}>{check}</li>)}</ul> : <p>No verification checks were reported.</p>}
      </details>
      {inspected.length > 0 && <details className="ct-plan-inspected">
        <summary>Architect inspected {inspected.length} relevant {inspected.length === 1 ? 'file' : 'files'}</summary>
        <ul>{inspected.map(file => <li key={file}><code>{file}</code></li>)}</ul>
      </details>}
      <details className="ct-disclosure">
        <summary>Full plan text</summary>
        <div className="ct-plan-objective">
          <span className="ct-eyebrow">Architect interpretation</span>
          <p>{plan.objective}</p>
        </div>
        {plan.constraints.length > 0 && <div className="ct-plan-constraints">
          <span className="ct-eyebrow">Constraints</span>
          <ul>{plan.constraints.map((constraint, index) => <li key={index}>{constraint}</li>)}</ul>
        </div>}
        {plan.riskSummary && <div className="ct-plan-risk">
          <span className="ct-eyebrow">Risks &amp; assumptions</span>
          <p>{plan.riskSummary}</p>
        </div>}
        {plan.architect && <div className="ct-plan-architect">
          <span className="ct-eyebrow">Architect model truth</span>
          <p className="ct-models">
            <ProviderModelBadge identity={plan.architect.requestedModel ? { state: 'requested', provider: plan.architect.provider, model: plan.architect.requestedModel } : { state: 'unavailable' }} />
            <ProviderModelBadge identity={plan.architect.reportedModel ? { state: 'reported', provider: plan.architect.provider, model: plan.architect.reportedModel } : { state: 'unreported' }} />
          </p>
          <span className="ct-field-note">Requested configuration is never reported as the model used.</span>
        </div>}
      </details>
      {plan.architectVerdict && <div className="ct-scope-verdict" aria-label="Architect verdict">
        <span className="ct-eyebrow">Architect verdict · {plan.architectVerdict.state}</span>
        <p>{plan.architectVerdict.summary}</p>
        {plan.reconciliationState && <p className="ct-field-note">Scope Pack reconciliation · {plan.reconciliationState.toUpperCase()}</p>}
      </div>}
      {plan.executionIntent === 'audit' || plan.executionIntent === 'research' ? <p className="ct-field-note">Read-only audit phase — accepting records the Architect result. No Implementer task is created.</p> : null}
      {plan.approval?.requiresOwnerReview && <p className="ct-scope-error" role="alert">CONFLICT: review the Scope Pack before implementation can be approved.</p>}
      {plan.approval?.requiresStaleAcknowledgment && <p className="ct-scope-warning" role="status">STALE: historical foundation has changed.</p>}
      {plan.reconciliationState === 'unverified' && <p className="ct-scope-warning" role="status">UNVERIFIED claims are visible. They have not been silently accepted.</p>}
      {needsAck && !audit && <label className="ct-scope-ack"><input type="checkbox" aria-label="Acknowledge Scope Pack reconciliation" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /> {plan.approval?.requiresOwnerReview ? 'Accept current repository truth and supersede the conflicting claim.' : 'Acknowledge the stale Scope Pack foundation.'}</label>}
      <div className="ct-plan-actions">
        <button type="button" className="ct-primary" disabled={!canApprove} onClick={onApprove} aria-label={audit ? 'Accept audit' : 'Approve Run'}>{audit ? 'Accept audit' : 'Approve Run'}</button>
        <button type="button" className="ct-secondary" onClick={onEditScope}>Edit Scope</button>
        <button type="button" className="ct-secondary" onClick={onCancel}>Cancel</button>
        <span className="ct-field-note">Approve Run references this exact plan ({plan.planHash.slice(0, 12)}…). A changed plan will not start.</span>
      </div>
      <details className="ct-disclosure"><summary>Plan identity</summary><code>Plan · {plan.planId}</code><code>{plan.planHash}</code></details>
    </div>
  </TowerPanel>
}
