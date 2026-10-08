/**
 * src/services/spending/spendingService.ts
 *
 * SERVER-ONLY (BANK-5). Orchestrates the Spending Explorer and the owner's interpretation decisions.
 *
 *   PLAID TRANSACTION = EVIDENCE, NOT A CASH OS TRANSACTION.
 *
 * It READS provider evidence, mappings and Cash OS context (obligations, projects, debt accounts) and WRITES only interpretation rows.
 * It never writes the ledger, accounts, balances, include_in_cash, obligations (no occurrence is materialized), projects, debt, payroll
 * or Outlook, and never changes provider evidence. Suggestions are computed on demand (deterministic) and are never persisted: only an
 * owner's decision (confirm / reject / ignore / undo) becomes a row, so there is nothing stale to regenerate and nothing to duplicate.
 *
 * Authority: owner/admin only, organization from the authenticated profile (never the request). Pending evidence may only be categorized
 * or ignored. Changing a decision keeps the old one as an "undone" row (audit trail), then writes the new one.
 */
import { BankConnectionError, UUID, assertAuthority, note, type BankActor } from '../bankConnectionService'
import { generateRecurrenceDates } from '../../../finance/recurrence'
import { addDays } from './analytics'
import { CONFIRMED_INTERPRETATION_CONTRACT } from './contract'
import { buildRows, filterRows, viewCounts, type AccountScope, type ExplorerQuery, type ExplorerView, EXPLORER_VIEWS } from './explorer'
import { BUCKETS, isBucketKey, isRelationshipKind, RELATIONSHIP_KINDS, type BucketKey, type Confidence, type RelationshipKind } from './taxonomy'
import type { AccountContext, Decision, DebtOption, EvidenceTx, KnownBillCandidate, ProjectOption } from './types'

export interface ObligationRow {
  id: string; name: string; amountMinor: number; amountType: 'fixed' | 'estimated'; estimatedMinMinor: number | null; estimatedMaxMinor: number | null
  recurrenceKind: 'weekly' | 'every_n_weeks' | 'monthly' | 'yearly'; recurrenceInterval: number; anchorDate: string; startDate: string; endDate: string | null
  status: string; accountId: string | null
}
export interface OccurrenceRow { obligationId: string; scheduledDate: string; overrideDate: string | null; overrideAmountMinor: number | null; status: string; reconciliationState: string }
export interface CommitmentRow { id: string; title: string; expectedDate: string; amountMinor: number; amountType: 'fixed' | 'estimated'; estimatedMinMinor: number | null; estimatedMaxMinor: number | null; status: string; reconciliationState: string; accountId: string | null }

export interface SpendingContext {
  txs: EvidenceTx[]
  accounts: AccountContext[]
  decisions: Decision[]
  obligations: ObligationRow[]
  occurrences: OccurrenceRow[]
  commitments: CommitmentRow[]
  debts: DebtOption[]
  projects: ProjectOption[]
}

export interface NewDecision {
  organizationId: string
  txId: string
  kind: Decision['kind']
  status: 'confirmed' | 'rejected'
  source: 'owner' | 'rule'
  confidence: Confidence
  basis: Record<string, unknown>
  category: string | null
  projectId: string | null
  obligationId: string | null
  commitmentId: string | null
  debtAccountId: string | null
  counterpartTxId: string | null
  actorUserId: string
}

export interface SpendingRepo {
  loadContext(organizationId: string, sinceDate: string): Promise<SpendingContext>
  getEvidence(organizationId: string, id: string): Promise<{ id: string; pending: boolean; removed: boolean } | null>
  /** Confirmed decisions (not rejected/undone) for one transaction. */
  confirmedFor(organizationId: string, txId: string): Promise<Decision[]>
  targetExists(organizationId: string, type: 'obligation' | 'commitment' | 'debt_account' | 'project', id: string): Promise<boolean>
  /**
   * ATOMIC: validate, retire the previous active decision of the same dimension as audit history, and insert the new confirmed decision, in
   * ONE database transaction (financial_provider_replace_interpretation). Either all of it happens or none of it. Idempotent: an identical
   * active decision returns 'unchanged'.
   */
  replaceDecision(row: NewDecision): Promise<{ outcome: 'created' | 'changed' | 'unchanged'; id: string }>
  /** Insert-only (a REJECTED suggestion is never an active decision, so nothing is replaced). */
  insertDecision(row: NewDecision): Promise<{ id: string }>
  markUndone(organizationId: string, decisionId: string, actorUserId: string, reason: string): Promise<void>
}
export interface SpendingDeps { repo: SpendingRepo; environment?: 'sandbox' | 'production'; log?: (e: { event: string; organizationId: string; outcome?: string; code?: string }) => void; now?: () => number }
const clock = (d: SpendingDeps) => d.now ? d.now() : Date.now()
const today = (d: SpendingDeps) => new Date(clock(d)).toISOString().slice(0, 10)
const logNote = (d: SpendingDeps, e: { event: string; organizationId: string; outcome?: string; code?: string }) => { try { d.log?.(e) } catch { /* logging never breaks the flow */ } }

/** Known money Cash OS already expects around the evidence dates. Pure reads: no occurrence is ever materialized here. */
export function buildBillCandidates(ctx: Pick<SpendingContext, 'obligations' | 'occurrences' | 'commitments' | 'txs'>, rangeStart: string, rangeEnd: string): KnownBillCandidate[] {
  const out: KnownBillCandidate[] = []
  const occ = new Map(ctx.occurrences.map(o => [`${o.obligationId}|${o.scheduledDate}`, o]))
  for (const o of ctx.obligations) {
    if (o.status !== 'active') continue
    let dates: string[] = []
    try { dates = generateRecurrenceDates({ kind: o.recurrenceKind, interval: o.recurrenceInterval, anchorDate: o.anchorDate, startDate: o.startDate, endDate: o.endDate }, rangeStart, rangeEnd) } catch { dates = [] }
    for (const scheduled of dates) {
      const row = occ.get(`${o.id}|${scheduled}`)
      if (row && (row.status !== 'scheduled' || row.reconciliationState === 'reconciled')) continue // already satisfied / skipped / canceled
      out.push({ type: 'obligation', id: o.id, label: o.name, expectedDate: row?.overrideDate ?? scheduled, amountMinor: row?.overrideAmountMinor ?? o.amountMinor,
        estimatedMinMinor: o.amountType === 'estimated' ? o.estimatedMinMinor : null, estimatedMaxMinor: o.amountType === 'estimated' ? o.estimatedMaxMinor : null, financialAccountId: o.accountId })
    }
  }
  for (const c of ctx.commitments) {
    if (c.status !== 'scheduled' || c.reconciliationState === 'reconciled' || c.expectedDate < rangeStart || c.expectedDate > rangeEnd) continue
    out.push({ type: 'commitment', id: c.id, label: c.title, expectedDate: c.expectedDate, amountMinor: c.amountMinor,
      estimatedMinMinor: c.amountType === 'estimated' ? c.estimatedMinMinor : null, estimatedMaxMinor: c.amountType === 'estimated' ? c.estimatedMaxMinor : null, financialAccountId: c.accountId })
  }
  return out
}

export function explorerFromContext(ctx: SpendingContext, asOf: string, accountScope: AccountScope = 'all', activeEnvironment?: 'sandbox' | 'production') {
  const dates = ctx.txs.map(t => t.date).sort()
  const start = dates.length ? addDays(dates[0], -7) : asOf, end = dates.length ? addDays(dates[dates.length - 1], 7) : asOf
  const bills = buildBillCandidates(ctx, start, end)
  const built = buildRows({
    asOf, accountScope, activeEnvironment, txs: ctx.txs, accounts: ctx.accounts, decisions: ctx.decisions, bills, debts: ctx.debts, projects: ctx.projects,
    obligationLabels: new Map(ctx.obligations.map(o => [o.id, o.name])), commitmentLabels: new Map(ctx.commitments.map(c => [c.id, c.title])),
  })
  return { ...built, bills }
}

const intOrUndefined = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : undefined)
const ISO = /^\d{4}-\d{2}-\d{2}$/

/** Sanitized query from untrusted input. Unknown values are dropped, never trusted. */
export function parseQuery(raw: Record<string, unknown>): ExplorerQuery {
  const q: ExplorerQuery = {}
  if (typeof raw.view === 'string' && (EXPLORER_VIEWS as readonly string[]).includes(raw.view)) q.view = raw.view as ExplorerView
  if (typeof raw.from === 'string' && ISO.test(raw.from)) q.from = raw.from
  if (typeof raw.to === 'string' && ISO.test(raw.to)) q.to = raw.to
  if (typeof raw.account === 'string' && UUID.test(raw.account)) q.account = raw.account
  if (typeof raw.bucket === 'string' && isBucketKey(raw.bucket)) q.bucket = raw.bucket
  if (raw.accounts === 'all' || raw.accounts === 'mapped') q.accounts = raw.accounts
  if (raw.scope === 'business' || raw.scope === 'personal' || raw.scope === 'unclear') q.scope = raw.scope
  if (typeof raw.search === 'string') q.search = raw.search.slice(0, 60)
  if (typeof raw.project === 'string' && raw.project.length <= 64) q.project = raw.project
  const min = intOrUndefined(raw.minMinor), max = intOrUndefined(raw.maxMinor)
  if (min !== undefined && min >= 0) q.minMinor = min
  if (max !== undefined && max >= 0) q.maxMinor = max
  if (raw.confidence === 'high' || raw.confidence === 'possible' || raw.confidence === 'low') q.confidence = raw.confidence
  if (raw.review === 'suggested' || raw.review === 'confirmed' || raw.review === 'needs_review' || raw.review === 'ignored') q.review = raw.review
  if (raw.includePending === false || raw.includePending === 'false') q.includePending = false
  q.limit = Math.min(Math.max(intOrUndefined(raw.limit) ?? 100, 1), 200)
  q.offset = Math.max(intOrUndefined(raw.offset) ?? 0, 0)
  return q
}

export async function getExplorer(deps: SpendingDeps, actor: BankActor, rawQuery: Record<string, unknown> = {}) {
  assertAuthority(actor)
  const asOf = today(deps)
  const ctx = await deps.repo.loadContext(actor.organizationId, addDays(asOf, -200))
  const q = parseQuery(rawQuery)
  const environment = deps.environment ?? 'sandbox' // the environment this server is configured for
  const accounts = q.accounts ?? 'mapped' // the default business view is the owner's MAPPED accounts; 'all' is an explicit choice
  const { rows, analytics, bills, outOfScopeDates } = explorerFromContext(ctx, asOf, accounts, environment)
  const base = { from: q.from ?? addDays(asOf, -89), ...q }
  const filtered = filterRows(rows, base)
  const page = filtered.slice(q.offset ?? 0, (q.offset ?? 0) + (q.limit ?? 100))
  const inWindow = rows.filter(r => r.date >= base.from && (!q.to || r.date <= q.to))
  return {
    asOf, window: { from: base.from, to: q.to ?? asOf },
    analytics, viewCounts: viewCounts(inWindow), total: filtered.length, rows: page,
    options: {
      buckets: BUCKETS.map(b => ({ key: b.key, label: b.label, hint: b.hint })),
      relationships: RELATIONSHIP_KINDS,
      accounts: ctx.accounts.map(a => ({ ref: a.providerAccountRef, label: a.financialAccountName ?? a.label, mask: a.mask, ownership: a.ownership })),
      obligations: ctx.obligations.filter(o => o.status === 'active').map(o => ({ id: o.id, label: o.name, amountMinor: o.amountMinor })),
      commitments: ctx.commitments.filter(c => c.status === 'scheduled').map(c => ({ id: c.id, label: c.title, amountMinor: c.amountMinor, expectedDate: c.expectedDate })),
      debts: ctx.debts, projects: ctx.projects,
    },
    accounts, environment,
    meta: {
      // Diagnostics for known-bill matching: a healthy pipeline with zero matches means the evidence simply does not resemble the bills.
      billCandidates: bills.length, activeObligations: ctx.obligations.filter(o => o.status === 'active').length, scheduledCommitments: ctx.commitments.filter(c => c.status === 'scheduled').length,
      evidenceRows: ctx.txs.length,
      // Evidence the active view does not show, so nothing is silently hidden.
      hiddenUnmapped: outOfScopeDates.filter(d => d >= base.from && (!q.to || d <= q.to)).length,
      olderThanPeriod: rows.filter(r => r.date < base.from).length + outOfScopeDates.filter(d => d < base.from).length,
      periodFrom: base.from,
    },
    contract: { confirmedMeans: CONFIRMED_INTERPRETATION_CONTRACT.confirmedMeans, isCanonicalAdoption: CONFIRMED_INTERPRETATION_CONTRACT.isCanonicalAdoption, text: CONFIRMED_INTERPRETATION_CONTRACT.ownerText },
  }
}

export type DecisionInput =
  | { action: 'set_bucket'; transactionId?: unknown; bucket?: unknown }
  | { action: 'set_relationship'; transactionId?: unknown; kind?: unknown; targetType?: unknown; targetId?: unknown; counterpartTransactionId?: unknown }
  | { action: 'accept_suggestion' | 'reject_suggestion'; transactionId?: unknown; dimension?: unknown }
  | { action: 'undo'; transactionId?: unknown; dimension?: unknown }
  | { action: 'ignore' | 'unignore'; transactionId?: unknown }

const bad = (m: string) => new BankConnectionError('invalid_request', 400, m)
const requireId = (v: unknown, what: string): string => { if (typeof v !== 'string' || !UUID.test(v)) throw bad(`A valid ${what} is required.`); return v }
const NO_TARGET = { projectId: null, obligationId: null, commitmentId: null, debtAccountId: null, counterpartTxId: null }

function fresh(actor: BankActor, txId: string, kind: Decision['kind'], extra: Partial<NewDecision>): NewDecision {
  return { organizationId: actor.organizationId, txId, kind, status: 'confirmed', source: 'owner', confidence: 'high', basis: { mode: 'owner_choice' }, category: null, ...NO_TARGET, actorUserId: actor.userId, ...extra }
}

async function relationshipRow(deps: SpendingDeps, actor: BankActor, txId: string, kind: RelationshipKind, t: { targetType?: unknown; targetId?: unknown; counterpartTransactionId?: unknown }, extra: Partial<NewDecision>): Promise<NewDecision> {
  const org = actor.organizationId
  const row = fresh(actor, txId, kind, extra)
  if (kind === 'obligation') {
    if (t.targetType !== 'obligation' && t.targetType !== 'commitment') throw bad('Choose the bill this belongs to.')
    const id = requireId(t.targetId, 'bill')
    if (!(await deps.repo.targetExists(org, t.targetType, id))) throw new BankConnectionError('not_found', 404, 'That bill was not found.')
    if (t.targetType === 'obligation') row.obligationId = id; else row.commitmentId = id
  } else if (kind === 'project') {
    if (typeof t.targetId !== 'string' || !t.targetId || t.targetId.length > 64) throw bad('Choose the project this belongs to.')
    if (!(await deps.repo.targetExists(org, 'project', t.targetId))) throw new BankConnectionError('not_found', 404, 'That project was not found.')
    row.projectId = t.targetId
  } else if (kind === 'debt') {
    const id = requireId(t.targetId, 'debt account')
    if (!(await deps.repo.targetExists(org, 'debt_account', id))) throw new BankConnectionError('not_found', 404, 'That debt account was not found.')
    row.debtAccountId = id
  } else if (kind === 'transfer' && t.counterpartTransactionId) {
    const other = requireId(t.counterpartTransactionId, 'matching transaction')
    const ev = await deps.repo.getEvidence(org, other)
    if (!ev || ev.removed || other === txId) throw new BankConnectionError('not_found', 404, 'The matching transaction was not found.')
    row.counterpartTxId = other
  }
  return row
}

/**
 * One owner decision. Idempotent: repeating it changes nothing. Replacing a decision is ATOMIC (one database transaction): the previous
 * decision becomes audit history and the new one becomes the only active decision, or nothing changes at all.
 * A confirmed decision is an interpretation of provider evidence ONLY (see contract.ts); no action here can create canonical truth.
 */
export async function applyDecision(deps: SpendingDeps, actor: BankActor, input: DecisionInput) {
  try {
    return await applyDecisionUnsafe(deps, actor, input)
  } catch (error) {
    if (error instanceof BankConnectionError) throw error
    logNote(deps, { event: 'spending.decision_failed', organizationId: actor.organizationId, code: 'persistence_failed' })
    throw new BankConnectionError('persistence_failed', 503, 'The change could not be saved. Nothing was changed; please try again.')
  }
}

async function applyDecisionUnsafe(deps: SpendingDeps, actor: BankActor, input: DecisionInput) {
  assertAuthority(actor)
  const org = actor.organizationId
  const txId = requireId((input as { transactionId?: unknown }).transactionId, 'transaction')
  const ev = await deps.repo.getEvidence(org, txId) // organization-scoped: another organization's id is simply "not found"
  if (!ev || ev.removed) throw new BankConnectionError('not_found', 404, 'Transaction not found.')
  const pendingBlock = () => { if (ev.pending) throw new BankConnectionError('conflict', 409, 'A pending transaction can only be categorized or ignored until it posts.') }
  const done = (outcome: string) => { logNote(deps, { event: 'spending.decision', organizationId: org, outcome: `${input.action}/${outcome}` }); return { outcome } }
  const confirmedNow = async () => {
    const confirmed = await deps.repo.confirmedFor(org, txId)
    return { bucket: confirmed.find(d => d.kind === 'category'), rel: confirmed.find(d => !['category', 'ignored'].includes(d.kind)), ignored: confirmed.find(d => d.kind === 'ignored') }
  }

  switch (input.action) {
    case 'set_bucket': {
      if (!isBucketKey(input.bucket)) throw bad('Choose a spending bucket.')
      return done((await deps.repo.replaceDecision(fresh(actor, txId, 'category', { category: input.bucket }))).outcome)
    }
    case 'set_relationship': {
      if (!isRelationshipKind(input.kind)) throw bad('Choose what this belongs to.')
      pendingBlock()
      const row = await relationshipRow(deps, actor, txId, input.kind, input, {})
      return done((await deps.repo.replaceDecision(row)).outcome)
    }
    case 'accept_suggestion':
    case 'reject_suggestion': {
      const dimension = input.dimension
      if (dimension !== 'bucket' && dimension !== 'relationship') throw bad('Choose bucket or relationship.')
      const ctx = await deps.repo.loadContext(org, addDays(today(deps), -200))
      const row = explorerFromContext(ctx, today(deps)).rows.find(r => r.id === txId)
      if (!row) throw new BankConnectionError('not_found', 404, 'Transaction not found.')
      if (dimension === 'bucket') {
        if (row.bucket.state !== 'suggested' || !row.bucket.key) throw new BankConnectionError('conflict', 409, 'There is no suggestion to act on.')
        const base = { source: 'rule' as const, confidence: row.bucket.confidence ?? 'low', basis: { mode: 'suggestion', reasons: row.bucket.reasons, confidence: row.bucket.confidence } }
        if (input.action === 'reject_suggestion') { await deps.repo.insertDecision({ ...fresh(actor, txId, 'category', { category: row.bucket.key, status: 'rejected' }), ...base }); return done('rejected') }
        return done((await deps.repo.replaceDecision({ ...fresh(actor, txId, 'category', { category: row.bucket.key }), ...base })).outcome)
      }
      const rel = row.relationship
      if (rel.state !== 'suggested' || rel.kind === 'unknown') throw new BankConnectionError('conflict', 409, 'There is no suggestion to act on.')
      const kind = rel.kind as RelationshipKind
      const t = rel.target
      const targetArgs = kind === 'debt' ? { targetId: t?.id } : { targetType: t?.type === 'debt_account' ? undefined : t?.type, targetId: t?.id ?? undefined, counterpartTransactionId: t?.type === 'counterpart_tx' ? t.id : undefined }
      const base = { source: 'rule' as const, confidence: rel.confidence ?? 'low', basis: { mode: 'suggestion', reasons: rel.reasons, confidence: rel.confidence } }
      if (input.action === 'reject_suggestion') {
        await deps.repo.insertDecision({ ...(await relationshipRow(deps, actor, txId, kind, targetArgs, { status: 'rejected' })), ...base })
        return done('rejected')
      }
      pendingBlock()
      return done((await deps.repo.replaceDecision({ ...(await relationshipRow(deps, actor, txId, kind, targetArgs, {})), ...base })).outcome)
    }
    case 'undo': {
      if (input.dimension !== 'bucket' && input.dimension !== 'relationship' && input.dimension !== 'ignore') throw bad('Choose what to undo.')
      const cur = await confirmedNow()
      const target = input.dimension === 'bucket' ? cur.bucket : input.dimension === 'relationship' ? cur.rel : cur.ignored
      if (!target) return done('nothing_to_undo')
      await deps.repo.markUndone(org, target.id, actor.userId, 'owner_undo')
      return done('undone')
    }
    case 'ignore': {
      const out = await deps.repo.replaceDecision(fresh(actor, txId, 'ignored', {}))
      return done(out.outcome === 'created' ? 'ignored' : out.outcome)
    }
    case 'unignore': {
      const cur = await confirmedNow()
      if (!cur.ignored) return done('nothing_to_undo')
      await deps.repo.markUndone(org, cur.ignored.id, actor.userId, 'owner_undo')
      return done('undone')
    }
    default:
      throw bad('Unsupported request.')
  }
}
export { BUCKETS }
export type { BucketKey }
