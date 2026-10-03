import type { CashOsSourceBundle } from '@/services/cashOsReadService'
import type { CashOsSnapshot } from '@/finance/cashOsSnapshot'
import { accountBalanceMinor } from '@/finance/ledgerCalculations'
import { CashCard, CashEmpty, money } from './cashOsUi'

interface CashOsDebtPlanProps {
  sources: CashOsSourceBundle | null
  snapshot: CashOsSnapshot | null
  showTrulyFreeCash: boolean
}

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  credit_card: 'Credit card',
  loan: 'Loan',
  other_liability: 'Other liability',
}

function balanceForAccount(
  accountId: string,
  sources: CashOsSourceBundle,
  snapshot: CashOsSnapshot | null,
): number {
  if (snapshot) return snapshot.accountBalancesMinor[accountId] ?? 0
  return accountBalanceMinor(accountId, sources.transactions, sources.asOfDate)
}

export default function CashOsDebtPlan({ sources, snapshot, showTrulyFreeCash }: CashOsDebtPlanProps) {
  if (!sources) {
    return (
      <CashCard>
        <p className="text-sm text-[var(--text-secondary)]">Canonical debt sources loading…</p>
      </CashCard>
    )
  }

  const liabilityAccounts = sources.accounts.filter(
    a => a.account_class === 'liability' && a.status === 'active',
  )

  const trulyFree = showTrulyFreeCash ? (snapshot?.allocation.trulyFreeCashMinor ?? null) : null

  return (
    <div className="space-y-5">
      {trulyFree !== null && (
        <div className="min-w-0 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-4">
          <span className="block text-[10px] font-bold tracking-[0.16em] text-[var(--text-secondary)]">TRULY FREE CASH</span>
          <strong className="mt-2 block break-words font-mono text-xl sm:text-2xl">{money(trulyFree)}</strong>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Owner decision — not automatically allocated to debt.
          </p>
        </div>
      )}

      <CashCard title="Liability accounts">
        {liabilityAccounts.length ? (
          <div className="space-y-3">
            {liabilityAccounts.map(account => {
              const balance = balanceForAccount(account.id, sources, snapshot)
              return (
                <div key={account.id} className="rounded-xl border border-[var(--border-primary)] p-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <strong>{account.display_name}</strong>
                      <p className="mt-1 text-xs text-[var(--text-secondary)]">
                        {ACCOUNT_TYPE_LABELS[account.account_type] ?? account.account_type.replace(/_/g, ' ')}
                        {' · '}
                        {account.ownership_context === 'business' ? 'Business' : 'Personal'}
                      </p>
                      <p className="mt-2 font-mono font-semibold">{money(balance)}</p>
                      <p className="text-xs text-[var(--text-muted)]">Current balance · canonical ledger</p>
                    </div>
                    <div className="shrink-0 text-right text-xs text-[var(--text-secondary)]">
                      <p>APR — not set</p>
                      <p>Min. payment — not set</p>
                      <p className="mt-1 text-[10px] italic text-[var(--text-muted)]">Debt terms not stored</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <CashEmpty>
            No active liability accounts. Add a credit card or loan account to track debt here.
          </CashEmpty>
        )}
      </CashCard>

      {!snapshot && liabilityAccounts.length > 0 && (
        <CashCard>
          <p className="text-sm text-[var(--text-secondary)]">
            Truly Free Cash and assumption-dependent values require Session Assumptions.
          </p>
        </CashCard>
      )}
    </div>
  )
}
