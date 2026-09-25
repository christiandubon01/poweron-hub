import { useRef, useState } from 'react'
import type { ApplyNotice } from '@/features/control-tower/applyCandidateView'
import { TowerPanel } from './ControlTowerPrimitives'

export interface CandidateChangeItem {
  path: string
  kind: 'modify' | 'add' | 'delete'
}

const KIND_LABEL = { modify: 'Modified', add: 'Added', delete: 'Deleted' } as const

export default function CandidateApplyPanel(props: {
  changeCount: number
  changes: CandidateChangeItem[]
  eligible: boolean
  reason: string | null
  applied: boolean
  busy: boolean
  progress: string | null
  notice: ApplyNotice | null
  onApply: () => void
}) {
  const [reviewing, setReviewing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const submittedRef = useRef(false)
  const applied = props.applied || props.notice?.kind === 'applied'
  const already = props.notice?.kind === 'already'
  const count = props.notice?.pathCount ?? props.changeCount
  const showPaths = reviewing || confirming || applied

  if (!applied && !already && !props.notice && !props.eligible && props.reason === 'No candidate changes to apply') {
    return <TowerPanel title="Candidate"><p>No candidate changes to apply</p></TowerPanel>
  }
  if (!applied && !already && !props.notice && !props.eligible && props.reason) {
    return <TowerPanel title="Candidate"><p>{props.reason}</p></TowerPanel>
  }
  if (!applied && !already && !props.notice && !props.eligible) return null

  return <TowerPanel title="Candidate">
    {applied && <>
      <p>Candidate applied</p>
      <p>{count} files applied to canonical working tree.</p>
      <p>Not committed</p>
      <p>Not pushed</p>
      <p>Not deployed</p>
    </>}
    {already && <p>Already applied</p>}
    {!applied && !already && props.eligible && <>
      <p>Candidate verified</p>
      <p>{props.changeCount} changes</p>
    </>}
    {props.progress && <p className="ct-planning-line" aria-live="polite">{props.progress}</p>}
    {props.notice?.kind === 'conflict' && <>
      <p>Candidate not applied</p>
      <p>Canonical changed since this run</p>
      <ul className="ct-apply-list">{props.notice.paths.map((entry) => <li key={entry}><code>{entry}</code></li>)}</ul>
    </>}
    {props.notice?.kind === 'failed' && <p role="alert">{props.notice.message}{props.notice.rollback ? ` Rollback ${props.notice.rollback}` : ''}</p>}
    {showPaths && <ChangeList changes={props.changes} />}
    {!applied && !already && props.eligible && !confirming && <div className="ct-apply-actions">
      <button type="button" className="ct-secondary" onClick={() => setReviewing((value) => !value)}>Review Candidate</button>
      <button type="button" className="ct-primary" disabled={props.busy || submitted} onClick={() => setConfirming(true)}>Apply Candidate</button>
    </div>}
    {confirming && !applied && !submitted && <section className="ct-apply-confirm" role="dialog" aria-label="Confirm apply candidate">
      <p>Apply {props.changeCount} verified candidate changes to the canonical working tree?</p>
      <ChangeList changes={props.changes} />
      <p>This will NOT:</p>
      <ul className="ct-apply-list">
        <li>commit</li>
        <li>push</li>
        <li>deploy</li>
        <li>run migrations</li>
      </ul>
      <div className="ct-apply-actions">
        <button type="button" className="ct-primary" disabled={props.busy} onClick={() => { if (submittedRef.current) return; submittedRef.current = true; setSubmitted(true); props.onApply() }}>Apply Candidate</button>
        <button type="button" className="ct-secondary" onClick={() => setConfirming(false)}>Cancel</button>
      </div>
    </section>}
  </TowerPanel>
}

function ChangeList(props: { changes: CandidateChangeItem[] }) {
  const groups = (['modify', 'add', 'delete'] as const).filter((kind) => props.changes.some((change) => change.kind === kind))
  return <>{groups.map((kind) => <div key={kind}><p>{KIND_LABEL[kind]}</p><ul className="ct-apply-list">{props.changes.filter((change) => change.kind === kind).map((change) => <li key={change.path}><code>{change.path}</code></li>)}</ul></div>)}</>
}
