import type { TowerSession } from './sessionPresentation'
import { countPhrase, verifierFailureDiagnostics } from '@/features/control-tower/verifierFailure'

const UNAVAILABLE = 'Verifier rejected the candidate. Detailed verifier evidence was not recorded for this run.'

export function VerifierRejectionBanner({ run, onInspect }: { run: TowerSession; onInspect: () => void }) {
  const diagnostics = verifierFailureDiagnostics(run)
  if (!diagnostics) return null
  const structured = diagnostics.failedChecks.length > 0 || diagnostics.evidenceCount != null
  return <section className="ct-attention ct-verifier-rejection" aria-label="Verifier rejection">
    <div className="ct-verifier-rejection-main">
      <span className="ct-verifier-rejection-copy">
        <strong>Verification failed — Candidate rejected</strong>
        <p className="ct-verifier-rejection-summary">{diagnostics.summary ?? UNAVAILABLE}</p>
        {structured && <p className="ct-verifier-rejection-counts">{diagnostics.failedChecks.length > 0 ? countPhrase(diagnostics.failedChecks.length, 'failed check', 'failed checks') : 'Failed checks were not recorded'} · {diagnostics.evidenceCount != null ? countPhrase(diagnostics.evidenceCount, 'evidence ref', 'evidence refs') : 'Evidence refs were not recorded'}</p>}
        {diagnostics.summary && !structured && <p className="ct-verifier-rejection-counts">Failed checks were not recorded for this run. Evidence refs were not recorded for this run.</p>}
      </span>
      <button type="button" onClick={onInspect}>Inspect failure</button>
    </div>
    <details className="ct-disclosure">
      <summary>Details</summary>
      <p>{diagnostics.summary ?? UNAVAILABLE}</p>
      <p>{diagnostics.failedChecks.length > 0 ? countPhrase(diagnostics.failedChecks.length, 'failed check', 'failed checks') : 'Failed checks were not recorded for this run.'}</p>
      <p>{diagnostics.evidenceCount != null ? countPhrase(diagnostics.evidenceCount, 'evidence ref', 'evidence refs') : 'Evidence refs were not recorded for this run.'}</p>
    </details>
  </section>
}

export function VerifierFailureDetail({ run }: { run: TowerSession }) {
  const diagnostics = verifierFailureDiagnostics(run)
  if (!diagnostics) return null
  return <section className="ct-verifier-failure-lead" aria-label="Verifier failure evidence">
    <div>
      <span className="ct-eyebrow">Verifier execution</span>
      <p className="ct-verifier-execution">{diagnostics.execution === 'passed' ? 'Completed successfully' : diagnostics.execution === 'failed' ? 'Failed' : 'Not reported'}</p>
    </div>
    <div>
      <span className="ct-eyebrow">Verification verdict</span>
      <p className="ct-verifier-verdict-fail">FAIL</p>
    </div>
    <h4>Summary</h4>
    <p>{diagnostics.summary ?? UNAVAILABLE}</p>
    <h4>Failed checks</h4>
    {diagnostics.failedChecks.length > 0
      ? <ul className="ct-team-failed-checks">{diagnostics.failedChecks.map((check, index) => <li key={`${index}-${check}`}>{check}</li>)}</ul>
      : <p>Failed checks were not recorded for this run.</p>}
    <h4>Evidence</h4>
    {diagnostics.evidenceRefs.length > 0
      ? <><p>{countPhrase(diagnostics.evidenceRefs.length, 'reference', 'references')}</p><ul className="ct-team-evidence-refs">{diagnostics.evidenceRefs.map((ref, index) => <li key={`${index}-${ref}`}><code>{ref}</code></li>)}</ul></>
      : <p>{diagnostics.evidenceCount != null ? `${countPhrase(diagnostics.evidenceCount, 'evidence ref', 'evidence refs')} published without listed paths.` : 'Evidence refs were not recorded for this run.'}</p>}
    <dl className="ct-facts ct-verifier-failure-meta">
      {diagnostics.provider && <div><dt>Verifier provider</dt><dd>{diagnostics.provider}</dd></div>}
      {diagnostics.reportedModel && <div><dt>Verifier model</dt><dd>{diagnostics.reportedModel}</dd></div>}
      {diagnostics.attemptId && <div><dt>Attempt id</dt><dd><code>{diagnostics.attemptId}</code></dd></div>}
      {diagnostics.verifierTaskTitle && <div><dt>Verifier task</dt><dd>{diagnostics.verifierTaskTitle}</dd></div>}
      {diagnostics.candidateCount != null && <div><dt>Implementer candidate</dt><dd>{countPhrase(diagnostics.candidateCount, 'change', 'changes')}</dd></div>}
      {diagnostics.guardSummary && <div><dt>Guard result</dt><dd>{diagnostics.guardSummary}</dd></div>}
      {diagnostics.disagreement && <div><dt>Verifier–implementer disagreement</dt><dd>{diagnostics.disagreement}</dd></div>}
    </dl>
  </section>
}
