/**
 * src/finance/bankPosition.ts
 *
 * Browser-safe contract of the Cash OS CONSOLIDATED POSITION (PLAID-3C), plus the one pure function the browser runs on it: comparing the manual-ledger
 * balances Cash OS already shows with what the bank reports. Types and one comparison; no server imports.
 *
 * The position keeps different kinds of money APART, because adding them together is how a financial dashboard lies:
 *
 *   bank cash         money in bank accounts: current and available are separate facts, each with its own freshness. Never reduced by card debt, never raised by credit.
 *   liabilities       what is owed on credit cards and loans. A liability, not "negative cash".
 *   unused credit     borrowing capacity on cards. Labelled "not cash", never summed with bank cash.
 *   activity          what moved in a window, placed by what the OWNER decided (income = customer payments the owner confirmed), never by a guess.
 *   manual ledger     the Cash OS ledger balances, shown beside the bank's and compared; a difference is information and never overwrites either.
 *
 * Every figure says where it came from (`Provenance`). A figure that is not known is `null`, never 0: a missing or old balance is never presented as current
 * verified cash. There is no profit figure by design: account balances and cash movement are not profit.
 */
export type Provenance = 'provider_reported' | 'derived' | 'owner_classified' | 'manual_ledger' | 'unavailable'
export type Freshness = 'fresh' | 'aging' | 'stale' | 'unknown'
export type PositionScope = 'business' | 'personal' | 'unmapped'
/**
 * How much a total over several accounts can be trusted:
 *   current      every account has a balance and every balance is under 24 hours old
 *   not_current  every account has a balance, but at least one is older (the total is "as of" the oldest)
 *   incomplete   at least one account has no balance, so the total leaves it out
 *   unavailable  no account has a balance
 *   none         there are no accounts of this kind
 */
export type Completeness = 'current' | 'not_current' | 'incomplete' | 'unavailable' | 'none'

export interface Figure { minor: number | null; provenance: Provenance }
export interface CountedFigure extends Figure { /** how many accounts contributed */ reportedBy: number; /** of how many accounts of this kind */ of: number }
export interface Census { accounts: number; withReading: number; fresh: number; aging: number; stale: number; missing: number }
export interface Observed { oldest: string | null; newest: string | null }

export interface CashBucket { balance: Figure; available: CountedFigure; census: Census; completeness: Completeness; observed: Observed }
export interface DebtBucket {
  owed: Figure; inFavour: Figure
  creditLimit: CountedFigure
  unusedCredit: CountedFigure & { isCash: false }
  census: Census; completeness: Completeness; observed: Observed
}

/** One live bank account, sanitized: no provider account id, no token, no raw provider data. */
export interface PositionAccount {
  ref: string
  label: string
  institution: string | null
  name: string | null
  mask: string | null
  accountClass: 'bank_cash' | 'credit_card' | 'loan'
  restricted: boolean
  scope: PositionScope
  mappedFinancialAccountId: string | null
  freshness: Freshness
  /** false: the bank gave no time for this balance; `observedAt` is when Cash OS fetched it, and the reading is never shown as current (GREENLIGHT-1 A-3). */
  bankTimeKnown?: boolean
  observedAt: string | null
  /** Bank cash: the bank's current balance. Card / loan: the amount owed. null = no reading. */
  balanceMinor: number | null
  availableMinor: number | null
  creditLimitMinor: number | null
  unusedCreditMinor: number | null
  unusedCreditBasis: 'provider_available' | 'limit_minus_owed' | null
}

export interface Amounts { inMinor: number; outMinor: number; count: number }
/** `ownerClassified + derived = the line`: the first part rests on an explicit owner decision, the second on rules or account ownership. */
export interface ActivityLine extends Amounts { key: string; label: string; ownerClassified: Amounts; derived: Amounts }
/** What a not-yet-classified movement LOOKS like. Counted in no total: these are the numbers that would move if the owner confirms. */
export interface ActivityHints { likelyTransferOrPayment: Amounts; likelyRefund: Amounts; likelyIncome: Amounts; /** the owner said "transfer" but no matching movement on another account was found */ markedTransferNoCounterpart: Amounts }
export interface PositionActivity {
  window: { from: string; to: string; days: number }
  coverage: { complete: boolean; reason: string | null }
  lines: {
    /** Customer payments the owner confirmed. Nothing else is ever income. */
    income: ActivityLine & { byScope: Record<PositionScope, number> }
    /** Refunds the owner confirmed: never income. */
    refunds: ActivityLine
    /** Other money in the owner classified (for example an owner or personal deposit): not income. */
    otherClassifiedIn: ActivityLine
    businessSpending: ActivityLine
    personalSpending: ActivityLine
    debtRepayments: ActivityLine
    /** Transfers between own accounts and card payments the owner confirmed: in NEITHER income nor expenses. */
    internalMovement: ActivityLine & { paidTowardCards: Amounts; /** pairs between a business and a personal account (counted once, by the outgoing leg): an owner draw or contribution, not an ordinary transfer */ crossScope: Amounts }
    /** Money in nobody has classified. Not income until the owner says so. `hints` says what it looks like. */
    unclassifiedIn: ActivityLine & { hints: ActivityHints }
    /** Money out that is neither business nor personal nor decided (including proposed transfers and debt payments). Not an expense until resolved. */
    unresolvedOut: ActivityLine & { hints: ActivityHints }
    /** Set aside by the owner. */
    ignored: ActivityLine
  }
  /** Not yet posted: shown for information, in no total. */
  pending: Amounts
  /** Posted rows in the window; every one sits in exactly one line (the lines' counts add up to this). */
  postedCount: number
}

export interface PositionIssue { id: string; severity: 'warning' | 'info'; message: string }
export interface PositionSync { worst: Freshness; connections: Array<{ label: string; status: string; lastSyncedAt: string | null; freshness: Freshness }> }

export interface ConsolidatedPositionData {
  enabled: true
  /** When the server computed this (ISO). */
  asOf: string
  environment: 'sandbox' | 'production'
  /** Provider balances are switched on (PLAID_BALANCES_ENABLED). Off = every balance figure is unavailable, never zero. */
  balancesEnabled: boolean
  /** Which classification path produced the activity lines. */
  reconciliation: 'on' | 'off'
  cash: { liquid: Record<PositionScope, CashBucket> & { all: CashBucket }; restricted: CashBucket }
  liabilities: { cards: DebtBucket; loans: DebtBucket }
  accounts: PositionAccount[]
  activity: PositionActivity | null
  sync: PositionSync
  issues: PositionIssue[]
  /** Constant guards that tests pin and the screen shows. */
  notes: { bankCashIsNotProfit: true; profit: null; liabilitiesAreNotNegativeCash: true; unusedCreditIsNotCash: true }
}
export type PositionResponse = { enabled: false } | ConsolidatedPositionData

// ── manual ledger beside the bank (browser side) ──────────────────────────────────────────────────────────────────────

/** What Cash OS already holds about a manual-ledger account (CashOsSnapshot): an account row and its balance. */
export interface ManualLedgerAccount {
  id: string
  name: string
  accountClass: 'asset' | 'liability'
  ownership: 'business' | 'personal'
  includeInCash: boolean
  status: 'active' | 'archived'
  /** Signed sum of posted ledger rows (an asset's positive balance is funds; a liability's positive balance is the amount owed). */
  balanceMinor: number
}
export interface ManualLedgerLine {
  financialAccountId: string
  name: string
  accountClass: 'asset' | 'liability'
  ownership: 'business' | 'personal'
  provenance: 'manual_ledger'
  ledgerMinor: number
  /** The bank account mapped to this ledger account, when there is one in the position. */
  bank: { label: string; accountClass: PositionAccount['accountClass']; balanceMinor: number | null; freshness: Freshness; observedAt: string | null } | null
  /** bank minus ledger, only when both are known and describe the same kind of money. Information, never a correction. */
  differenceMinor: number | null
  comparable: boolean
}
export interface ManualLedgerView {
  lines: ManualLedgerLine[]
  /** Ledger cash: active asset accounts included in cash. Manual records, not bank money. */
  ledgerCash: Figure
  /** Live bank accounts that are not mapped to any ledger account (so the ledger says nothing about them). */
  bankOnly: PositionAccount[]
}

/** Compares what the manual ledger says with what the bank reports, account by account. Pure and total: it never changes either side. */
export function compareManualLedger(position: Pick<ConsolidatedPositionData, 'accounts'>, ledger: readonly ManualLedgerAccount[]): ManualLedgerView {
  const byFinancial = new Map<string, PositionAccount>()
  for (const a of position.accounts) if (a.mappedFinancialAccountId && !byFinancial.has(a.mappedFinancialAccountId)) byFinancial.set(a.mappedFinancialAccountId, a)
  const active = ledger.filter(a => a.status === 'active')
  const lines: ManualLedgerLine[] = active.map(l => {
    const b = byFinancial.get(l.id) ?? null
    // Same kind of money only: a cash ledger account against a bank cash account; a liability ledger account against a card or loan.
    const comparable = !!b && b.balanceMinor !== null && (l.accountClass === 'asset' ? b.accountClass === 'bank_cash' : b.accountClass !== 'bank_cash')
    return {
      financialAccountId: l.id, name: l.name, accountClass: l.accountClass, ownership: l.ownership, provenance: 'manual_ledger', ledgerMinor: l.balanceMinor,
      bank: b ? { label: b.label, accountClass: b.accountClass, balanceMinor: b.balanceMinor, freshness: b.freshness, observedAt: b.observedAt } : null,
      differenceMinor: comparable ? (b!.balanceMinor as number) - l.balanceMinor : null, comparable,
    }
  })
  const mapped = new Set(active.map(l => l.id))
  const cash = active.filter(a => a.accountClass === 'asset' && a.includeInCash)
  return {
    lines,
    ledgerCash: cash.length ? { minor: cash.reduce((n, a) => n + a.balanceMinor, 0), provenance: 'manual_ledger' } : { minor: null, provenance: 'unavailable' },
    bankOnly: position.accounts.filter(a => !a.mappedFinancialAccountId || !mapped.has(a.mappedFinancialAccountId)),
  }
}
