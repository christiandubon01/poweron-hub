import { useMemo, useState } from 'react'
import type { CashOsSnapshot } from '@/finance/cashOsSnapshot'
import {
  ACTION_CATEGORY_LABELS, buildOwnerDecisionView,
  type ActionCategory, type Certainty, type DecisionAction, type DecisionRisk, type MoneyItem,
  type OwnerDecisionFacts, type OwnerDecisionView,
} from '@/finance/decisionLayer'
import type { CashProjectFactsRow } from '@/finance/cashProjectFacts'
import CashOsProjectFactsEditor, { type LinkedSpend } from './CashOsProjectFactsEditor'
import { CashCard, cashDate, money } from './cashOsUi'

/** Lets the owner answer a job's open questions right where the money is shown. */
export interface DecisionEditor {
  factsFor: (projectId: string) => CashProjectFactsRow | null
  spendFor: (projectId: string) => LinkedSpend[]
  onSaved: () => void | Promise<void>
}

const CATEGORY_ORDER: ActionCategory[] = ['no_cash', 'owner_work', 'cash_required', 'protection', 'waiting', 'watch']

const CERTAINTY_LABEL: Record<Certainty, { text: string; cls: string }> = {
  recommended: { text: 'Recommended', cls: 'bg-emerald-500/15 text-emerald-300' },
  needs_verification: { text: 'Check first', cls: 'bg-amber-500/15 text-amber-300' },
  informational: { text: 'For your information', cls: 'bg-white/10 text-[var(--text-secondary)]' },
}

const SEVERITY_CLS: Record<DecisionRisk['severity'], string> = {
  high: 'border-red-500/40 bg-red-500/10',
  medium: 'border-amber-500/40 bg-amber-500/10',
  low: 'border-[var(--border-primary)] bg-[var(--bg-secondary)]',
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return <div className="min-w-0 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-3">
    <span className="block text-[11px] text-[var(--text-muted)]">{label}</span>
    <strong className={`mt-1 block break-words font-mono text-lg ${tone === 'good' ? 'text-emerald-300' : tone === 'bad' ? 'text-red-300' : ''}`}>{value}</strong>
  </div>
}

function Unknowns({ items }: { items: string[] }) {
  if (!items.length) return null
  return <p className="mt-1 text-[11px] text-amber-300/90">Not known yet: {items.join('; ')}</p>
}

function DetailsToggle({ projectId, name, editor, open, onOpen, onClose, hasFacts }: {
  projectId: string; name: string; editor?: DecisionEditor; open: string | null
  onOpen: (id: string) => void; onClose: () => void; hasFacts: boolean
}) {
  if (!editor) return null
  if (open === projectId) {
    return <CashOsProjectFactsEditor projectId={projectId} projectName={name} facts={editor.factsFor(projectId)}
      linkedSpend={editor.spendFor(projectId)} onCancel={onClose}
      onSaved={async () => { await editor.onSaved(); onClose() }} />
  }
  return <button type="button" onClick={() => onOpen(projectId)}
    className="mt-1 text-xs font-semibold text-orange-300 hover:text-orange-200">{hasFacts ? 'Edit job details' : 'Tell Cash OS about this job'}</button>
}

function MoneyGroup({ title, hint, items, testId, editor, open, onOpen, onClose }: {
  title: string; hint: string; items: MoneyItem[]; testId: string
  editor?: DecisionEditor; open: string | null; onOpen: (id: string) => void; onClose: () => void
}) {
  if (!items.length) return null
  return <div data-testid={testId} className="rounded-xl border border-[var(--border-primary)] p-3">
    <h5 className="text-sm font-semibold">{title}</h5>
    <p className="mb-2 text-[11px] text-[var(--text-muted)]">{hint}</p>
    <div className="space-y-2">{items.map(item => <div key={item.id} className="text-sm">
      <div className="flex justify-between gap-3">
        <span>{item.label}</span>
        <strong className="whitespace-nowrap font-mono">{item.amountMinor == null ? 'Amount unknown' : money(item.amountMinor)}</strong>
      </div>
      <p className="text-xs text-[var(--text-secondary)]">{item.basis}</p>
      <Unknowns items={item.unknowns} />
      {item.projectId && <DetailsToggle projectId={item.projectId} name={item.label} editor={editor} open={open}
        onOpen={onOpen} onClose={onClose} hasFacts={!!editor?.factsFor(item.projectId)} />}
    </div>)}</div>
  </div>
}

function ActionCard({ action }: { action: DecisionAction }) {
  const certainty = CERTAINTY_LABEL[action.certainty]
  return <div data-testid="decision-action" data-category={action.category} data-certainty={action.certainty}
    className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-3">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <h5 className="text-sm font-semibold">{action.title}</h5>
      <span className={`rounded-full px-2 py-0.5 text-[11px] ${certainty.cls}`}>{certainty.text}</span>
    </div>
    <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-[var(--text-secondary)]">
      {action.why.map((reason, index) => <li key={index}>{reason}</li>)}
    </ul>
    <p className="mt-2 text-[11px] text-[var(--text-muted)]">
      Cash needed: {action.resource.cashMinor == null ? 'unknown' : money(action.resource.cashMinor)}
      {' · '}Your work: {action.resource.ownerWork === 'required' ? 'required' : action.resource.ownerWork === 'none' ? 'none' : 'unknown'}
      {action.timing.date ? ` · Timing: ${cashDate(action.timing.date)}` : ' · Timing: not known'}
    </p>
    <Unknowns items={action.missing} />
  </div>
}

export function CashOsDecisionView({ view, editor }: { view: OwnerDecisionView; editor?: DecisionEditor }) {
  const [openProject, setOpenProject] = useState<string | null>(null)
  const t = view.today
  const grouped = CATEGORY_ORDER.map(category => ({ category, items: view.actions.filter(a => a.category === category) }))
    .filter(group => group.items.length > 0)
  const states = view.moneyStates
  const futureCount = states.collectible.length + states.unlockable.length + states.potential.length + states.blocked.length
  return <div data-testid="cash-decision-layer" className="mb-5 space-y-5">
    <CashCard title="Where you stand today">
      {view.status === 'ready' ? <>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Cash you have" value={money(t.availableMinor)} tone={(t.availableMinor ?? 0) < 0 ? 'bad' : undefined} />
          <Stat label="Set aside for bills" value={money(t.protectedMinor)} />
          <Stat label="Free to use" value={money(t.trulyFreeMinor)} tone={(t.trulyFreeMinor ?? 0) > 0 ? 'good' : undefined} />
          <Stat label="Short of what's set aside" value={money(t.protectionShortfallMinor)} tone={(t.protectionShortfallMinor ?? 0) > 0 ? 'bad' : undefined} />
        </div>
        {t.operatingFloorMinor != null && <p className="mt-3 text-xs text-[var(--text-secondary)]">
          Your operating floor of {money(t.operatingFloorMinor)} is already included in what is set aside. Money you may collect later is not part of these numbers.
        </p>}
      </> : <p className="text-sm text-amber-300">{view.status === 'withheld' ? 'Cash totals are being held back until payroll inputs are reviewed.' : 'No cash summary is available yet.'}</p>}
      {t.notes.map(note => <p key={note} className="mt-2 text-xs text-amber-300">{note}</p>)}
    </CashCard>

    {view.status !== 'unavailable' && <CashCard title="Next 7 days">
      {view.status === 'withheld' ? <p className="text-sm text-[var(--text-secondary)]">Held back with the cash totals.</p> : <>
        {view.next7Days.movements.length ? <div className="space-y-2">{view.next7Days.movements.map((m, index) =>
          <div key={`${m.date}:${m.label}:${index}`} className="flex justify-between gap-3 border-b border-[var(--border-primary)] py-2 text-sm">
            <div><span className="font-semibold">{m.label}</span><span className="block text-xs text-[var(--text-secondary)]">{cashDate(m.date)}</span></div>
            <span className="whitespace-nowrap font-mono">{m.direction === 'outflow' ? '−' : '+'}{money(m.amountMinor)}</span>
          </div>)}</div> : <p className="text-sm text-[var(--text-secondary)]">No dated bills or confirmed money in the next 7 days.</p>}
        <p className="mt-3 text-xs text-[var(--text-secondary)]">
          Bills due: {money(view.next7Days.requiredOutflowMinor)}
          {view.next7Days.lowestCashMinor != null && <> · Lowest cash: {money(view.next7Days.lowestCashMinor)} on {cashDate(view.next7Days.lowestCashDate)}</>}
          {view.next7Days.undatedPayrollMinor > 0 && <> · Payroll owed with no pay date: {money(view.next7Days.undatedPayrollMinor)}</>}
        </p>
        {view.next7Days.notes.map(note => <p key={note} className="mt-1 text-[11px] text-[var(--text-muted)]">{note}</p>)}
      </>}
    </CashCard>}

    <CashCard title="Money that isn't cash yet">
      <p className="mb-3 text-xs text-[var(--text-secondary)]">None of this is in your cash total. It moves up only when something real happens (work finished, billed, accepted, paid).</p>
      {futureCount === 0 && states.notCounted.length === 0
        ? <p className="text-sm text-[var(--text-secondary)]">No open project money was found.</p>
        : <div className="space-y-3">
          <MoneyGroup testId="money-collectible" editor={editor} open={openProject} onOpen={setOpenProject} onClose={() => setOpenProject(null)} title="Ready to collect" hint="Earned and billed (or completed), not yet recorded as paid." items={states.collectible} />
          <MoneyGroup testId="money-unlockable" editor={editor} open={openProject} onOpen={setOpenProject} onClose={() => setOpenProject(null)} title="Could unlock by finishing work" hint="A balance exists, but something must happen first." items={states.unlockable} />
          <MoneyGroup testId="money-blocked" editor={editor} open={openProject} onOpen={setOpenProject} onClose={() => setOpenProject(null)} title="Blocked" hint="Cannot move forward right now." items={states.blocked} />
          <MoneyGroup testId="money-potential" editor={editor} open={openProject} onOpen={setOpenProject} onClose={() => setOpenProject(null)} title="Possible, not awarded" hint="Estimates and unconfirmed work. Counted as $0." items={states.potential} />
          {states.notCounted.length > 0 && <div data-testid="money-not-counted" className="rounded-xl border border-dashed border-[var(--border-primary)] p-3">
            <h5 className="text-sm font-semibold">Not counted</h5>
            {states.notCounted.map(item => <div key={item.id} className="mt-1 text-xs text-[var(--text-secondary)]">
              <p><strong>{item.label}:</strong> {item.reason}</p>
              {item.projectId && <DetailsToggle projectId={item.projectId} name={item.label} editor={editor} open={openProject}
                onOpen={setOpenProject} onClose={() => setOpenProject(null)} hasFacts={!!editor?.factsFor(item.projectId)} />}
            </div>)}
          </div>}
        </div>}
      {states.settledProjectCount > 0 && <p className="mt-3 text-[11px] text-[var(--text-muted)]">{states.settledProjectCount} fully paid project{states.settledProjectCount === 1 ? '' : 's'} hidden — nothing to do.</p>}
    </CashCard>

    <CashCard title="Watch out for">
      {view.risks.length ? <div className="space-y-2">{view.risks.map(risk => <div key={risk.id} data-testid="decision-risk"
        className={`rounded-xl border p-3 ${SEVERITY_CLS[risk.severity]}`}>
        <h5 className="text-sm font-semibold">{risk.title}</h5>
        <p className="mt-1 text-xs text-[var(--text-secondary)]">{risk.detail}</p>
        <Unknowns items={risk.missing} />
      </div>)}</div> : <p className="text-sm text-[var(--text-secondary)]">Nothing urgent found in the data Cash OS has.</p>}
    </CashCard>

    <CashCard title="What you could do next">
      {grouped.length ? <div className="space-y-4">{grouped.map(group => <div key={group.category}>
        <h4 className="mb-2 text-sm font-semibold">{ACTION_CATEGORY_LABELS[group.category]}</h4>
        <div className="space-y-2">{group.items.map(action => <ActionCard key={action.id} action={action} />)}</div>
      </div>)}
        <p className="text-[11px] text-[var(--text-muted)]">These are suggestions. Cash OS never moves money, marks work ready, or changes a project for you, and these actions can be done side by side.</p>
      </div> : <p className="text-sm text-[var(--text-secondary)]">No actions to suggest from the data Cash OS has.</p>}
    </CashCard>

    {view.dataGaps.length > 0 && <details data-testid="decision-data-gaps" className="rounded-xl border border-[var(--border-primary)] p-3 text-xs text-[var(--text-secondary)]">
      <summary className="cursor-pointer font-semibold">What Cash OS doesn't know yet</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5">{view.dataGaps.map(gap => <li key={gap}>{gap}</li>)}</ul>
    </details>}
  </div>
}

export default function CashOsDecisionLayer({ snapshot, partial = false, facts, onRefresh }: {
  snapshot: CashOsSnapshot | null
  partial?: boolean
  facts?: OwnerDecisionFacts
  /** Shared Cash OS refresh; when given, jobs can be edited in place and the layer updates from fresh data. */
  onRefresh?: () => void | Promise<void>
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
  return <CashOsDecisionView view={result.view} editor={editor} />
}
