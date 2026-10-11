/**
 * src/services/bankProvider/spending/matchReview.ts
 *
 * PURE (PLAID-3B). The read model behind the Cash OS "Matches" review: which pairs of transactions to ask the owner about, in which state, why, and what the
 * owner may do next. It decides nothing and stores nothing. Every state below is DERIVED from two things the database really holds:
 *
 *   - the evidence (provider transactions) and the reconciliation engine's proposals, and
 *   - the owner's decision rows (interpretations of kind 'transfer': confirmed / rejected / undone, with the evidence fingerprint recorded at decision time).
 *
 *   suggested         the engine proposes it and the owner has not decided it (posted legs).
 *   waiting           both legs are still pending: shown, nothing can be decided until they post.
 *   ambiguous         several movements could match each other: listed as a group; the owner picks the right pair.
 *   confirmed         both legs carry the owner's confirmation of THIS pair and the evidence is what the owner saw.
 *   rejected          the owner said "not this pair" and the evidence is what the owner saw. It is not suggested again.
 *   reversed          the owner undid a confirmation; the pair is undecided again (still proposed).
 *   evidence_changed  a decision exists, but the evidence it was made on has changed (amount, date, account, pending flag, a leg that disappeared, or one
 *                     leg that was later given a different meaning). A confirmed pair keeps its effect on reports (owner precedence) and is flagged;
 *                     a rejected pair is offered again, for review only.
 *   needsReview       not a state: true for anything the owner should look at rather than approve in passing (possible / ambiguous / evidence changed / business<->personal).
 */
import { pairFingerprint, pairIsValid, buildPair, type ReconAccount, type ReconPair, type ReconResult, type PairCap, type PairKind } from './reconciliation'
import type { EvidenceTx } from './types'
import type { MatchAccountInfo, MatchHistoryEvent, MatchItem, MatchLeg, MatchState, AmbiguousGroup, AmbiguousCandidate, RefundMatch, MatchCounts, MatchAction } from '../../../finance/bankMatchReview'

export type { MatchAccountInfo, MatchHistoryEvent, MatchItem, MatchLeg, MatchState, AmbiguousGroup, AmbiguousCandidate, RefundMatch, MatchCounts, MatchAction }

/** One interpretation row of kind 'transfer' (any status), as read for review. Never carries a user id. */
export interface PairDecisionRow {
  id: string
  txId: string
  counterpartTxId: string | null
  status: 'suggested' | 'confirmed' | 'rejected' | 'undone'
  source: string
  fingerprint: string | null
  pairId: string | null
  pairKind: string | null
  decidedAt: string | null
  undoneAt: string | null
  undoReason: string | null
  createdAt: string
}

export interface MatchReview {
  items: MatchItem[]
  groups: AmbiguousGroup[]
  refunds: RefundMatch[]
  counts: MatchCounts
}

export interface MatchReviewInput {
  txs: EvidenceTx[]
  accounts: MatchAccountInfo[]
  recon: ReconResult
  pairDecisions: PairDecisionRow[]
  /** confirmed / rejected category decisions on refund bucket, by transaction id (refund items are decided through the category dimension). */
  refundDecisions: Array<{ txId: string; status: 'confirmed' | 'rejected' }>
  window: { from: string; to: string }
}

const key = (o: string, i: string) => `${o}:${i}`
const unordered = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

/** Parses a fingerprint produced by pairFingerprint back into its legs (null if it is not one of ours). */
export function parseFingerprint(fp: string | null): { o: FpLeg; i: FpLeg } | null {
  const m = /^v1\|o:([^|]+)\|i:([^|]+)$/.exec(fp ?? '')
  if (!m) return null
  const leg = (s: string): FpLeg | null => { const p = s.split(':'); return p.length === 5 ? { id: p[0], account: p[1], amountMinor: Number(p[2]), date: p[3], pending: p[4] === '1' } : null }
  const o = leg(m[1]), i = leg(m[2])
  return o && i ? { o, i } : null
}
interface FpLeg { id: string; account: string; amountMinor: number; date: string; pending: boolean }

/** Which facts differ between the evidence a decision was made on and the evidence now. */
export function describeEvidenceChange(stored: string | null, current: { o: EvidenceTx | undefined; i: EvidenceTx | undefined }): string[] {
  const parsed = parseFingerprint(stored)
  if (!parsed) return []
  const out: string[] = []
  const cmp = (side: 'outgoing' | 'incoming', was: FpLeg, now: EvidenceTx | undefined) => {
    if (!now) { out.push(`The ${side} transaction is no longer in your bank data.`); return }
    if (now.amountMinor !== was.amountMinor) out.push(`The ${side} amount changed.`)
    if (now.date !== was.date) out.push(`The ${side} date changed.`)
    if (now.providerAccountRef !== was.account) out.push(`The ${side} account changed.`)
    if (now.pending !== was.pending) out.push(`The ${side} transaction ${now.pending ? 'is pending again' : 'posted'}.`)
  }
  cmp('outgoing', parsed.o, current.o); cmp('incoming', parsed.i, current.i)
  return out
}

const UNDO_EVENT: Record<string, MatchHistoryEvent['event']> = { pair_reversed: 'reversed', pair_reconfirmed: 'reconfirmed', completed_by_pair: 'completed', superseded_by_pair_confirmation: 'superseded' }
/** The owner-visible trail of a pair, oldest first: a decision, and (for an undone row) when and why it ended. The two rows of one pair report each event once. */
export function historyOf(rows: PairDecisionRow[]): MatchHistoryEvent[] {
  const seen = new Set<string>()
  const out: MatchHistoryEvent[] = []
  const add = (at: string | null, event: MatchHistoryEvent['event'], pairId: string | null) => {
    const k = `${event}|${pairId ?? at}`
    if (seen.has(k)) return
    seen.add(k); out.push({ at, event })
  }
  for (const r of rows) {
    if (r.status === 'confirmed') add(r.decidedAt, 'confirmed', r.pairId)
    else if (r.status === 'rejected') add(r.decidedAt, 'rejected', r.pairId)
    else if (r.status === 'undone') {
      if (r.decidedAt) add(r.decidedAt, 'confirmed', r.pairId)
      const e = UNDO_EVENT[r.undoReason ?? '']
      if (e && e !== 'superseded' && e !== 'completed') add(r.undoneAt, e, r.pairId)
    }
  }
  return out.sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''))
}

export function buildMatchReview(input: MatchReviewInput): MatchReview {
  const known = new Map(input.txs.map(t => [t.id, t]))                       // every transaction in the loaded history, removed ones included
  const txById = new Map(input.txs.filter(t => !t.removed).map(t => [t.id, t])) // the live ones
  const acct = new Map(input.accounts.map(a => [a.ref, a]))
  const reconAccounts: ReconAccount[] = input.accounts.map(a => ({ ref: a.ref, label: a.label, accountClass: a.accountClass, ownership: a.ownership }))
  const leg = (id: string): MatchLeg => {
    const t = txById.get(id)
    if (!t) { const gone = known.get(id); return { id, date: gone?.date ?? null, name: gone?.name ?? null, merchant: gone?.merchantName ?? null, amountMinor: gone?.amountMinor ?? null, pending: false, missing: true, account: gone ? acct.get(gone.providerAccountRef) ?? null : null } }
    return { id, date: t.date, name: t.name, merchant: t.merchantName, amountMinor: t.amountMinor, pending: t.pending, missing: false, account: acct.get(t.providerAccountRef) ?? null }
  }
  const inWindow = (...ids: string[]) => ids.some(id => { const t = txById.get(id); return !!t && t.date >= input.window.from && t.date <= input.window.to })

  // Decisions grouped by the unordered pair they are about.
  const byPair = new Map<string, PairDecisionRow[]>()
  for (const r of input.pairDecisions) {
    if (!r.counterpartTxId) continue
    const k = unordered(r.txId, r.counterpartTxId)
    byPair.set(k, [...(byPair.get(k) ?? []), r])
  }
  const proposed = new Map(input.recon.pairs.map(p => [unordered(p.outflowId, p.inflowId), p]))
  const items: MatchItem[] = []

  const orient = (a: string, b: string): [string, string] | null => {
    const ta = txById.get(a), tb = txById.get(b)
    if (ta && tb) return ta.amountMinor > 0 && tb.amountMinor < 0 ? [a, b] : ta.amountMinor < 0 && tb.amountMinor > 0 ? [b, a] : null
    return null
  }

  const keys = new Set([...proposed.keys(), ...byPair.keys()])
  for (const k of keys) {
    const rows = (byPair.get(k) ?? []).sort((x, y) => x.createdAt.localeCompare(y.createdAt) || x.id.localeCompare(y.id))
    const [idA, idB] = k.split('|')
    const prop = proposed.get(k)
    // orientation: from the proposal, else from the decision rows (the outflow leg is the one with the positive amount), else unknown (a leg is missing)
    let oId: string, iId: string
    if (prop) { oId = prop.outflowId; iId = prop.inflowId }
    else {
      const o = orient(idA, idB)
      if (o) [oId, iId] = o
      else { const roleOut = rows.find(r => r.status !== 'undone' && r.fingerprint && parseFingerprint(r.fingerprint)); const fp = parseFingerprint(roleOut?.fingerprint ?? rows.find(r => r.fingerprint)?.fingerprint ?? null); if (fp) { oId = fp.o.id; iId = fp.i.id } else { oId = idA; iId = idB } }
    }
    if (!known.has(oId) || !known.has(iId)) continue // outside the loaded history: nothing can be said about it here
    const o = txById.get(oId), i = txById.get(iId)
    const confirmedRows = rows.filter(r => r.status === 'confirmed')
    const rejectedRows = rows.filter(r => r.status === 'rejected')
    const history = historyOf(rows)
    const current = o && i ? pairFingerprint(o, i) : null
    const valid = !!o && !!i && pairIsValid(o, i, reconAccounts)
    const built: ReconPair | null = prop ?? (valid ? buildPair(o!, i!, reconAccounts) : null)
    const base = { key: key(oId, iId), outflow: leg(oId), inflow: leg(iId), amountMinor: Math.abs(o?.amountMinor ?? i?.amountMinor ?? 0), history: history.slice(-6) }
    const common = { kind: (built?.kind ?? 'internal_transfer') as PairKind, daysApart: built?.daysApart ?? null, reasons: built?.reasons ?? [], caps: built?.caps ?? [], crossScope: built?.crossScope ?? false }

    if (confirmedRows.length || prop?.state === 'confirmed') {
      const stored = confirmedRows.find(r => r.fingerprint)?.fingerprint ?? null
      const legacy = !stored
      const hasBoth = confirmedRows.some(r => r.txId === oId && r.counterpartTxId === iId) && confirmedRows.some(r => r.txId === iId && r.counterpartTxId === oId)
      const changes = describeEvidenceChange(stored, { o, i })
      // A pair recorded by the review has a row on each leg. One missing now means a leg was later given another meaning. A LEGACY decision (made on one
      // leg before the review existed) legitimately has one row: it stays confirmed and can be re-confirmed to record both sides.
      if (!legacy && !hasBoth) changes.push('One side of this match was later given a different meaning.')
      if (legacy && (!o || !i)) changes.push('One of the two transactions is no longer in your bank data.')
      const changed = changes.length > 0
      if (!inWindow(oId, iId) && !changed) continue
      const canRe = valid && (changed || (legacy && !hasBoth))
      items.push({ ...base, ...common, state: changed ? 'evidence_changed' : 'confirmed', confidence: 'high', needsReview: changed, fingerprint: current, changes,
        decision: { at: confirmedRows.length ? confirmedRows[confirmedRows.length - 1].decidedAt : null, legacy },
        reasons: [`You confirmed this ${common.kind === 'card_payment' ? 'card payment' : 'transfer'}.${legacy && !changed ? ' It was confirmed on one side only; confirm it again to record both sides.' : ''}`],
        actions: ['reverse', ...(canRe ? ['reconfirm' as const] : [])] })
      continue
    }
    if (rejectedRows.length) {
      if (!o || !i || !inWindow(oId, iId)) continue
      const latest = rejectedRows[rejectedRows.length - 1]
      const sameEvidence = !latest.fingerprint || latest.fingerprint === current
      items.push({ ...base, ...common, state: sameEvidence ? 'rejected' : 'evidence_changed', confidence: built?.confidence ?? null, needsReview: !sameEvidence, fingerprint: current,
        decision: { at: latest.decidedAt, legacy: !latest.fingerprint }, changes: sameEvidence ? [] : describeEvidenceChange(latest.fingerprint, { o, i }),
        actions: valid ? (sameEvidence ? ['confirm'] : ['confirm', 'reject']) : [], reasons: sameEvidence ? ['You said this is not a match.'] : ['You rejected this earlier, but the evidence has changed since. Please look again.', ...common.reasons] })
      continue
    }
    if (!prop || !o || !i || !inWindow(oId, iId)) continue
    const reversedLast = history.length > 0 && history[history.length - 1].event === 'reversed'
    const waiting = prop.provisional
    items.push({ ...base, ...common, state: waiting ? 'waiting' : reversedLast ? 'reversed' : 'suggested', confidence: prop.confidence, fingerprint: current,
      needsReview: !waiting && (prop.confidence !== 'high' || prop.crossScope || reversedLast), decision: null, changes: [],
      actions: waiting ? [] : ['confirm', 'reject'], reasons: reversedLast ? ['You reversed this earlier, so it is undecided again.', ...prop.reasons] : prop.reasons })
  }

  const groups: AmbiguousGroup[] = input.recon.ambiguous.filter(g => inWindow(...g.outflowIds, ...g.inflowIds)).map(g => {
    const candidates: AmbiguousCandidate[] = []
    for (const oid of g.outflowIds) for (const iid of g.inflowIds) {
      const o = txById.get(oid), i = txById.get(iid)
      if (!o || !i || !pairIsValid(o, i, reconAccounts)) continue
      const p = buildPair(o, i, reconAccounts)
      candidates.push({ outflowId: oid, inflowId: iid, kind: p.kind, daysApart: p.daysApart, confidence: 'possible', crossScope: p.crossScope, fingerprint: p.fingerprint })
    }
    return { key: `group:${g.outflowIds.join(',')}:${g.inflowIds.join(',')}`, outflows: g.outflowIds.map(leg), inflows: g.inflowIds.map(leg), reasons: g.reasons, candidates }
  })

  const decidedRefund = new Map<string, 'confirmed' | 'rejected'>()
  for (const d of input.refundDecisions) decidedRefund.set(d.txId, d.status === 'confirmed' ? 'confirmed' : decidedRefund.get(d.txId) ?? 'rejected')
  const refunds: RefundMatch[] = []
  for (const r of input.recon.refunds) {
    if (!inWindow(r.refundId)) continue
    refunds.push({ key: `refund:${r.refundId}`, state: decidedRefund.get(r.refundId) === 'rejected' ? 'rejected' : 'suggested', confidence: r.confidence, refund: leg(r.refundId), original: r.originalId ? leg(r.originalId) : null, candidates: r.candidateIds.map(leg), reasons: r.reasons })
  }
  for (const [txId, st] of decidedRefund) {
    if (st !== 'confirmed' || !inWindow(txId) || refunds.some(x => x.refund.id === txId)) continue
    refunds.push({ key: `refund:${txId}`, state: 'confirmed', confidence: null, refund: leg(txId), original: null, candidates: [], reasons: ['You confirmed this as a refund. It is shown as a refund, never as new income.'] })
  }

  const order = (a: MatchItem, b: MatchItem) => Number(b.needsReview) - Number(a.needsReview) || (b.outflow.date ?? '').localeCompare(a.outflow.date ?? '') || b.amountMinor - a.amountMinor || a.key.localeCompare(b.key)
  items.sort(order)
  const counts = { suggested: 0, waiting: 0, ambiguous: groups.length, confirmed: 0, rejected: 0, reversed: 0, evidence_changed: 0, needsReview: 0, refunds: refunds.filter(r => r.state === 'suggested').length } as MatchReview['counts']
  for (const it of items) { counts[it.state] += 1; if (it.needsReview) counts.needsReview += 1 }
  counts.needsReview += groups.length
  return { items, groups, refunds, counts }
}
