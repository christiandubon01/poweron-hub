/**
 * src/services/bankProvider/spending/matchReviewService.ts
 *
 * SERVER-ONLY (PLAID-3B). The owner's Matches review: read what the reconciliation engine proposes and what the owner has decided, and record a
 * decision on a PAIR of transactions (confirm / reject / reverse).
 *
 * Trust model:
 *   - The organization and the acting user come from the authenticated profile. A body can never name either.
 *   - The browser names two transaction ids and echoes the evidence fingerprint it showed. EVERYTHING else is recomputed here from the organization's own
 *     evidence: the pair must be structurally valid, the fingerprint must still match, and the kind (transfer / card payment) is derived from the accounts.
 *     The database function re-validates all of it under row locks, so a stale or forged request changes nothing.
 *   - Off unless the reconciliation switch is on (server configuration). Decisions additionally need the reviewed SQL (plaid3b) to be installed; until then
 *     the review is read-only and says so.
 *   - A decision is an INTERPRETATION of bank evidence only: it never creates a ledger entry, changes a balance, or touches provider evidence.
 */
import { BankConnectionError, UUID, assertAuthority, type BankActor } from '../bankConnectionService'
import { classifyAccount } from '../balanceModel'
import { addDays } from './analytics'
import { reconciliationFor } from './classifier'
import { buildMatchReview, type MatchAccountInfo, type MatchItem, type MatchReview, type MatchState } from './matchReview'
import { buildPair, pairFingerprint, pairIsValid, type ReconAccount } from './reconciliation'
import { loadCompleteContext, loadExplorerContext, type SpendingContext, type SpendingDeps } from './spendingService'
import type { AccountContext, EvidenceTx } from './types'

const ISO = /^\d{4}-\d{2}-\d{2}$/
export const MATCH_PAGE = 50
export type MatchTab = 'review' | 'confirmed' | 'rejected' | 'all'
const TAB_STATES: Record<MatchTab, MatchState[] | null> = {
  review: ['suggested', 'reversed', 'evidence_changed', 'waiting'],
  confirmed: ['confirmed', 'evidence_changed'],
  rejected: ['rejected'],
  all: null,
}
const bad = (m: string) => new BankConnectionError('invalid_request', 400, m)
const infoOf = (a: AccountContext): MatchAccountInfo => {
  const institution = a.institution ?? (a.label.includes(' · ') ? a.label.split(' · ')[0] : null)
  return { ref: a.providerAccountRef, label: a.financialAccountName ?? a.label, mask: a.mask, ownership: a.ownership, accountClass: a.providerType || a.providerSubtype ? classifyAccount(a.providerType, a.providerSubtype).accountClass : null, institution }
}

export interface MatchReviewResponse {
  enabled: boolean
  /** Decisions can be recorded (the reviewed SQL is installed). When false the review is read-only. */
  decisionsAvailable: boolean
  asOf?: string
  window?: { from: string; to: string }
  environment?: string
  coverage?: { complete: boolean; reason: string | null }
  tab?: MatchTab
  counts?: MatchReview['counts']
  total?: number
  items?: MatchItem[]
  groups?: MatchReview['groups']
  refunds?: MatchReview['refunds']
  contract?: string
}

/** The evidence for the review: the complete report source when installed, else the capped Explorer window, with the truth about coverage. */
async function loadForReview(deps: SpendingDeps, organizationId: string, asOf: string, from: string): Promise<{ ctx: SpendingContext; coverage: { complete: boolean; reason: string | null } }> {
  const complete = await loadCompleteContext(deps, organizationId, addDays(from, -125))
  if (complete && complete.reportCoverage?.complete === true) return { ctx: complete, coverage: { complete: true, reason: null } }
  const ctx = await loadExplorerContext(deps, organizationId, addDays(asOf, -200))
  return { ctx, coverage: { complete: false, reason: complete?.reportCoverage?.reason ?? ctx.legacyCoverage?.reason ?? 'Only recent history was loaded, so matches near its edges may be missing.' } }
}

export async function getMatchReview(deps: SpendingDeps, actor: BankActor, raw: Record<string, unknown>): Promise<MatchReviewResponse> {
  assertAuthority(actor)
  if (deps.reconciliationEnabled !== true) return { enabled: false, decisionsAvailable: false }
  const asOf = new Date((deps.now ?? Date.now)()).toISOString().slice(0, 10)
  const valid = (v: unknown) => typeof v === 'string' && ISO.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v
  const from = raw.from ?? addDays(asOf, -89), to = raw.to ?? asOf
  if (!valid(from) || !valid(to) || String(from) > String(to)) throw bad('Choose a valid date range.')
  const tab: MatchTab = (['review', 'confirmed', 'rejected', 'all'] as const).includes(raw.tab as MatchTab) ? raw.tab as MatchTab : 'review'
  const limit = Math.min(Math.max(Number.isFinite(Number(raw.limit)) ? Math.round(Number(raw.limit)) : MATCH_PAGE, 1), 100)
  const offset = Math.max(Number.isFinite(Number(raw.offset)) ? Math.round(Number(raw.offset)) : 0, 0)
  const environment = deps.environment ?? 'sandbox'

  const org = actor.organizationId
  const [{ ctx, coverage }, pairDecisions, decisionsAvailable] = await Promise.all([
    loadForReview(deps, org, asOf, from as string),
    deps.repo.loadPairDecisions ? deps.repo.loadPairDecisions(org) : Promise.resolve([]),
    deps.repo.decideMatch ? deps.repo.decideMatch({ organizationId: org, actorUserId: actor.userId, action: 'probe' }).then(r => r.outcome === 'available').catch(() => false) : Promise.resolve(false),
  ])
  // Only accounts of THIS environment take part (a Sandbox test Item never pairs with a Production account).
  const accounts = ctx.accounts.filter(a => (a.environment ?? 'sandbox') === environment)
  const accountRefs = new Set(accounts.map(a => a.providerAccountRef))
  const txs = ctx.txs.filter(t => accountRefs.has(t.providerAccountRef))
  const recon = reconciliationFor(txs.filter(t => !t.removed), new Map(accounts.map(a => [a.providerAccountRef, a])), ctx.decisions)
  const review = buildMatchReview({
    txs, accounts: accounts.map(infoOf), recon, pairDecisions,
    refundDecisions: ctx.decisions.filter(d => d.kind === 'category' && d.category === 'refund' && (d.status === 'confirmed' || d.status === 'rejected')).map(d => ({ txId: d.txId, status: d.status as 'confirmed' | 'rejected' })),
    window: { from: from as string, to: to as string },
  })
  const wanted = TAB_STATES[tab]
  const filtered = wanted ? review.items.filter(i => wanted.includes(i.state)) : review.items
  return {
    enabled: true, decisionsAvailable, asOf, window: { from: from as string, to: to as string }, environment, coverage, tab, counts: review.counts, total: filtered.length,
    items: filtered.slice(offset, offset + limit), groups: tab === 'review' || tab === 'all' ? review.groups : [], refunds: review.refunds,
    contract: 'A match is your statement that two bank movements are the same event. It labels bank evidence only: it does not change your balances, ledger or any account.',
  }
}

export type MatchDecision = 'confirm' | 'reject' | 'reverse'
export interface MatchDecisionResult { outcome: 'confirmed' | 'rejected' | 'reversed' | 'unchanged' | 'nothing_to_reverse'; pairId: string | null }

const CONFLICT_TEXT: Record<string, string> = {
  LEG_ALREADY_PAIRED: 'One of these transactions is already matched with another. Reverse that match first.',
  LEG_ALREADY_DECIDED: 'You already decided one of these transactions as something else (a bill, project, payroll, personal…). Undo that decision first.',
  LEG_IGNORED: 'One of these transactions is set aside as ignored. Un-ignore it first.',
  LEG_CATEGORIZED: 'You already categorized one of these transactions as a purchase. Change that first.',
  PAIR_CONFIRMED: 'This match is confirmed. Reverse it before rejecting it.',
}

export async function decideMatch(deps: SpendingDeps, actor: BankActor, input: { decision?: unknown; outflowId?: unknown; inflowId?: unknown; fingerprint?: unknown }): Promise<MatchDecisionResult> {
  assertAuthority(actor)
  if (deps.reconciliationEnabled !== true) throw new BankConnectionError('feature_disabled', 403, 'Match review is not enabled yet.')
  if (!deps.repo.decideMatch) throw new BankConnectionError('persistence_failed', 503, 'Match decisions need a database update that has not been installed yet. Nothing was changed.')
  if (input.decision !== 'confirm' && input.decision !== 'reject' && input.decision !== 'reverse') throw bad('Choose confirm, reject or reverse.')
  const decision: MatchDecision = input.decision
  const id = (v: unknown, what: string): string => { if (typeof v !== 'string' || !UUID.test(v)) throw bad(`A valid ${what} is required.`); return v.toLowerCase() }
  const outflowId = id(input.outflowId, 'outgoing transaction'), inflowId = id(input.inflowId, 'incoming transaction')
  if (outflowId === inflowId) throw bad('Choose two different transactions.')
  const org = actor.organizationId
  const settle = (r: { outcome: string; pairId: string | null; detail: string | null }): MatchDecisionResult => {
    switch (r.outcome) {
      case 'confirmed': case 'rejected': case 'reversed': case 'unchanged': case 'nothing_to_reverse': return { outcome: r.outcome, pairId: r.pairId }
      case 'evidence_changed': throw new BankConnectionError('conflict', 409, 'This match changed since you opened it. Refresh and review it again; nothing was saved.')
      case 'conflict': throw new BankConnectionError('conflict', 409, CONFLICT_TEXT[r.detail ?? ''] ?? 'Another decision already covers one of these transactions. Nothing was changed.')
      case 'pending_not_allowed': throw new BankConnectionError('conflict', 409, 'A pending transaction cannot be matched until it posts. Nothing was changed.')
      case 'invalid_pair': throw bad('These two transactions do not form a valid match (equal amounts, opposite directions, different accounts, a few days apart).')
      case 'not_found': throw new BankConnectionError('not_found', 404, 'Transaction not found.')
      default: throw new BankConnectionError('persistence_failed', 503, 'The match could not be saved. Nothing was changed; please try again.')
    }
  }

  if (decision === 'reverse') return settle(await deps.repo.decideMatch({ organizationId: org, actorUserId: actor.userId, action: 'reverse', outflowId, inflowId }))

  // confirm / reject: recompute the pair from this organization's own evidence. Nothing about the pair is taken from the request except the two ids and the
  // fingerprint of what the owner was shown.
  if (typeof input.fingerprint !== 'string' || input.fingerprint.length < 20 || input.fingerprint.length > 400 || !input.fingerprint.startsWith('v1|')) throw bad('Refresh the review and try again.')
  if (!deps.repo.getPairEvidence) throw new BankConnectionError('persistence_failed', 503, 'The match could not be checked. Nothing was changed.')
  const evidence = await deps.repo.getPairEvidence(org, [outflowId, inflowId])
  const o = evidence.txs.find(t => t.id === outflowId), i = evidence.txs.find(t => t.id === inflowId)
  const environment = deps.environment ?? 'sandbox'
  const accountOk = (t?: EvidenceTx) => !!t && evidence.accounts.some(a => a.providerAccountRef === t.providerAccountRef && (a.environment ?? 'sandbox') === environment)
  if (!o || !i || !accountOk(o) || !accountOk(i)) throw new BankConnectionError('not_found', 404, 'Transaction not found.')
  const recon: ReconAccount[] = evidence.accounts.map(a => { const info = infoOf(a); return { ref: info.ref, label: info.label, accountClass: info.accountClass, ownership: info.ownership } })
  if (o.removed || i.removed) throw new BankConnectionError('conflict', 409, 'This match changed since you opened it. Refresh and review it again; nothing was saved.')
  if (o.pending || i.pending) throw new BankConnectionError('conflict', 409, 'A pending transaction cannot be matched until it posts. Nothing was changed.')
  if (!pairIsValid(o, i, recon)) throw bad('These two transactions do not form a valid match (equal amounts, opposite directions, different accounts, a few days apart).')
  if (pairFingerprint(o, i) !== input.fingerprint) throw new BankConnectionError('conflict', 409, 'This match changed since you opened it. Refresh and review it again; nothing was saved.')
  const pair = buildPair(o, i, recon)
  return settle(await deps.repo.decideMatch({
    organizationId: org, actorUserId: actor.userId, action: decision, outflowId, inflowId, pairKind: pair.kind, fingerprint: pair.fingerprint,
    basis: { confidence: pair.confidence, caps: pair.caps, crossScope: pair.crossScope, daysApart: pair.daysApart, reasons: pair.reasons.slice(0, 6), source: 'owner_review' },
  }))
}
