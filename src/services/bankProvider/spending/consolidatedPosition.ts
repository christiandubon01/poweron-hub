/**
 * src/services/bankProvider/spending/consolidatedPosition.ts
 *
 * PURE (PLAID-2G). One consolidated picture of the owner's connected money that keeps seven different things APART, because adding them together is
 * how a financial dashboard lies:
 *
 *   1. bankCash          actual money in bank accounts (current / available, freshness). Never reduced by card debt, never increased by credit.
 *   2. liabilities       what is owed on credit cards and loans. A liability, not "negative cash".
 *   3. unusedCredit      spendable CREDIT on cards. Labelled as not cash and never summed with bankCash.
 *   4. income            money in that is not a transfer, card payment or refund.
 *   5. expenses          business spending, personal/owner outflows and debt repayments (each separate).
 *   6. internalMovement  transfers between own accounts and card payments: shown, but in NEITHER income nor expenses.
 *   7. uncategorized     activity nobody (owner or an unambiguous rule) has resolved: shown, in neither income nor expenses.
 *   +  manualLedger      Cash OS ledger balances supplied by the caller, kept beside the provider balance; a difference is information, never an overwrite.
 *
 * There is NO profit figure here, by design: account balances and cash movement are not profit.
 */
import type { AccountBalanceView } from '../bankBalanceService'
import type { Freshness } from '../balanceModel'
import type { ReportSlot } from '../../../finance/bankSpendingReports'

export type Scope = 'business' | 'personal' | 'unmapped'
const SCOPES: Scope[] = ['business', 'personal', 'unmapped']
const RANK: Record<Freshness, number> = { fresh: 0, aging: 1, stale: 2, unknown: 3 }

export interface CashBucket { balanceMinor: number; availableMinor: number; accountsWithAvailable: number; accountsWithoutAvailable: number; accountCount: number }
export interface ManualLedgerBalance { financialAccountId: string; name: string; balanceMinor: number }
export interface PositionActivityLine { key: string; label: string; inMinor: number; outMinor: number; count: number }

export interface ConsolidatedPosition {
  bankCash: { liquid: Record<Scope, CashBucket> & { total: CashBucket }; restricted: CashBucket }
  liabilities: { cards: { owedMinor: number; inFavourMinor: number; byScope: Record<Scope, number> }; loans: { owedMinor: number } }
  unusedCredit: { minor: number; isCash: false; note: string }
  freshness: { worst: Freshness; stale: string[]; unknown: string[]; aging: string[] }
  activity: { income: PositionActivityLine; businessExpenses: PositionActivityLine; personalOutflows: PositionActivityLine; debtRepayments: PositionActivityLine;
    refunds: PositionActivityLine; internalMovement: PositionActivityLine; uncategorized: PositionActivityLine; ignored: PositionActivityLine } | null
  manualLedger: Array<{ financialAccountId: string; name: string; ledgerMinor: number; providerBalanceMinor: number | null; differenceMinor: number | null; providerFreshness: Freshness }>
  /** Constant guards that tests pin and the UI shows. */
  notes: { bankCashIsNotProfit: true; profit: null; liabilitiesAreNotNegativeCash: true }
}

const emptyBucket = (): CashBucket => ({ balanceMinor: 0, availableMinor: 0, accountsWithAvailable: 0, accountsWithoutAvailable: 0, accountCount: 0 })
const addBucket = (b: CashBucket, a: AccountBalanceView) => {
  b.accountCount += 1
  b.balanceMinor += a.bankBalanceMinor ?? 0
  if (a.availableMinor === null) b.accountsWithoutAvailable += 1; else { b.availableMinor += a.availableMinor; b.accountsWithAvailable += 1 }
}
const line = (groups: ReportSlot[] | undefined, key: string, label: string): PositionActivityLine => {
  const g = groups?.find(x => x.key === key)
  return { key, label, inMinor: g?.inMinor ?? 0, outMinor: g?.outMinor ?? 0, count: g?.postedCount ?? 0 }
}

/**
 * @param balances        interpreted balances (bankBalanceService.getBalances)
 * @param allMoneyGroups  `groups` of a BANK-6G report in mode 'all_money' (activity slots: income, business, personal, debt, transfer, refund, unresolved, ignored)
 * @param ledger          optional Cash OS manual-ledger balances, shown beside (never merged with) provider balances
 */
export function buildConsolidatedPosition(input: { balances: AccountBalanceView[]; allMoneyGroups?: ReportSlot[] | null; ledger?: ManualLedgerBalance[] }): ConsolidatedPosition {
  const liquid = { business: emptyBucket(), personal: emptyBucket(), unmapped: emptyBucket(), total: emptyBucket() } as ConsolidatedPosition['bankCash']['liquid']
  const restricted = emptyBucket()
  const cards = { owedMinor: 0, inFavourMinor: 0, byScope: { business: 0, personal: 0, unmapped: 0 } as Record<Scope, number> }
  let loans = 0, unused = 0
  const fresh = { worst: 'fresh' as Freshness, stale: [] as string[], unknown: [] as string[], aging: [] as string[] }
  let any = false
  for (const a of input.balances) {
    const scope: Scope = a.ownership ?? 'unmapped'
    const name = `${a.institutionName ? a.institutionName + ' · ' : ''}${a.name ?? 'Account'}${a.mask ? ` ••••${a.mask}` : ''}`
    if (a.accountClass === 'bank_cash') {
      if (a.restricted) addBucket(restricted, a); else { addBucket(liquid[scope], a); addBucket(liquid.total, a) }
    } else if (a.accountClass === 'credit_card') {
      cards.owedMinor += a.owedMinor ?? 0; cards.inFavourMinor += a.creditInFavourMinor ?? 0; cards.byScope[scope] += a.owedMinor ?? 0
      unused += a.unusedCreditMinor ?? 0
    } else if (a.accountClass === 'loan') loans += a.owedMinor ?? 0
    else continue
    any = true
    if (a.freshness === 'stale') fresh.stale.push(name); else if (a.freshness === 'unknown') fresh.unknown.push(name); else if (a.freshness === 'aging') fresh.aging.push(name)
    if (RANK[a.freshness] > RANK[fresh.worst]) fresh.worst = a.freshness
  }
  if (!any) fresh.worst = 'unknown'
  const g = input.allMoneyGroups ?? undefined
  const activity = g ? {
    income: line(g, 'income', 'Money in (not transfers or refunds)'),
    businessExpenses: line(g, 'business', 'Business spending'), personalOutflows: line(g, 'personal', 'Personal & owner outflows'), debtRepayments: line(g, 'debt', 'Debt repayments'),
    refunds: line(g, 'refund', 'Refunds'), internalMovement: line(g, 'transfer', 'Transfers & card payments between your own accounts'),
    uncategorized: line(g, 'unresolved', 'Not yet resolved'), ignored: line(g, 'ignored', 'Ignored activity'),
  } : null
  const byAccount = new Map(input.balances.map(b => [b.mappedFinancialAccountId, b]))
  const manualLedger = (input.ledger ?? []).map(l => {
    const p = byAccount.get(l.financialAccountId)
    const providerMinor = p ? (p.accountClass === 'bank_cash' ? p.bankBalanceMinor : p.owedMinor) : null
    return { financialAccountId: l.financialAccountId, name: l.name, ledgerMinor: l.balanceMinor, providerBalanceMinor: providerMinor, differenceMinor: providerMinor === null ? null : providerMinor - l.balanceMinor, providerFreshness: p?.freshness ?? 'unknown' as Freshness }
  })
  return { bankCash: { liquid, restricted }, liabilities: { cards, loans: { owedMinor: loans } },
    unusedCredit: { minor: unused, isCash: false, note: 'Unused credit is borrowing capacity on your cards. It is not cash and is not part of any bank balance.' },
    freshness: fresh, activity, manualLedger, notes: { bankCashIsNotProfit: true, profit: null, liabilitiesAreNotNegativeCash: true } }
}
