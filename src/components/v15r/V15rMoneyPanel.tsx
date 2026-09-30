import { useState } from 'react'
import { useDemoMode } from '@/store/demoStore'
import { useCashOsSnapshot } from '@/hooks/useCashOsSnapshot'
import V15rMoneyPerformancePanel from './V15rMoneyPerformancePanel'
import CashOsOutlook from './cash-os/CashOsOutlook'
import CashOsSetupPanel from './cash-os/CashOsSetupPanel'
import { CashCalendarView, CashProjectsView, CashPayrollView, CashTransactionsView, CashObligationsView } from './cash-os/CashOsViews'
import { CashCard, cashDate } from './cash-os/cashOsUi'

const tabs = ['Outlook', 'Calendar', 'Projects', 'Payroll', 'Transactions', 'Obligations', 'Debt Killer', 'Performance'] as const
type MoneyTab = typeof tabs[number]

export default function V15rMoneyPanel({ onNavigate }: { onNavigate?: (view: string) => void }) {
  const { isDemoMode, hasHydrated } = useDemoMode()
  const [tab, setTab] = useState<MoneyTab>('Outlook')
  const cash = useCashOsSnapshot(!hasHydrated || isDemoMode)
  const scope = cash.scope
  const showSetup = cash.editing || cash.status === 'setup_required'
  const authoritative = cash.status === 'ready' && !!cash.snapshot && !cash.editing

  return <div className="min-h-screen space-y-5 bg-[var(--bg-secondary)] p-3 text-[var(--text-primary)] sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-[10px] font-bold uppercase tracking-[0.25em] text-emerald-400">Power On Hub / Money</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{tab}</h1>
        {cash.snapshot && <p className="mt-1 text-xs text-[var(--text-secondary)]">As of {cashDate(cash.snapshot.asOfDate)} · {cash.confidenceMode}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {cash.setup && <span className="text-[var(--text-secondary)]">Session assumptions · confirmed {new Date(cash.setup.confirmedAt).toLocaleString()}</span>}
        {scope && !isDemoMode && <button onClick={() => setEditingAndOutlook()} className="rounded-lg border border-[var(--border-primary)] px-3 py-2 hover:bg-white/5">{cash.setup ? 'Edit assumptions' : 'Session assumptions'}</button>}
        {cash.setup && !isDemoMode && <button onClick={cash.resetSetup} className="rounded-lg border border-[var(--border-primary)] px-3 py-2 hover:bg-white/5">Reset assumptions</button>}
        {!isDemoMode && <button onClick={cash.refresh} className="rounded-lg border border-[var(--border-primary)] px-3 py-2 hover:bg-white/5">Refresh</button>}
        {cash.lastRefreshedAt && <span className="text-[var(--text-muted)]">Last refreshed {new Date(cash.lastRefreshedAt).toLocaleTimeString()}</span>}
      </div>
    </header>
    <nav aria-label="Money workspace" className="-mx-3 flex gap-1 overflow-x-auto border-b border-[var(--border-primary)] px-3 sm:mx-0 sm:px-0">
      {tabs.map(item => <button key={item} onClick={() => setTab(item)} aria-current={tab === item ? 'page' : undefined}
        className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm font-semibold ${tab === item ? 'border-emerald-400 text-emerald-300' : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>{item}</button>)}
    </nav>
    {tab === 'Performance' ? <V15rMoneyPerformancePanel />
      : tab === 'Debt Killer' ? <CashCard title="Debt Killer"><p className="mb-4 text-sm text-[var(--text-secondary)]">Debt Killer is the existing standalone tool. Its Cash OS funding integration is planned for CASH-9.</p>
        <button onClick={() => onNavigate?.('debt-killer')} className="rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-slate-950">Open Debt Killer</button></CashCard>
      : !hasHydrated ? <CashCard><p>Loading workspace…</p></CashCard>
      : isDemoMode ? <CashCard title="Cash OS unavailable in Demo Mode"><p className="text-sm text-[var(--text-secondary)]">This demo has no isolated Cash OS ledger and payroll source bundle. Performance remains available with demo data.</p></CashCard>
      : showSetup && scope ? <CashOsSetupPanel key={`${scope.context.organizationId}:${cash.editing}`} organizationId={scope.context.organizationId}
        storedTimezone={scope.storedTimezone} existing={cash.setup} reason={cash.reason} onConfirm={cash.confirmSetup} />
      : cash.status === 'loading' ? <CashCard><div className="animate-pulse space-y-3"><div className="h-5 w-48 rounded bg-white/10" /><div className="h-20 rounded bg-white/5" /></div><p className="mt-4 text-sm text-[var(--text-secondary)]">Loading canonical cash sources…</p></CashCard>
      : cash.status === 'error' ? <CashCard title="Cash OS source unavailable"><p className="text-sm text-amber-300">{cash.reason}: {cash.error}</p><button onClick={cash.refresh} className="mt-4 rounded-lg border border-[var(--border-primary)] px-4 py-2 text-sm">Retry read</button></CashCard>
      : cash.status === 'empty' ? <CashCard title="Ledger empty"><p className="text-sm text-[var(--text-secondary)]">No posted transactions were loaded for an included cash account. Record or verify an opening balance before Outlook publishes cash totals.</p></CashCard>
      : cash.status === 'partial' && tab === 'Outlook' ? <CashCard title="Partial / Needs attention"><p className="text-sm text-amber-300">Payroll inputs need review. Authoritative cash totals and trajectory are withheld until the missing or overlapping source is resolved.</p>
        <ul className="mt-3 space-y-1 text-xs text-[var(--text-secondary)]">{cash.snapshot?.payrollDiagnostics.map((d, index) => <li key={`${d.kind}:${index}`}>{d.kind.replace(/_/g, ' ')}: {d.note}</li>)}</ul></CashCard>
      : cash.status === 'partial' && (tab === 'Calendar' || tab === 'Projects') ? <CashCard title="Partial / Needs attention"><p className="text-sm text-amber-300">Payroll inputs need review before projected events or project funding coverage can be published. Payroll, Transactions, Obligations, and Performance remain available.</p></CashCard>
      : cash.snapshot ? <>
        {tab === 'Outlook' && authoritative && <CashOsOutlook snapshot={cash.snapshot} horizonDays={cash.horizonDays} confidenceMode={cash.confidenceMode} onHorizon={cash.setHorizonDays} onConfidence={cash.setConfidenceMode} />}
        {tab === 'Calendar' && <div className="space-y-4"><div className="flex flex-wrap gap-2" aria-label="Calendar horizon">{([7, 14, 30, 60, 90] as const).map(days => <button key={days} onClick={() => cash.setHorizonDays(days)} aria-pressed={cash.horizonDays === days}
          className={`rounded-lg px-3 py-2 text-xs font-semibold ${cash.horizonDays === days ? 'bg-emerald-500/20 text-emerald-300' : 'bg-[var(--bg-card)] text-[var(--text-secondary)]'}`}>{days} days</button>)}</div><CashCalendarView snapshot={cash.snapshot} /></div>}
        {tab === 'Projects' && <CashProjectsView snapshot={cash.snapshot} />}
        {tab === 'Payroll' && <CashPayrollView snapshot={cash.snapshot} partial={cash.status === 'partial'} />}
        {tab === 'Transactions' && <CashTransactionsView snapshot={cash.snapshot} />}
        {tab === 'Obligations' && <CashObligationsView snapshot={cash.snapshot} />}
      </> : <CashCard><p className="text-sm text-[var(--text-secondary)]">Cash OS has no ready snapshot. Complete session assumptions or refresh the source reads.</p></CashCard>}
  </div>

  function setEditingAndOutlook() {
    setTab('Outlook')
    cash.setEditing(true)
  }
}
