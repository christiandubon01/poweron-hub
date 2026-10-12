/**
 * src/features/cash-position/CashPositionPanel.tsx
 *
 * The consolidated cash position (PLAID-3C) in the Cash OS Transactions view. It shows what the banks report, KEPT APART, with where every figure came from:
 *
 *   Bank cash        provider-reported balances, by ownership, with how current they are. A missing balance is "not available", never $0.
 *   Owed             credit-card and loan balances. A liability, never subtracted from cash. Unused credit says it is not cash.
 *   Last N days      money in and out placed by what YOU decided: only a customer payment you confirmed is income; everything else says what it is or that it is
 *                    not classified yet. Transfers and card payments between your accounts are one movement, in neither income nor spending.
 *   Manual ledger    the balances Cash OS already holds, beside the bank's, with the difference. Information only: neither side is changed.
 *
 * No profit figure exists here, by design. Renders nothing unless the server says the feature is on for this caller.
 */
import { useMemo, useState } from 'react'
import { btn, btnQuiet, eyebrow } from '../spending-explorer/ui'
import { Chip, SegmentedControl, type ChipTone } from '../spending-explorer/controls'
import { shortDate, signedUsd2, usd2 } from '../spending-explorer/format'
import { compareManualLedger, type ActivityLine, type CashBucket, type Completeness, type ConsolidatedPositionData, type DebtBucket, type Figure, type ManualLedgerAccount, type PositionAccount, type PositionScope, type Provenance } from '@/finance/bankPosition'
import { usePosition, type PositionDays } from './usePosition'

const PROV: Record<Provenance, { label: string; tone: ChipTone }> = {
  provider_reported: { label: 'Bank-reported', tone: 'neutral' },
  derived: { label: 'Derived', tone: 'muted' },
  owner_classified: { label: 'You classified', tone: 'done' },
  manual_ledger: { label: 'Manual ledger', tone: 'neutral' },
  unavailable: { label: 'Not available', tone: 'muted' },
}
const COMPLETE: Record<Completeness, { label: string; tone: ChipTone } | null> = {
  current: { label: 'Current', tone: 'done' }, not_current: { label: 'Not current', tone: 'warn' }, incomplete: { label: 'Incomplete', tone: 'warn' }, unavailable: { label: 'No balance yet', tone: 'muted' }, none: null,
}
const SCOPE_LABEL: Record<PositionScope, string> = { business: 'Business accounts', personal: 'Personal accounts', unmapped: 'Not linked to Cash OS' }
const CLASS_LABEL = { bank_cash: 'Bank account', credit_card: 'Credit card', loan: 'Loan' } as const
const WINDOWS: Array<{ value: `${PositionDays}`; label: string }> = [{ value: '30', label: '30 days' }, { value: '60', label: '60 days' }, { value: '90', label: '90 days' }]

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null)
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)
/** A figure, or "—" when it is not known. Never a made-up $0.00. */
const fig = (f: Figure) => (f.minor === null ? '—' : signedUsd2(f.minor))
const Prov = ({ p, testId }: { p: Provenance; testId?: string }) => <Chip tone={PROV[p].tone} testId={testId}>{PROV[p].label}</Chip>

/** One plain sentence on how far a total can be trusted. */
function trust(c: { census: CashBucket['census']; completeness: Completeness; observed: CashBucket['observed'] }): string {
  const n = c.census
  switch (c.completeness) {
    case 'current': return `${n.accounts} ${plural(n.accounts, 'account', 'accounts')}, all updated in the last 24 hours`
    case 'not_current': return `${n.aging + n.stale} of ${n.accounts} ${plural(n.accounts, 'balance', 'balances')} ${plural(n.aging + n.stale, 'is', 'are')} older than 24 hours · oldest ${when(c.observed.oldest) ?? 'unknown'}`
    case 'incomplete': return `${n.missing} of ${n.accounts} ${plural(n.accounts, 'account', 'accounts')} ${plural(n.missing, 'has', 'have')} no balance yet and ${plural(n.missing, 'is', 'are')} left out of this total`
    case 'unavailable': return 'No balance has been received yet'
    default: return ''
  }
}

function Row({ label, value, sub, prov, testId, strong, children }: { label: string; value?: string; sub?: string; prov?: Provenance; testId?: string; strong?: boolean; children?: React.ReactNode }) {
  return <div className="py-2" data-testid={testId}>
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <span className={`min-w-0 text-sm ${strong ? 'font-semibold' : ''}`}>{label}</span>
      {value !== undefined && <span className="shrink-0 text-base font-semibold tabular-nums" data-testid={testId ? `${testId}-value` : undefined}>{value}</span>}
    </div>
    {(sub || prov || children) && <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--text-secondary)]">{prov && <Prov p={prov} />}{prov && sub ? ' ' : null}{sub && <span>{sub}</span>}{children}</div>}
  </div>
}

function CashRow({ scope, b, testId }: { scope: string; b: CashBucket; testId: string }) {
  if (b.completeness === 'none') return null
  const chip = COMPLETE[b.completeness]
  const a = b.available
  return <div className="py-2" data-testid={testId} data-completeness={b.completeness}>
    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
      <span className="text-sm font-semibold">{scope}</span>
      <span className="text-lg font-semibold tabular-nums" data-testid={`${testId}-balance`}>{fig(b.balance)}</span>
    </div>
    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--text-secondary)]">
      {chip && <Chip tone={chip.tone} testId={`${testId}-status`}>{chip.label}</Chip>}{' '}<Prov p={b.balance.provenance} />{' '}<span>{trust(b)}</span>
    </div>
    {b.balance.minor !== null && <p className="mt-0.5 text-xs text-[var(--text-secondary)]" data-testid={`${testId}-available`}>
      {a.minor === null ? 'Available balance: not reported by the bank' : `Available ${signedUsd2(a.minor)}${a.reportedBy < a.of ? ` (reported by ${a.reportedBy} of ${a.of} ${plural(a.of, 'account', 'accounts')})` : ''}`}
    </p>}
  </div>
}

function DebtRow({ title, b, testId, cards }: { title: string; b: DebtBucket; testId: string; cards?: boolean }) {
  if (b.completeness === 'none') return null
  const chip = COMPLETE[b.completeness]
  return <div className="py-2" data-testid={testId} data-completeness={b.completeness}>
    <div className="flex flex-wrap items-baseline justify-between gap-x-3"><span className="text-sm font-semibold">{title}</span><span className="text-lg font-semibold tabular-nums" data-testid={`${testId}-owed`}>{fig(b.owed)}</span></div>
    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--text-secondary)]">{chip && <Chip tone={chip.tone}>{chip.label}</Chip>}{' '}<Prov p={b.owed.provenance} />{' '}<span>owed · {trust(b)}</span></div>
    {b.inFavour.minor ? <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{signedUsd2(b.inFavour.minor)} in your favour (an overpayment), not netted against anything.</p> : null}
    {cards && <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--text-secondary)]" data-testid={`${testId}-unused`}>
      {b.unusedCredit.minor === null ? 'Unused credit: not reported' : <><span className="font-semibold text-[var(--text-primary)]">{signedUsd2(b.unusedCredit.minor)}</span>{' '}<span>unused credit · not cash</span>{' '}<Prov p={b.unusedCredit.provenance} /></>}
      {b.creditLimit.minor !== null && <>{' '}<span>· limit {signedUsd2(b.creditLimit.minor)}{b.creditLimit.reportedBy < b.creditLimit.of ? ` (${b.creditLimit.reportedBy} of ${b.creditLimit.of})` : ''}</span></>}
    </p>}
  </div>
}

/** "$A you classified · $B <derived wording>": only the parts that exist (an empty part is not shown as $0.00). */
const split = (l: ActivityLine, derivedWording: string): string | undefined => {
  const parts = [l.ownerClassified.outMinor ? `${usd2(l.ownerClassified.outMinor)} you classified` : '', l.derived.outMinor ? `${usd2(l.derived.outMinor)} ${derivedWording}` : ''].filter(Boolean)
  return parts.length ? parts.join(' · ') : undefined
}
type Side = 'in' | 'out' | 'moved'
/** What a line's number is: money in, money out, or (for a confirmed movement between own accounts) the amount moved, showing both sides only when they differ. */
function amountText(l: ActivityLine, side: Side): string {
  if (side === 'in') return l.inMinor ? usd2(l.inMinor) : '—'
  if (side === 'out') return l.outMinor ? usd2(l.outMinor) : '—'
  if (!l.inMinor && !l.outMinor) return '—'
  return l.inMinor === l.outMinor ? usd2(l.outMinor) : [l.outMinor ? `out ${usd2(l.outMinor)}` : '', l.inMinor ? `in ${usd2(l.inMinor)}` : ''].filter(Boolean).join(' · ')
}
function Line({ l, side, prov, note, testId }: { l: ActivityLine; side: Side; prov: Provenance; note?: string; testId: string }) {
  const sub = [`${l.count} ${plural(l.count, 'transaction', 'transactions')}`, note].filter(Boolean).join(' · ')
  return <Row testId={testId} label={l.label} value={amountText(l, side)} prov={l.count ? prov : undefined} sub={l.count ? sub : 'None in this period'} />
}

function Accounts({ accounts }: { accounts: PositionAccount[] }) {
  const [open, setOpen] = useState(false)
  if (!accounts.length) return null
  return <div className="mt-1">
    <button type="button" className={`${btnQuiet} -ml-3`} aria-expanded={open} onClick={() => setOpen(o => !o)} data-testid="position-accounts-toggle">{open ? '▾' : '▸'} Accounts ({accounts.length})</button>
    {open && <ul className="divide-y divide-[var(--surface-line)]" data-testid="position-accounts">{accounts.map(a => <li key={a.ref} className="py-2 text-sm" data-testid="position-account-row" data-class={a.accountClass} data-freshness={a.freshness}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3"><span className="min-w-0 truncate font-semibold" title={a.label}>{a.label}</span><span className="tabular-nums">{a.balanceMinor === null ? '—' : signedUsd2(a.balanceMinor)}</span></div>
      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--text-secondary)]">
        <Chip tone="muted">{CLASS_LABEL[a.accountClass]}{a.restricted ? ' · restricted' : ''}</Chip><Chip tone="neutral">{SCOPE_LABEL[a.scope].replace(' accounts', '')}</Chip>
        <Chip tone={a.freshness === 'fresh' ? 'done' : a.freshness === 'unknown' ? 'muted' : 'warn'}>{a.freshness === 'fresh' ? 'Current' : a.freshness === 'unknown' ? 'No balance' : a.freshness === 'aging' ? (a.bankTimeKnown === false ? 'Bank time unknown' : 'Over 24 h old') : 'Stale'}</Chip>
        {a.observedAt && <span>as of {when(a.observedAt)}</span>}
        {a.accountClass === 'bank_cash' && a.balanceMinor !== null && <span>{a.availableMinor === null ? 'available: not reported' : `available ${signedUsd2(a.availableMinor)}`}</span>}
        {a.accountClass === 'credit_card' && a.unusedCreditMinor !== null && <span>unused credit {signedUsd2(a.unusedCreditMinor)} (not cash){a.unusedCreditBasis === 'limit_minus_owed' ? ', derived' : ''}</span>}
      </p>
    </li>)}</ul>}
  </div>
}

function Ledger({ data, ledger }: { data: ConsolidatedPositionData; ledger: ManualLedgerAccount[] }) {
  const view = useMemo(() => compareManualLedger(data, ledger), [data, ledger])
  if (!view.lines.length && !view.bankOnly.length) return null
  return <section aria-label="Manual ledger beside the bank" data-testid="position-ledger" className="mt-4 border-t border-[var(--surface-line)] pt-3">
    <p className={eyebrow}>Manual ledger beside the bank</p>
    <p className="mt-1 text-xs text-[var(--text-secondary)]">Your Cash OS ledger and the bank are two records. Differences are information: neither is changed.</p>
    {view.ledgerCash.minor !== null && <Row testId="position-ledger-cash" label="Ledger cash (accounts counted as cash)" value={signedUsd2(view.ledgerCash.minor)} prov="manual_ledger" sub="not bank money" />}
    <ul className="divide-y divide-[var(--surface-line)]">{view.lines.map(l => <li key={l.financialAccountId} className="py-2 text-sm" data-testid="position-ledger-row" data-comparable={l.comparable ? 'true' : 'false'}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3"><span className="min-w-0 truncate font-semibold">{l.name}</span><span className="tabular-nums" data-testid="position-ledger-amount">{signedUsd2(l.ledgerMinor)}</span></div>
      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--text-secondary)]">
        <Prov p="manual_ledger" />
        {l.bank ? <><span>Bank: {l.bank.balanceMinor === null ? 'no balance yet' : signedUsd2(l.bank.balanceMinor)}</span>{l.bank.freshness !== 'fresh' && l.bank.balanceMinor !== null && <Chip tone="warn">bank balance not current</Chip>}</> : <span>No bank account linked</span>}
        {l.differenceMinor !== null && <span data-testid="position-ledger-diff">{l.differenceMinor === 0 ? 'Matches the bank' : `Bank is ${signedUsd2(Math.abs(l.differenceMinor))} ${l.differenceMinor > 0 ? 'higher' : 'lower'} than the ledger`}</span>}
      </p>
    </li>)}</ul>
    {view.bankOnly.length > 0 && <p className="mt-2 text-xs text-[var(--text-secondary)]" data-testid="position-bank-only">{view.bankOnly.length} bank {plural(view.bankOnly.length, 'account has', 'accounts have')} no active Cash OS ledger account to compare with: {view.bankOnly.map(a => a.label).slice(0, 3).join(', ')}{view.bankOnly.length > 3 ? '…' : ''}.</p>}
  </section>
}

/** The position, or nothing at all when the server does not offer it to this caller. */
export default function CashPositionPanel({ ledger = [] }: { ledger?: ManualLedgerAccount[] }) {
  const { data, load, days, setDays, busy, error, refresh } = usePosition()
  const [more, setMore] = useState(false)
  if (load !== 'ready' || !data) return null
  const act = data.activity
  const lines = act?.lines
  const issues = data.issues
  const shownIssues = more ? issues : issues.slice(0, 3)
  return <section aria-label="Cash position" data-testid="cash-position" className="rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-4 sm:p-5" aria-busy={busy}>
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Cash position · what your banks report</h3>
      <span className="text-xs text-[var(--text-secondary)]" data-testid="position-asof">As of {when(data.asOf)}{data.environment === 'sandbox' ? ' · sandbox test data' : ''}</span>
    </div>
    <p className="mt-1 text-xs text-[var(--text-secondary)]">Kept apart on purpose: cash, what you owe, and what moved. This is not profit, and nothing here changes your ledger or any account.</p>

    {issues.length > 0 && <div className="mt-3 rounded-xl p-3 ring-1 ring-[var(--surface-line)]" role="status" data-testid="position-issues" aria-label="What to know about these figures">
      <ul className="space-y-1 text-xs">{shownIssues.map(i => <li key={i.id} data-severity={i.severity}><span aria-hidden="true">{i.severity === 'warning' ? '▲ ' : '• '}</span><span className="sr-only">{i.severity === 'warning' ? 'Warning: ' : 'Note: '}</span>{i.message}</li>)}</ul>
      {issues.length > 3 && <button type="button" className={`${btnQuiet} -ml-3 mt-1`} onClick={() => setMore(m => !m)} data-testid="position-issues-toggle">{more ? 'Show fewer' : `Show ${issues.length - 3} more`}</button>}
    </div>}

    <div className="mt-3 border-t border-[var(--surface-line)] pt-3" data-testid="position-cash">
      <p className={eyebrow}>Bank cash</p>
      {data.balancesEnabled ? <>
        <CashRow scope="Business accounts" b={data.cash.liquid.business} testId="position-cash-business" />
        <CashRow scope="Personal accounts" b={data.cash.liquid.personal} testId="position-cash-personal" />
        <CashRow scope="Not linked to Cash OS" b={data.cash.liquid.unmapped} testId="position-cash-unmapped" />
        {[data.cash.liquid.business, data.cash.liquid.personal, data.cash.liquid.unmapped].filter(b => b.census.accounts > 0).length > 1 && <CashRow scope="All connected accounts" b={data.cash.liquid.all} testId="position-cash-all" />}
        <CashRow scope="Restricted (CDs and similar, not spendable)" b={data.cash.restricted} testId="position-cash-restricted" />
        {data.cash.liquid.all.completeness === 'none' && data.cash.restricted.completeness === 'none' && <p className="py-2 text-sm text-[var(--text-secondary)]" data-testid="position-no-accounts">No bank accounts are connected.</p>}
      </> : <p className="py-2 text-sm text-[var(--text-secondary)]" data-testid="position-balances-off">Bank balances are not switched on, so cash and card balances are not available. They are not zero.</p>}
      <Accounts accounts={data.accounts} />
    </div>

    {data.balancesEnabled && (data.liabilities.cards.completeness !== 'none' || data.liabilities.loans.completeness !== 'none') && <div className="mt-3 border-t border-[var(--surface-line)] pt-3" data-testid="position-owed">
      <p className={eyebrow}>What you owe</p>
      <DebtRow title="Credit cards" b={data.liabilities.cards} testId="position-cards" cards />
      <DebtRow title="Loans" b={data.liabilities.loans} testId="position-loans" />
    </div>}

    <div className="mt-3 border-t border-[var(--surface-line)] pt-3" data-testid="position-activity">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={eyebrow}>What moved{act ? ` · ${shortDate(act.window.from)} – ${shortDate(act.window.to)}` : ''}</p>
        <SegmentedControl label="Period" value={`${days}` as `${PositionDays}`} onChange={v => setDays(Number(v) as PositionDays)} size="sm" options={WINDOWS.map(w => ({ value: w.value, label: w.label, testId: `position-window-${w.value}` }))} />
      </div>
      {!act || !lines ? <p className="py-2 text-sm text-[var(--text-secondary)]" data-testid="position-activity-unavailable">Bank activity could not be read, so no income or spending is shown.</p> : <>
        {!act.coverage.complete && <p className="mt-2 text-xs" style={{ color: 'var(--fin-warning)' }} role="status" data-testid="position-coverage">Activity may be incomplete. {act.coverage.reason}</p>}
        <p className="mt-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Money in</p>
        <Line l={lines.income} side="in" prov="owner_classified" testId="position-line-income" note={lines.income.count ? `into ${(['business', 'personal', 'unmapped'] as const).filter(s => lines.income.byScope[s] > 0).map(s => SCOPE_LABEL[s].toLowerCase().replace(' accounts', '')).join(', ')}` : undefined} />
        <Line l={lines.unclassifiedIn} side="in" prov="derived" testId="position-line-unclassifiedIn" note="not income until you confirm it" />
        {(lines.unclassifiedIn.hints.likelyTransferOrPayment.count > 0 || lines.unclassifiedIn.hints.likelyRefund.count > 0 || lines.unclassifiedIn.hints.likelyIncome.count > 0) && <p className="-mt-1 pb-1 text-xs text-[var(--text-secondary)]" data-testid="position-hints-in">
          Looks like: {[lines.unclassifiedIn.hints.likelyTransferOrPayment.count && `${usd2(lines.unclassifiedIn.hints.likelyTransferOrPayment.inMinor)} transfers or card payments`, lines.unclassifiedIn.hints.likelyRefund.count && `${usd2(lines.unclassifiedIn.hints.likelyRefund.inMinor)} refunds`, lines.unclassifiedIn.hints.likelyIncome.count && `${usd2(lines.unclassifiedIn.hints.likelyIncome.inMinor)} customer payments`].filter(Boolean).join(' · ')}. Counted nowhere until you decide.</p>}
        <Line l={lines.refunds} side="in" prov="owner_classified" testId="position-line-refunds" note="not income" />
        {lines.otherClassifiedIn.count > 0 && <Line l={lines.otherClassifiedIn} side="in" prov="owner_classified" testId="position-line-otherClassifiedIn" />}
        <p className="mt-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Money out</p>
        <Line l={lines.businessSpending} side="out" prov="derived" testId="position-line-businessSpending" note={split(lines.businessSpending, 'assumed from the business account')} />
        <Line l={lines.personalSpending} side="out" prov="derived" testId="position-line-personalSpending" note={split(lines.personalSpending, 'from personal accounts')} />
        <Line l={lines.debtRepayments} side="moved" prov="owner_classified" testId="position-line-debtRepayments" />
        <Line l={lines.unresolvedOut} side="out" prov="derived" testId="position-line-unresolvedOut" note="not an expense until you decide" />
        {lines.unresolvedOut.hints.likelyTransferOrPayment.count > 0 && <p className="-mt-1 pb-1 text-xs text-[var(--text-secondary)]" data-testid="position-hints-out">Looks like transfers or card payments: {usd2(lines.unresolvedOut.hints.likelyTransferOrPayment.outMinor)}. Counted nowhere until you decide.</p>}
        <p className="mt-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Between your own accounts</p>
        <Line l={lines.internalMovement} side="moved" prov="owner_classified" testId="position-line-internalMovement" note={lines.internalMovement.count ? `confirmed pairs, in neither income nor spending${lines.internalMovement.paidTowardCards.count ? ` · ${usd2(lines.internalMovement.paidTowardCards.inMinor)} paid toward cards` : ''}${lines.internalMovement.crossScope.count ? ` · ${usd2(lines.internalMovement.crossScope.outMinor)} between business and personal accounts (owner draw or contribution)` : ''}` : undefined} />
        {(lines.ignored.count > 0 || act.pending.count > 0) && <p className="mt-2 text-xs text-[var(--text-secondary)]" data-testid="position-aside">
          {lines.ignored.count > 0 && `Set aside by you: ${lines.ignored.count} ${plural(lines.ignored.count, 'transaction', 'transactions')}. `}
          {act.pending.count > 0 && `Not yet posted and not counted: ${act.pending.count} ${plural(act.pending.count, 'transaction', 'transactions')} (${usd2(act.pending.outMinor + act.pending.inMinor)}).`}</p>}
        <p className="mt-2 text-xs text-[var(--text-secondary)]" data-testid="position-basis">{act.postedCount} posted {plural(act.postedCount, 'transaction', 'transactions')}, each counted once. Classification {data.reconciliation === 'on' ? 'uses the transfer and card-payment matching' : 'uses the standard rules'}.</p>
      </>}
    </div>

    <Ledger data={data} ledger={ledger} />

    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--surface-line)] pt-3">
      <p className="text-xs text-[var(--text-secondary)]" data-testid="position-sync">{data.sync.connections.length ? data.sync.connections.map(c => `${c.label}: ${c.status === 'login_required' ? 'sign-in needed' : c.lastSyncedAt ? `synced ${when(c.lastSyncedAt)}` : 'not synced yet'}`).join(' · ') : 'No connections.'}</p>
      <button type="button" className={btn} onClick={() => void refresh()} disabled={busy} data-testid="position-refresh" aria-label="Refresh the cash position">{busy ? 'Refreshing…' : 'Refresh'}</button>
    </div>
    {error && <p className="mt-2 text-xs" style={{ color: 'var(--fin-negative)' }} role="alert" data-testid="position-refresh-error">Could not refresh: {error} Showing the last figures above.</p>}
  </section>
}
