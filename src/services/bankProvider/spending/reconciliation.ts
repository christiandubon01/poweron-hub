/**
 * src/services/bankProvider/spending/reconciliation.ts
 *
 * PURE (PLAID-2F). Conservative reconciliation of money that moves BETWEEN the owner's own connected accounts, so the same economic event is
 * never counted twice:
 *
 *   internal transfer   money leaves one bank account and arrives in another bank account (checking -> savings, checking -> checking).
 *                       Neither leg is income or an expense.
 *   card payment        money leaves a bank account and arrives as a payment on an owned credit card. The PURCHASES on the card were the expenses;
 *                       paying the card is a liability settlement, never a second expense, and never income on the card side.
 *   refund / reversal   money returns to the account that paid for a purchase. It reverses that purchase; it is never income.
 *
 * DERIVED, NOT PROVIDER FACT: nothing here is stored. The result is recomputed from evidence plus the owner's recorded decisions, so a decision
 * (confirm / reject / undo) is the only thing that persists, and undoing one simply makes the engine suggest again.
 *
 * CONSERVATIVE RULES (each tested):
 *   - A pair needs: different accounts, equal amounts, opposite provider signs, the same pending state (a pending leg waits for its posted
 *     replacement), and dates within the window (3 days between bank accounts, 5 for a card payment).
 *   - A pair is made only when it is UNAMBIGUOUS: the outflow has exactly one candidate and the inflow exactly one candidate. Otherwise the
 *     whole group goes to owner review with every candidate listed. (One exception: several identical movements between the same two accounts
 *     are paired in date order, at most 'possible', since every pairing is economically identical.)
 *   - 'high' confidence needs a textual or provider-category signal on a leg ("transfer", "credit card payment", PFC TRANSFER_*). Equal amounts
 *     alone are only 'possible': coincidences happen (a $50 purchase and an unrelated $50 vendor refund).
 *   - Owner decisions win: a confirmed pair is final, a rejected pair is never suggested again, a transaction in a confirmed pair is never
 *     offered to anything else.
 */
import { merchantKey, searchText } from './merchant'
import type { EvidenceTx } from './types'
import { classifyAccount, type AccountClass } from '../balanceModel'

export interface ReconAccount { ref: string; label: string; accountClass: AccountClass | null }
export type PairKind = 'internal_transfer' | 'card_payment'
export type PairConfidence = 'high' | 'possible'
export interface ReconPair { kind: PairKind; outflowId: string; inflowId: string; confidence: PairConfidence; daysApart: number; reasons: string[]; state: 'suggested' | 'confirmed' }
export interface ReconAmbiguity { kind: 'ambiguous_match'; outflowIds: string[]; inflowIds: string[]; reasons: string[] }
export interface ReconRefund { refundId: string; originalId: string | null; candidateIds: string[]; confidence: 'high' | 'possible' | 'ambiguous'; reasons: string[] }
export interface ReconResult { pairs: ReconPair[]; ambiguous: ReconAmbiguity[]; refunds: ReconRefund[] }
export interface ReconInput {
  txs: EvidenceTx[]
  accounts: ReconAccount[]
  /** Owner-confirmed pairs [outflowId, inflowId] (from confirmed 'transfer' decisions with a counterpart). */
  confirmedPairs?: Array<[string, string]>
  /** Owner-rejected pairs (either order). */
  rejectedPairs?: Array<[string, string]>
}

export const BANK_WINDOW_DAYS = 3
export const CARD_WINDOW_DAYS = 5
export const REFUND_WINDOW_DAYS = 120

const days = (a: string, b: string) => Math.abs(Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000))
const money = (m: number) => `$${(Math.abs(m) / 100).toFixed(2)}`
const TRANSFER_WORDS = /\b(?:TRANSFER|XFER|ONLINE TRANSFER|ACH TRANSFER)\b/
const CARD_WORDS = /\b(?:CREDIT CARD|CARD PAYMENT|CARD PMT|CRCARDPMT|CARD SERVICES|AUTOPAY|AUTO PAY|EPAY|PAYMENT THANK YOU|THANK YOU|ONLINE PMT|PMT)\b/
const REFUND_WORDS = /\b(?:REFUND|RETURN|REVERSAL|CHARGEBACK|CREDIT ADJUSTMENT)\b/
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

const pfc = (t: EvidenceTx) => ({ primary: (t.category?.primary ?? '').toUpperCase(), detailed: (t.category?.detailed ?? '').toUpperCase() })
const transferSignal = (t: EvidenceTx) => {
  const c = pfc(t)
  return TRANSFER_WORDS.test(searchText(t.name, t.merchantName)) || c.primary.startsWith('TRANSFER_') || c.detailed.includes('ACCOUNT_TRANSFER')
}
const cardSignal = (t: EvidenceTx) => {
  const c = pfc(t)
  return CARD_WORDS.test(searchText(t.name, t.merchantName)) || c.detailed.includes('CREDIT_CARD_PAYMENT') || c.detailed.includes('LOAN_PAYMENTS_CREDIT_CARD')
}

export function reconcile(input: ReconInput): ReconResult {
  const acct = new Map(input.accounts.map(a => [a.ref, a]))
  const live = input.txs.filter(t => !t.removed && t.amountMinor !== 0).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  const byId = new Map(live.map(t => [t.id, t]))
  const label = (t: EvidenceTx) => acct.get(t.providerAccountRef)?.label ?? 'another account'
  const klass = (t: EvidenceTx): AccountClass | null => acct.get(t.providerAccountRef)?.accountClass ?? null
  const rejected = new Set((input.rejectedPairs ?? []).map(([a, b]) => pairKey(a, b)))
  const pairs: ReconPair[] = []
  const used = new Set<string>()

  // 1. Owner-confirmed pairs are final and take their legs out of every other consideration.
  for (const [o, i] of input.confirmedPairs ?? []) {
    const to = byId.get(o), ti = byId.get(i)
    if (!to || !ti || used.has(o) || used.has(i)) continue
    used.add(o); used.add(i)
    const card = klass(ti) === 'credit_card'
    pairs.push({ kind: card ? 'card_payment' : 'internal_transfer', outflowId: o, inflowId: i, confidence: 'high', daysApart: days(to.date, ti.date), state: 'confirmed',
      reasons: [`You confirmed this ${card ? 'card payment' : 'transfer'}.`] })
  }

  // 2. Candidate graph over the remaining posted/pending-consistent legs.
  const outs = live.filter(t => t.amountMinor > 0 && !used.has(t.id) && klass(t) !== 'credit_card')
  const ins = live.filter(t => t.amountMinor < 0 && !used.has(t.id))
  const window = (o: EvidenceTx, i: EvidenceTx) => (klass(i) === 'credit_card' ? CARD_WINDOW_DAYS : BANK_WINDOW_DAYS)
  const candidatesOf = (o: EvidenceTx) => ins.filter(i => i.providerAccountRef !== o.providerAccountRef && i.pending === o.pending && -i.amountMinor === o.amountMinor
    && klass(i) !== 'loan' && klass(i) !== 'investment' && days(i.date, o.date) <= window(o, i) && !rejected.has(pairKey(o.id, i.id)))
  const cand = new Map(outs.map(o => [o.id, candidatesOf(o)]))
  const back = new Map<string, EvidenceTx[]>()
  for (const o of outs) for (const i of cand.get(o.id)!) back.set(i.id, [...(back.get(i.id) ?? []), o])

  const ambiguous: ReconAmbiguity[] = []
  const grouped = new Set<string>()
  const emit = (o: EvidenceTx, i: EvidenceTx, forcedPossible = false, extra: string[] = []) => {
    const card = klass(i) === 'credit_card'
    const signal = card ? (cardSignal(o) || cardSignal(i) || transferSignal(o) || transferSignal(i)) : (transferSignal(o) || transferSignal(i))
    const confidence: PairConfidence = signal && !forcedPossible ? 'high' : 'possible'
    pairs.push({ kind: card ? 'card_payment' : 'internal_transfer', outflowId: o.id, inflowId: i.id, confidence, daysApart: days(o.date, i.date), state: 'suggested',
      reasons: [`An equal ${money(o.amountMinor)} movement left ${label(o)} and arrived in ${label(i)} within ${days(o.date, i.date)} day(s).`,
        card ? 'The arrival is a payment on a credit card: the card purchases are the expenses, not this payment.' : 'Money between your own accounts is not income or an expense.',
        signal ? 'The description or bank category supports it.' : 'Only the equal opposite amounts suggest it; please confirm.', ...extra] })
  }

  for (const o of outs) {
    if (grouped.has(o.id) || used.has(o.id)) continue
    const cs = cand.get(o.id)!
    if (cs.length === 0) continue
    // The connected component through shared candidates.
    const compOut = new Map<string, EvidenceTx>([[o.id, o]]), compIn = new Map<string, EvidenceTx>()
    const queue: Array<{ side: 'o' | 'i'; tx: EvidenceTx }> = [{ side: 'o', tx: o }]
    while (queue.length) {
      const { side, tx } = queue.pop()!
      const nexts = side === 'o' ? cand.get(tx.id)! : back.get(tx.id)!
      for (const n of nexts) {
        const m = side === 'o' ? compIn : compOut
        if (!m.has(n.id)) { m.set(n.id, n); queue.push({ side: side === 'o' ? 'i' : 'o', tx: n }) }
      }
    }
    for (const t of compOut.values()) grouped.add(t.id)
    const O = [...compOut.values()], I = [...compIn.values()]
    if (O.length === 1 && I.length === 1) { emit(O[0], I[0]); continue }
    // Several identical movements between the SAME two accounts pair in date order: every pairing is economically the same.
    const sameAccounts = new Set(O.map(t => t.providerAccountRef)).size === 1 && new Set(I.map(t => t.providerAccountRef)).size === 1
    if (sameAccounts && O.length === I.length) {
      const os = [...O].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)), is = [...I].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
      os.forEach((t, k) => emit(t, is[k], true, [`${O.length} identical movements between the same two accounts were paired in date order.`]))
      continue
    }
    ambiguous.push({ kind: 'ambiguous_match', outflowIds: O.map(t => t.id), inflowIds: I.map(t => t.id),
      reasons: [`${O.length} outgoing and ${I.length} incoming movements of ${money(o.amountMinor)} could match each other, so none is paired automatically. Pick the right pairs.`] })
  }
  for (const p of pairs) { used.add(p.outflowId); used.add(p.inflowId) }

  // 3. Refunds / reversals: an inflow that returns money to the account that paid, from the same merchant, for an earlier purchase.
  const refunds: ReconRefund[] = []
  const takenOriginals = new Set<string>()
  for (const r of live.filter(t => t.amountMinor < 0 && !used.has(t.id) && klass(t) !== 'loan')) {
    const key = merchantKey(r.name, r.merchantName)
    const hasWord = REFUND_WORDS.test(searchText(r.name, r.merchantName))
    const originals = live.filter(o => o.amountMinor > 0 && !used.has(o.id) && o.providerAccountRef === r.providerAccountRef && o.date <= r.date && days(o.date, r.date) <= REFUND_WINDOW_DAYS
      && merchantKey(o.name, o.merchantName) === key && key !== 'UNKNOWN MERCHANT' && -r.amountMinor <= o.amountMinor)
    if (originals.length === 0) continue
    const exact = originals.filter(o => o.amountMinor === -r.amountMinor)
    const pool = exact.length ? exact : originals
    if (pool.length > 1) { refunds.push({ refundId: r.id, originalId: null, candidateIds: pool.map(o => o.id), confidence: 'ambiguous', reasons: [`${pool.length} earlier purchases at this merchant fit; choose the one this ${money(r.amountMinor)} returns.`] }); continue }
    const o = pool[0]
    if (takenOriginals.has(o.id)) continue
    takenOriginals.add(o.id)
    const full = o.amountMinor === -r.amountMinor
    refunds.push({ refundId: r.id, originalId: o.id, candidateIds: [o.id], confidence: full && hasWord ? 'high' : 'possible',
      reasons: [full ? `It returns exactly the ${money(o.amountMinor)} purchase of ${o.date} at the same merchant.` : `It returns part (${money(r.amountMinor)}) of the ${money(o.amountMinor)} purchase of ${o.date} at the same merchant.`,
        hasWord ? 'The description says refund or return.' : 'Only the merchant and amount suggest a refund; please confirm.'] })
  }
  return { pairs: pairs.sort((a, b) => a.outflowId.localeCompare(b.outflowId)), ambiguous, refunds }
}

/** Maps account type text from provider evidence into the engine's account class (null = unknown, treated like a bank account for transfers). */
export function reconAccountOf(ref: string, label: string, type: string | null | undefined, subtype: string | null | undefined): ReconAccount {
  return { ref, label, accountClass: type || subtype ? classifyAccount(type, subtype).accountClass : null }
}
