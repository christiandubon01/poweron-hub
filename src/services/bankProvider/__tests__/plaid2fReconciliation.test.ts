import { describe, expect, it } from 'vitest'
import { performance } from 'node:perf_hooks'
import { reconcile, type ReconAccount } from '../spending/reconciliation'
import type { EvidenceTx } from '../spending/types'

const ACCTS: ReconAccount[] = [
  { ref: 'chk', label: 'Business Checking', accountClass: 'bank_cash' }, { ref: 'chk2', label: 'Personal Checking', accountClass: 'bank_cash' },
  { ref: 'sav', label: 'Savings', accountClass: 'bank_cash' }, { ref: 'card', label: 'Visa Card', accountClass: 'credit_card' }, { ref: 'loan', label: 'Truck Loan', accountClass: 'loan' },
]
let n = 0
const tx = (account: string, amountMinor: number, date: string, name = 'GENERIC', o: Partial<EvidenceTx> = {}): EvidenceTx =>
  ({ id: o.id ?? `t${++n}`, providerAccountRef: account, date, name, merchantName: null, amountMinor, pending: false, removed: false, category: null, ...o })
const run = (txs: EvidenceTx[], extra: Partial<Parameters<typeof reconcile>[0]> = {}) => reconcile({ txs, accounts: ACCTS, ...extra })

describe('PLAID-2F reconciliation engine', () => {
  it('pairs a checking-to-savings transfer; the text makes it high, equal amounts alone only possible', () => {
    const a = run([tx('chk', 100_000, '2026-09-01', 'ONLINE TRANSFER TO SAV', { id: 'o' }), tx('sav', -100_000, '2026-09-01', 'ONLINE TRANSFER FROM CHK', { id: 'i' })])
    expect(a.pairs).toEqual([expect.objectContaining({ kind: 'internal_transfer', outflowId: 'o', inflowId: 'i', confidence: 'high', state: 'suggested' })])
    const b = run([tx('chk', 100_000, '2026-09-01', 'ACME', { id: 'o' }), tx('sav', -100_000, '2026-09-02', 'DEPOSIT', { id: 'i' })])
    expect(b.pairs[0]).toMatchObject({ confidence: 'possible', daysApart: 1 })
    expect(b.pairs[0].reasons.join(' ')).toMatch(/please confirm/)
  })

  it('a payment from checking to an owned card is a card payment, not an expense and not card-side income; card purchases are never payment legs', () => {
    const r = run([
      tx('card', 5_000, '2026-09-02', 'HOME DEPOT', { id: 'purchase' }),                                                 // a purchase on the card: an expense, never a candidate
      tx('chk', 50_000, '2026-09-05', 'WELLS FARGO CARD AUTOPAY', { id: 'pay-out' }), tx('card', -50_000, '2026-09-07', 'PAYMENT THANK YOU', { id: 'pay-in' }),
    ])
    expect(r.pairs).toEqual([expect.objectContaining({ kind: 'card_payment', outflowId: 'pay-out', inflowId: 'pay-in', confidence: 'high', daysApart: 2 })])
    const legs = new Set(r.pairs.flatMap(p => [p.outflowId, p.inflowId]))
    expect(legs.has('purchase')).toBe(false)
  })

  it('never double counts: a leg belongs to at most one pair', () => {
    const txs = [tx('chk', 10_000, '2026-09-01', 'TRANSFER', { id: 'o1' }), tx('sav', -10_000, '2026-09-01', 'TRANSFER', { id: 'i1' }), tx('chk', 10_000, '2026-09-01', 'TRANSFER', { id: 'o2' })]
    const r = run(txs)
    const legs = r.pairs.flatMap(p => [p.outflowId, p.inflowId])
    expect(new Set(legs).size).toBe(legs.length)
    expect(r.ambiguous).toHaveLength(1) // two outflows, one inflow: not decidable
    expect(r.pairs).toHaveLength(0)
  })

  it('ambiguous groups go to owner review with every candidate listed, never guessed', () => {
    const r = run([tx('chk', 20_000, '2026-09-01', 'X', { id: 'o1' }), tx('chk2', 20_000, '2026-09-01', 'X', { id: 'o2' }), tx('sav', -20_000, '2026-09-01', 'X', { id: 'i1' })])
    expect(r.pairs).toHaveLength(0)
    expect(r.ambiguous[0]).toMatchObject({ outflowIds: ['o1', 'o2'], inflowIds: ['i1'] })
  })

  it('identical movements between the same two accounts pair in date order (possible only)', () => {
    const r = run([tx('chk', 20_000, '2026-09-01', 'T', { id: 'o1' }), tx('chk', 20_000, '2026-09-02', 'T', { id: 'o2' }), tx('sav', -20_000, '2026-09-01', 'T', { id: 'i1' }), tx('sav', -20_000, '2026-09-02', 'T', { id: 'i2' })])
    expect(r.pairs.map(p => [p.outflowId, p.inflowId, p.confidence])).toEqual([['o1', 'i1', 'possible'], ['o2', 'i2', 'possible']])
    expect(r.ambiguous).toHaveLength(0)
  })

  it('does not pair: same account, pending vs posted, outside the window, unequal amounts, loan or investment inflows', () => {
    expect(run([tx('chk', 100, '2026-09-01', 'T'), tx('chk', -100, '2026-09-01', 'T')]).pairs).toHaveLength(0)
    expect(run([tx('chk', 100, '2026-09-01', 'T', { pending: true }), tx('sav', -100, '2026-09-01', 'T')]).pairs).toHaveLength(0)
    expect(run([tx('chk', 100, '2026-09-01', 'T'), tx('sav', -100, '2026-09-05', 'T')]).pairs).toHaveLength(0) // 4 days between bank accounts
    expect(run([tx('chk', 100, '2026-09-01', 'T'), tx('sav', -100, '2026-09-04', 'T')]).pairs).toHaveLength(1) // 3 days is inside
    expect(run([tx('chk', 100, '2026-09-01', 'T'), tx('card', -100, '2026-09-06', 'T')]).pairs).toHaveLength(1) // 5 days for a card
    expect(run([tx('chk', 100, '2026-09-01', 'T'), tx('card', -100, '2026-09-07', 'T')]).pairs).toHaveLength(0)
    expect(run([tx('chk', 100, '2026-09-01', 'T'), tx('sav', -101, '2026-09-01', 'T')]).pairs).toHaveLength(0)
    expect(run([tx('chk', 100, '2026-09-01', 'LOAN PAYMENT'), tx('loan', -100, '2026-09-01', 'PAYMENT')]).pairs).toHaveLength(0)
    expect(run([tx('chk', 0, '2026-09-01', 'T'), tx('sav', 0, '2026-09-01', 'T')]).pairs).toHaveLength(0)
    expect(run([tx('chk', 100, '2026-09-01', 'T', { removed: true }), tx('sav', -100, '2026-09-01', 'T')]).pairs).toHaveLength(0)
  })

  it('owner decisions win: a rejected pair is never suggested again; a confirmed pair is final and frees nothing else', () => {
    const txs = [tx('chk', 5_000, '2026-09-01', 'TRANSFER', { id: 'o' }), tx('sav', -5_000, '2026-09-01', 'TRANSFER', { id: 'i' })]
    expect(run(txs, { rejectedPairs: [['i', 'o']] }).pairs).toHaveLength(0)
    const confirmed = run([...txs, tx('chk2', -5_000, '2026-09-01', 'TRANSFER', { id: 'i2' })], { confirmedPairs: [['o', 'i2']] })
    expect(confirmed.pairs).toEqual([expect.objectContaining({ outflowId: 'o', inflowId: 'i2', state: 'confirmed', confidence: 'high' })])
    expect(confirmed.pairs.some(p => p.inflowId === 'i')).toBe(false)
    // a confirmed pair whose evidence disappeared (removed) is simply not emitted, never invented
    expect(run([tx('chk', 5_000, '2026-09-01', 'T', { id: 'o' })], { confirmedPairs: [['o', 'gone']] }).pairs).toHaveLength(0)
  })

  it('refunds and reversals return to the paying account and the same merchant; never income, never guessed between several purchases', () => {
    const buy = tx('card', 8_999, '2026-08-01', 'HOME DEPOT #123', { id: 'buy' })
    const refund = tx('card', -8_999, '2026-08-20', 'HOME DEPOT RETURN', { id: 'ref' })
    expect(run([buy, refund]).refunds).toEqual([expect.objectContaining({ refundId: 'ref', originalId: 'buy', confidence: 'high' })])
    expect(run([buy, tx('card', -8_999, '2026-08-20', 'HOME DEPOT #123', { id: 'ref' })]).refunds[0]).toMatchObject({ originalId: 'buy', confidence: 'possible' })
    expect(run([buy, tx('card', -3_000, '2026-08-20', 'HOME DEPOT RETURN', { id: 'ref' })]).refunds[0].reasons.join(' ')).toMatch(/part/)
    expect(run([buy, tx('chk', -8_999, '2026-08-20', 'HOME DEPOT RETURN', { id: 'ref' })]).refunds).toHaveLength(0) // other account
    expect(run([buy, tx('card', -9_000, '2026-08-20', 'HOME DEPOT RETURN', { id: 'ref' })]).refunds).toHaveLength(0) // more than was paid
    expect(run([buy, tx('card', -8_999, '2027-01-20', 'HOME DEPOT RETURN', { id: 'ref' })]).refunds).toHaveLength(0) // outside the window
    const two = run([buy, tx('card', 8_999, '2026-08-05', 'HOME DEPOT #456', { id: 'buy2' }), refund]).refunds[0]
    expect(two).toMatchObject({ confidence: 'ambiguous', originalId: null, candidateIds: ['buy', 'buy2'] })
  })

  it('is deterministic: any input order gives the same result', () => {
    const base = [
      tx('chk', 10_000, '2026-09-01', 'TRANSFER', { id: 'a' }), tx('sav', -10_000, '2026-09-01', 'TRANSFER', { id: 'b' }),
      tx('chk', 7_000, '2026-09-03', 'CARD AUTOPAY', { id: 'c' }), tx('card', -7_000, '2026-09-04', 'PAYMENT', { id: 'd' }),
      tx('chk', 9_000, '2026-09-10', 'X', { id: 'e' }), tx('chk2', 9_000, '2026-09-10', 'X', { id: 'f' }), tx('sav', -9_000, '2026-09-10', 'X', { id: 'g' }),
      tx('card', 3_000, '2026-08-01', 'ACME', { id: 'h' }), tx('card', -3_000, '2026-08-09', 'ACME REFUND', { id: 'k' }),
    ]
    const norm = (r: ReturnType<typeof run>) => JSON.stringify([r.pairs, r.ambiguous.map(a => ({ ...a, outflowIds: [...a.outflowIds].sort(), inflowIds: [...a.inflowIds].sort() })), r.refunds])
    const expected = norm(run(base))
    let seed = 7
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    for (let k = 0; k < 20; k++) {
      const shuffled = [...base].sort(() => rnd() - 0.5)
      expect(norm(run(shuffled))).toBe(expected)
    }
  })

  it('scales: 6,000 transactions across five accounts reconcile quickly', () => {
    const txs: EvidenceTx[] = []
    for (let k = 0; k < 1_000; k++) {
      const day = `2026-0${1 + (k % 9)}-${String(1 + (k % 27)).padStart(2, '0')}`
      txs.push(tx('chk', 10_000 + k * 13, day, 'TRANSFER'), tx('sav', -(10_000 + k * 13), day, 'TRANSFER'))
      txs.push(tx('card', 500 + k, day, 'MERCHANT ' + (k % 50)), tx('chk2', 300 + k * 3, day, 'SHOP'), tx('chk', 2_000_000 + k, day, 'CARD PMT'), tx('card', -(2_000_000 + k), day, 'PAYMENT'))
    }
    const t = performance.now()
    const r = run(txs)
    const ms = performance.now() - t
    expect(r.pairs.length).toBe(2_000); expect(r.ambiguous).toHaveLength(0)
    expect(ms).toBeLessThan(3_000)
  })
})
