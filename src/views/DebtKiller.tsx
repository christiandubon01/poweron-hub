import { useState } from 'react'
import { useDemoMode } from '@/store/demoStore'
import { useCashOsSnapshot } from '@/hooks/useCashOsSnapshot'
import type { CashOsSourceBundle } from '@/services/cashOsReadService'
import CashOsObligations from '@/components/v15r/cash-os/CashOsObligations'
import CashOsOutlook from '@/components/v15r/cash-os/CashOsOutlook'
import CashOsDecisionLayer from '@/components/v15r/cash-os/CashOsDecisionLayer'
import { projectOptionsFromBackup } from '@/finance/cashProjectFacts'
import CashOsSetupPanel from '@/components/v15r/cash-os/CashOsSetupPanel'
import {
  CashCalendarView,
  CashProjectsView,
  CashPayrollView,
  CashTransactionsView,
  CashObligationsView,
} from '@/components/v15r/cash-os/CashOsViews'
import { CashOsAccountMenu } from '@/components/v15r/cash-os/CashOsAccountMenu'
import { CashCard, CashEmpty, cashDate, money } from '@/components/v15r/cash-os/cashOsUi'
import CashOsAddSheet from '@/components/v15r/cash-os/CashOsAddSheet'
import CashOsDebtPlan from '@/components/v15r/cash-os/CashOsDebtPlan'
import CashOsPayoffPlanner from '@/components/v15r/cash-os/CashOsPayoffPlanner'

const tabs = ['Outlook', 'Calendar', 'Projects', 'Payroll', 'Transactions', 'Obligations', 'Debt Plan'] as const
type DebtKillerTab = typeof tabs[number]

/** Sum of posted cash account balances from raw sources — no allocation engine. */
function rawTotalCash(sources: CashOsSourceBundle | null): number | null {
  if (!sources) return null
  const included = new Set(
    sources.accounts
      .filter(a => a.status === 'active' && a.account_class === 'asset' && a.include_in_cash)
      .map(a => a.id),
  )
  if (included.size === 0) return null
  const posted = sources.transactions.filter(tx => tx.status === 'posted' && included.has(tx.account_id))
  if (posted.length === 0) return null
  return posted.reduce((sum, tx) => sum + tx.amount_minor, 0)
}

function NeedsAssumptions({ label }: { label: string }) {
  return (
    <div>
      <span className="block text-[10px] font-bold tracking-[0.16em] text-[var(--text-secondary)]">{label}</span>
      <span className="mt-2 block text-sm text-[var(--text-muted)]">Needs assumptions</span>
    </div>
  )
}

function PreSetupOutlook({ sources }: { sources: CashOsSourceBundle | null }) {
  const total = rawTotalCash(sources)
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <div className="min-w-0 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-4">
          <span className="block text-[10px] font-bold tracking-[0.16em] text-[var(--text-secondary)]">TOTAL CASH</span>
          <strong className="mt-2 block break-words font-mono text-xl sm:text-2xl">
            {total !== null ? money(total) : 'Unknown'}
          </strong>
          {total === null && (
            <span className="mt-1 block text-[10px] text-[var(--text-muted)]">No included cash accounts found</span>
          )}
        </div>
        <NeedsAssumptions label="PROTECTED" />
        <NeedsAssumptions label="TRULY FREE" />
        <NeedsAssumptions label="14-DAY LOW" />
        <NeedsAssumptions label="DAYS COVERED" />
      </div>
      <CashCard>
        <p className="text-sm text-[var(--text-secondary)]">
          Cash trajectory and Truly Free cash require session assumptions to calculate safely.
        </p>
      </CashCard>
    </div>
  )
}

function PreSetupTransactions({ sources, onAdd, onRefresh }: { sources: CashOsSourceBundle | null; onAdd?: () => void; onRefresh?: () => void | Promise<void> }) {
  if (!sources) {
    return <CashCard><p className="text-sm text-[var(--text-secondary)]">Transactions loading…</p></CashCard>
  }
  const accounts = sources.accounts.filter(a => a.status === 'active')
  const transactions = [...sources.transactions]
    .sort((a, b) => b.transaction_date.localeCompare(a.transaction_date) || b.id.localeCompare(a.id))
    .slice(0, 40)
  const addAction = onAdd
    ? <button onClick={onAdd} className="rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-600">+ Add</button>
    : undefined
  return (
    <div className="space-y-5">
      <CashCard title="Financial accounts" action={addAction}>
        {accounts.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {accounts.map(account => (
              <div key={account.id} className="rounded-xl border border-[var(--border-primary)] p-3">
                <div className="flex items-start justify-between gap-1">
                  <strong className="leading-snug">{account.display_name}</strong>
                  <CashOsAccountMenu account={account} onMutated={async () => { await onRefresh?.() }} />
                </div>
                <span className="block text-xs text-[var(--text-muted)]">
                  {account.ownership_context === 'business' ? 'Business' : 'Personal'} · {account.account_class === 'asset' ? 'Asset' : 'Liability'} · {account.include_in_cash ? 'Included in cash' : 'Excluded from cash'}
                </span>
                <span className="mt-2 block text-xs text-[var(--text-muted)]">Balance — Needs assumptions</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-[var(--border-primary)] px-4 py-6 text-sm">
            <p className="font-semibold text-[var(--text-primary)]">Add your first account</p>
            <p className="mt-1 text-[var(--text-secondary)]">Track where your money lives — checking, savings, cash on hand, credit cards, and loans.</p>
            {onAdd && <button onClick={onAdd} className="mt-3 rounded-lg bg-orange-500 px-4 py-2 text-xs font-semibold text-white hover:bg-orange-600">Add account</button>}
          </div>
        )}
      </CashCard>
      <CashCard title="Recent ledger transactions">
        {transactions.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[550px] text-left text-sm">
              <thead className="text-xs uppercase text-[var(--text-muted)]">
                <tr><th className="py-2">Date</th><th>Description</th><th>Category / project</th><th className="text-right">Amount</th></tr>
              </thead>
              <tbody>
                {transactions.map(tx => (
                  <tr key={tx.id} className="border-t border-[var(--border-primary)]">
                    <td className="py-2">{cashDate(tx.transaction_date)}</td>
                    <td>{tx.description || tx.transaction_kind}<span className="block text-xs text-[var(--text-muted)]">{tx.status}</span></td>
                    <td>{tx.category ?? '—'}{tx.project_id ? ` · ${tx.project_id}` : ''}</td>
                    <td className="text-right font-mono">{money(tx.amount_minor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <CashEmpty>No ledger transactions were loaded.</CashEmpty>
        )}
      </CashCard>
    </div>
  )
}


export default function DebtKiller() {
  const { isDemoMode, hasHydrated } = useDemoMode()
  const [tab, setTab] = useState<DebtKillerTab>('Outlook')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [addSheetOpen, setAddSheetOpen] = useState(false)
  const cash = useCashOsSnapshot(!hasHydrated || isDemoMode)
  const scope = cash.scope
  const authoritative = cash.status === 'ready' && !!cash.snapshot && !cash.editing

  function openSheet() {
    cash.setEditing(true)
    setSheetOpen(true)
  }

  function closeSheet() {
    cash.setEditing(false)
    setSheetOpen(false)
  }

  function openAddSheet() { setAddSheetOpen(true) }
  function closeAddSheet() { setAddSheetOpen(false) }
  // The sheet closes only after the mutation's authoritative refresh has been committed.
  async function handleAddSuccess() {
    await cash.refresh()
    setAddSheetOpen(false)
    setTab('Transactions')
  }

  function handleConfirmSetup(setup: Parameters<typeof cash.confirmSetup>[0]) {
    cash.confirmSetup(setup)
    setSheetOpen(false)
  }

  const preSetup = cash.status === 'setup_required' && cash.sources !== null

  return (
    <div className="min-h-screen space-y-5 bg-[var(--bg-secondary)] p-3 text-[var(--text-primary)] sm:p-6">

      {/* Add sheet modal */}
      {addSheetOpen && scope && (
        <CashOsAddSheet
          organizationId={scope.context.organizationId}
          sources={cash.sources}
          onClose={closeAddSheet}
          onSuccess={handleAddSuccess}
          onMutated={cash.refresh}
        />
      )}

      {/* Assumptions sheet modal */}
      {sheetOpen && scope && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Session assumptions"
          className="fixed inset-0 z-50 flex items-start justify-end bg-black/60 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) closeSheet() }}
        >
          <div className="relative flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-[var(--bg-secondary)] p-4 sm:p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-bold text-[var(--text-primary)]">Session Assumptions</h2>
              <button
                aria-label="Close assumptions"
                onClick={closeSheet}
                className="rounded-lg border border-[var(--border-primary)] px-3 py-2 text-sm hover:bg-white/5"
              >
                ✕ Close
              </button>
            </div>
            <CashOsSetupPanel
              key={`${scope.context.organizationId}:${cash.editing}`}
              organizationId={scope.context.organizationId}
              storedTimezone={scope.storedTimezone}
              existing={cash.setup}
              reason={cash.reason}
              onConfirm={handleConfirmSetup}
            />
          </div>
        </div>
      )}

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-orange-400">Power On Hub / Cash OS</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{tab}</h1>
          {cash.snapshot && (
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              As of {cashDate(cash.snapshot.asOfDate)} · {cash.confidenceMode}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {cash.setup && (
            <span className="text-[var(--text-secondary)]">
              Session assumptions · confirmed {new Date(cash.setup.confirmedAt).toLocaleString()}
            </span>
          )}
          {scope && !isDemoMode && (
            <button
              onClick={openSheet}
              className="rounded-lg border border-[var(--border-primary)] px-3 py-2 hover:bg-white/5"
            >
              {cash.setup ? 'Edit assumptions' : 'Session assumptions'}
            </button>
          )}
          {cash.setup && !isDemoMode && (
            <button
              onClick={cash.resetSetup}
              className="rounded-lg border border-[var(--border-primary)] px-3 py-2 hover:bg-white/5"
            >
              Reset assumptions
            </button>
          )}
          {!isDemoMode && (
            <button
              onClick={cash.refresh}
              className="rounded-lg border border-[var(--border-primary)] px-3 py-2 hover:bg-white/5"
            >
              Refresh
            </button>
          )}
          {cash.refreshing ? (
            <span className="text-[var(--text-muted)]">Refreshing…</span>
          ) : cash.lastRefreshedAt && (
            <span className="text-[var(--text-muted)]">
              Last refreshed {new Date(cash.lastRefreshedAt).toLocaleTimeString()}
            </span>
          )}
        </div>
      </header>

      <nav
        aria-label="Debt Killer workspace"
        className="-mx-3 flex gap-1 overflow-x-auto border-b border-[var(--border-primary)] px-3 sm:mx-0 sm:px-0"
      >
        {tabs.map((item) => (
          <button
            key={item}
            onClick={() => setTab(item)}
            aria-current={tab === item ? 'page' : undefined}
            className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm font-semibold ${
              tab === item
                ? 'border-orange-400 text-orange-300'
                : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {item}
          </button>
        ))}
      </nav>

      {/* Non-blocking assumptions notice */}
      {cash.status === 'setup_required' && !isDemoMode && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
          <span className="text-amber-200">Some calculations need Session Assumptions.</span>
          {scope && (
            <button
              onClick={openSheet}
              className="rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-500/10"
            >
              {cash.setup ? 'Edit assumptions' : 'Set up now'}
            </button>
          )}
        </div>
      )}

      {!hasHydrated ? (
        <CashCard><p>Loading workspace…</p></CashCard>
      ) : isDemoMode ? (
        <CashCard title="Cash OS unavailable in Demo Mode">
          <p className="text-sm text-[var(--text-secondary)]">
            This demo has no isolated Cash OS ledger and payroll source bundle. All tabs require canonical sources.
          </p>
        </CashCard>
      ) : cash.status === 'loading' ? (
        <CashCard>
          <div className="animate-pulse space-y-3">
            <div className="h-5 w-48 rounded bg-white/10" />
            <div className="h-20 rounded bg-white/5" />
          </div>
          <p className="mt-4 text-sm text-[var(--text-secondary)]">Loading canonical cash sources…</p>
        </CashCard>
      ) : cash.status === 'error' ? (
        <CashCard title="Cash OS source unavailable">
          <p className="text-sm text-amber-300">{cash.reason}: {cash.error}</p>
          <button
            onClick={cash.refresh}
            className="mt-4 rounded-lg border border-[var(--border-primary)] px-4 py-2 text-sm"
          >
            Retry read
          </button>
        </CashCard>
      ) : cash.status === 'empty' && tab === 'Debt Plan' && cash.sources ? (
        <div className="space-y-5">
          <CashOsDebtPlan sources={cash.sources} snapshot={null} showTrulyFreeCash={false} onRefresh={cash.refresh} />
          <CashOsPayoffPlanner sources={cash.sources} snapshot={null} />
        </div>
      ) : cash.status === 'empty' ? (
        <CashCard title="Ledger empty">
          <p className="text-sm text-[var(--text-secondary)]">
            No posted transactions were loaded for an included cash account. Record or verify an opening balance before Outlook publishes cash totals.
          </p>
        </CashCard>
      ) : preSetup ? (
        /* Pre-setup: sources are available; render what we can without calculations */
        <>
          {tab === 'Outlook' && <PreSetupOutlook sources={cash.sources} />}
          {tab === 'Calendar' && (
            <CashCard title="Cash Calendar">
              <p className="text-sm text-[var(--text-secondary)]">
                Projected events and unresolved payment markers need session assumptions to calculate safely.
              </p>
            </CashCard>
          )}
          {tab === 'Projects' && (
            <CashCard title="Collection Clock">
              <p className="text-sm text-[var(--text-secondary)]">
                Collection timing and project funding coverage need session assumptions.
              </p>
            </CashCard>
          )}
          {tab === 'Payroll' && (
            <CashCard title="Payroll exposure">
              <p className="text-sm text-amber-200">Payroll exposure needs session assumptions.</p>
              <p className="mt-3 text-xs text-[var(--text-secondary)]">
                Set your wages paid-through date in Session Assumptions to calculate open payroll liabilities.
              </p>
            </CashCard>
          )}
          {tab === 'Transactions' && <PreSetupTransactions sources={cash.sources} onAdd={openAddSheet} onRefresh={cash.refresh} />}
          {tab === 'Obligations' && <CashOsObligations obligations={cash.sources?.obligations ?? []} commitments={cash.sources?.commitments ?? []} occurrences={cash.sources?.occurrences ?? []} transactions={cash.sources?.transactions ?? []} accounts={cash.sources?.accounts ?? []} projects={projectOptionsFromBackup(cash.sources?.backup)} onRefresh={cash.refresh} />}
          {tab === 'Debt Plan' && (
            <div className="space-y-5">
              <CashOsDebtPlan sources={cash.sources} snapshot={null} showTrulyFreeCash={false} onRefresh={cash.refresh} />
              <CashOsPayoffPlanner sources={cash.sources} snapshot={null} />
            </div>
          )}
        </>
      ) : cash.status === 'partial' && tab === 'Outlook' ? (
        <div className="space-y-5">
          <CashOsDecisionLayer snapshot={cash.snapshot} partial onRefresh={cash.refresh} />
          <CashCard title="Partial / Needs attention">
            <p className="text-sm text-amber-300">
              Payroll inputs need review. Authoritative cash totals and trajectory are withheld until the missing or overlapping source is resolved.
            </p>
            <ul className="mt-3 space-y-1 text-xs text-[var(--text-secondary)]">
              {cash.snapshot?.payrollDiagnostics.map((d, index) => (
                <li key={`${d.kind}:${index}`}>{d.kind.replace(/_/g, ' ')}: {d.note}</li>
              ))}
            </ul>
          </CashCard>
        </div>
      ) : cash.status === 'partial' && (tab === 'Calendar' || tab === 'Projects') ? (
        <CashCard title="Partial / Needs attention">
          <p className="text-sm text-amber-300">
            Payroll inputs need review before projected events or project funding coverage can be published.
            Payroll, Transactions, Obligations, and Debt Plan remain available.
          </p>
        </CashCard>
      ) : cash.snapshot ? (
        <>
          {tab === 'Outlook' && authoritative && (<>
            <CashOsDecisionLayer snapshot={cash.snapshot} onRefresh={cash.refresh} />
            <CashOsOutlook
              snapshot={cash.snapshot}
              horizonDays={cash.horizonDays}
              confidenceMode={cash.confidenceMode}
              onHorizon={cash.setHorizonDays}
              onConfidence={cash.setConfidenceMode}
            />
          </>)}
          {tab === 'Calendar' && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2" aria-label="Calendar horizon">
                {([7, 14, 30, 60, 90] as const).map((days) => (
                  <button
                    key={days}
                    onClick={() => cash.setHorizonDays(days)}
                    aria-pressed={cash.horizonDays === days}
                    className={`rounded-lg px-3 py-2 text-xs font-semibold ${
                      cash.horizonDays === days
                        ? 'bg-orange-500/20 text-orange-300'
                        : 'bg-[var(--bg-card)] text-[var(--text-secondary)]'
                    }`}
                  >
                    {days} days
                  </button>
                ))}
              </div>
              <CashCalendarView snapshot={cash.snapshot} />
            </div>
          )}
          {tab === 'Projects' && <CashProjectsView snapshot={cash.snapshot} />}
          {tab === 'Payroll' && <CashPayrollView snapshot={cash.snapshot} partial={cash.status === 'partial'} />}
          {tab === 'Transactions' && <CashTransactionsView snapshot={cash.snapshot} onAdd={openAddSheet} onRefresh={cash.refresh} />}
          {tab === 'Obligations' && <CashObligationsView snapshot={cash.snapshot} onRefresh={cash.refresh} />}
          {tab === 'Debt Plan' && (
            <div className="space-y-5">
              <CashOsDebtPlan sources={cash.snapshot} snapshot={cash.snapshot} showTrulyFreeCash={cash.status === 'ready'} onRefresh={cash.refresh} />
              <CashOsPayoffPlanner sources={cash.snapshot} snapshot={cash.snapshot} />
            </div>
          )}
        </>
      ) : (
        <CashCard>
          <p className="text-sm text-[var(--text-secondary)]">
            Cash OS has no ready snapshot. Complete session assumptions or refresh the source reads.
          </p>
        </CashCard>
      )}
    </div>
  )
}
