import { useState } from 'react'
import type { CashOsSourceBundle } from '@/services/cashOsReadService'
import type { CashOsSnapshot } from '@/finance/cashOsSnapshot'
import type { LiabilityTermsRow, PromoType } from '@/finance/liabilityTermsTypes'
import { accountBalanceMinor } from '@/finance/ledgerCalculations'
import { CashCard, CashEmpty, money } from './cashOsUi'
import CashOsDebtTermsEditor from './CashOsDebtTermsEditor'

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

const STRUCTURE_LABELS: Record<string, string> = {
  revolving: 'Revolving',
  installment: 'Installment',
  other: 'Other',
}

const PROMO_TYPE_HEADINGS: Record<PromoType, string> = {
  intro_apr: 'Intro APR',
  deferred_interest: 'Deferred interest',
  reduced_apr_fixed_payment: 'Promo financing (fixed payment)',
  other: 'Promotional financing',
}

function balanceForAccount(
  accountId: string,
  sources: CashOsSourceBundle,
  snapshot: CashOsSnapshot | null,
): number {
  if (snapshot) return snapshot.accountBalancesMinor[accountId] ?? 0
  return accountBalanceMinor(accountId, sources.transactions, sources.asOfDate)
}

function fmtApr(bp: number | null): string {
  if (bp == null) return '—'
  return `${(bp / 100).toFixed(2)}%`
}

function fmtMonthYear(date: string | null): string {
  if (!date) return ''
  const d = new Date(date + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

function fmtFullDate(date: string | null): string {
  if (!date) return '—'
  const d = new Date(date + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtDueDay(day: number | null): string {
  if (day == null) return '—'
  const suffix = day === 1 || day === 21 || day === 31 ? 'st'
    : day === 2 || day === 22 ? 'nd'
    : day === 3 || day === 23 ? 'rd' : 'th'
  return `${day}${suffix} of each month`
}

function TermRow({ label, value }: { label: string; value: string }) {
  const missing = value === '—'
  return (
    <div className="flex justify-between gap-2 text-xs">
      <span className="text-[var(--text-secondary)]">{label}</span>
      <span className={missing ? 'italic text-[var(--text-muted)]' : 'font-mono text-[var(--text-primary)]'}>
        {missing ? 'not set' : value}
      </span>
    </div>
  )
}

function PromoBlock({ terms }: { terms: LiabilityTermsRow }) {
  const hasPromo = terms.promo_apr_basis_points != null || terms.promo_type != null || terms.promo_expires_on != null
  if (!hasPromo) return null

  const heading = terms.promo_type ? PROMO_TYPE_HEADINGS[terms.promo_type] : 'Promotional financing'
  const isDeferred = terms.promo_type === 'deferred_interest'

  return (
    <div className="rounded-lg border border-[var(--border-secondary,var(--border-primary))] bg-[var(--bg-subtle,var(--bg-card))] px-3 py-2 text-xs">
      <p className="font-semibold text-[var(--text-primary)]">{heading}</p>
      {isDeferred ? (
        <>
          <p className="mt-0.5 text-[var(--text-secondary)]">
            {terms.promo_expires_on
              ? `0% if paid in full by ${fmtFullDate(terms.promo_expires_on)}`
              : 'Deadline not set — interest may accrue retroactively if not paid in full'}
          </p>
          {terms.promo_started_on && (
            <p className="text-[var(--text-muted)]">Started: {fmtFullDate(terms.promo_started_on)}</p>
          )}
          <p className="mt-1 text-[var(--text-muted)]">
            Standard APR: {fmtApr(terms.apr_basis_points)}
          </p>
        </>
      ) : (
        <>
          <p className="mt-0.5 text-[var(--text-secondary)]">
            {fmtApr(terms.promo_apr_basis_points)}
            {terms.promo_expires_on ? ` through ${fmtMonthYear(terms.promo_expires_on)}` : ''}
            {terms.promo_started_on ? ` · started ${fmtMonthYear(terms.promo_started_on)}` : ''}
          </p>
          <p className="mt-1 text-[var(--text-muted)]">
            {terms.promo_type === 'intro_apr' ? 'Then standard APR:' : 'Standard APR:'}{' '}
            {fmtApr(terms.apr_basis_points)}
          </p>
        </>
      )}
    </div>
  )
}

export default function CashOsDebtPlan({ sources, snapshot, showTrulyFreeCash }: CashOsDebtPlanProps) {
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null)
  const [savedTermsById, setSavedTermsById] = useState<Record<string, LiabilityTermsRow>>({})

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

  // Index terms by account_id; prefer locally saved override after an edit
  const termsIndex: Record<string, LiabilityTermsRow> = {}
  for (const t of (sources.liabilityTerms ?? [])) {
    termsIndex[t.account_id] = t
  }
  Object.assign(termsIndex, savedTermsById)

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
              const terms = termsIndex[account.id] ?? null
              const isEditing = editingAccountId === account.id

              return (
                <div key={account.id} className="rounded-xl border border-[var(--border-primary)] p-3 text-sm">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <strong className="block truncate">{account.display_name}</strong>
                      <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                        {ACCOUNT_TYPE_LABELS[account.account_type] ?? account.account_type.replace(/_/g, ' ')}
                        {' · '}
                        {account.ownership_context === 'business' ? 'Business' : 'Personal'}
                        {terms?.debt_structure ? ` · ${STRUCTURE_LABELS[terms.debt_structure] ?? terms.debt_structure}` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditingAccountId(isEditing ? null : account.id)}
                      className="shrink-0 rounded-md border border-[var(--border-primary)] px-2 py-1 text-[10px] font-semibold tracking-wide text-[var(--text-secondary)] hover:bg-[var(--bg-hover,var(--bg-card))]"
                    >
                      {isEditing ? 'Cancel' : 'Edit Terms'}
                    </button>
                  </div>

                  {/* Balance */}
                  <p className="mt-2 font-mono font-semibold">{money(balance)}</p>
                  <p className="text-xs text-[var(--text-muted)]">Current balance · canonical ledger</p>

                  {/* Terms */}
                  <div className="mt-3 space-y-2 border-t border-[var(--border-primary)] pt-3">
                    {/* Promotional financing block — structured display */}
                    {terms && <PromoBlock terms={terms} />}

                    {/* Standard APR — only shown outside promo block context */}
                    {(!terms || !(terms.promo_apr_basis_points != null || terms.promo_type != null || terms.promo_expires_on != null)) && (
                      <TermRow label="APR" value={fmtApr(terms?.apr_basis_points ?? null)} />
                    )}

                    <TermRow
                      label={terms?.debt_structure === 'installment' ? 'Contractual payment' : 'Min. payment'}
                      value={terms?.minimum_payment_minor != null ? money(terms.minimum_payment_minor) : '—'}
                    />
                    <TermRow
                      label="Due"
                      value={
                        terms?.next_due_date
                          ? `Next: ${fmtFullDate(terms.next_due_date)}`
                          : fmtDueDay(terms?.payment_due_day ?? null)
                      }
                    />

                    {/* Installment extras */}
                    {terms?.debt_structure === 'installment' && (
                      <>
                        {terms.scheduled_payment_minor != null && (
                          <TermRow label="Scheduled payment" value={money(terms.scheduled_payment_minor)} />
                        )}
                        {terms.original_principal_minor != null && (
                          <TermRow label="Original principal" value={money(terms.original_principal_minor)} />
                        )}
                        {terms.maturity_date && (
                          <TermRow label="Maturity" value={fmtFullDate(terms.maturity_date)} />
                        )}
                      </>
                    )}

                    {!terms && (
                      <p className="text-[10px] italic text-[var(--text-muted)]">Debt terms not stored</p>
                    )}

                    {terms?.owner_notes && (
                      <p className="mt-1 text-[10px] text-[var(--text-muted)]">{terms.owner_notes}</p>
                    )}
                  </div>

                  {/* Inline editor */}
                  {isEditing && (
                    <CashOsDebtTermsEditor
                      accountId={account.id}
                      accountDisplayName={account.display_name}
                      initialTerms={terms}
                      onSave={saved => {
                        setSavedTermsById(prev => ({ ...prev, [account.id]: saved }))
                        setEditingAccountId(null)
                      }}
                      onCancel={() => setEditingAccountId(null)}
                    />
                  )}
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
