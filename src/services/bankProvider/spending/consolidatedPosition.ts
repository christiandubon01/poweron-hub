/**
 * src/services/bankProvider/spending/consolidatedPosition.ts
 *
 * PURE (PLAID-3C, replacing the PLAID-2G draft). Builds the consolidated position (contract: src/finance/bankPosition.ts) from three things the application
 * already holds: interpreted provider balances, the derived Explorer rows (the same ones the Explorer, Smart Review and the BANK-6G reports read), and the
 * connections' sync state. It queries nothing and decides nothing the owner has not decided.
 *
 * What it will NOT do, each pinned by a test:
 *   - invent a balance: no reading is `null`, never 0, and a total that leaves an account out says "incomplete";
 *   - present an old balance as current: every bucket reports how many accounts are fresh / aging / stale and the oldest observation;
 *   - add credit to cash, subtract card debt from cash, or net anything into a profit figure;
 *   - call money "income" because it arrived: only a customer payment the OWNER confirmed is income. Other money in is "not classified yet" (with a hint of what it
 *     looks like) or a refund / owner deposit the owner classified. A proposed transfer or card payment is in no total until the owner confirms the pair;
 *   - count the same event twice: every posted row in the window sits in exactly one activity line (the lines' counts add up to `postedCount`), and the
 *     two legs of a confirmed transfer or card payment are one internal movement, never income and never an expense.
 *
 * Two deliberate differences from the BANK-6G all-money report (each pinned by a test):
 *   - money in the owner has not classified is never "income" (the report's "Money in" group includes every unclassified deposit and every proposed transfer leg);
 *   - a PROPOSED (unconfirmed) debt payment is "not resolved" whatever the account's ownership, where the report places a personal-account outflow in personal
 *     spending first. Counting a likely debt payment as spending before the owner decides would be a guess. It is listed in the hints, so nothing is hidden.
 * Everything the report already holds back (proposed transfers, an unpaired "transfer") is held back here too.
 */
import type { AccountBalanceView } from '../bankBalanceService'
import { freshnessOf, type AccountClass, type Freshness } from '../balanceModel'
import { STALE_SYNC_HOURS } from '../attention'
import type { ExplorerRow } from './types'
import type {
  ActivityHints, ActivityLine, Amounts, CashBucket, Census, Completeness, ConsolidatedPositionData, CountedFigure, DebtBucket, Figure, Observed, PositionAccount,
  PositionActivity, PositionIssue, PositionScope, PositionSync,
} from '../../../finance/bankPosition'

const SCOPES: PositionScope[] = ['business', 'personal', 'unmapped']
const RANK: Record<Freshness, number> = { fresh: 0, aging: 1, stale: 2, unknown: 3 }
const OTHER_BUCKET = 'other_needs_review'

const unavailable = (): Figure => ({ minor: null, provenance: 'unavailable' })
const safeSum = (xs: number[]): number | null => { const n = xs.reduce((a, b) => a + b, 0); return Number.isSafeInteger(n) ? n : null }
const usd = (minor: number) => `$${(Math.abs(minor) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// ── balances ──────────────────────────────────────────────────────────────────────────────────────────────────────

function censusOf(list: AccountBalanceView[], has: (a: AccountBalanceView) => boolean): Census {
  const contributors = list.filter(has)
  // an unreadable timestamp is never "fresh": it counts as stale
  const f = (x: Freshness) => contributors.filter(a => (a.freshness === 'unknown' ? 'stale' : a.freshness) === x).length
  return { accounts: list.length, withReading: contributors.length, fresh: f('fresh'), aging: f('aging'), stale: f('stale'), missing: list.length - contributors.length }
}
export function completenessOf(c: Census): Completeness {
  if (c.accounts === 0) return 'none'
  if (c.withReading === 0) return 'unavailable'
  if (c.missing > 0) return 'incomplete'
  return c.fresh === c.withReading ? 'current' : 'not_current'
}
function observedOf(list: AccountBalanceView[]): Observed {
  const ts = list.map(a => a.observedAt).filter((t): t is string => !!t && Number.isFinite(Date.parse(t))).sort()
  return { oldest: ts[0] ?? null, newest: ts[ts.length - 1] ?? null }
}
function counted(values: number[], of: number, provenance: Figure['provenance']): CountedFigure {
  const minor = values.length ? safeSum(values) : null
  return minor === null ? { ...unavailable(), reportedBy: values.length, of } : { minor, provenance, reportedBy: values.length, of }
}

function cashBucket(list: AccountBalanceView[], unreadable = false): CashBucket {
  const withBalance = list.filter(a => a.bankBalanceMinor !== null)
  const balance = withBalance.length ? safeSum(withBalance.map(a => a.bankBalanceMinor as number)) : null
  const census = censusOf(list, a => a.bankBalanceMinor !== null)
  return {
    balance: balance === null ? unavailable() : { minor: balance, provenance: 'provider_reported' },
    // `available` is the bank's own statement; an account that did not report it is left out and counted, never replaced by its current balance
    available: counted(list.filter(a => a.availableMinor !== null).map(a => a.availableMinor as number), list.length, 'provider_reported'),
    census, completeness: unreadable ? 'unavailable' : completenessOf(census), observed: observedOf(withBalance),
  }
}

function debtBucket(list: AccountBalanceView[], unreadable = false): DebtBucket {
  const withOwed = list.filter(a => a.owedMinor !== null)
  const owed = withOwed.length ? safeSum(withOwed.map(a => a.owedMinor as number)) : null
  const inFavour = withOwed.length ? safeSum(withOwed.map(a => a.creditInFavourMinor ?? 0)) : null
  const unused = list.filter(a => a.unusedCreditMinor !== null)
  const census = censusOf(list, a => a.owedMinor !== null)
  return {
    owed: owed === null ? unavailable() : { minor: owed, provenance: 'provider_reported' },
    inFavour: inFavour === null ? unavailable() : { minor: inFavour, provenance: 'provider_reported' },
    creditLimit: counted(list.filter(a => a.creditLimitMinor !== null).map(a => a.creditLimitMinor as number), list.length, 'provider_reported'),
    // the limit minus what is owed is DERIVED; only the bank's own "available" is provider-reported. One derived account makes the figure derived.
    unusedCredit: { ...counted(unused.map(a => a.unusedCreditMinor as number), list.length, unused.every(a => a.unusedCreditBasis === 'provider_available') ? 'provider_reported' : 'derived'), isCash: false },
    census, completeness: unreadable ? 'unavailable' : completenessOf(census), observed: observedOf(withOwed),
  }
}

const scopeOf = (a: { ownership: 'business' | 'personal' | null }): PositionScope => a.ownership ?? 'unmapped'
const ORDER_CLASS: Record<string, number> = { bank_cash: 0, credit_card: 1, loan: 2 }

function accountView(a: AccountBalanceView): PositionAccount | null {
  if (a.accountClass !== 'bank_cash' && a.accountClass !== 'credit_card' && a.accountClass !== 'loan') return null // investment / other accounts are not cash or debt: not listed
  const label = `${a.institutionName ? `${a.institutionName} · ` : ''}${a.name ?? 'Account'}${a.mask ? ` ••••${a.mask}` : ''}`
  return {
    ref: a.accountRef, label, institution: a.institutionName, name: a.name, mask: a.mask, accountClass: a.accountClass, restricted: a.restricted, scope: scopeOf(a),
    mappedFinancialAccountId: a.mappedFinancialAccountId, freshness: a.freshness, observedAt: a.observedAt,
    balanceMinor: a.accountClass === 'bank_cash' ? a.bankBalanceMinor : a.owedMinor,
    availableMinor: a.accountClass === 'bank_cash' ? a.availableMinor : null,
    creditLimitMinor: a.accountClass === 'credit_card' ? a.creditLimitMinor : null,
    unusedCreditMinor: a.accountClass === 'credit_card' ? a.unusedCreditMinor : null,
    unusedCreditBasis: a.accountClass === 'credit_card' ? a.unusedCreditBasis : null,
  }
}

// ── activity ──────────────────────────────────────────────────────────────────────────────────────────────────────

type Row = Pick<ExplorerRow, 'id' | 'date' | 'direction' | 'amountMinor' | 'pending' | 'review' | 'bucket' | 'relationship' | 'scope' | 'account'> & { removed?: boolean }
type LineKey = keyof PositionActivity['lines']
const zero = (): Amounts => ({ inMinor: 0, outMinor: 0, count: 0 })
const tally = (a: Amounts, r: Pick<Row, 'direction' | 'amountMinor'>) => { a.count += 1; if (r.direction === 'money_in') a.inMinor += Math.abs(r.amountMinor); else if (r.direction === 'money_out') a.outMinor += r.amountMinor }
const line = (key: string, label: string): ActivityLine => ({ key, label, ...zero(), ownerClassified: zero(), derived: zero() })
const noHints = (): ActivityHints => ({ likelyTransferOrPayment: zero(), likelyRefund: zero(), likelyIncome: zero(), markedTransferNoCounterpart: zero() })

/** Where ONE posted row belongs, and whether the owner's own decision put it there. See the file header for the rules. */
export function placeRow(r: Row): { line: LineKey; owner: boolean; hint?: keyof ActivityHints } {
  if (r.review === 'ignored') return { line: 'ignored', owner: true }
  const rel = r.relationship
  const bucket = r.bucket.state === 'confirmed' && r.bucket.key && r.bucket.key !== OTHER_BUCKET ? r.bucket.key : null
  const suggestedBucket = r.bucket.state === 'suggested' ? r.bucket.key : null
  const unresolved: LineKey = r.direction === 'money_in' ? 'unclassifiedIn' : 'unresolvedOut'
  // A confirmed pair: both legs are ONE movement between the owner's own accounts (or a payment to their own card). Neither income nor an expense.
  if (rel.state === 'confirmed' && rel.kind === 'transfer' && rel.target?.type === 'counterpart_tx') return { line: 'internalMovement', owner: true }
  // "Transfer" said by the owner with no matched other side is not proof of an internal relationship (the same rule as the BANK-6G report).
  if ((rel.state === 'confirmed' && rel.kind === 'transfer') || bucket === 'transfers') return { line: unresolved, owner: true, hint: 'markedTransferNoCounterpart' }
  if (rel.state === 'confirmed' && rel.kind === 'debt') return { line: 'debtRepayments', owner: true }
  const proposed = (rel.state === 'suggested' && (rel.kind === 'transfer' || rel.kind === 'debt')) || suggestedBucket === 'transfers'
  const decided = bucket !== null || rel.state === 'confirmed'
  if (r.direction === 'money_in') {
    if (bucket === 'customer_payment') return { line: 'income', owner: true }
    if (bucket === 'refund') return { line: 'refunds', owner: true }
    if (bucket) return { line: 'otherClassifiedIn', owner: true }
    return { line: 'unclassifiedIn', owner: false, hint: proposed ? 'likelyTransferOrPayment' : suggestedBucket === 'refund' ? 'likelyRefund' : suggestedBucket === 'customer_payment' ? 'likelyIncome' : undefined }
  }
  if (r.direction === 'money_out') {
    if (proposed) return { line: 'unresolvedOut', owner: false, hint: 'likelyTransferOrPayment' }
    if (r.scope.value === 'personal' || bucket === 'owner_draw') return { line: 'personalSpending', owner: r.scope.source === 'owner' || bucket === 'owner_draw' || rel.state === 'confirmed' }
    if (r.scope.value === 'business') return { line: 'businessSpending', owner: decided }
  }
  return { line: unresolved, owner: false }
}

export function buildActivity(rows: Row[], window: { from: string; to: string; days: number }, coverage: { complete: boolean; reason: string | null }, accountClassOf: Map<string, AccountClass>): PositionActivity {
  const lines: PositionActivity['lines'] = {
    income: { ...line('income', 'Customer payments you confirmed'), byScope: { business: 0, personal: 0, unmapped: 0 } },
    refunds: line('refunds', 'Refunds you confirmed'),
    otherClassifiedIn: line('otherClassifiedIn', 'Other money in you classified (not income)'),
    businessSpending: line('businessSpending', 'Business spending'),
    personalSpending: line('personalSpending', 'Personal and owner outflows'),
    debtRepayments: line('debtRepayments', 'Debt repayments'),
    internalMovement: { ...line('internalMovement', 'Transfers and card payments between your own accounts'), paidTowardCards: zero(), crossScope: zero() },
    unclassifiedIn: { ...line('unclassifiedIn', 'Money in not classified yet'), hints: noHints() },
    unresolvedOut: { ...line('unresolvedOut', 'Money out not resolved yet'), hints: noHints() },
    ignored: line('ignored', 'Set aside (ignored)'),
  }
  const empty = (): PositionActivity => ({ window, coverage, lines, pending: zero(), postedCount: 0 })
  // Unusable amounts mean every total is unreliable: report no totals rather than wrong ones (the same stance as the BANK-6G report).
  if (rows.some(r => !Number.isSafeInteger(r.amountMinor))) return { ...empty(), coverage: { complete: false, reason: 'Evidence has an unsupported amount. Totals are unavailable.' } }
  if (new Set(rows.map(r => r.id)).size !== rows.length) return { ...empty(), coverage: { complete: false, reason: 'Evidence changed while loading. Refresh before relying on these totals.' } }
  const out = empty()
  const byId = new Map(rows.map(r => [r.id, r])) // the counterpart of a confirmed pair may be just outside the window
  for (const r of rows) {
    if (r.removed || r.date < window.from || r.date > window.to) continue
    if (r.pending) { tally(out.pending, r); continue }
    const p = placeRow(r)
    const l = lines[p.line] as ActivityLine
    tally(l, r); tally(p.owner ? l.ownerClassified : l.derived, r)
    out.postedCount += 1
    if (p.line === 'income') lines.income.byScope[scopeOf(r.account)] += Math.abs(r.amountMinor)
    if (p.line === 'internalMovement' && r.direction === 'money_in' && accountClassOf.get(r.account.ref) === 'credit_card') tally(lines.internalMovement.paidTowardCards, r)
    if (p.line === 'internalMovement' && r.direction === 'money_out' && r.relationship.target?.id) {
      const other = byId.get(r.relationship.target.id)
      if (other && r.account.ownership && other.account.ownership && other.account.ownership !== r.account.ownership) tally(lines.internalMovement.crossScope, r)
    }
    if (p.hint && (p.line === 'unclassifiedIn' || p.line === 'unresolvedOut')) tally((lines[p.line] as { hints: ActivityHints }).hints[p.hint], r)
  }
  const sums = Object.values(lines).flatMap(l => [l.inMinor, l.outMinor])
  if (!sums.every(Number.isSafeInteger)) return { ...empty(), coverage: { complete: false, reason: 'Totals exceed supported precision.' } }
  return out
}

// ── the position ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface PositionInput {
  nowMs: number
  environment: 'sandbox' | 'production'
  balancesEnabled: boolean
  /** Interpreted provider balances of the ACTIVE environment's live accounts (getBalances already filters). */
  balances: AccountBalanceView[]
  /** The derived Explorer rows of the active environment, or null when the evidence could not be read. */
  rows: Row[] | null
  accountClassOf: Map<string, AccountClass>
  window: { from: string; to: string; days: number }
  coverage: { complete: boolean; reason: string | null }
  syncs: Array<{ label: string; status: string; lastSyncedAt: string | null }>
  reconciliation: boolean
  /** The balances / connection state could not be READ (as opposed to being switched off or empty): said so, never shown as "no accounts". */
  balancesError?: boolean
  syncError?: boolean
}

export function buildPosition(input: PositionInput): ConsolidatedPositionData {
  const views = input.balances.slice().sort((a, b) => SCOPES.indexOf(scopeOf(a)) - SCOPES.indexOf(scopeOf(b)) || (ORDER_CLASS[a.accountClass] ?? 9) - (ORDER_CLASS[b.accountClass] ?? 9)
    || `${a.institutionName ?? ''}${a.name ?? ''}${a.mask ?? ''}`.localeCompare(`${b.institutionName ?? ''}${b.name ?? ''}${b.mask ?? ''}`) || a.accountRef.localeCompare(b.accountRef))
  const liquid = views.filter(a => a.accountClass === 'bank_cash' && !a.restricted)
  const restricted = views.filter(a => a.accountClass === 'bank_cash' && a.restricted)
  const cards = views.filter(a => a.accountClass === 'credit_card')
  const loans = views.filter(a => a.accountClass === 'loan')
  const bad = input.balancesError === true
  const cash = {
    liquid: { business: cashBucket(liquid.filter(a => scopeOf(a) === 'business'), bad), personal: cashBucket(liquid.filter(a => scopeOf(a) === 'personal'), bad), unmapped: cashBucket(liquid.filter(a => scopeOf(a) === 'unmapped'), bad), all: cashBucket(liquid, bad) },
    restricted: cashBucket(restricted, bad),
  }
  const liabilities = { cards: debtBucket(cards, bad), loans: debtBucket(loans, bad) }
  const activity = input.rows ? buildActivity(input.rows, input.window, input.coverage, input.accountClassOf) : null

  const syncs = input.syncs.map(s => ({ label: s.label, status: s.status, lastSyncedAt: s.lastSyncedAt, freshness: s.status === 'disconnected' ? 'unknown' as Freshness : freshnessOf(s.lastSyncedAt, input.nowMs, s.status === 'healthy').freshness }))
  const sync: PositionSync = { worst: syncs.reduce<Freshness>((w, s) => (RANK[s.freshness] > RANK[w] ? s.freshness : w), syncs.length ? 'fresh' : 'unknown'), connections: syncs }

  const issues: PositionIssue[] = []
  const warn = (id: string, message: string) => issues.push({ id, severity: 'warning', message })
  const info = (id: string, message: string) => issues.push({ id, severity: 'info', message })
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)
  if (bad) warn('balances-error', 'Bank balances could not be read just now, so no cash or card figures are shown. Nothing was changed; try again.')
  else if (!input.balancesEnabled) info('balances-off', 'Bank balances are not switched on, so cash and card balances are unavailable (not zero).')
  else if (views.length === 0) info('no-accounts', 'No bank accounts are connected in this environment.')
  else {
    for (const [id, name, c] of [['cash', 'Bank cash', cash.liquid.all.census], ['restricted', 'Restricted bank accounts', cash.restricted.census], ['cards', 'Credit cards', liabilities.cards.census], ['loans', 'Loans', liabilities.loans.census]] as const) {
      if (c.accounts === 0) continue
      if (c.missing > 0) warn(`${id}-missing`, `${c.missing} of ${c.accounts} ${plural(c.accounts, 'account', 'accounts')} ${plural(c.missing, 'has', 'have')} no balance yet, so the ${name.toLowerCase()} total leaves ${plural(c.missing, 'it', 'them')} out.`)
      if (c.aging + c.stale > 0) warn(`${id}-old`, `${c.aging + c.stale} ${name.toLowerCase()} ${plural(c.aging + c.stale, 'balance is', 'balances are')} older than 24 hours. Treat that total as of the oldest reading.`)
    }
  }
  if (activity && !activity.coverage.complete) warn('activity-partial', `Activity may be incomplete. ${activity.coverage.reason ?? ''}`.trim())
  if (!activity) warn('activity-unavailable', 'Bank activity could not be read, so no income or spending figures are shown.')
  if (activity) {
    const u = activity.lines.unclassifiedIn
    if (u.inMinor > 0) info('unclassified-in', `${usd(u.inMinor)} of money in (${u.count} ${plural(u.count, 'deposit', 'deposits')}) is not classified yet. It is not counted as income until you confirm it.`)
    const o = activity.lines.unresolvedOut
    if (o.outMinor > 0) info('unresolved-out', `${usd(o.outMinor)} of money out (${o.count} ${plural(o.count, 'payment', 'payments')}) is not resolved yet. It is not counted as an expense until you decide.`)
  }
  if (activity) {
    const m = activity.lines.internalMovement
    if (m.inMinor !== m.outMinor) info('internal-unbalanced', `Transfers and card payments you confirmed do not balance in this period (out ${usd(m.outMinor)}, in ${usd(m.inMinor)}). A matching side may fall outside the period, have been removed by the bank, or have changed.`)
  }
  // The same real account connected twice (two Items of one institution) would be counted twice, in both balances and activity. Never merged silently: said.
  const same = new Map<string, AccountBalanceView[]>()
  for (const a of views) if (a.institutionName && a.mask && (a.accountClass === 'bank_cash' || a.accountClass === 'credit_card' || a.accountClass === 'loan')) {
    const k = `${a.institutionName.toLowerCase()}|${a.mask}|${a.accountClass}|${(a.subtype ?? a.type ?? '').toLowerCase()}`
    same.set(k, [...(same.get(k) ?? []), a])
  }
  const dupes = [...same.values()].filter(g => new Set(g.map(a => a.connectionId)).size > 1)
  if (dupes.length) warn('duplicate-accounts', `${dupes.flat().map(a => a.name ?? 'Account').filter((n, i, all) => all.indexOf(n) === i).slice(0, 3).join(', ')} look like the same account connected more than once. Its balance and activity may be counted twice until one connection is removed.`)
  if (input.syncError === true) info('sync-unreadable', 'Connection status could not be read just now.')
  const ageHours = (s: { lastSyncedAt: string | null }) => (s.lastSyncedAt && Number.isFinite(Date.parse(s.lastSyncedAt)) ? Math.max(0, (input.nowMs - Date.parse(s.lastSyncedAt)) / 3_600_000) : null)
  for (const s of input.syncs) {
    if (s.status === 'disconnected') continue
    if (s.status === 'login_required') { warn(`sync-login-${s.label}`, `${s.label} needs you to sign in again, so its data is not updating.`); continue }
    const age = ageHours(s)
    if (age === null) info(`sync-never-${s.label}`, `${s.label} has not synced yet.`)
    else if (age > STALE_SYNC_HOURS) warn(`sync-old-${s.label}`, `${s.label} was last synced over ${STALE_SYNC_HOURS} hours ago.`)
  }
  issues.sort((a, b) => (a.severity === b.severity ? a.id.localeCompare(b.id) : a.severity === 'warning' ? -1 : 1))

  return {
    enabled: true, asOf: new Date(input.nowMs).toISOString(), environment: input.environment, balancesEnabled: input.balancesEnabled, reconciliation: input.reconciliation ? 'on' : 'off',
    cash, liabilities, accounts: views.map(accountView).filter((a): a is PositionAccount => a !== null), activity, sync, issues,
    notes: { bankCashIsNotProfit: true, profit: null, liabilitiesAreNotNegativeCash: true, unusedCreditIsNotCash: true },
  }
}
