/**
 * src/services/bankProvider/spending/reconciliation.ts
 *
 * PURE (PLAID-2F, hardened in PLAID-3A). Conservative reconciliation of money that moves BETWEEN the owner's own connected accounts, so the same
 * economic event is never counted twice:
 *
 *   internal transfer   money leaves one bank account and arrives in another bank account (checking -> savings, checking -> checking).
 *                       Neither leg is income or an expense.
 *   card payment        money leaves a bank account and arrives as a payment on an owned credit card. The PURCHASES on the card were the expenses;
 *                       paying the card is a liability settlement, never a second expense, and never income on the card side.
 *   refund / reversal   money returns to the account that paid for a purchase. It reverses that purchase; it is never income.
 *
 * ONLY RUNS WHEN THE RECONCILIATION SWITCH IS ON (CASH_OS_RECONCILIATION_ENABLED). The classifier calls it only for `reconciliation: true`; with the
 * switch off the legacy pairing runs instead and nothing in this file executes.
 *
 * DERIVED, NOT PROVIDER FACT: nothing here is stored. The result is recomputed from evidence plus the owner's recorded decisions, so a decision
 * (confirm / reject / reverse) is the only thing that persists, and reversing one simply makes the engine suggest again.
 *
 * CONSERVATIVE RULES (each tested):
 *   - A pair needs: different accounts, equal amounts, opposite provider signs, the same pending state (a pending leg waits for its posted
 *     replacement), and dates within the window (3 days between bank accounts, 5 for a card payment).
 *   - A pair is made only when it is UNAMBIGUOUS: the outflow has exactly one candidate and the inflow exactly one candidate. Otherwise the
 *     whole group goes to owner review with every candidate listed. (One exception: several identical movements between the same two accounts
 *     are paired in date order, at most 'possible', since every pairing is economically identical.)
 *   - 'high' confidence needs a textual or provider-category signal on a leg ("transfer", "credit card payment", PFC TRANSFER_*) AND known account
 *     types AND accounts of the same ownership. Equal amounts alone are only 'possible': coincidences happen (a $50 purchase and an unrelated
 *     $50 vendor refund). A pair between a BUSINESS and a PERSONAL account is never better than 'possible': its business meaning (owner draw or
 *     contribution) is the owner's decision.
 *   - Owner decisions win: a confirmed pair is final, a rejected pair is never suggested again, a leg the owner already decided as something else
 *     (a bill, a project, payroll, personal, a purchase category, ignored) is never offered to anything, and a transaction in a confirmed pair is
 *     never offered to anything else.
 */
import { merchantKey, searchText } from './merchant'
import type { EvidenceTx } from './types'
import { classifyAccount, type AccountClass } from '../balanceModel'

export interface ReconAccount {
  ref: string
  label: string
  accountClass: AccountClass | null
  /** Ownership of the MAPPED Cash OS account; null = not mapped / unknown. */
  ownership?: 'business' | 'personal' | null
}
export type { PairKind, PairCap } from '../../../finance/bankMatchReview'
import type { PairKind, PairCap } from '../../../finance/bankMatchReview'
export type PairConfidence = 'high' | 'possible'
export interface ReconPair {
  kind: PairKind
  outflowId: string
  inflowId: string
  confidence: PairConfidence
  daysApart: number
  reasons: string[]
  state: 'suggested' | 'confirmed'
  /** Canonical string of the evidence this pair rests on (see pairFingerprint). A decision is bound to it. */
  fingerprint: string
  /** The two accounts are mapped to Cash OS accounts of DIFFERENT ownership (business <-> personal). */
  crossScope: boolean
  /** Both legs are still pending: shown for information; nothing can be confirmed until both post. */
  provisional: boolean
  caps: PairCap[]
}
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
  /** Legs the owner already decided as something else (transaction id -> short reason). Never offered to any automatic pairing or refund match. */
  excluded?: Map<string, string>
}

export const BANK_WINDOW_DAYS = 3
export const CARD_WINDOW_DAYS = 5
export const REFUND_WINDOW_DAYS = 120

const days = (a: string, b: string) => Math.abs(Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000))
const money = (m: number) => `$${(Math.abs(m) / 100).toFixed(2)}`
const TRANSFER_WORDS = /\b(?:TRANSFER|XFER|ONLINE TRANSFER|ACH TRANSFER)\b/
const CARD_WORDS = /\b(?:CREDIT CARD|CARD PAYMENT|CARD PMT|CRCARDPMT|CARD SERVICES|AUTOPAY|AUTO PAY|EPAY|PAYMENT THANK YOU|THANK YOU|ONLINE PMT|PMT)\b/
const REFUND_WORDS = /\b(?:REFUND|RETURN|REVERSAL|CHARGEBACK|CREDIT ADJUSTMENT)\b/
export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

/**
 * The evidence a pair decision rests on: both legs' ids, accounts, signed amounts, dates and pending flags. It deliberately excludes descriptions
 * (banks rewrite them) and includes everything that changes the financial meaning. The database function that records a decision rebuilds this exact
 * string from the locked evidence rows and refuses to record a decision made on different evidence.
 */
export function pairFingerprint(o: Pick<EvidenceTx, 'id' | 'providerAccountRef' | 'amountMinor' | 'date' | 'pending'>, i: Pick<EvidenceTx, 'id' | 'providerAccountRef' | 'amountMinor' | 'date' | 'pending'>): string {
  const leg = (t: typeof o) => `${t.id}:${t.providerAccountRef}:${t.amountMinor}:${t.date}:${t.pending ? 1 : 0}`
  return `v1|o:${leg(o)}|i:${leg(i)}`
}

const pfc = (t: EvidenceTx) => ({ primary: (t.category?.primary ?? '').toUpperCase(), detailed: (t.category?.detailed ?? '').toUpperCase() })
const transferSignal = (t: EvidenceTx) => {
  const c = pfc(t)
  return TRANSFER_WORDS.test(searchText(t.name, t.merchantName)) || c.primary.startsWith('TRANSFER_') || c.detailed.includes('ACCOUNT_TRANSFER')
}
const cardSignal = (t: EvidenceTx) => {
  const c = pfc(t)
  return CARD_WORDS.test(searchText(t.name, t.merchantName)) || c.detailed.includes('CREDIT_CARD_PAYMENT') || c.detailed.includes('LOAN_PAYMENTS_CREDIT_CARD')
}

/** Account lookups shared by the engine and by explicit owner review (evaluatePair). */
const LOOKUPS = new WeakMap<ReconAccount[], ReturnType<typeof makeLookups>>()
function makeLookups(accounts: ReconAccount[]) {
  const acct = new Map(accounts.map(a => [a.ref, a]))
  return {
    label: (t: EvidenceTx) => acct.get(t.providerAccountRef)?.label ?? 'another account',
    klass: (t: EvidenceTx): AccountClass | null => acct.get(t.providerAccountRef)?.accountClass ?? null,
    owner: (t: EvidenceTx) => acct.get(t.providerAccountRef)?.ownership ?? null,
  }
}
/** Memoized per accounts array: the engine asks for these millions of times on a large history. */
function accountLookups(accounts: ReconAccount[]) {
  let l = LOOKUPS.get(accounts)
  if (!l) { l = makeLookups(accounts); LOOKUPS.set(accounts, l) }
  return l
}

/**
 * Structural validity of ONE candidate pair (no graph logic): opposite signs and equal amounts, different accounts, the same pending state, a receiver that
 * is not a loan or investment, a sender that is not a credit card, and dates inside the window. Used by the engine and by the review service to decide whether
 * the owner may be asked about a pair at all. It says nothing about ambiguity or about decisions the owner already made.
 */
export function pairIsValid(o: EvidenceTx, i: EvidenceTx, accounts: ReconAccount[]): boolean {
  const { klass } = accountLookups(accounts)
  if (o.removed || i.removed || o.amountMinor <= 0 || i.amountMinor >= 0 || -i.amountMinor !== o.amountMinor) return false
  if (o.providerAccountRef === i.providerAccountRef || o.pending !== i.pending) return false
  if (klass(o) === 'credit_card' || klass(i) === 'loan' || klass(i) === 'investment') return false
  return days(i.date, o.date) <= (klass(i) === 'credit_card' ? CARD_WINDOW_DAYS : BANK_WINDOW_DAYS)
}

/** One suggested pair with its confidence, caps, reasons and evidence fingerprint. `identicalGroup` marks several identical movements paired in date order. */
export function buildPair(o: EvidenceTx, i: EvidenceTx, accounts: ReconAccount[], identicalGroup = false, extra: string[] = []): ReconPair {
  const { label, klass, owner } = accountLookups(accounts)
  const card = klass(i) === 'credit_card'
  const signal = card ? (cardSignal(o) || cardSignal(i) || transferSignal(o) || transferSignal(i)) : (transferSignal(o) || transferSignal(i))
  const classUnknown = klass(o) === null || klass(i) === null
  const crossScope = !!owner(o) && !!owner(i) && owner(o) !== owner(i)
  const caps: PairCap[] = []
  if (!signal) caps.push('no_signal')
  if (classUnknown) caps.push('class_unknown')
  if (crossScope) caps.push('cross_scope')
  if (identicalGroup) caps.push('identical_group')
  const gap = days(o.date, i.date)
  return { kind: card ? 'card_payment' : 'internal_transfer', outflowId: o.id, inflowId: i.id, confidence: caps.length ? 'possible' : 'high', daysApart: gap, state: 'suggested',
    fingerprint: pairFingerprint(o, i), crossScope, provisional: o.pending && i.pending, caps,
    reasons: [`An equal ${money(o.amountMinor)} movement left ${label(o)} and arrived in ${label(i)} within ${gap} day(s).`,
      card ? 'The arrival is a payment on a credit card: the card purchases are the expenses, not this payment.' : 'Money between your own accounts is not income or an expense.',
      signal ? 'The description or bank category supports it.' : 'Only the equal opposite amounts suggest it; please confirm.',
      ...(classUnknown ? ['The type of one account is not known, so this cannot be called a card payment or a transfer with certainty.'] : []),
      ...(crossScope ? [`This moves money between a ${owner(o)} account and a ${owner(i)} account. That may be an owner draw or a contribution rather than a plain transfer: you decide.`] : []),
      ...extra] }
}

export function reconcile(input: ReconInput): ReconResult {
  const excluded = input.excluded ?? new Map<string, string>()
  const live = input.txs.filter(t => !t.removed && t.amountMinor !== 0).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  const byId = new Map(live.map(t => [t.id, t]))
  const { klass, owner } = accountLookups(input.accounts)
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
      fingerprint: pairFingerprint(to, ti), crossScope: !!owner(to) && !!owner(ti) && owner(to) !== owner(ti), provisional: to.pending || ti.pending, caps: [],
      reasons: [`You confirmed this ${card ? 'card payment' : 'transfer'}.`] })
  }

  // 2. Candidate graph over the remaining legs. A leg the owner already decided as something else is not a candidate.
  const eligible = (t: EvidenceTx) => !used.has(t.id) && !excluded.has(t.id)
  const outs = live.filter(t => t.amountMinor > 0 && eligible(t) && klass(t) !== 'credit_card')
  const ins = live.filter(t => t.amountMinor < 0 && eligible(t))
  // PLAID-6: pairIsValid demands equal amounts (opposite signs), so only inflows of the SAME amount can ever be candidates. Indexing them by amount turns the candidate
  // search from "every outflow against every inflow" (quadratic: 11 s at 20,000 rows) into "every outflow against the few inflows of its own amount". The validity rule
  // itself is unchanged and still applied; the order of candidates (date, id) is preserved, so every result is identical.
  const insByAmount = new Map<number, EvidenceTx[]>()
  for (const i of ins) { const l = insByAmount.get(-i.amountMinor); if (l) l.push(i); else insByAmount.set(-i.amountMinor, [i]) }
  const candidatesOf = (o: EvidenceTx) => (insByAmount.get(o.amountMinor) ?? []).filter(i => pairIsValid(o, i, input.accounts) && !rejected.has(pairKey(o.id, i.id)))
  const cand = new Map(outs.map(o => [o.id, candidatesOf(o)]))
  const back = new Map<string, EvidenceTx[]>()
  for (const o of outs) for (const i of cand.get(o.id)!) { const l = back.get(i.id); if (l) l.push(o); else back.set(i.id, [o]) }

  const ambiguous: ReconAmbiguity[] = []
  const grouped = new Set<string>()
  const emit = (o: EvidenceTx, i: EvidenceTx, identicalGroup = false, extra: string[] = []) => { pairs.push(buildPair(o, i, input.accounts, identicalGroup, extra)) }

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
    ambiguous.push({ kind: 'ambiguous_match', outflowIds: O.map(t => t.id).sort(), inflowIds: I.map(t => t.id).sort(),
      reasons: [`${O.length} outgoing and ${I.length} incoming movements of ${money(o.amountMinor)} could match each other, so none is paired automatically. Pick the right pairs.`] })
  }
  for (const p of pairs) { used.add(p.outflowId); used.add(p.inflowId) }

  // 3. Refunds / reversals: an inflow that returns money to the account that paid, from the same merchant, for an earlier purchase.
  const refunds: ReconRefund[] = []
  const takenOriginals = new Set<string>()
  // PLAID-6: the merchant key of a row is computed ONCE, and the purchases a refund could return are indexed by account and merchant (in date order), so each
  // refund looks at its own merchant's purchases instead of rescanning the whole history (it was quadratic, with a string normalisation inside the inner loop).
  const keys = new Map<string, string>()
  const keyOf = (t: EvidenceTx) => { let k = keys.get(t.id); if (k === undefined) { k = merchantKey(t.name, t.merchantName); keys.set(t.id, k) } return k }
  const purchases = new Map<string, Map<string, EvidenceTx[]>>()
  for (const o of live) {
    if (o.amountMinor <= 0 || used.has(o.id)) continue
    const key = keyOf(o)
    if (key === 'UNKNOWN MERCHANT') continue
    const byMerchant = purchases.get(o.providerAccountRef) ?? purchases.set(o.providerAccountRef, new Map()).get(o.providerAccountRef)!
    const l = byMerchant.get(key); if (l) l.push(o); else byMerchant.set(key, [o])
  }
  for (const r of live.filter(t => t.amountMinor < 0 && !used.has(t.id) && !excluded.has(t.id) && klass(t) !== 'loan')) {
    const key = keyOf(r)
    if (key === 'UNKNOWN MERCHANT') continue
    const originals = (purchases.get(r.providerAccountRef)?.get(key) ?? []).filter(o => o.date <= r.date && days(o.date, r.date) <= REFUND_WINDOW_DAYS && -r.amountMinor <= o.amountMinor)
    if (originals.length === 0) continue
    const hasWord = REFUND_WORDS.test(searchText(r.name, r.merchantName))
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
  return { pairs: pairs.sort((a, b) => a.outflowId.localeCompare(b.outflowId) || a.inflowId.localeCompare(b.inflowId)), ambiguous: ambiguous.sort((a, b) => a.outflowIds[0].localeCompare(b.outflowIds[0])), refunds }
}

/** Maps account type text from provider evidence into the engine's account class (null = unknown). */
export function reconAccountOf(ref: string, label: string, type: string | null | undefined, subtype: string | null | undefined, ownership: 'business' | 'personal' | null = null): ReconAccount {
  return { ref, label, accountClass: type || subtype ? classifyAccount(type, subtype).accountClass : null, ownership }
}
