// @ts-nocheck -- generated fixtures
/**
 * PLAID-6: the reconciliation engine was made linear (candidate search indexed by amount, refund search indexed by account and merchant). A performance change in
 * financial code is only acceptable if it changes NOTHING it computes. This test runs the frozen pre-optimization engine (preOptimization/reconciliation.ts, the
 * exact text committed before the change) and the current engine on the same inputs and requires deeply equal results: pairs, ambiguity groups, refunds,
 * confidence, caps, reasons, fingerprints and their order.
 */
import { describe, expect, it } from 'vitest'
import { reconcile as frozen } from './preOptimization/reconciliation'
import { reconcile as current } from '../spending/reconciliation'

function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
const TYPES = [['depository', 'checking'], ['depository', 'savings'], ['credit', 'credit card'], ['loan', 'auto'], [undefined, undefined], ['depository', 'cd'], ['investment', 'brokerage']]
const NAMES = ['ONLINE TRANSFER', 'TRANSFER FROM CHK', 'WELLS FARGO CARD AUTOPAY', 'PAYMENT THANK YOU', 'HOME DEPOT #12', 'HOME DEPOT RETURN', 'CHEVRON 123', 'CHEVRON REFUND', 'AMAZON MKTPLACE', 'AMAZON REFUND', 'DEPOSIT CUSTOMER', 'ZELLE FROM JOHN', 'ACME', 'STAPLES', 'STAPLES RETURN', 'MISC DEBIT', 'CHARGEBACK ACME']
const AMOUNTS = [500, 1500, 2500, 5000, 7777, 12000, 12000, 50000, 50000, 100000]

function scenario(seed: number) {
  const r = rng(seed), pick = <T,>(xs: T[]): T => xs[Math.floor(r() * xs.length)], int = (n: number) => Math.floor(r() * n)
  const accounts = Array.from({ length: 2 + int(8) }, (_, k) => { const [t, s] = pick(TYPES); return { ref: `a${k}`, label: `Account ${k}`, accountClass: t || s ? ({ depository: 'bank_cash', credit: 'credit_card', loan: 'loan', investment: 'investment' }[t as string] ?? 'other') : null, ownership: pick(['business', 'business', 'personal', null]) } })
  const txs: any[] = []
  let n = 0
  const add = (account: string, amountMinor: number, day: number, name: string, extra: any = {}) => txs.push({ id: `t${seed}-${++n}`, providerAccountRef: account, date: `2026-09-${String(1 + day).padStart(2, '0')}`, name, merchantName: r() < 0.25 ? name.split(' ')[0] : null, amountMinor, pending: r() < 0.08, removed: r() < 0.04, category: r() < 0.15 ? { primary: pick(['TRANSFER_OUT', 'TRANSFER_IN', 'GENERAL_MERCHANDISE']), detailed: pick(['TRANSFER_OUT_ACCOUNT_TRANSFER', 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT', 'GENERAL_MERCHANDISE_OTHER']), confidence: 'HIGH' } : null, ...extra })
  const total = 4 + int(seed % 5 === 0 ? 400 : 60)                                    // some very dense histories: many equal amounts, many candidates per leg
  for (let k = 0; k < total; k++) {
    const amount = pick(AMOUNTS), day = int(28), a = pick(accounts).ref
    const kind = r()
    if (kind < 0.35) { let b = pick(accounts).ref; if (b === a) b = accounts[(accounts.findIndex(x => x.ref === a) + 1) % accounts.length].ref; add(a, amount, day, pick(NAMES)); add(b, -amount, Math.min(27, day + int(8)), pick(NAMES)) }
    else if (kind < 0.55) { const m = pick(NAMES); add(a, amount, day, m); add(r() < 0.8 ? a : pick(accounts).ref, -(r() < 0.8 ? amount : Math.max(100, amount - 500)), Math.min(27, day + int(27)), r() < 0.7 ? m.split(' ')[0] + ' RETURN' : m) }
    else if (kind < 0.75) add(a, -amount, day, pick(NAMES))
    else add(a, amount, day, pick(NAMES))
  }
  const ids = txs.map(t => t.id)
  const confirmedPairs: Array<[string, string]> = [], rejectedPairs: Array<[string, string]> = [], excluded = new Map<string, string>()
  for (let k = 0; k < ids.length; k += 1) {
    const x = r()
    if (x < 0.02) { const a = pick(ids), b = pick(ids); if (a !== b) confirmedPairs.push([a, b]) }
    else if (x < 0.05) { const a = pick(ids), b = pick(ids); if (a !== b) rejectedPairs.push([a, b]) }
    else if (x < 0.07) excluded.set(pick(ids), 'decided')
  }
  return { txs, accounts, confirmedPairs, rejectedPairs, excluded }
}

describe('PLAID-6 the linear engine is the same engine', () => {
  it('600 generated organizations (sparse and very dense, every account type, owner decisions of every kind): identical pairs, ambiguity groups and refunds, in identical order', () => {
    let pairs = 0, ambiguous = 0, refunds = 0, dense = 0
    for (let seed = 1; seed <= 600; seed++) {
      const input = scenario(seed)
      const a = frozen(input), b = current(input)
      expect(b, `seed ${seed}`).toEqual(a)
      pairs += b.pairs.length; ambiguous += b.ambiguous.length; refunds += b.refunds.length; if (input.txs.length > 200) dense++
    }
    // the scenarios really exercise every path (otherwise equality would prove little)
    expect(pairs).toBeGreaterThan(1500); expect(ambiguous).toBeGreaterThan(150); expect(refunds).toBeGreaterThan(300); expect(dense).toBeGreaterThan(20)
  }, 240_000)

  it('input order does not matter to either engine, and they agree on shuffled input too', () => {
    for (let seed = 1000; seed < 1060; seed++) {
      const input = scenario(seed), shuffled = { ...input, txs: [...input.txs].reverse() }
      expect(current(shuffled)).toEqual(frozen(shuffled)); expect(current(shuffled)).toEqual(current(input))
    }
  }, 120_000)
})
