import { useState } from 'react'
import CashMoneyPlan from './CashMoneyPlan'
import type { DetailTab } from './commandCenterModel'

const DETAIL_LINKS: Array<{ tab: DetailTab; hint: string }> = [
  { tab: 'Calendar', hint: 'Every dated bill and inflow' },
  { tab: 'Projects', hint: 'Collection clock and project funding' },
  { tab: 'Payroll', hint: 'Wages owed and diagnostics' },
  { tab: 'Transactions', hint: 'Accounts and ledger' },
  { tab: 'Obligations', hint: 'Recurring bills and commitments' },
  { tab: 'Debt Plan', hint: 'Balances, terms and payoff' },
]

/**
 * One compact way to reach the deeper views Outlook no longer renders by default.
 * The detailed tabs are the existing Cash OS navigation; Money Plan (buckets/envelopes) is mounted
 * only when asked for, so it is not part of the default reading flow but loses no function.
 */
export default function CashOsDetailsAccess({ totalCashMinor, onNavigate }: {
  totalCashMinor: number
  onNavigate?: (tab: DetailTab) => void
}) {
  const [open, setOpen] = useState(false)
  const [planOpen, setPlanOpen] = useState(false)
  return <section data-testid="details-access" aria-label="More financial detail" className="rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-4">
    <button type="button" aria-expanded={open} aria-controls="cash-details-panel" onClick={() => setOpen(v => !v)}
      className="flex min-h-[44px] w-full items-center justify-between gap-3 text-left">
      <span className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--text-secondary)]">More financial detail</span>
      <span aria-hidden="true" className="text-[var(--text-secondary)]">{open ? '⌃' : '›'}</span>
    </button>
    {open && <div id="cash-details-panel" className="mt-2 space-y-3">
      {onNavigate && <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{DETAIL_LINKS.map(link => <button key={link.tab} type="button" onClick={() => onNavigate(link.tab)}
        data-testid={`details-link-${link.tab.replace(/\s+/g, '-').toLowerCase()}`}
        className="min-h-[44px] rounded-lg px-3 py-2 text-left ring-1 ring-[var(--border-primary)] hover:bg-white/5">
        <span className="block text-sm font-semibold">{link.tab} →</span>
        <span className="block text-xs text-[var(--text-secondary)]">{link.hint}</span>
      </button>)}</div>}
      <div>
        <button type="button" aria-expanded={planOpen} aria-controls="cash-money-plan-panel" onClick={() => setPlanOpen(v => !v)}
          className="min-h-[44px] rounded-lg px-3 py-2 text-sm font-semibold ring-1 ring-[var(--border-primary)] hover:bg-white/5">
          {planOpen ? 'Hide Money Plan' : 'Money Plan (buckets & envelopes)'}
        </button>
        {planOpen && <div id="cash-money-plan-panel" className="mt-3"><CashMoneyPlan totalCashMinor={totalCashMinor} /></div>}
      </div>
    </div>}
  </section>
}
