import { useMemo } from 'react'
import type { CashOsSnapshot } from '@/finance/cashOsSnapshot'
import { buildOwnerDecisionView, type OwnerDecisionFacts, type OwnerDecisionView } from '@/finance/decisionLayer'
import CashOsCommandCenter from './CashOsCommandCenter'
import type { DecisionEditor } from './CashOsDecisionEditor'
import type { DetailTab } from './commandCenterModel'
import type { GraphLink } from './cashTimelineModel'
import { CashCard } from './cashOsUi'

export type { DecisionEditor } from './CashOsDecisionEditor'

/**
 * The owner decision layer as it appears under the graph: a compact command center
 * (Today / Needs attention / Money / Next) built from the existing OwnerDecisionView, plus the
 * full "what Cash OS doesn't know" list kept collapsed. The four cash-status numbers are NOT here;
 * Outlook's single Cash Status row owns them.
 */
export function CashOsDecisionView({ view, snapshot = null, editor, onNavigate, graphLink }: {
  view: OwnerDecisionView
  snapshot?: CashOsSnapshot | null
  editor?: DecisionEditor
  onNavigate?: (tab: DetailTab) => void
  graphLink?: GraphLink
}) {
  return <div data-testid="cash-decision-layer" className="space-y-3">
    {view.status === 'withheld' && <CashCard title="Where you stand today">
      <p className="text-sm text-amber-300">Cash totals are being held back until payroll inputs are reviewed.</p>
    </CashCard>}
    {view.status === 'unavailable' && <CashCard title="Where you stand today">
      <p className="text-sm text-amber-300">No cash summary is available yet.</p>
    </CashCard>}
    {view.status === 'ready' && view.today.notes.length > 0 && <div data-testid="decision-status-notes" className="space-y-1">
      {view.today.notes.map(note => <p key={note} className="text-xs" style={{ color: 'var(--fin-warning)' }}>{note}</p>)}
    </div>}
    {view.status !== 'unavailable' && <CashOsCommandCenter view={view} snapshot={snapshot} editor={editor} onNavigate={onNavigate} graphLink={graphLink} />}
    {view.dataGaps.length > 0 && <details data-testid="decision-data-gaps" className="rounded-xl border border-[var(--border-primary)] p-3 text-sm text-[var(--text-secondary)]">
      <summary className="min-h-[44px] cursor-pointer py-2 font-semibold">What Cash OS doesn't know yet ({view.dataGaps.length})</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5">{view.dataGaps.map(gap => <li key={gap}>{gap}</li>)}</ul>
    </details>}
  </div>
}

export default function CashOsDecisionLayer({ snapshot, partial = false, facts, onRefresh, onNavigate, graphLink }: {
  snapshot: CashOsSnapshot | null
  partial?: boolean
  facts?: OwnerDecisionFacts
  /** Shared Cash OS refresh; when given, jobs can be edited in place and the layer updates from fresh data. */
  onRefresh?: () => void | Promise<void>
  /** Opens one of the detailed Cash OS tabs (Calendar, Projects, Payroll, ...). */
  onNavigate?: (tab: DetailTab) => void
  /** Graph ↔ command-center link supplied by Outlook (identity-based highlight and row selection). */
  graphLink?: GraphLink
}) {
  const result = useMemo(() => {
    try { return { view: buildOwnerDecisionView(snapshot, { partial, facts }), error: null as string | null } }
    catch (error) { return { view: null, error: error instanceof Error ? error.message : String(error) } }
  }, [snapshot, partial, facts])
  if (!result.view) {
    return <CashCard title="Where you stand today"><p className="text-sm text-amber-300">The summary could not be built: {result.error}. The detailed tabs are unaffected.</p></CashCard>
  }
  const editor: DecisionEditor | undefined = onRefresh && snapshot ? {
    factsFor: id => (snapshot.projectFacts ?? []).find(row => row.project_id === id) ?? null,
    spendFor: id => (snapshot.commitments ?? [])
      .filter(c => c.projectId === id && c.status === 'scheduled' && c.reconciliationState !== 'reconciled' && c.requirement === 'required')
      .map(c => ({ id: c.id, title: c.title, amountMinor: c.amount.minor })),
    onSaved: onRefresh,
  } : undefined
  return <CashOsDecisionView view={result.view} snapshot={snapshot} editor={editor} onNavigate={onNavigate} graphLink={graphLink} />
}
