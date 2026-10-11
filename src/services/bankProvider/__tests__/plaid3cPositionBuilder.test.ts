// @ts-nocheck -- fixtures
/**
 * PLAID-3C: the consolidated position builder (pure). Pins the financial contract for the position:
 *   bank cash, card debt, unused credit, income, expenses and transfers are different things and are never added together;
 *   a missing balance is `null` (never 0) and an old one is never "current"; income is only what the OWNER confirmed as a customer payment;
 *   a proposed transfer or card payment is in no total until confirmed; every posted row sits in exactly one line.
 */
import { describe, expect, it } from 'vitest'
import { buildActivity, buildPosition, completenessOf, placeRow } from '../spending/consolidatedPosition'
import { buildRows } from '../spending/explorer'
import { buildSpendingReport } from '../spending/reporting'
import { interpretBalance } from '../balanceModel'
import { APPROVED_REPORTING_POLICY } from '../../../finance/bankSpendingReports'
import { compareManualLedger } from '../../../finance/bankPosition'

const NOW = Date.parse('2026-10-11T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString()
const snap = (o: object = {}) => ({ currentMinor: null, availableMinor: null, limitMinor: null, observedAt: hoursAgo(1), retrievedAt: new Date(NOW).toISOString(), observedIsProvider: true, ...o })
const view = (name: string, type: string, subtype: string, s: object | null, over: object = {}) => ({
  ...interpretBalance({ type, subtype }, s ? snap(s) : null, NOW), accountRef: name, connectionId: 'item', institutionName: 'Wells Fargo', name, mask: '1111', type, subtype, live: true,
  mappedFinancialAccountId: `fa-${name}`, ownership: 'business', ...over })
const base = (over = {}) => ({ nowMs: NOW, environment: 'production', balancesEnabled: true, balances: [], rows: [], accountClassOf: new Map(), window: { from: '2026-09-12', to: '2026-10-11', days: 30 }, coverage: { complete: true, reason: null }, syncs: [], reconciliation: true, ...over })

describe('balances: kinds of money stay apart, unknown stays unknown, old is never current', () => {
  const balances = [
    view('Business Checking', 'depository', 'checking', { currentMinor: 1_000_000, availableMinor: 900_000 }),
    view('Personal Checking', 'depository', 'checking', { currentMinor: 250_000 }, { ownership: 'personal' }),            // the bank gave no available balance
    view('Savings', 'depository', 'savings', { currentMinor: 4_000_000, availableMinor: 4_000_000 }, { ownership: null, mappedFinancialAccountId: null }), // not mapped
    view('CD', 'depository', 'cd', { currentMinor: 5_000_000, availableMinor: 5_000_000 }),
    view('Business Visa', 'credit', 'credit card', { currentMinor: 230_000, availableMinor: 770_000, limitMinor: 1_000_000 }),
    view('Truck Loan', 'loan', 'auto', { currentMinor: 1_800_000 }, { ownership: null }),
  ]
  const p = buildPosition(base({ balances }))

  it('bank cash by ownership; unmapped is never claimed as business or personal; restricted is apart; an unreported available balance stays unknown, never replaced by current', () => {
    const { liquid, restricted } = p.cash
    expect(liquid.business.balance).toEqual({ minor: 1_000_000, provenance: 'provider_reported' })
    expect(liquid.business.available).toMatchObject({ minor: 900_000, reportedBy: 1, of: 1, provenance: 'provider_reported' })
    expect(liquid.personal.balance.minor).toBe(250_000)
    expect(liquid.personal.available).toEqual({ minor: null, provenance: 'unavailable', reportedBy: 0, of: 1 }) // NOT 250,000 and NOT 0
    expect(liquid.unmapped.balance.minor).toBe(4_000_000)
    expect(liquid.all.balance.minor).toBe(5_250_000)
    expect(liquid.all.available).toMatchObject({ minor: 4_900_000, reportedBy: 2, of: 3 })    // two of three accounts reported it: the figure says so
    expect(restricted.balance.minor).toBe(5_000_000)                                             // a CD is not spendable cash and is not in the liquid total
  })

  it('card debt, loans and unused credit never touch bank cash; unused credit says it is not cash; there is no profit or net figure', () => {
    expect(p.liabilities.cards.owed).toEqual({ minor: 230_000, provenance: 'provider_reported' })
    expect(p.liabilities.cards.unusedCredit).toMatchObject({ minor: 770_000, isCash: false, provenance: 'provider_reported', reportedBy: 1 })
    expect(p.liabilities.cards.creditLimit.minor).toBe(1_000_000)
    expect(p.liabilities.loans.owed.minor).toBe(1_800_000)
    expect(p.cash.liquid.all.balance.minor).toBe(5_250_000)                                      // unchanged by the card or the loan
    expect(p.notes).toEqual({ bankCashIsNotProfit: true, profit: null, liabilitiesAreNotNegativeCash: true, unusedCreditIsNotCash: true })
    expect(JSON.stringify(p)).not.toMatch(/"(net|netCash|cashAfter|profit)[A-Za-z]*":\s*-?\d/i)
  })

  it('unused credit that the builder computed (limit - owed) is DERIVED; only the bank\'s own available figure is provider-reported', () => {
    const derived = buildPosition(base({ balances: [view('Visa', 'credit', 'credit card', { currentMinor: 230_000, limitMinor: 1_000_000 })] }))
    expect(derived.liabilities.cards.unusedCredit).toMatchObject({ minor: 770_000, provenance: 'derived', isCash: false })
    const mixed = buildPosition(base({ balances: [view('A', 'credit', 'credit card', { currentMinor: 1, availableMinor: 9_000, limitMinor: 10_000 }), view('B', 'credit', 'credit card', { currentMinor: 100, limitMinor: 1_000 })] }))
    expect(mixed.liabilities.cards.unusedCredit).toMatchObject({ minor: 9_000 + 900, provenance: 'derived', reportedBy: 2 }) // one derived account makes the sum derived
    const none = buildPosition(base({ balances: [view('C', 'credit', 'credit card', { currentMinor: 5_000 })] }))
    expect(none.liabilities.cards.unusedCredit).toEqual({ minor: null, provenance: 'unavailable', reportedBy: 0, of: 1, isCash: false }) // unknown stays unknown
  })

  it('an overpaid card is credit in the owner\'s favour: not negative debt netted against cash', () => {
    const q = buildPosition(base({ balances: [view('Visa', 'credit', 'credit card', { currentMinor: -4_000, limitMinor: 100_000 })] }))
    expect(q.liabilities.cards.owed.minor).toBe(0); expect(q.liabilities.cards.inFavour.minor).toBe(4_000); expect(q.cash.liquid.all.balance).toEqual({ minor: null, provenance: 'unavailable' })
  })

  it('completeness: current, not_current (old), incomplete (a missing balance), unavailable (none known), none (no accounts); the oldest observation is reported', () => {
    const fresh = view('A', 'depository', 'checking', { currentMinor: 100 })
    const aging = view('B', 'depository', 'checking', { currentMinor: 200, observedAt: hoursAgo(30) })
    const stale = view('C', 'depository', 'checking', { currentMinor: 300, observedAt: hoursAgo(100) })
    const missing = view('D', 'depository', 'checking', null)
    const of = (...b) => buildPosition(base({ balances: b })).cash.liquid.all
    expect(of(fresh).completeness).toBe('current')
    expect(of(fresh, aging)).toMatchObject({ completeness: 'not_current', census: { accounts: 2, withReading: 2, fresh: 1, aging: 1, stale: 0, missing: 0 } })
    expect(of(fresh, stale)).toMatchObject({ completeness: 'not_current', census: { stale: 1 }, observed: { oldest: hoursAgo(100), newest: hoursAgo(1) } })
    expect(of(fresh, missing)).toMatchObject({ completeness: 'incomplete', balance: { minor: 100, provenance: 'provider_reported' }, census: { accounts: 2, withReading: 1, missing: 1 } })
    expect(of(missing)).toMatchObject({ completeness: 'unavailable', balance: { minor: null, provenance: 'unavailable' } })              // NOT 0
    expect(of()).toMatchObject({ completeness: 'none', balance: { minor: null } })
    expect(completenessOf({ accounts: 0, withReading: 0, fresh: 0, aging: 0, stale: 0, missing: 0 })).toBe('none')
  })

  it('a connection that needs sign-in is never reported fresh (even with a recent reading)', () => {
    const v = { ...interpretBalance({ type: 'depository', subtype: 'checking' }, snap({ currentMinor: 100 }), NOW, false), accountRef: 'x', connectionId: 'i', institutionName: 'WF', name: 'X', mask: '1', type: 'depository', subtype: 'checking', live: true, mappedFinancialAccountId: null, ownership: 'business' }
    expect(buildPosition(base({ balances: [v] })).cash.liquid.all.completeness).toBe('not_current')
  })

  it('what could not be read is said so: balances off, no accounts, and a read failure are three different statements, none of them zero', () => {
    const off = buildPosition(base({ balancesEnabled: false }))
    expect(off.cash.liquid.all).toMatchObject({ completeness: 'none', balance: { minor: null } }); expect(off.issues.map(i => i.id)).toContain('balances-off')
    expect(buildPosition(base()).issues.map(i => i.id)).toContain('no-accounts')
    const bad = buildPosition(base({ balancesError: true }))
    expect(bad.cash.liquid.all).toMatchObject({ completeness: 'unavailable', balance: { minor: null } }); expect(bad.liabilities.cards.completeness).toBe('unavailable')
    expect(bad.issues.find(i => i.id === 'balances-error')).toMatchObject({ severity: 'warning' })
  })

  it('issues name what is missing or old, in plain words, warnings first', () => {
    const q = buildPosition(base({ balances: [view('A', 'depository', 'checking', { currentMinor: 1, observedAt: hoursAgo(100) }), view('B', 'depository', 'savings', null)] }))
    const ids = q.issues.map(i => i.id)
    expect(ids).toEqual(expect.arrayContaining(['cash-missing', 'cash-old']))
    expect(q.issues.find(i => i.id === 'cash-missing')!.message).toBe('1 of 2 accounts has no balance yet, so the bank cash total leaves it out.')
    expect(q.issues[0].severity).toBe('warning')
  })

  it('investment and other accounts are in neither cash nor debt and are not listed', () => {
    const q = buildPosition(base({ balances: [view('Brokerage', 'investment', 'brokerage', { currentMinor: 9_999_999 }), view('Checking', 'depository', 'checking', { currentMinor: 100 })] }))
    expect(q.cash.liquid.all.balance.minor).toBe(100); expect(q.accounts.map(a => a.name)).toEqual(['Checking'])
  })
})

describe('sync state', () => {
  it('reports each connection\'s freshness and the worst; a sign-in problem and an old sync are warnings; never synced is information', () => {
    const q = buildPosition(base({ syncs: [
      { label: 'Wells Fargo', status: 'healthy', lastSyncedAt: hoursAgo(2) }, { label: 'Chase', status: 'login_required', lastSyncedAt: hoursAgo(5) },
      { label: 'Old Bank', status: 'healthy', lastSyncedAt: hoursAgo(60) }, { label: 'New Bank', status: 'healthy', lastSyncedAt: null }, { label: 'Gone', status: 'disconnected', lastSyncedAt: null } ] }))
    expect(q.sync.connections.find(c => c.label === 'Wells Fargo')!.freshness).toBe('fresh')
    expect(q.sync.connections.find(c => c.label === 'Chase')!.freshness).not.toBe('fresh')
    const by = Object.fromEntries(q.issues.map(i => [i.id, i]))
    expect(by['sync-login-Chase']).toMatchObject({ severity: 'warning' }); expect(by['sync-old-Old Bank']).toMatchObject({ severity: 'warning' })
    expect(by['sync-never-New Bank']).toMatchObject({ severity: 'info' }); expect(Object.keys(by).some(k => k.includes('Gone'))).toBe(false)
    expect(buildPosition(base()).sync).toEqual({ worst: 'unknown', connections: [] })
  })
})

// ── activity ──────────────────────────────────────────────────────────────────────────────────────────────────────
const acct = (ref: string, ownership: 'business' | 'personal' | null = 'business', type = 'depository', subtype = 'checking') => ({ providerAccountRef: ref, label: ref, mask: null, ownership, financialAccountId: ownership ? `fa-${ref}` : null, financialAccountName: ownership ? ref : null, environment: 'production', providerType: type, providerSubtype: subtype })
const ACCOUNTS = [acct('chk'), acct('sav'), acct('card', 'business', 'credit', 'credit card'), acct('pchk', 'personal')]
const tx = (id: string, account: string, amountMinor: number, date: string, name: string, over = {}) => ({ id, providerAccountRef: account, date, name, merchantName: null, amountMinor, pending: false, removed: false, category: null, ...over })
const decision = (id: string, txId: string, kind: string, over = {}) => ({ id, txId, kind, status: 'confirmed', category: null, projectId: null, obligationId: null, commitmentId: null, debtAccountId: null, counterpartTxId: null, confidence: 'high', source: 'owner', decidedAt: '2026-09-20T00:00:00Z', ...over })
const rowsOf = (txs, decisions = [], reconciliation = true) => buildRows({ asOf: '2026-10-11', txs, accounts: ACCOUNTS, decisions, bills: [], obligationLabels: new Map(), commitmentLabels: new Map(), debts: [], projects: [], reconciliation }).rows
const act = (txs, decisions = [], reconciliation = true) => buildActivity(rowsOf(txs, decisions, reconciliation), { from: '2026-09-01', to: '2026-10-11', days: 41 }, { complete: true, reason: null }, new Map([['card', 'credit_card'], ['chk', 'bank_cash'], ['sav', 'bank_cash']]))
const where = (txs, decisions = [], reconciliation = true) => Object.fromEntries(rowsOf(txs, decisions, reconciliation).map(r => [r.id, placeRow(r).line]))

describe('activity: income is only what the owner confirmed; nothing is guessed into a total', () => {
  it('a deposit nobody classified is NOT income: it is "not classified yet" (the PLAID-2G draft counted it as income)', () => {
    const a = act([tx('dep', 'chk', -300_000, '2026-09-15', 'DEPOSIT CUSTOMER')])
    expect(a.lines.income.inMinor).toBe(0)
    expect(a.lines.unclassifiedIn).toMatchObject({ inMinor: 300_000, count: 1 })
    expect(a.lines.unclassifiedIn.derived.inMinor).toBe(300_000); expect(a.lines.unclassifiedIn.ownerClassified.inMinor).toBe(0)
  })

  it('once the owner confirms a customer payment, it is income (owner-classified), split by account ownership', () => {
    const a = act([tx('dep', 'chk', -300_000, '2026-09-15', 'DEPOSIT CUSTOMER'), tx('dep2', 'pchk', -50_000, '2026-09-16', 'ZELLE FROM JOHN')],
      [decision('d1', 'dep', 'category', { category: 'customer_payment' }), decision('d2', 'dep2', 'category', { category: 'customer_payment' })])
    expect(a.lines.income).toMatchObject({ inMinor: 350_000, count: 2, ownerClassified: { inMinor: 350_000 }, derived: { inMinor: 0 }, byScope: { business: 300_000, personal: 50_000, unmapped: 0 } })
    expect(a.lines.unclassifiedIn.count).toBe(0)
  })

  it('a refund is never income: confirmed it is a refund; merely suggested it stays unclassified, with a hint', () => {
    const txs = [tx('buy', 'card', 8_999, '2026-08-01', 'HOME DEPOT #12'), tx('ret', 'card', -8_999, '2026-09-20', 'HOME DEPOT RETURN')]
    const un = act(txs)
    expect(un.lines.income.inMinor).toBe(0); expect(un.lines.refunds.inMinor).toBe(0)
    expect(un.lines.unclassifiedIn).toMatchObject({ inMinor: 8_999, hints: { likelyRefund: { inMinor: 8_999, count: 1 } } })
    const ok = act(txs, [decision('d1', 'ret', 'category', { category: 'refund' })])
    expect(ok.lines.refunds).toMatchObject({ inMinor: 8_999, ownerClassified: { inMinor: 8_999 } }); expect(ok.lines.income.inMinor).toBe(0)
  })

  it('other money in the owner classified (an owner deposit) is not income either', () => {
    const a = act([tx('own', 'chk', -100_000, '2026-09-15', 'DEPOSIT')], [decision('d1', 'own', 'category', { category: 'personal_owner' })])
    expect(a.lines.income.inMinor).toBe(0); expect(a.lines.otherClassifiedIn).toMatchObject({ inMinor: 100_000, ownerClassified: { inMinor: 100_000 } })
  })

  it('"other / needs review" confirmed is not a classification', () => {
    const a = act([tx('x', 'chk', -1_000, '2026-09-15', 'DEPOSIT')], [decision('d1', 'x', 'category', { category: 'other_needs_review' })])
    expect(a.lines.unclassifiedIn.inMinor).toBe(1_000); expect(a.lines.otherClassifiedIn.inMinor).toBe(0)
  })
})

describe('activity: transfers and card payments are one internal movement, in neither income nor expenses', () => {
  const TXS = [
    tx('buy', 'card', 12_000, '2026-09-02', 'HOME DEPOT #12'),                                                                                         // $120 purchase on the card
    tx('pay-out', 'chk', 50_000, '2026-09-10', 'WELLS FARGO CARD AUTOPAY'), tx('pay-in', 'card', -50_000, '2026-09-11', 'PAYMENT THANK YOU'),        // $500 card payment
    tx('xfer-out', 'chk', 100_000, '2026-09-12', 'ONLINE TRANSFER TO SAVINGS'), tx('xfer-in', 'sav', -100_000, '2026-09-12', 'ONLINE TRANSFER FROM CHECKING'),
    tx('cust', 'chk', -300_000, '2026-09-15', 'DEPOSIT CUSTOMER'), tx('fuel', 'chk', 6_000, '2026-09-16', 'CHEVRON 123'),
  ]
  it('PROPOSED pairs are in no total: neither legs as income, nor the outflows as spending, until the owner confirms (and the hint says what they look like)', () => {
    const a = act(TXS)
    expect(a.lines.income.inMinor).toBe(0)                                             // nothing the owner confirmed
    expect(a.lines.internalMovement.count).toBe(0)                                     // nothing confirmed as internal yet
    expect(a.lines.businessSpending.outMinor).toBe(12_000 + 6_000)                     // the card purchase and fuel; NOT the $500 card payment or the $1,000 transfer
    expect(a.lines.unresolvedOut).toMatchObject({ outMinor: 50_000 + 100_000, hints: { likelyTransferOrPayment: { outMinor: 150_000, count: 2 } } })
    expect(a.lines.unclassifiedIn.hints.likelyTransferOrPayment).toMatchObject({ inMinor: 150_000, count: 2 })
    expect(a.lines.unclassifiedIn.inMinor).toBe(300_000 + 150_000)                     // the customer deposit (not income until confirmed) and the two proposed inflows
  })

  it('once confirmed, both legs are internal movement; the card PURCHASE stays the only expense (paying the card is a settlement, not a second expense)', () => {
    const a = act(TXS, [
      decision('d1', 'pay-out', 'transfer', { counterpartTxId: 'pay-in' }), decision('d1b', 'pay-in', 'transfer', { counterpartTxId: 'pay-out' }),
      decision('d2', 'xfer-out', 'transfer', { counterpartTxId: 'xfer-in' }), decision('d2b', 'xfer-in', 'transfer', { counterpartTxId: 'xfer-out' }),
      decision('d3', 'buy', 'category', { category: 'materials' }), decision('d4', 'cust', 'category', { category: 'customer_payment' }),
    ])
    expect(a.lines.internalMovement).toMatchObject({ outMinor: 150_000, inMinor: 150_000, count: 4, ownerClassified: { count: 4 } })
    expect(a.lines.internalMovement.paidTowardCards).toMatchObject({ inMinor: 50_000, count: 1 })    // the card-side leg only
    expect(a.lines.income.inMinor).toBe(300_000)
    expect(a.lines.businessSpending).toMatchObject({ outMinor: 18_000, ownerClassified: { outMinor: 12_000 }, derived: { outMinor: 6_000 } }) // $120 the owner categorized, $60 assumed from the business account
    expect(a.lines.unresolvedOut.outMinor + a.lines.unclassifiedIn.inMinor).toBe(0)
    expect(a.postedCount).toBe(TXS.length)
  })

  it('"transfer" said by the owner with no matching other side is not proof of an internal movement: held as unresolved, and hinted', () => {
    const a = act([tx('lone', 'chk', 20_000, '2026-09-10', 'WIRE OUT')], [decision('d1', 'lone', 'category', { category: 'transfers' })])
    expect(a.lines.internalMovement.count).toBe(0); expect(a.lines.unresolvedOut).toMatchObject({ outMinor: 20_000, ownerClassified: { outMinor: 20_000 }, hints: { markedTransferNoCounterpart: { outMinor: 20_000 } } })
  })

  it('a confirmed pair stays internal after the reconciliation switch is turned OFF (each leg names the other)', () => {
    const decisions = [decision('d1', 'xfer-out', 'transfer', { counterpartTxId: 'xfer-in' }), decision('d1b', 'xfer-in', 'transfer', { counterpartTxId: 'xfer-out' })]
    for (const on of [true, false]) expect(act(TXS, decisions, on).lines.internalMovement).toMatchObject({ outMinor: 100_000, inMinor: 100_000, count: 2 })
  })
})

describe('activity: spending is placed by what is known; a debt payment and a personal outflow are separate; ignored and pending are in no total', () => {
  it('business, personal and debt are separate lines; ownership from the account is "derived", an owner decision is "owner classified"', () => {
    const a = act([tx('b1', 'chk', 10_000, '2026-09-10', 'STAPLES'), tx('b2', 'chk', 5_000, '2026-09-11', 'LOWES'), tx('p1', 'pchk', 7_000, '2026-09-12', 'RESTAURANT'), tx('draw', 'chk', 90_000, '2026-09-13', 'OWNER DRAW'), tx('loan', 'chk', 40_000, '2026-09-14', 'TRUCK LOAN')],
      [decision('d1', 'b1', 'category', { category: 'office_admin' }), decision('d2', 'draw', 'category', { category: 'owner_draw' }), decision('d3', 'loan', 'debt', { debtAccountId: 'fa-loan' })])
    expect(a.lines.businessSpending).toMatchObject({ outMinor: 15_000, ownerClassified: { outMinor: 10_000 }, derived: { outMinor: 5_000 } })
    expect(a.lines.personalSpending).toMatchObject({ outMinor: 97_000, ownerClassified: { outMinor: 90_000 }, derived: { outMinor: 7_000 } })
    expect(a.lines.debtRepayments).toMatchObject({ outMinor: 40_000, ownerClassified: { outMinor: 40_000 } })
  })
  it('ignored rows are set aside (own line); pending rows are shown apart and in no line; removed rows are not rows at all', () => {
    const rows = rowsOf([tx('i', 'chk', 1_000, '2026-09-10', 'X'), tx('p', 'chk', 2_000, '2026-09-10', 'Y', { pending: true }), tx('r', 'chk', 4_000, '2026-09-10', 'Z', { removed: true })], [decision('d', 'i', 'ignored')])
    const a = buildActivity([...rows, { ...rows[0], id: 'removed', removed: true }], { from: '2026-09-01', to: '2026-10-11', days: 41 }, { complete: true, reason: null }, new Map())
    expect(a.lines.ignored).toMatchObject({ outMinor: 1_000, count: 1 }); expect(a.pending).toEqual({ inMinor: 0, outMinor: 2_000, count: 1 })
    expect(a.postedCount).toBe(1); expect(a.lines.businessSpending.count).toBe(0)
  })
  it('rows outside the window are not counted', () => {
    const a = act([tx('old', 'chk', 1_000, '2026-08-01', 'OLD'), tx('in', 'chk', 2_000, '2026-09-10', 'IN'), tx('future', 'chk', 3_000, '2026-10-12', 'LATE')])
    expect(a.postedCount).toBe(1); expect(a.lines.businessSpending.outMinor).toBe(2_000)
  })
  it('unusable amounts or duplicate ids give no totals, with the reason (never wrong totals)', () => {
    const rows = rowsOf([tx('a', 'chk', 1_000, '2026-09-10', 'A')])
    const bad = buildActivity([{ ...rows[0], amountMinor: 1.5 }], { from: '2026-09-01', to: '2026-10-11', days: 41 }, { complete: true, reason: null }, new Map())
    expect(bad.coverage.complete).toBe(false); expect(bad.postedCount).toBe(0)
    const dup = buildActivity([rows[0], rows[0]], { from: '2026-09-01', to: '2026-10-11', days: 41 }, { complete: true, reason: null }, new Map())
    expect(dup.coverage.complete).toBe(false); expect(dup.postedCount).toBe(0)
  })
  it('incomplete coverage is carried into the position as a warning', () => {
    const q = buildPosition(base({ rows: [], coverage: { complete: false, reason: 'Legacy review evidence may be capped.' } }))
    expect(q.activity!.coverage).toEqual({ complete: false, reason: 'Legacy review evidence may be capped.' }); expect(q.issues.find(i => i.id === 'activity-partial')!.message).toContain('Legacy review evidence may be capped.')
    expect(buildPosition(base({ rows: null })).activity).toBeNull(); expect(buildPosition(base({ rows: null })).issues.map(i => i.id)).toContain('activity-unavailable')
  })
})

describe('the position and the BANK-6G all-money report agree, except for ONE documented difference', () => {
  const report = (txs, decisions) => {
    const rows = rowsOf(txs, decisions)
    return { rows, r: buildSpendingReport(rows, 'all_money', { from: '2026-09-01', to: '2026-10-11', accounts: 'all', environment: 'production' }, APPROVED_REPORTING_POLICY, { complete: true, reason: null }) }
  }
  it('on confirmed decisions the money-out lines match the report exactly (business, personal, debt, internal, ignored)', () => {
    const txs = [tx('b', 'chk', 10_000, '2026-09-10', 'STAPLES'), tx('p', 'pchk', 7_000, '2026-09-12', 'RESTAURANT'), tx('o', 'chk', 20_000, '2026-09-13', 'TRANSFER OUT'), tx('i', 'sav', -20_000, '2026-09-13', 'TRANSFER IN'), tx('ig', 'chk', 500, '2026-09-14', 'IGN')]
    const decisions = [decision('d1', 'o', 'transfer', { counterpartTxId: 'i' }), decision('d1b', 'i', 'transfer', { counterpartTxId: 'o' }), decision('d2', 'ig', 'ignored'), decision('d3', 'b', 'category', { category: 'office_admin' })]
    const { r } = report(txs, decisions)
    const a = act(txs, decisions)
    const g = Object.fromEntries(r.groups.map(x => [x.key, x]))
    expect(a.lines.businessSpending.outMinor).toBe(g.business.outMinor); expect(a.lines.personalSpending.outMinor).toBe(g.personal.outMinor)
    expect(a.lines.internalMovement).toMatchObject({ outMinor: g.transfer.outMinor, inMinor: g.transfer.inMinor }); expect(a.lines.ignored.outMinor).toBe(g.ignored.outMinor)
  })
  it('a personal-account outflow that is only PROPOSED as a transfer is "not resolved" in BOTH (the report already holds proposed transfers back)', () => {
    const txs = [tx('o', 'pchk', 30_000, '2026-09-10', 'ONLINE TRANSFER TO SAV'), tx('i', 'sav', -30_000, '2026-09-10', 'ONLINE TRANSFER FROM CHK')]
    const { r } = report(txs, [])
    expect(r.rows.find(x => x.id === 'o').activity).toBe('unresolved'); expect(where(txs).o).toBe('unresolvedOut')
    expect(act(txs).lines.personalSpending.outMinor).toBe(0)
  })
  it('DIFFERENCE (deliberate): a personal-account outflow that is only PROPOSED as a debt payment is "not resolved" in the position, but personal spending in the report', () => {
    const txs = [tx('loan', 'pchk', 40_000, '2026-09-10', 'TRUCK LOAN PAYMENT')]
    const rows = buildRows({ asOf: '2026-10-11', txs, accounts: ACCOUNTS, decisions: [], bills: [], obligationLabels: new Map(), commitmentLabels: new Map(), debts: [{ id: 'fa-loan', label: 'Truck Loan', accountType: 'loan' }], projects: [], reconciliation: true }).rows
    expect(rows[0].relationship).toMatchObject({ kind: 'debt', state: 'suggested' })
    const r = buildSpendingReport(rows, 'all_money', { from: '2026-09-01', to: '2026-10-11', accounts: 'all', environment: 'production' }, APPROVED_REPORTING_POLICY, { complete: true, reason: null })
    expect(r.rows[0].activity).toBe('personal')                                      // the BANK-6G report (owner-approved policy) counts it as personal spending
    expect(placeRow(rows[0]).line).toBe('unresolvedOut')                              // the position holds a proposed debt payment back until the owner confirms it
    expect(buildActivity(rows, { from: '2026-09-01', to: '2026-10-11', days: 41 }, { complete: true, reason: null }, new Map()).lines.unresolvedOut.hints.likelyTransferOrPayment).toMatchObject({ outMinor: 40_000, count: 1 })
  })
  it('DIFFERENCE (corrected defect): unclassified deposits are "money in" in the report, but never income in the position', () => {
    const txs = [tx('d', 'chk', -9_900, '2026-09-10', 'DEPOSIT')]
    const { r } = report(txs, [])
    expect(r.rows[0].activity).toBe('income'); expect(where(txs).d).toBe('unclassifiedIn'); expect(act(txs).lines.income.inMinor).toBe(0)
  })
})

describe('every posted row is in exactly one line (randomized), and the result is deterministic', () => {
  function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
  const NAMES = ['ONLINE TRANSFER', 'PAYMENT THANK YOU', 'HOME DEPOT', 'DEPOSIT CUSTOMER', 'CHEVRON', 'REFUND', 'CARD AUTOPAY', 'ZELLE']
  const scenario = (seed: number) => {
    const r = rng(seed), pick = xs => xs[Math.floor(r() * xs.length)]
    const txs = [], decisions = []
    const n = 5 + Math.floor(r() * 60)
    for (let k = 0; k < n; k++) {
      const amt = pick([1_500, 2_500, 5_000, 12_000, 50_000]) * (r() < 0.45 ? -1 : 1)
      txs.push(tx(`t${seed}-${k}`, pick(['chk', 'sav', 'card', 'pchk']), amt, `2026-09-${String(1 + Math.floor(r() * 28)).padStart(2, '0')}`, pick(NAMES), { pending: r() < 0.1, removed: r() < 0.03 }))
      if (k && r() < 0.25) txs.push(tx(`t${seed}-${k}x`, pick(['chk', 'sav', 'card', 'pchk']), -amt, txs[txs.length - 1].date, pick(NAMES)))
    }
    for (const t of txs) if (r() < 0.3) decisions.push(decision(`d-${t.id}`, t.id, pick(['category', 'category', 'ignored', 'debt', 'overhead']), { category: pick(['materials', 'customer_payment', 'refund', 'transfers', 'personal_owner', 'owner_draw', 'other_needs_review']) }))
    return { txs, decisions }
  }
  it('Σ line counts = postedCount = posted rows in the window; Σ in/out of the lines = Σ in/out of those rows (300 scenarios, both switch states)', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const { txs, decisions } = scenario(seed)
      for (const on of [true, false]) {
        const rows = rowsOf(txs.filter(t => !t.removed), decisions.filter(d => d.kind !== 'debt'), on)   // a 'debt' decision needs a valid target; the other kinds exercise every line
        const window = { from: '2026-09-01', to: '2026-09-30', days: 30 }
        const a = buildActivity(rows, window, { complete: true, reason: null }, new Map())
        const posted = rows.filter(r => !r.pending && r.date >= window.from && r.date <= window.to)
        const lines = Object.values(a.lines)
        expect(lines.reduce((n, l) => n + l.count, 0), `seed ${seed} on=${on}`).toBe(posted.length); expect(a.postedCount).toBe(posted.length)
        expect(lines.reduce((n, l) => n + l.inMinor, 0)).toBe(posted.filter(r => r.direction === 'money_in').reduce((n, r) => n + Math.abs(r.amountMinor), 0))
        expect(lines.reduce((n, l) => n + l.outMinor, 0)).toBe(posted.filter(r => r.direction === 'money_out').reduce((n, r) => n + r.amountMinor, 0))
        for (const l of lines) { expect(l.ownerClassified.count + l.derived.count).toBe(l.count); expect(l.ownerClassified.inMinor + l.derived.inMinor).toBe(l.inMinor); expect(l.ownerClassified.outMinor + l.derived.outMinor).toBe(l.outMinor) }
        // income can only ever come from an owner-confirmed customer payment
        const incomeRows = posted.filter(r => placeRow(r).line === 'income')
        expect(incomeRows.every(r => r.bucket.state === 'confirmed' && r.bucket.key === 'customer_payment' && r.direction === 'money_in')).toBe(true)
        expect(a.lines.income.derived.count).toBe(0)
      }
    }
  })
  it('the same inputs give byte-identical output, whatever the order the rows arrive in', () => {
    const { txs, decisions } = scenario(77)
    const rows = rowsOf(txs.filter(t => !t.removed), decisions.filter(d => d.kind !== 'debt'))
    const w = { from: '2026-09-01', to: '2026-09-30', days: 30 }
    const one = JSON.stringify(buildActivity(rows, w, { complete: true, reason: null }, new Map()))
    expect(JSON.stringify(buildActivity([...rows].reverse(), w, { complete: true, reason: null }, new Map()))).toBe(one)
    expect(JSON.stringify(buildActivity([...rows].sort((a, b) => a.id.localeCompare(b.id)), w, { complete: true, reason: null }, new Map()))).toBe(one)
    const balances = [view('A', 'depository', 'checking', { currentMinor: 100 }), view('B', 'credit', 'credit card', { currentMinor: 5, limitMinor: 100 })]
    expect(JSON.stringify(buildPosition(base({ balances, rows })))).toBe(JSON.stringify(buildPosition(base({ balances: [...balances].reverse(), rows: [...rows].reverse() }))))
  })
})

describe('integrity signals: nothing is merged or hidden; what looks wrong is said', () => {
  it('the same account connected twice (two Items of one institution) is flagged, never silently de-duplicated', () => {
    const a = view('Business Checking', 'depository', 'checking', { currentMinor: 100_000 }, { connectionId: 'item-1', accountRef: 'r1' })
    const b = view('Business Checking', 'depository', 'checking', { currentMinor: 100_000 }, { connectionId: 'item-2', accountRef: 'r2' })
    const q = buildPosition(base({ balances: [a, b] }))
    expect(q.cash.liquid.all.balance.minor).toBe(200_000)                                  // both are counted as they are: Cash OS does not decide which one is real
    expect(q.issues.find(i => i.id === 'duplicate-accounts')).toMatchObject({ severity: 'warning' })
    expect(q.issues.find(i => i.id === 'duplicate-accounts')!.message).toMatch(/same account connected more than once.*counted twice/)
    // different accounts of one institution, or the same mask at two institutions, are not flagged
    const c = view('Business Savings', 'depository', 'savings', { currentMinor: 5 }, { connectionId: 'item-1', accountRef: 'r3', mask: '2222' })
    const d = view('Other Bank Checking', 'depository', 'checking', { currentMinor: 5 }, { connectionId: 'item-3', accountRef: 'r4', institutionName: 'Chase' })
    expect(buildPosition(base({ balances: [a, c, d] })).issues.some(i => i.id === 'duplicate-accounts')).toBe(false)
    // two accounts with the same mask inside ONE connection (a checking and a savings sharing digits) are not duplicates either
    expect(buildPosition(base({ balances: [a, view('Business Checking', 'depository', 'checking', { currentMinor: 1 }, { connectionId: 'item-1', accountRef: 'r9' })] })).issues.some(i => i.id === 'duplicate-accounts')).toBe(false)
  })

  it('confirmed transfers that do not balance in the period are reported (a side is outside the period, removed, or changed) and shown with both sides', () => {
    const txs = [tx('o', 'chk', 100_000, '2026-09-12', 'ONLINE TRANSFER TO SAV'), tx('i', 'sav', -100_000, '2026-09-13', 'ONLINE TRANSFER FROM CHK')]
    const decisions = [decision('d1', 'o', 'transfer', { counterpartTxId: 'i' }), decision('d1b', 'i', 'transfer', { counterpartTxId: 'o' })]
    const rows = rowsOf(txs, decisions)
    const w = { from: '2026-09-13', to: '2026-10-11', days: 29 }                          // the outgoing leg falls one day BEFORE the period
    const q = buildPosition(base({ rows, window: w }))
    expect(q.activity!.lines.internalMovement).toMatchObject({ outMinor: 0, inMinor: 100_000, count: 1 })
    expect(q.issues.find(i => i.id === 'internal-unbalanced')!.message).toMatch(/do not balance.*out \$0\.00, in \$1,000\.00.*outside the period.*removed.*changed/)
    expect(buildPosition(base({ rows })).issues.some(i => i.id === 'internal-unbalanced')).toBe(false)   // whole pair in the period: balanced
    // a bank-changed amount on one leg after the owner confirmed it shows as an imbalance too
    const changed = rowsOf([txs[0], { ...txs[1], amountMinor: -99_000 }], decisions)
    expect(buildPosition(base({ rows: changed })).issues.some(i => i.id === 'internal-unbalanced')).toBe(true)
  })

  it('a confirmed pair between a business and a personal account is counted once as cross-scope (an owner draw or contribution), still in neither income nor spending', () => {
    const txs = [tx('o', 'chk', 200_000, '2026-09-12', 'ONLINE TRANSFER'), tx('i', 'pchk', -200_000, '2026-09-12', 'ONLINE TRANSFER'), tx('o2', 'chk', 50_000, '2026-09-14', 'ONLINE TRANSFER TO SAV'), tx('i2', 'sav', -50_000, '2026-09-14', 'ONLINE TRANSFER FROM CHK')]
    const decisions = [decision('d1', 'o', 'transfer', { counterpartTxId: 'i' }), decision('d1b', 'i', 'transfer', { counterpartTxId: 'o' }), decision('d2', 'o2', 'transfer', { counterpartTxId: 'i2' }), decision('d2b', 'i2', 'transfer', { counterpartTxId: 'o2' })]
    const a = act(txs, decisions)
    expect(a.lines.internalMovement).toMatchObject({ outMinor: 250_000, inMinor: 250_000, count: 4, crossScope: { outMinor: 200_000, count: 1 } })   // the business-to-business $500 pair is not cross-scope
    expect(a.lines.income.inMinor + a.lines.businessSpending.outMinor + a.lines.personalSpending.outMinor).toBe(0)
  })
})

describe('the manual ledger sits beside the bank and is only compared (browser side)', () => {
  const accounts = buildPosition(base({ balances: [
    view('Business Checking', 'depository', 'checking', { currentMinor: 1_000_000, availableMinor: 900_000 }),
    view('Business Visa', 'credit', 'credit card', { currentMinor: 230_000, limitMinor: 1_000_000 }),
    view('Savings', 'depository', 'savings', { currentMinor: 4_000_000 }, { ownership: null, mappedFinancialAccountId: null }),
  ] }))
  const ledger = [
    { id: 'fa-Business Checking', name: 'Operating', accountClass: 'asset', ownership: 'business', includeInCash: true, status: 'active', balanceMinor: 1_050_000 },
    { id: 'fa-Business Visa', name: 'Visa (manual)', accountClass: 'liability', ownership: 'business', includeInCash: false, status: 'active', balanceMinor: 200_000 },
    { id: 'fa-petty', name: 'Petty cash', accountClass: 'asset', ownership: 'business', includeInCash: true, status: 'active', balanceMinor: 20_000 },
    { id: 'fa-old', name: 'Archived', accountClass: 'asset', ownership: 'business', includeInCash: true, status: 'archived', balanceMinor: 999 },
    { id: 'fa-wrong', name: 'Mismapped', accountClass: 'liability', ownership: 'business', includeInCash: false, status: 'active', balanceMinor: 5 },
  ]
  it('differences are information: bank minus ledger, only for the same kind of money; a ledger-only account has none', () => {
    const v = compareManualLedger(accounts, ledger)
    const by = Object.fromEntries(v.lines.map(l => [l.financialAccountId, l]))
    expect(by['fa-Business Checking']).toMatchObject({ ledgerMinor: 1_050_000, provenance: 'manual_ledger', differenceMinor: -50_000, comparable: true, bank: { balanceMinor: 1_000_000, freshness: 'fresh' } })
    expect(by['fa-Business Visa']).toMatchObject({ ledgerMinor: 200_000, differenceMinor: 30_000, comparable: true, bank: { accountClass: 'credit_card', balanceMinor: 230_000 } })
    expect(by['fa-petty']).toMatchObject({ ledgerMinor: 20_000, bank: null, differenceMinor: null, comparable: false })
    expect(v.lines.some(l => l.financialAccountId === 'fa-old')).toBe(false)                         // archived accounts are not compared
    expect(v.ledgerCash).toEqual({ minor: 1_070_000, provenance: 'manual_ledger' })                  // active asset accounts included in cash only
    expect(v.bankOnly.map(a => a.name)).toEqual(['Savings'])                                           // a bank account the ledger knows nothing about
  })
  it('comparing never changes either side, and an asset ledger account mapped to a card is not compared (different kinds of money)', () => {
    const before = JSON.stringify(accounts)
    const v = compareManualLedger(accounts, [{ ...ledger[0], id: 'fa-Business Visa', name: 'Wrong kind' }])
    expect(JSON.stringify(accounts)).toBe(before); expect(v.lines[0]).toMatchObject({ comparable: false, differenceMinor: null })
    expect(compareManualLedger(accounts, []).ledgerCash).toEqual({ minor: null, provenance: 'unavailable' })
  })
})
