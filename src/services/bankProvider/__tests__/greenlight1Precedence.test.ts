/**
 * GREENLIGHT-1 (reviewer A) corrections, pure functions over the real explorer / report / position code. Every change is reconciliation- or position-only:
 *  A-1  ON: a category the owner confirmed outranks an unconfirmed transfer/debt suggestion (reported under the owner's category, not "unresolved").
 *  A-2  ON: a payment into a loan account and a card cash advance are held back as unresolved (as before the engine), never Business spending / Money in;
 *       an ordinary card purchase next to an unrelated deposit of the same amount is NOT held back.
 *  A-4  ON: the mirrored pair leg never overrides a category the other leg's owner confirmed.
 *  A-3  position: a balance without the bank's own timestamp is never shown as current.
 * With the switch OFF the rows are exactly what they were (pinned here for the same scenarios; the full proof is plaid3aReconciliationSwitch / plaid6).
 */
import { describe, expect, it } from 'vitest'
import { buildRows } from '../spending/explorer'
import { activityOf } from '../spending/reporting'
import { buildPosition, placeRow } from '../spending/consolidatedPosition'
import { interpretBalance } from '../balanceModel'
import type { AccountContext, Decision, EvidenceTx } from '../spending/types'

const acct = (ref: string, type: string, subtype: string, name: string): AccountContext => ({ providerAccountRef: ref, label: `WF · ${name}`, mask: ref.slice(0, 4), ownership: 'business', financialAccountId: `fa-${ref}`, financialAccountName: name, environment: 'production', providerType: type, providerSubtype: subtype } as AccountContext)
const ACCOUNTS = [acct('chk', 'depository', 'checking', 'Business Checking'), acct('sav', 'depository', 'savings', 'Business Savings'), acct('card', 'credit', 'credit card', 'Business Visa'), acct('loan', 'loan', 'auto', 'Truck loan')]
const tx = (id: string, ref: string, dollars: number, date: string, name: string, pfc?: string): EvidenceTx => ({ id, providerAccountRef: ref, date, name, merchantName: null, amountMinor: Math.round(dollars * 100), pending: false, removed: false, category: pfc ? { primary: pfc.split('|')[0], detailed: pfc.split('|')[1] ?? null, confidence: 'HIGH' } : null } as EvidenceTx)
const dec = (txId: string, kind: string, extra: Partial<Decision> = {}): Decision => ({ id: `d-${txId}-${kind}`, txId, kind, status: 'confirmed', category: null, projectId: null, obligationId: null, commitmentId: null, debtAccountId: null, counterpartTxId: null, confidence: 'high', source: 'owner', decidedAt: '2026-10-01T00:00:00Z', ...extra } as Decision)
const rows = (txs: EvidenceTx[], decisions: Decision[], reconciliation: boolean, debts: Array<{ id: string; label: string }> = []) =>
  buildRows({ asOf: '2026-10-11', accountScope: 'all', txs, accounts: ACCOUNTS, decisions, bills: [], obligationLabels: new Map(), commitmentLabels: new Map(), debts, projects: [], ownerRules: new Map(), reconciliation } as any).rows
const view = (rs: ReturnType<typeof rows>) => Object.fromEntries(rs.map(r => [r.id, { activity: activityOf(r), position: placeRow(r as any).line }]))

describe('GREENLIGHT-1 precedence and holds (reconciliation ON only)', () => {
  it('A-1: an owner-confirmed category beats a suggested transfer (Zelle tagged as a transfer) and a suggested debt payment', () => {
    const txs = [tx('z', 'chk', 1800, '2026-10-01', 'ZELLE TO JOSE GARCIA', 'TRANSFER_OUT|TRANSFER_OUT_ACCOUNT_TRANSFER'), tx('f', 'chk', 650, '2026-10-02', 'FORD CREDIT PAYMENT')]
    const decisions = [dec('z', 'category', { category: 'payroll_people' }), dec('f', 'category', { category: 'fuel_vehicle' })]
    const debts = [{ id: 'debt-ford', label: 'Ford Credit truck loan' }]
    expect(view(rows(txs, decisions, true, debts))).toEqual({ z: { activity: 'business', position: 'businessSpending' }, f: { activity: 'business', position: 'businessSpending' } })
    // OFF: exactly the pre-existing behavior (documented as a pre-existing defect; changing it needs the owner's approval)
    expect(view(rows(txs, decisions, false, debts))).toEqual({ z: { activity: 'unresolved', position: 'unresolvedOut' }, f: { activity: 'unresolved', position: 'unresolvedOut' } })
  })

  it('A-2: a loan payment and a card cash advance are unresolved with the switch ON, as with it OFF; an unrelated same-amount purchase/deposit is not held', () => {
    const txs = [tx('lp', 'chk', 650, '2026-10-07', 'WF LOAN PAYMENT'), tx('lpin', 'loan', -650, '2026-10-07', 'PAYMENT RECEIVED'),
      tx('adv', 'card', 300, '2026-10-06', 'CASH ADVANCE'), tx('advin', 'chk', -300, '2026-10-06', 'ONLINE TRANSFER FROM VISA'),
      tx('buy', 'card', 49.99, '2026-10-08', 'ADOBE'), tx('dep', 'chk', -49.99, '2026-10-08', 'DEPOSIT CUSTOMER')]
    for (const on of [true, false]) {
      const v = view(rows(txs, [], on))
      for (const id of ['lp', 'adv']) expect(v[id], `${id} on=${on}`).toEqual({ activity: 'unresolved', position: 'unresolvedOut' })
      for (const id of ['lpin', 'advin']) expect(v[id], `${id} on=${on}`).toEqual({ activity: 'unresolved', position: 'unclassifiedIn' })
    }
    const v = view(rows(txs, [], true))
    expect(v.buy).toEqual({ activity: 'business', position: 'businessSpending' }); expect(v.dep.activity).toBe('income')
  })

  it('A-4: a one-leg confirmed transfer is not mirrored over a category the other leg\'s owner confirmed (contract G)', () => {
    const txs = [tx('o', 'chk', 500, '2026-10-03', 'ONLINE TRANSFER'), tx('i', 'sav', -500, '2026-10-03', 'DEPOSIT')]
    const decisions = [dec('o', 'transfer', { counterpartTxId: 'i' }), dec('i', 'category', { category: 'customer_payment' })]
    const r = rows(txs, decisions, true).find(x => x.id === 'i')!
    expect(r.relationship.state).not.toBe('confirmed'); expect(r.bucket).toMatchObject({ key: 'customer_payment', state: 'confirmed' })
    // without a competing decision the mirror still works
    const plain = rows(txs, [dec('o', 'transfer', { counterpartTxId: 'i' })], true).find(x => x.id === 'i')!
    expect(plain.relationship).toMatchObject({ kind: 'transfer', state: 'confirmed' })
  })

  it('A-3: a balance the bank gave no time for is never "current" in the position; one with the bank\'s time is', () => {
    const now = Date.parse('2026-10-11T12:00:00Z')
    const position = (observedIsProvider: boolean) => {
      const snap = { currentMinor: 1234500, availableMinor: 1200000, limitMinor: null, observedAt: '2026-10-11T11:59:00Z', retrievedAt: '2026-10-11T11:59:00Z', observedIsProvider }
      const v = { ...interpretBalance({ type: 'depository', subtype: 'checking' }, snap, now, true), accountRef: 'a1', connectionId: 'i1', institutionName: 'WF', name: 'Checking', mask: '1111', type: 'depository', subtype: 'checking', live: true, mappedFinancialAccountId: 'fa', ownership: 'business' as const }
      return buildPosition({ nowMs: now, environment: 'production', balancesEnabled: true, balances: [v as any], rows: [], accountClassOf: new Map(), window: { from: '2026-09-12', to: '2026-10-11', days: 30 }, coverage: { complete: true, reason: null }, syncs: [], reconciliation: false } as any)
    }
    const unknownTime = position(false)
    expect(unknownTime.accounts[0]).toMatchObject({ freshness: 'aging', bankTimeKnown: false })
    expect(unknownTime.cash.liquid.business.completeness).not.toBe('current')
    expect(unknownTime.cash.liquid.business.balance.minor).toBe(1234500)                                    // the figure is still shown, with its warning
    const bankTime = position(true)
    expect(bankTime.accounts[0]).toMatchObject({ freshness: 'fresh', bankTimeKnown: true })
    expect(bankTime.cash.liquid.business.completeness).toBe('current')
  })
})
