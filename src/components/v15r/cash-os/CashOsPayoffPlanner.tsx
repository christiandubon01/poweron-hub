import { useState, useMemo } from 'react'
import type { CashOsSourceBundle } from '@/services/cashOsReadService'
import type { CashOsSnapshot } from '@/finance/cashOsSnapshot'
import { accountBalanceMinor } from '@/finance/ledgerCalculations'
import {
  computePortfolioPayoff,
  type DebtInputRaw,
  type PayoffStrategy,
  type OwnershipScope,
  type DebtPayoffResult,
} from '@/finance/debtPayoffEngine'
import { CashCard, CashEmpty, cashDate, money } from './cashOsUi'

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildDebtInputs(sources: CashOsSourceBundle): DebtInputRaw[] {
  const liabilityAccounts = sources.accounts.filter(
    a => a.status === 'active' && a.account_class === 'liability',
  )
  return liabilityAccounts.map(account => {
    const balance = accountBalanceMinor(account.id, sources.transactions)
    const terms = (sources.liabilityTerms ?? []).find(t => t.account_id === account.id)
    return {
      accountId: account.id,
      label: account.display_name,
      ownershipContext: account.ownership_context as 'business' | 'personal',
      balanceMinor: Math.max(0, balance),
      debtStructure: terms?.debt_structure ?? null,
      aprBasisPoints: terms?.apr_basis_points ?? null,
      minimumPaymentMinor: terms?.minimum_payment_minor ?? null,
      scheduledPaymentMinor: terms?.scheduled_payment_minor ?? null,
      promoAprBasisPoints: terms?.promo_apr_basis_points ?? null,
      promoType: terms?.promo_type ?? null,
      promoStartedOn: terms?.promo_started_on ?? null,
      promoExpiresOn: terms?.promo_expires_on ?? null,
    }
  })
}

function parseModeledExtraMinor(raw: string, maxMinor: number | null): number {
  const val = parseFloat(raw.replace(/[^0-9.]/g, ''))
  if (!Number.isFinite(val) || val < 0) return 0
  const minor = Math.round(val * 100)
  return maxMinor != null ? Math.min(minor, Math.max(0, maxMinor)) : minor
}

function formatMonths(months: number): string {
  if (!isFinite(months)) return '—'
  const y = Math.floor(months / 12)
  const m = months % 12
  if (y === 0) return `${m} mo`
  if (m === 0) return `${y} yr`
  return `${y} yr ${m} mo`
}

const labelCls = 'block text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]'
const inputCls = 'mt-1 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 text-sm'
const chipActive = 'rounded-lg bg-orange-500/20 px-3 py-1.5 text-xs font-semibold text-orange-300 border border-orange-500/30'
const chipInactive = 'rounded-lg border border-[var(--border-primary)] px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]'

// ── Per-debt result row ───────────────────────────────────────────────────────

function DebtRow({ d, showExtra }: { d: DebtPayoffResult; showExtra: boolean }) {
  const insufficient = !d.sufficiency.ok

  return (
    <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="truncate">{d.label}</strong>
            {d.ownershipContext === 'personal' && (
              <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-300">Personal</span>
            )}
          </div>
          <p className="mt-0.5 font-mono text-[var(--text-secondary)]">{money(d.balanceMinor)} balance</p>
        </div>
        <div className="text-right">
          {insufficient ? (
            <span className="rounded bg-amber-500/15 px-2 py-1 text-xs font-semibold text-amber-300">Needs terms</span>
          ) : d.nonAmortizing ? (
            <span className="rounded bg-red-500/15 px-2 py-1 text-xs font-semibold text-red-300">Does not amortize</span>
          ) : (
            <span className="font-semibold text-green-300">{formatMonths(d.payoffMonths)}</span>
          )}
        </div>
      </div>

      {insufficient && d.sufficiency.ok === false && (
        <p className="mt-2 text-xs text-amber-300">
          Missing: {d.sufficiency.missingFields.join(', ')}
        </p>
      )}

      {d.nonAmortizing && (
        <p className="mt-2 text-xs text-red-300">
          Payment does not currently amortize this debt. Increase payment to reduce balance.
        </p>
      )}

      {!insufficient && !d.nonAmortizing && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)]">
          {d.payoffDate && <span>Payoff: {cashDate(d.payoffDate)}</span>}
          <span>Est. interest: {isFinite(d.estimatedInterestMinor) ? money(d.estimatedInterestMinor) : '—'}</span>
          {d.contractualPaymentMinor != null && (
            <span>Contractual: {money(d.contractualPaymentMinor)}/mo</span>
          )}
          {showExtra && d.modeledExtraMinor > 0 && (
            <span className="text-orange-300">+{money(d.modeledExtraMinor)} extra applied</span>
          )}
        </div>
      )}

      {d.promoDeadlineRisk && d.promoExpiresOn && (
        <p className="mt-2 rounded bg-amber-500/10 px-2 py-1.5 text-xs text-amber-300">
          Promo deadline risk — projected payoff after {cashDate(d.promoExpiresOn)}.
          Pay off before that date to avoid deferred interest charges.
        </p>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CashOsPayoffPlanner({
  sources,
  snapshot,
}: {
  sources: CashOsSourceBundle | null
  snapshot: CashOsSnapshot | null
}) {
  const [scope, setScope] = useState<OwnershipScope>('all')
  const [strategy, setStrategy] = useState<PayoffStrategy>('avalanche')
  const [targetDebtId, setTargetDebtId] = useState<string | null>(null)
  const [modeledExtraRaw, setModeledExtraRaw] = useState('')

  const tfcMinor: number | null = snapshot?.allocation?.trulyFreeCashMinor ?? null
  const hasTfc = tfcMinor != null

  const modeledExtraMinor = useMemo(
    () => parseModeledExtraMinor(modeledExtraRaw, tfcMinor),
    [modeledExtraRaw, tfcMinor],
  )

  const debtInputs = useMemo(
    () => (sources ? buildDebtInputs(sources) : []),
    [sources],
  )

  const projectionStartDate = sources?.asOfDate ?? new Date().toISOString().slice(0, 10)

  const result = useMemo(() => {
    if (!debtInputs.length) return null
    return computePortfolioPayoff({
      debts: debtInputs,
      strategy,
      scope,
      extraAvailableMinor: modeledExtraMinor,
      targetDebtAccountId: strategy === 'target_debt' ? targetDebtId : null,
      projectionStartDate,
      trulyFreeCashMinor: tfcMinor,
    })
  }, [debtInputs, strategy, scope, modeledExtraMinor, targetDebtId, projectionStartDate, tfcMinor])

  const sufficientDebts = debtInputs.filter(d => d.balanceMinor > 0)
  const targetCandidates = useMemo(
    () => debtInputs.filter(d => {
      if (d.balanceMinor <= 0) return false
      if (scope !== 'all' && d.ownershipContext !== scope) return false
      return true
    }),
    [debtInputs, scope],
  )

  if (!sources) {
    return (
      <CashCard title="Payoff Planner">
        <p className="text-sm text-[var(--text-secondary)]">Sources loading…</p>
      </CashCard>
    )
  }

  if (sufficientDebts.length === 0) {
    return (
      <CashCard title="Payoff Planner">
        <CashEmpty>No active liability accounts found. Add debt accounts and record balances to use the planner.</CashEmpty>
      </CashCard>
    )
  }

  const remainingTfcMinor = hasTfc ? Math.max(0, tfcMinor! - modeledExtraMinor) : null

  return (
    <div className="space-y-5">

      {/* Controls */}
      <CashCard title="Payoff Planner">
        <p className="mb-4 text-xs text-[var(--text-secondary)]">
          Planning estimates only. Interest is calculated as{' '}
          <code className="rounded bg-white/5 px-1">round(balance × APR / 12)</code> in minor currency units.
          Actual issuer calculations may differ.
        </p>

        {/* TFC row */}
        {hasTfc && (
          <div className="mb-4 grid grid-cols-3 gap-3 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-3 text-center text-xs">
            <div>
              <p className="font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Available TFC</p>
              <p className="mt-1 font-mono text-base font-bold">{money(tfcMinor!)}</p>
            </div>
            <div>
              <p className="font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Modeled toward debt</p>
              <p className="mt-1 font-mono text-base font-bold text-orange-300">{money(modeledExtraMinor)}</p>
            </div>
            <div>
              <p className="font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Remaining</p>
              <p className={`mt-1 font-mono text-base font-bold ${remainingTfcMinor! < 0 ? 'text-red-300' : ''}`}>
                {money(remainingTfcMinor!)}
              </p>
            </div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {/* Scope */}
          <div>
            <label className={labelCls}>Scope</label>
            <div className="mt-2 flex flex-wrap gap-2">
              {(['all', 'business', 'personal'] as OwnershipScope[]).map(s => (
                <button key={s} type="button"
                  onClick={() => setScope(s)}
                  className={scope === s ? chipActive : chipInactive}>
                  {s === 'all' ? 'All' : s === 'business' ? 'Business' : 'Personal'}
                </button>
              ))}
            </div>
          </div>

          {/* Strategy */}
          <div>
            <label className={labelCls}>Strategy</label>
            <div className="mt-2 flex flex-wrap gap-2">
              {([
                ['baseline', 'Baseline'],
                ['avalanche', 'Avalanche'],
                ['snowball', 'Snowball'],
                ['target_debt', 'Target'],
              ] as [PayoffStrategy, string][]).map(([s, label]) => (
                <button key={s} type="button"
                  onClick={() => setStrategy(s)}
                  className={strategy === s ? chipActive : chipInactive}>
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[10px] text-[var(--text-muted)]">
              {strategy === 'baseline' && 'Contractual payments only — no extra, no cascade.'}
              {strategy === 'avalanche' && 'Highest APR first — minimizes total interest.'}
              {strategy === 'snowball' && 'Lowest balance first — maximizes early wins.'}
              {strategy === 'target_debt' && 'Direct extra payment to one specific debt.'}
            </p>
          </div>

          {/* Target debt selector */}
          {strategy === 'target_debt' && (
            <div className="sm:col-span-2">
              <label className={labelCls}>Target debt</label>
              <select
                value={targetDebtId ?? ''}
                onChange={e => setTargetDebtId(e.target.value || null)}
                className={inputCls}
              >
                <option value="">— Select a debt —</option>
                {targetCandidates.map(d => (
                  <option key={d.accountId} value={d.accountId}>
                    {d.label} ({money(d.balanceMinor)})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Modeled extra */}
          {strategy !== 'baseline' && (
            <div>
              <label className={labelCls}>
                Modeled extra / month
                {hasTfc && <span className="ml-1 normal-case text-[var(--text-muted)]">(max {money(tfcMinor!)})</span>}
              </label>
              <input
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={modeledExtraRaw}
                onChange={e => setModeledExtraRaw(e.target.value)}
                className={inputCls}
              />
              <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                Session-only — no transaction or obligation is created.
              </p>
            </div>
          )}
        </div>
      </CashCard>

      {/* Per-debt projections */}
      {result && (
        <CashCard title="Debt projections">
          {result.debts.length === 0 ? (
            <CashEmpty>No debts in scope.</CashEmpty>
          ) : (
            <div className="space-y-3">
              {result.debts
                .slice()
                .sort((a, b) => {
                  // Sufficient debts by payoffOrder, insufficient at end
                  if (a.sufficiency.ok && !b.sufficiency.ok) return -1
                  if (!a.sufficiency.ok && b.sufficiency.ok) return 1
                  if (a.sufficiency.ok && b.sufficiency.ok) return a.payoffOrder - b.payoffOrder
                  return a.label.localeCompare(b.label)
                })
                .map(d => (
                  <DebtRow key={d.accountId} d={d} showExtra={strategy !== 'baseline'} />
                ))}
            </div>
          )}
        </CashCard>
      )}

      {/* Portfolio summary */}
      {result && result.debts.some(d => d.sufficiency.ok) && (
        <CashCard title="Portfolio summary">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <p className={labelCls}>Portfolio payoff</p>
              <p className="mt-1 font-mono text-lg font-bold">
                {result.portfolioPayoffMonths != null
                  ? formatMonths(result.portfolioPayoffMonths)
                  : '—'}
              </p>
              {result.portfolioPayoffDate && (
                <p className="text-xs text-[var(--text-secondary)]">{cashDate(result.portfolioPayoffDate)}</p>
              )}
            </div>
            <div>
              <p className={labelCls}>Est. total interest</p>
              <p className="mt-1 font-mono text-lg font-bold">
                {result.totalPortfolioInterestMinor != null
                  ? money(result.totalPortfolioInterestMinor)
                  : '—'}
              </p>
            </div>
            <div>
              <p className={labelCls}>Status</p>
              <p className="mt-1 text-sm">
                {result.portfolioComplete ? (
                  <span className="text-green-300">All debts modeled</span>
                ) : (
                  <span className="text-amber-300">
                    {result.incompleteAccountIds.length} debt{result.incompleteAccountIds.length !== 1 ? 's' : ''} need terms
                  </span>
                )}
              </p>
            </div>
          </div>

          {result.incompleteAccountIds.length > 0 && (
            <p className="mt-3 text-xs text-[var(--text-secondary)]">
              Portfolio payoff date and total interest require all debts to have complete terms.
              Add APR and payment terms in Debt Plan → Edit Terms.
            </p>
          )}
        </CashCard>
      )}
    </div>
  )
}
