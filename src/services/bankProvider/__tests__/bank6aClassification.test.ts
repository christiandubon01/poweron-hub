import { describe, expect, it } from 'vitest'
import { classifyAll } from '../spending/classifier'
import { BATCH_APPROVABLE_BUCKETS, BUCKETS, bucketFitsDirection } from '../spending/taxonomy'
import type { AccountContext, EvidenceTx } from '../spending/types'

/** BANK-6A: what a real bank statement looks like to the classifier. Suggestions only; the strongest wording for money in, owner draws, card payments is "possible". */
const ACC = '10000000-0000-4000-8000-0000000000a1'
const accounts = new Map<string, AccountContext>([[ACC, { providerAccountRef: ACC, label: 'Wells Fargo', mask: '6960', ownership: 'business', financialAccountId: 'fa', financialAccountName: 'WF 6960', environment: 'production' }]])
let n = 0
const tx = (name: string, dollars: number, over: Partial<EvidenceTx> = {}): EvidenceTx => ({ id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, providerAccountRef: ACC, date: '2026-10-01', name, merchantName: null, amountMinor: Math.round(dollars * 100), pending: false, removed: false, category: null, ...over })
const one = (t: EvidenceTx) => classifyAll({ txs: [t], accounts, decisions: [], bills: [], debts: [], projects: [] }).get(t.id)!

describe('BANK-6A classification of real bank wording', () => {
  it('owner draws are only ever a "possible" bucket suggestion', () => {
    for (const name of ['OWNER DRAW', "OWNER'S DRAW 1234", 'MEMBER DRAW ONLINE', 'SHAREHOLDER DISTRIBUTION']) expect(one(tx(name, 800)).bucket, name).toMatchObject({ bucket: 'owner_draw', confidence: 'possible' })
  })
  it('incoming money: customer-payment and refund wording is "possible" at most, and unrecognised deposits get no suggestion', () => {
    for (const name of ['MOBILE DEPOSIT', 'ZELLE FROM J SMITH', 'REMOTE ONLINE DEPOSIT']) expect(one(tx(name, -900)).bucket, name).toMatchObject({ bucket: 'customer_payment', confidence: 'possible' })
    for (const name of ['HOME DEPOT RETURN', 'AMAZON REFUND', 'CHARGEBACK CREDIT']) expect(one(tx(name, -45)).bucket, name).toMatchObject({ bucket: 'refund', confidence: 'possible' })
    expect(one(tx('INTEREST PAID', -1.2)).bucket).toBeNull()
    for (const out of [one(tx('MOBILE DEPOSIT', -900)), one(tx('AMAZON REFUND', -45))]) expect(out.bucket!.confidence).not.toBe('high')
  })
  it('a credit-card payment is a (possible) transfer, never ordinary spending; a merchant that merely contains "card" is not', () => {
    for (const t of [tx('WELLS FARGO CREDIT CARD AUTOPAY', 400), tx('ONLINE CARD PAYMENT CHASE', 400), tx('PAYMENT', 400, { category: { primary: 'LOAN_PAYMENTS', detailed: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT', confidence: 'HIGH' } })]) {
      const s = one(t)
      expect(s.relationship, t.name!).toMatchObject({ kind: 'transfer', confidence: 'possible' })
      expect(s.bucket).toMatchObject({ bucket: 'transfers' })
    }
    expect(one(tx('GREETING CARD SHOP', 12)).relationship).toBeNull()
    expect(one(tx('CARD PAYMENT RECEIVED', -400)).relationship).toBeNull() // money in is not a card payment OUT
  })
  it('payroll, projects and transfers are never "high" from a name alone except a payroll PROCESSOR, and even that is excluded from batch approval', () => {
    expect(one(tx('GUSTO PAYROLL 4412', 4200)).bucket).toMatchObject({ bucket: 'payroll_people' })
    expect(BATCH_APPROVABLE_BUCKETS).not.toContain('payroll_people')
    for (const b of ['payroll_people', 'personal_owner', 'transfers', 'owner_draw', 'customer_payment', 'refund', 'other_needs_review']) expect(BATCH_APPROVABLE_BUCKETS, b).not.toContain(b)
    for (const b of BATCH_APPROVABLE_BUCKETS) expect(BUCKETS.some(x => x.key === b)).toBe(true)
  })
  it('categories fit the direction of the money', () => {
    expect(bucketFitsDirection('customer_payment', 'money_in')).toBe(true); expect(bucketFitsDirection('customer_payment', 'money_out')).toBe(false)
    expect(bucketFitsDirection('refund', 'money_out')).toBe(false); expect(bucketFitsDirection('materials', 'money_in')).toBe(false)
    expect(bucketFitsDirection('transfers', 'money_in')).toBe(true); expect(bucketFitsDirection('other_needs_review', 'money_in')).toBe(true)
  })
})
