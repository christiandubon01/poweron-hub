import { describe, expect, it } from 'vitest'
import { buildRows } from '../spending/explorer'
import type { AccountContext, Decision, EvidenceTx } from '../spending/types'

const acct = (ref: string, label: string, type: string, subtype: string): AccountContext => ({ providerAccountRef: ref, label, mask: null, ownership: 'business', financialAccountId: `fa-${ref}`, financialAccountName: label, environment: 'production', providerType: type, providerSubtype: subtype })
const ACCOUNTS = [acct('chk', 'Checking', 'depository', 'checking'), acct('sav', 'Savings', 'depository', 'savings'), acct('card', 'Visa', 'credit', 'credit card')]
const tx = (id: string, account: string, amountMinor: number, date: string, name: string): EvidenceTx => ({ id, providerAccountRef: account, date, name, merchantName: null, amountMinor, pending: false, removed: false, category: null })
const build = (txs: EvidenceTx[], decisions: Decision[] = []) => buildRows({ asOf: '2026-09-30', txs, accounts: ACCOUNTS, decisions, bills: [], obligationLabels: new Map(), commitmentLabels: new Map(), debts: [], projects: [], reconciliation: true }).rows
const rowOf = (rows: ReturnType<typeof build>, id: string) => rows.find(r => r.id === id)!

describe('PLAID-2F inside the Explorer', () => {
  const base = [
    tx('purchase', 'card', 12_000, '2026-09-02', 'HOME DEPOT #12'),          // an expense on the card
    tx('pay-out', 'chk', 50_000, '2026-09-10', 'WELLS FARGO CARD AUTOPAY'), tx('pay-in', 'card', -50_000, '2026-09-11', 'PAYMENT THANK YOU'),
  ]
  it('the card payment is two transfer legs (not spending, not income); the card purchase stays an expense that needs a decision', () => {
    const r = build(base)
    for (const id of ['pay-out', 'pay-in']) {
      const row = rowOf(r, id)
      expect(row.relationship).toMatchObject({ kind: 'transfer', state: 'suggested', confidence: 'high' })
      expect(row.bucket.key).toBe('transfers')
      expect(row.unassigned).toBe(false)
    }
    expect(rowOf(r, 'pay-out').relationship.target).toMatchObject({ type: 'counterpart_tx', id: 'pay-in' })
    expect(rowOf(r, 'purchase').relationship.kind).not.toBe('transfer')
    expect(rowOf(r, 'purchase').unassigned).toBe(true)
  })

  it('ambiguous equal movements are NOT paired: they stay low-confidence and unresolved for the owner', () => {
    const r = build([tx('o1', 'chk', 20_000, '2026-09-01', 'MISC'), tx('o2', 'sav', 20_000, '2026-09-01', 'MISC'), tx('i', 'card', -20_000, '2026-09-02', 'PAYMENT')])
    for (const id of ['o1', 'o2', 'i']) expect(rowOf(r, id).relationship).toMatchObject({ kind: 'transfer', confidence: 'low' })
    expect(rowOf(r, 'o1').relationship.target?.id ?? null).toBeNull() // no counterpart picked
    expect(rowOf(r, 'o1').unassigned).toBe(true)
  })

  it('a refund returns to the card that paid: suggested as a refund (never income) and never high', () => {
    const r = build([tx('buy', 'card', 8_999, '2026-08-01', 'HOME DEPOT #12'), tx('ref', 'card', -8_999, '2026-08-20', 'HOME DEPOT RETURN')])
    expect(rowOf(r, 'ref').bucket).toMatchObject({ key: 'refund', state: 'suggested' })
    expect(rowOf(r, 'ref').bucket.confidence).not.toBe('high')
  })

  it('an owner-rejected transfer decision suppresses the suggestion; an owner-confirmed pair stays confirmed', () => {
    const txs = [tx('o', 'chk', 7_000, '2026-09-01', 'ONLINE TRANSFER'), tx('i', 'sav', -7_000, '2026-09-01', 'ONLINE TRANSFER')]
    const decision = (status: 'confirmed' | 'rejected'): Decision => ({ id: 'd1', txId: 'o', kind: 'transfer', status, category: null, projectId: null, obligationId: null, commitmentId: null, debtAccountId: null, counterpartTxId: 'i', confidence: 'high', source: 'owner', decidedAt: '2026-09-02T00:00:00Z' })
    const rejected = build(txs, [decision('rejected')])
    expect(rowOf(rejected, 'o').relationship.state).not.toBe('suggested')
    expect(rowOf(rejected, 'i').relationship.target?.id ?? null).toBeNull() // the rejected pairing is never offered again, from either side
    const confirmed = build(txs, [decision('confirmed')])
    expect(rowOf(confirmed, 'o').relationship).toMatchObject({ kind: 'transfer', state: 'confirmed' })
    expect(rowOf(confirmed, 'i').relationship).toMatchObject({ kind: 'transfer', state: 'confirmed' }) // the owner's pairing names both legs
    expect(rowOf(confirmed, 'i').relationship.reasons[0]).toMatch(/Paired with the transfer you confirmed/)
    // ... but only when the counterpart is live evidence
    expect(rowOf(build([txs[0]], [decision('confirmed')]), 'o').relationship.state).toBe('confirmed')
  })
})
