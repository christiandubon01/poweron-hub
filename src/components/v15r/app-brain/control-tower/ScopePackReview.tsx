import type { ScopePackContract, ScopePackReconciliationState } from '@/features/control-tower/scopePack/types'

interface Props {
  pack: ScopePackContract
  selectedPhaseId?: string | null
  compact?: boolean
}

const STATE_LABEL: Record<ScopePackReconciliationState, string> = {
  unverified: 'UNVERIFIED',
  current: 'CURRENT',
  stale: 'STALE',
  conflict: 'CONFLICT',
}

export default function ScopePackReview({ pack, selectedPhaseId, compact = false }: Props) {
  const phase = pack.roadmapPhases.find(item => item.id === (selectedPhaseId ?? pack.currentPhaseId)) ?? pack.roadmapPhases[0]
  return <div className={compact ? 'ct-scope-review ct-scope-review-compact' : 'ct-scope-review'} aria-label="Scope Pack review">
    <div className="ct-scope-review-head">
      <div>
        <span className="ct-eyebrow">Scope Pack</span>
        <h3>{pack.title}</h3>
      </div>
      <span className={`ct-scope-state ct-scope-state-${pack.reconciliationState}`}>{STATE_LABEL[pack.reconciliationState]}</span>
    </div>
    <dl className="ct-scope-meta">
      <div><dt>Version</dt><dd>{pack.version}</dd></div>
      <div><dt>Source</dt><dd>{pack.sourceFilename} · {pack.sourceHash.slice(0, 12)}…</dd></div>
      <div><dt>Checkpoint</dt><dd>{pack.historicalCheckpoint ?? 'None'}</dd></div>
      <div><dt>Selected phase</dt><dd>{phase ? phase.title : 'None selected'}</dd></div>
      <div><dt>Last reconciled</dt><dd>{pack.lastReconciledAt ? pack.lastReconciledAt.replace('T', ' ').slice(0, 16) : 'Never'}</dd></div>
    </dl>
    {!compact && <p className="ct-scope-intent">{pack.intent || 'No product goal extracted.'}</p>}
    <details className="ct-disclosure"><summary>Foundation · {pack.foundationClaims.length}</summary>
      <ul>{pack.foundationClaims.map(claim => <li key={claim.claimId}><span className={`ct-claim-state ct-claim-state-${claim.state.toLowerCase()}`}>{claim.state}</span> {claim.claim}{claim.reconciliationSummary ? ` — ${claim.reconciliationSummary}` : ''}{claim.evidenceRefs.length > 0 ? ` · ${claim.evidenceRefs.length} evidence` : ''}</li>)}</ul>
    </details>
    <details className="ct-disclosure"><summary>Locked rules · {pack.lockedRules.length}</summary>
      <ul>{pack.lockedRules.map(rule => <li key={rule}>{rule}</li>)}</ul>
    </details>
    <details className="ct-disclosure"><summary>Do not touch · {pack.doNotTouch.length}</summary>
      <ul>{pack.doNotTouch.map(rule => <li key={rule}>{rule}</li>)}</ul>
    </details>
    <details className="ct-disclosure"><summary>Acceptance · {pack.acceptanceCriteria.length}{pack.runtimeAcceptanceRequired ? ' · runtime required' : ''}</summary>
      <ul>{pack.acceptanceCriteria.map(item => <li key={item}>{item}</li>)}</ul>
    </details>
    <details className="ct-disclosure"><summary>Roadmap · {pack.roadmapPhases.length}</summary>
      <ul>{pack.roadmapPhases.map(item => <li key={item.id}><strong>{item.id}</strong> {item.title} · {item.executionIntent}</li>)}</ul>
    </details>
    <details className="ct-disclosure"><summary>Reconciliation</summary>
      <p>{pack.reconciliationSummary ?? 'Not reconciled yet.'}</p>
    </details>
  </div>
}
