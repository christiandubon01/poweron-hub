import { useState } from 'react'
import type { CashOsSnapshot } from '@/finance/cashOsSnapshot'
import { CashCollectionClock } from './CashOsOutlook'
import { CashCard, CashEmpty, cashDate, money } from './cashOsUi'
import CashOsObligations from './CashOsObligations'
import { CashOsAccountMenu, CashOsAccountRestore } from './CashOsAccountMenu'

export function CashCalendarView({ snapshot }: { snapshot: CashOsSnapshot }) {
  const { projection } = snapshot
  const dates = [...new Set([...projection.datedEvents.map(e => e.date),
    ...projection.datedMarkers.map(m => m.date).filter((date): date is string => !!date)])].sort()
  return <CashCard title="Cash Calendar">
    <p className="mb-5 text-xs text-[var(--text-secondary)]">Canonical events and unresolved markers in the selected projection horizon.</p>
    {dates.length ? <div className="space-y-4">{dates.map(date => <div key={date} className="rounded-xl border border-[var(--border-primary)] p-4">
      <h4 className="mb-2 font-semibold">{cashDate(date)}</h4>
      {projection.datedEvents.filter(event => event.date === date).map(event => <p key={event.sourceKey} className="flex justify-between gap-3 py-1 text-sm">
        <span>{event.label} <small className="text-[var(--text-muted)]">{event.confidence}</small></span><span className="font-mono">{event.direction === 'outflow' ? '−' : '+'}{money(event.amountMinor)}</span>
      </p>)}
      {projection.datedMarkers.filter(marker => marker.date === date).map(marker => <p key={`${marker.sourceKey}:${marker.reason}`} className="py-1 text-xs text-amber-300">{marker.label} · {marker.reason.replace(/_/g, ' ')} · {money(marker.amountMinor)}</p>)}
    </div>)}</div> : <CashEmpty>No dated events in this horizon.</CashEmpty>}
    <h4 className="mb-2 mt-6 font-semibold">Undated / unresolved</h4>
    {projection.undatedMarkers.length ? projection.undatedMarkers.map(marker => <p key={`${marker.sourceKey}:${marker.reason}`} className="border-b border-[var(--border-primary)] py-2 text-xs text-amber-300">
      {marker.label} · {marker.semanticCode === 'payment_timing_unknown' ? 'Payment timing unknown' : 'Date unknown'} · {money(marker.amountMinor)}
    </p>) : <CashEmpty>No undated markers.</CashEmpty>}
  </CashCard>
}

export function CashProjectsView({ snapshot }: { snapshot: CashOsSnapshot }) {
  return <CashCollectionClock snapshot={snapshot} />
}

export function CashPayrollView({ snapshot, partial }: { snapshot: CashOsSnapshot; partial: boolean }) {
  const { payroll } = snapshot
  return <div className="space-y-5"><CashCard title="Cash payroll exposure">
    <div className="grid gap-4 sm:grid-cols-3">
      <div><span className="block text-xs text-[var(--text-muted)]">Paid through</span><strong>{cashDate(snapshot.setup.payrollPaidThroughDate)}</strong></div>
      <div><span className="block text-xs text-[var(--text-muted)]">Open shift estimates</span><strong>{snapshot.setup.includeOpenShiftEstimates ? 'Included' : 'Excluded'}</strong></div>
      <div><span className="block text-xs text-[var(--text-muted)]">Current exposure</span><strong className="font-mono">{partial ? 'Partial / Needs attention' : money(snapshot.payrollExposureMinor)}</strong></div>
    </div>
    <p className="mt-4 text-xs text-[var(--text-secondary)]">Base cash wages only. Loaded employer cost is not used as payroll cash exposure.</p>
    <h4 className="mb-2 mt-6 text-sm font-semibold">Liabilities</h4>
    {payroll.liabilities.length ? <div className="space-y-2">{payroll.liabilities.map(liability => <div key={liability.provenance.source.recordId} className="flex flex-wrap justify-between gap-3 border-b border-[var(--border-primary)] py-2 text-sm">
      <div>{liability.label}<span className="block text-xs text-[var(--text-muted)]">{liability.provenance.confidence} · {liability.provenance.source.kind} · {liability.attribution.projectId ? `Project ${liability.attribution.projectId}` : 'Project unattributed'}</span></div>
      <strong className="font-mono">{money(liability.amountMinor)}</strong>
    </div>)}</div> : <CashEmpty>No unpaid payroll liabilities were derived from the loaded time rows.</CashEmpty>}
    <p className="mt-4 text-xs text-[var(--text-secondary)]">Unattributed project payroll: {money(snapshot.collectionClock.unattributedPayrollMinor)}</p>
  </CashCard>
    <CashCard title="Payroll diagnostics">{snapshot.payrollDiagnostics.length ? <ul className="space-y-2 text-sm text-amber-300">{snapshot.payrollDiagnostics.map((diagnostic, index) => <li key={`${diagnostic.kind}:${diagnostic.sourceId ?? index}`}>
      {diagnostic.kind.replace(/_/g, ' ')} · {diagnostic.note}
    </li>)}</ul> : <CashEmpty>No payroll diagnostics.</CashEmpty>}</CashCard>
  </div>
}

function kindLabel(kind: string | null | undefined): string {
  if (!kind) return '—'
  const labels: Record<string, string> = {
    opening_balance: 'Opening Balance', income: 'Income', expense: 'Expense',
    transfer: 'Transfer', card_debt_payment: 'Card / Loan Payment',
    refund_reversal: 'Refund / Reversal', adjustment: 'Adjustment',
    balance_reconciliation: 'Balance Reconciliation',
  }
  return labels[kind] ?? kind.replace(/_/g, ' ')
}

const addBtn = (onAdd: () => void) => (
  <button onClick={onAdd} className="rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-600">+ Add</button>
)

export function CashTransactionsView({
  snapshot,
  onAdd,
  onRefresh,
}: {
  snapshot: CashOsSnapshot
  onAdd?: () => void
  onRefresh?: () => void | Promise<void>
}) {
  const [showArchived, setShowArchived] = useState(false)
  const accounts = snapshot.accounts.filter(a => a.status === 'active')
  const archivedAccounts = snapshot.accounts.filter(a => a.status === 'archived')
  const transactions = [...snapshot.transactions].sort((a, b) => b.transaction_date.localeCompare(a.transaction_date) || b.id.localeCompare(a.id)).slice(0, 40)
  const handleMutated = async () => { await onRefresh?.() }
  return <div className="space-y-5">
    <CashCard title="Financial accounts" action={onAdd ? addBtn(onAdd) : undefined}>
      {accounts.length ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{accounts.map(account => <div key={account.id} className="rounded-xl border border-[var(--border-primary)] p-3">
        <div className="flex items-start justify-between gap-1">
          <strong className="leading-snug">{account.display_name}</strong>
          <CashOsAccountMenu account={account} onMutated={handleMutated} />
        </div>
        <span className="block text-xs text-[var(--text-muted)]">
          {account.ownership_context === 'business' ? 'Business' : 'Personal'} · {account.account_class === 'asset' ? 'Asset' : 'Liability'} · {account.include_in_cash ? 'Included in cash' : 'Excluded from cash'}
        </span>
        <span className="mt-2 block font-mono">{money(snapshot.accountBalancesMinor[account.id])}</span>
      </div>)}</div> : <div className="rounded-xl border border-dashed border-[var(--border-primary)] px-4 py-6 text-sm">
        <p className="font-semibold text-[var(--text-primary)]">Add your first account</p>
        <p className="mt-1 text-[var(--text-secondary)]">Track where your money lives — checking, savings, cash on hand, credit cards, and loans.</p>
        {onAdd && <button onClick={onAdd} className="mt-3 rounded-lg bg-orange-500 px-4 py-2 text-xs font-semibold text-white hover:bg-orange-600">Add account</button>}
      </div>}
      {archivedAccounts.length > 0 && (
        <div className="mt-4 border-t border-[var(--border-primary)] pt-3">
          <button
            type="button"
            onClick={() => setShowArchived(v => !v)}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          >
            {showArchived ? '▲ Hide archived' : `▼ Show ${archivedAccounts.length} archived account${archivedAccounts.length !== 1 ? 's' : ''}`}
          </button>
          {showArchived && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {archivedAccounts.map(account => (
                <div key={account.id} className="rounded-xl border border-dashed border-[var(--border-primary)] p-3 opacity-60">
                  <div className="flex items-start justify-between gap-1">
                    <strong className="leading-snug text-[var(--text-secondary)]">{account.display_name}</strong>
                    <CashOsAccountRestore account={account} onMutated={handleMutated} />
                  </div>
                  <span className="block text-xs text-[var(--text-muted)]">
                    Archived · {account.ownership_context === 'business' ? 'Business' : 'Personal'} · {account.account_class === 'asset' ? 'Asset' : 'Liability'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </CashCard>
    <CashCard title="Recent ledger transactions">
      {transactions.length ? <div className="overflow-x-auto"><table className="w-full min-w-[550px] text-left text-sm"><thead className="text-xs uppercase text-[var(--text-muted)]"><tr><th className="py-2">Date</th><th>Description</th><th>Kind / Category</th><th className="text-right">Movement</th></tr></thead><tbody>
        {transactions.map(tx => <tr key={tx.id} className="border-t border-[var(--border-primary)]"><td className="py-2">{cashDate(tx.transaction_date)}</td><td>{tx.description || kindLabel(tx.transaction_kind)}<span className="block text-xs text-[var(--text-muted)]">{tx.status}</span></td><td>{kindLabel(tx.transaction_kind)}{tx.category ? ` · ${tx.category}` : ''}{tx.project_id ? ` · ${tx.project_id}` : ''}</td><td className="text-right font-mono">{money(tx.amount_minor)}</td></tr>)}
      </tbody></table></div> : <CashEmpty>No ledger transactions were loaded.</CashEmpty>}
    </CashCard>
  </div>
}

export function CashObligationsView({ snapshot, onRefresh }: { snapshot: CashOsSnapshot; onRefresh?: () => void | Promise<void> }) {
  return (
    <CashOsObligations
      obligations={snapshot.obligations}
      commitments={snapshot.commitments}
      occurrences={snapshot.occurrences}
      transactions={snapshot.transactions}
      accounts={snapshot.accounts}
      onRefresh={onRefresh ?? (() => {})}
    />
  )
}
