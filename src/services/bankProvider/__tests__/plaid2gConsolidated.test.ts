import { describe, expect, it } from 'vitest'
import { buildConsolidatedPosition } from '../spending/consolidatedPosition'
import { interpretBalance } from '../balanceModel'
import { buildRows } from '../spending/explorer'
import { buildSpendingReport } from '../spending/reporting'
import { APPROVED_REPORTING_POLICY } from '../../../finance/bankSpendingReports'
import type { AccountBalanceView } from '../bankBalanceService'
import type { AccountContext, Decision, EvidenceTx } from '../spending/types'

const NOW = Date.parse('2026-10-11T12:00:00Z')
const snap = (o: object) => ({ currentMinor: null, availableMinor: null, limitMinor: null, observedAt: new Date(NOW - 3_600_000).toISOString(), retrievedAt: new Date(NOW).toISOString(), observedIsProvider: true, ...o })
const view = (name: string, type: string, subtype: string, s: object | null, over: Partial<AccountBalanceView> = {}): AccountBalanceView => ({
  ...interpretBalance({ type, subtype }, s ? snap(s) : null, NOW), accountRef: name, connectionId: 'item', institutionName: 'Wells Fargo', name, mask: '1111', type, subtype, live: true,
  mappedFinancialAccountId: `fa-${name}`, ownership: 'business', ...over })

describe('consolidated position keeps seven different things apart', () => {
  const balances = [
    view('Business Checking', 'depository', 'checking', { currentMinor: 1_000_000, availableMinor: 900_000 }),
    view('Personal Checking', 'depository', 'checking', { currentMinor: 250_000 }, { ownership: 'personal' }),          // bank gave no available
    view('Savings', 'depository', 'savings', { currentMinor: 4_000_000, availableMinor: 4_000_000 }, { ownership: null }), // unmapped
    view('CD', 'depository', 'cd', { currentMinor: 5_000_000, availableMinor: 5_000_000 }),
    view('Business Visa', 'credit', 'credit card', { currentMinor: 230_000, availableMinor: 770_000, limitMinor: 1_000_000 }),
    view('Truck Loan', 'loan', 'auto', { currentMinor: 1_800_000 }, { ownership: null }),
  ]
  const p = buildConsolidatedPosition({ balances })

  it('bank cash is real bank money by ownership; unmapped is never claimed as business or personal; restricted is apart; available stays unknown when unknown', () => {
    expect(p.bankCash.liquid.business).toMatchObject({ balanceMinor: 1_000_000, availableMinor: 900_000, accountCount: 1 })
    expect(p.bankCash.liquid.personal).toMatchObject({ balanceMinor: 250_000, availableMinor: 0, accountsWithAvailable: 0, accountsWithoutAvailable: 1 })
    expect(p.bankCash.liquid.unmapped.balanceMinor).toBe(4_000_000)
    expect(p.bankCash.liquid.total).toMatchObject({ balanceMinor: 5_250_000, availableMinor: 4_900_000, accountsWithoutAvailable: 1 })
    expect(p.bankCash.restricted.balanceMinor).toBe(5_000_000) // a CD is not spendable cash
  })

  it('card debt, loans and unused credit never touch bank cash, and there is no net/profit figure', () => {
    expect(p.liabilities.cards).toMatchObject({ owedMinor: 230_000, inFavourMinor: 0 })
    expect(p.liabilities.cards.byScope.business).toBe(230_000)
    expect(p.liabilities.loans.owedMinor).toBe(1_800_000)
    expect(p.unusedCredit).toMatchObject({ minor: 770_000, isCash: false })
    expect(p.bankCash.liquid.total.balanceMinor).toBe(5_250_000) // unchanged by the card or the loan
    expect(p.notes).toEqual({ bankCashIsNotProfit: true, profit: null, liabilitiesAreNotNegativeCash: true })
    expect(JSON.stringify(p)).not.toMatch(/"(net|profit(?!")|netCash|cashAfter)/i)
  })

  it('freshness is reported per account and the worst wins; no data at all is unknown, never fresh', () => {
    expect(p.freshness.worst).toBe('fresh')
    const old = buildConsolidatedPosition({ balances: [view('A', 'depository', 'checking', { currentMinor: 1, observedAt: new Date(NOW - 100 * 3_600_000).toISOString() }), view('B', 'depository', 'savings', null)] })
    expect(old.freshness.worst).toBe('unknown')
    expect(old.freshness.stale).toEqual(['Wells Fargo · A ••••1111']); expect(old.freshness.unknown).toEqual(['Wells Fargo · B ••••1111'])
    expect(buildConsolidatedPosition({ balances: [] }).freshness.worst).toBe('unknown')
  })

  it('an overpaid card is credit in the owner\'s favour, not negative debt netted into cash', () => {
    const q = buildConsolidatedPosition({ balances: [view('Visa', 'credit', 'credit card', { currentMinor: -4_000, limitMinor: 100_000 })] })
    expect(q.liabilities.cards).toMatchObject({ owedMinor: 0, inFavourMinor: 4_000 }); expect(q.bankCash.liquid.total.balanceMinor).toBe(0)
  })

  it('manual-ledger balances sit beside provider balances; a difference is information, never an overwrite', () => {
    const q = buildConsolidatedPosition({ balances, ledger: [{ financialAccountId: 'fa-Business Checking', name: 'Operating', balanceMinor: 1_050_000 }, { financialAccountId: 'fa-none', name: 'Petty cash', balanceMinor: 20_000 }] })
    expect(q.manualLedger[0]).toMatchObject({ ledgerMinor: 1_050_000, providerBalanceMinor: 1_000_000, differenceMinor: -50_000, providerFreshness: 'fresh' })
    expect(q.manualLedger[1]).toMatchObject({ ledgerMinor: 20_000, providerBalanceMinor: null, differenceMinor: null, providerFreshness: 'unknown' })
    expect(q.bankCash.liquid.business.balanceMinor).toBe(1_000_000) // the ledger figure did not leak into bank cash
  })
})

describe('end to end: the same economic event is never counted twice', () => {
  const acct = (ref: string, label: string, type: string, subtype: string): AccountContext => ({ providerAccountRef: ref, label, mask: null, ownership: 'business', financialAccountId: `fa-${ref}`, financialAccountName: label, environment: 'production', providerType: type, providerSubtype: subtype })
  const ACCOUNTS = [acct('chk', 'Checking', 'depository', 'checking'), acct('sav', 'Savings', 'depository', 'savings'), acct('card', 'Visa', 'credit', 'credit card')]
  const tx = (id: string, account: string, amountMinor: number, date: string, name: string): EvidenceTx => ({ id, providerAccountRef: account, date, name, merchantName: null, amountMinor, pending: false, removed: false, category: null })
  const TXS = [
    tx('buy', 'card', 12_000, '2026-09-02', 'HOME DEPOT #12'),                                                        // $120 expense on the card
    tx('pay-out', 'chk', 50_000, '2026-09-10', 'WELLS FARGO CARD AUTOPAY'), tx('pay-in', 'card', -50_000, '2026-09-11', 'PAYMENT THANK YOU'),  // $500 card payment
    tx('xfer-out', 'chk', 100_000, '2026-09-12', 'ONLINE TRANSFER TO SAVINGS'), tx('xfer-in', 'sav', -100_000, '2026-09-12', 'ONLINE TRANSFER FROM CHECKING'),
    tx('cust', 'chk', -300_000, '2026-09-15', 'DEPOSIT CUSTOMER'),                                                    // $3,000 customer money
    tx('fuel', 'chk', 6_000, '2026-09-16', 'CHEVRON 123'),
  ]
  const decision = (id: string, txId: string, kind: Decision['kind'], over: Partial<Decision> = {}): Decision => ({ id, txId, kind, status: 'confirmed', category: null, projectId: null, obligationId: null, commitmentId: null, debtAccountId: null, counterpartTxId: null, confidence: 'high', source: 'owner', decidedAt: '2026-09-20T00:00:00Z', ...over })
  const report = (decisions: Decision[]) => {
    const rows = buildRows({ asOf: '2026-09-30', txs: TXS, accounts: ACCOUNTS, decisions, bills: [], obligationLabels: new Map(), commitmentLabels: new Map(), debts: [], projects: [] }).rows
    return buildSpendingReport(rows, 'all_money', { from: '2026-09-01', to: '2026-09-30', accounts: 'all', environment: 'production' }, APPROVED_REPORTING_POLICY, { complete: true, reason: null })
  }

  it('before the owner confirms anything, suggested transfers and card payments are shown as unresolved: in neither income nor expenses', () => {
    const r = report([])
    const pos = buildConsolidatedPosition({ balances: [], allMoneyGroups: r.groups })
    // the $3,000 deposit is the only income; the card payment and transfer legs are not income, not business spending
    expect(pos.activity!.income.inMinor).toBe(300_000)
    const unresolvedLegs = ['pay-out', 'pay-in', 'xfer-out', 'xfer-in']
    expect(r.rows.filter(x => unresolvedLegs.includes(x.id)).every(x => x.activity === 'unresolved')).toBe(true)
    expect(pos.activity!.businessExpenses.outMinor).toBe(12_000 + 6_000) // card purchase + fuel (business-mapped accounts); the $500 payment and $1,000 transfer are NOT expenses
  })

  it('once the owner confirms a pair, both legs become internal movement; the card PURCHASE stays the only expense and the payment is not a second one', () => {
    const r = report([
      decision('d1', 'pay-out', 'transfer', { counterpartTxId: 'pay-in' }), decision('d2', 'xfer-out', 'transfer', { counterpartTxId: 'xfer-in' }),
      decision('d3', 'buy', 'overhead'), decision('d4', 'buy', 'category', { category: 'materials' }),
    ])
    const pos = buildConsolidatedPosition({ balances: [], allMoneyGroups: r.groups })
    expect(pos.activity!.internalMovement).toMatchObject({ outMinor: 150_000, inMinor: 150_000, count: 4 })
    expect(pos.activity!.income.inMinor).toBe(300_000)                      // transfers and card payment did not become income
    expect(pos.activity!.businessExpenses.outMinor).toBe(12_000 + 6_000)    // purchase $120 + fuel $60; the $500 card payment is not an expense
    expect(pos.activity!.uncategorized.outMinor + pos.activity!.uncategorized.inMinor).toBe(0)
    // every posted row sits in exactly one activity line
    const lines = Object.values(pos.activity!)
    expect(lines.reduce((n, l) => n + l.count, 0)).toBe(TXS.length)
  })
})
