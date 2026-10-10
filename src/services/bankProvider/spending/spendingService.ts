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
import { createHash } from 'node:crypto'
import { BankConnectionError, UUID, assertAuthority, note, type BankActor } from '../bankConnectionService'
import { generateRecurrenceDates } from '../../../finance/recurrence'
import { addDays } from './analytics'
import { CONFIRMED_INTERPRETATION_CONTRACT } from './contract'
import { buildSmartReview } from './smartReview'
import { buildRows, filterRows, viewCounts, type AccountScope, type ExplorerQuery, type ExplorerView, EXPLORER_VIEWS } from './explorer'
import { BATCH_APPROVABLE_BUCKETS, BUCKETS, bucketFitsDirection, bucketLabel, isBucketKey, isRelationshipKind, RELATIONSHIP_KINDS, type BucketKey, type Confidence, type RelationshipKind } from './taxonomy'
import type { AccountContext, Decision, DebtOption, EvidenceTx, KnownBillCandidate, ProjectOption } from './types'
import { canAssign, categoryName, categoryOptions, defaultHierarchy, explicitBatchKeys, type SpendingHierarchy } from './hierarchy'
import { APPROVED_REPORTING_POLICY, buildSpendingReport, REPORT_MODES, type ReportMode, type SpendingReport } from './reporting'

export interface ObligationRow {
  id: string; name: string; amountMinor: number; amountType: 'fixed' | 'estimated'; estimatedMinMinor: number | null; estimatedMaxMinor: number | null
  recurrenceKind: 'weekly' | 'every_n_weeks' | 'monthly' | 'yearly'; recurrenceInterval: number; anchorDate: string; startDate: string; endDate: string | null
  status: string; accountId: string | null
}
export interface OccurrenceRow { obligationId: string; scheduledDate: string; overrideDate: string | null; overrideAmountMinor: number | null; status: string; reconciliationState: string }
export interface CommitmentRow { id: string; title: string; expectedDate: string; amountMinor: number; amountType: 'fixed' | 'estimated'; estimatedMinMinor: number | null; estimatedMaxMinor: number | null; status: string; reconciliationState: string; accountId: string | null }

export interface SpendingContext {
  hierarchy?: SpendingHierarchy
  reportCoverage?: SpendingReport['coverage']
  legacyCoverage?: SpendingReport['coverage']
  txs: EvidenceTx[]
  accounts: AccountContext[]
  decisions: Decision[]
  obligations: ObligationRow[]
  occurrences: OccurrenceRow[]
  commitments: CommitmentRow[]
  debts: DebtOption[]
  projects: ProjectOption[]
  /** BANK-6B: active owner-approved merchant rules. Absent / rulesAvailable false before migration 157. */
  merchantRules?: MerchantRule[]
  rulesAvailable?: boolean
}
export interface MerchantRule { id: string; merchantKey: string; merchantLabel: string | null; category: string; updatedAt: string | null }

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
  checkedCategoryAvailable?(organizationId:string,actor:string):Promise<boolean>
  replaceCategoryChecked?(organizationId:string,actor:string,id:string,category:string,expected:import('../../../finance/relatedTransactions').CategoryRevision):Promise<{outcome:'created'|'changed'|'unchanged'}>
  loadHierarchy?(organizationId: string): Promise<SpendingHierarchy>
  loadReportContext?(organizationId: string, sinceDate: string): Promise<SpendingContext>
  loadContext(organizationId: string, sinceDate: string): Promise<SpendingContext>
  getEvidence(organizationId: string, id: string): Promise<{ id: string; pending: boolean; removed: boolean; amountMinor: number } | null>
  /** The audit trail of one transaction (every decision ever made, including undone and rejected ones). */
  historyFor(organizationId: string, txId: string): Promise<HistoryEntry[]>
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
  /** BANK-6B: remember / forget a merchant's category. Suggestions only: neither writes an interpretation, a decision or any canonical record. */
  upsertMerchantRule(organizationId: string, actorUserId: string, rule: { merchantKey: string; merchantLabel: string; category: string }): Promise<void>
  revokeMerchantRule(organizationId: string, actorUserId: string, merchantKey: string): Promise<boolean>
  markUndone(organizationId: string, decisionId: string, actorUserId: string, reason: string): Promise<void>
}
export interface HistoryEntry { kind: string; status: string; category: string | null; source: string; confidence: string | null; decidedAt: string | null; undoneAt: string | null; undoReason: string | null; createdAt: string }
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

export const ownerRulesOf = (ctx: Pick<SpendingContext, 'merchantRules'>): Map<string, BucketKey> =>
  new Map((ctx.merchantRules ?? []).filter(r => isBucketKey(r.category) && BATCH_APPROVABLE_BUCKETS.includes(r.category)).map(r => [r.merchantKey, r.category as BucketKey]))

export function explorerFromContext(ctx: SpendingContext, asOf: string, accountScope: AccountScope = 'all', activeEnvironment?: 'sandbox' | 'production', includeRemoved = false) {
  const dates = ctx.txs.map(t => t.date).sort()
  const start = dates.length ? addDays(dates[0], -7) : asOf, end = dates.length ? addDays(dates[dates.length - 1], 7) : asOf
  const bills = buildBillCandidates(ctx, start, end)
  const built = buildRows({
    asOf, accountScope, activeEnvironment, txs: ctx.txs, accounts: ctx.accounts, decisions: ctx.decisions, bills, debts: ctx.debts, projects: ctx.projects,
    ownerRules: ownerRulesOf(ctx), includeRemoved,
    obligationLabels: new Map(ctx.obligations.map(o => [o.id, o.name])), commitmentLabels: new Map(ctx.commitments.map(c => [c.id, c.title])),
  })
  for (const row of built.rows) if (row.bucket.key) row.bucket.label = categoryName(row.bucket.key, ctx.hierarchy)
  for (const entry of built.analytics.unassigned.byBucket) entry.label = categoryName(entry.key, ctx.hierarchy)
  return { ...built, bills }
}

const intOrUndefined = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : undefined)
const ISO = /^\d{4}-\d{2}-\d{2}$/

/** Sanitized query from untrusted input. Unknown values are dropped, never trusted. */
export function parseQuery(raw: Record<string, unknown>, hierarchy = defaultHierarchy()): ExplorerQuery {
  const q: ExplorerQuery = {}
  if (typeof raw.view === 'string' && (EXPLORER_VIEWS as readonly string[]).includes(raw.view)) q.view = raw.view as ExplorerView
  if (typeof raw.from === 'string' && ISO.test(raw.from)) q.from = raw.from
  if (typeof raw.to === 'string' && ISO.test(raw.to)) q.to = raw.to
  if (typeof raw.account === 'string' && UUID.test(raw.account)) q.account = raw.account
  if (typeof raw.bucket === 'string' && (isBucketKey(raw.bucket) || hierarchy.available && hierarchy.categories.some(c => c.key === raw.bucket))) q.bucket = raw.bucket
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

export function reviewCounts(rows: Array<{ review: string; bucket: { state: string }; relationship: { state: string } }>) {
  let reviewed = 0, unreviewed = 0, excluded = 0
  for (const r of rows) {
    if (r.review === 'ignored') excluded += 1
    else if (r.bucket.state === 'confirmed' || r.relationship.state === 'confirmed') reviewed += 1
    else unreviewed += 1
  }
  return { reviewed, unreviewed, excluded }
}

export async function getExplorer(deps: SpendingDeps, actor: BankActor, rawQuery: Record<string, unknown> = {}) {
  assertAuthority(actor)
  const asOf = today(deps)
  const ctx = await deps.repo.loadContext(actor.organizationId, addDays(asOf, -200))
  const q = parseQuery(rawQuery, ctx.hierarchy)
  const environment = deps.environment ?? 'sandbox' // the environment this server is configured for
  const accounts = q.accounts ?? 'mapped' // the default business view is the owner's MAPPED accounts; 'all' is an explicit choice
  const { rows, analytics, bills, outOfScopeDates } = explorerFromContext(ctx, asOf, accounts, environment)
  const base = { from: q.from ?? addDays(asOf, -89), ...q }
  const filtered = filterRows(rows, base)
  const page = filtered.slice(q.offset ?? 0, (q.offset ?? 0) + (q.limit ?? 100))
  const inWindow = rows.filter(r => r.date >= base.from && (!q.to || r.date <= q.to))
  return {
    asOf, window: { from: base.from, to: q.to ?? asOf }, hierarchy: ctx.hierarchy ?? defaultHierarchy(), coverage: ctx.legacyCoverage ?? {complete:true,reason:null},
    analytics, viewCounts: viewCounts(inWindow), total: filtered.length, rows: page,
    // Reviewed = the owner confirmed a bucket or a relationship. Excluded = the owner set it aside. Unreviewed = everything else (suggested or unknown).
    reviewCounts: reviewCounts(inWindow),
    options: {
      buckets: categoryOptions(ctx.hierarchy ?? defaultHierarchy()),
      batchBuckets: explicitBatchKeys(ctx.hierarchy ?? defaultHierarchy()), maxBatch: MAX_BATCH,
      merchantRules: (ctx.merchantRules ?? []).map(r => ({ merchantKey: r.merchantKey, label: r.merchantLabel ?? r.merchantKey, category: r.category, categoryLabel: bucketLabel(r.category) })), rulesAvailable: ctx.rulesAvailable === true,
      relationships: RELATIONSHIP_KINDS,
      accounts: ctx.accounts.map(a => ({ ref: a.providerAccountRef, label: a.financialAccountName ?? a.label, mask: a.mask, ownership: a.ownership })),
      obligations: ctx.obligations.filter(o => o.status === 'active').map(o => ({ id: o.id, label: o.name, amountMinor: o.amountMinor })),
      commitments: ctx.commitments.filter(c => c.status === 'scheduled').map(c => ({ id: c.id, label: c.title, amountMinor: c.amountMinor, expectedDate: c.expectedDate })),
      debts: ctx.debts, projects: ctx.projects,
    },
    // Opaque, one-way: lets the browser keep an in-progress review draft that is private to this organization AND this user, without knowing either id.
    draftScope: createHash('sha256').update(`${actor.organizationId}:${actor.userId}:review-draft`).digest('hex').slice(0, 16),
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
  | { action: 'confirm_batch'; transactionIds?: unknown; categoryOverrides?: unknown; rememberTransactionIds?: unknown }
  | { action: 'forget_rule'; merchantKey?: unknown }

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

export const MAX_BATCH = 100
export type BatchSkipReason = 'not_found' | 'pending' | 'money_in' | 'no_suggestion' | 'not_high_confidence' | 'needs_individual_review' | 'mixed_purpose' | 'relationship_suggested' | 'already_decided' | 'failed'
export interface BatchItemResult { id: string; result: 'confirmed' | 'unchanged' | 'skipped'; reason?: BatchSkipReason; bucket?: string; overridden?: boolean }

/**
 * SELECTED-BATCH approval. The server decides what is eligible, from the CURRENT evidence and decisions (the browser's idea of a suggestion
 * is never trusted). Only an ordinary operating-expense CATEGORY suggestion with HIGH confidence on a POSTED money-out transaction is confirmed.
 * Never confirmed in bulk: pending rows, money in, payroll, personal, transfers, owner draws, projects, bills, debts, or any row that also carries a
 * relationship suggestion. Those stay in the review queue for an individual decision. Each confirmed row is its own atomic, audited decision
 * (so a failure on one row never half-saves another); nothing here can create canonical truth.
 *
 * CATEGORY OVERRIDES: the owner may correct the suggested category of a row before approving it ({ transactionId: bucketKey }). An override is
 * validated here, never trusted: it must belong to a selected row, name a real everyday-expense category (the same list batch approval allows), and
 * the row must still be a posted, undecided money-out transaction with no competing relationship suggestion. It is saved as the OWNER's decision
 * (not a rule's), with the original suggestion kept in the audit basis. A malformed or disallowed override refuses the whole request unchanged.
 */
async function confirmBatch(deps: SpendingDeps, actor: BankActor, rawIds: unknown, rawOverrides: unknown, rawRemember: unknown) {
  if (!Array.isArray(rawIds) || rawIds.length === 0) throw bad('Select at least one transaction.')
  const ids = [...new Set(rawIds)]
  if (ids.length > MAX_BATCH) throw bad(`Approve at most ${MAX_BATCH} transactions at a time.`)
  for (const id of ids) requireId(id, 'transaction')
  const overrides = new Map<string, string>()
  if (rawOverrides !== undefined && rawOverrides !== null) {
    if (typeof rawOverrides !== 'object' || Array.isArray(rawOverrides)) throw bad('Category changes were not understood.')
    const entries = Object.entries(rawOverrides as Record<string, unknown>)
    if (entries.length > ids.length) throw bad('Category changes were not understood.')
    for (const [id, bucket] of entries) {
      if (!ids.includes(id)) throw bad('A category change was sent for a transaction that is not selected.')
      if (typeof bucket !== 'string') throw bad('Choose an everyday expense category.')
      overrides.set(id, bucket)
    }
  }
  // BANK-6B: transactions whose merchant the owner asked to REMEMBER. Only ids selected in this same request count; the merchant and the category are
  // derived here from the saved decision, never taken from the browser.
  const remember = new Set<string>()
  if (rawRemember !== undefined && rawRemember !== null) {
    if (!Array.isArray(rawRemember) || rawRemember.length > ids.length) throw bad('Remembered merchants were not understood.')
    for (const id of rawRemember) { requireId(id, 'transaction'); if (!ids.includes(id)) throw bad('A merchant was marked to remember for a transaction that is not selected.'); remember.add(id) }
  }
  const org = actor.organizationId
  const ctx = await deps.repo.loadContext(org, addDays(today(deps), -200)) // organization-scoped: another organization's ids are simply not found
  const hierarchy = ctx.hierarchy ?? defaultHierarchy()
  for (const [id, key] of overrides) {
    if (!canAssign(key, hierarchy) || !explicitBatchKeys(hierarchy).includes(key)) throw bad('Choose an everyday expense category. Payroll, personal, transfers and owner draws are decided one at a time.')
    if (!isBucketKey(key) && remember.has(id)) throw bad('Custom category merchant remembering is not available. Turn off Remember before approving.')
  }
  const rows = new Map(explorerFromContext(ctx, today(deps)).rows.map(r => [r.id, r]))
  const results: BatchItemResult[] = []
  for (const id of ids as string[]) {
    const row = rows.get(id)
    const skip = (reason: BatchSkipReason) => results.push({ id, result: 'skipped', reason })
    if (!row) { skip('not_found'); continue }
    if (row.pending) { skip('pending'); continue }
    if (row.direction !== 'money_out') { skip('money_in'); continue }
    if (row.review === 'ignored' || row.bucket.state === 'confirmed') { skip('already_decided'); continue }
    const override = overrides.get(id)
    if (override) {
      if (row.relationship.state === 'suggested') { skip('relationship_suggested'); continue }
      try {
        const basis = { mode: 'owner_batch_override', suggested: row.bucket.state === 'suggested' ? row.bucket.key : null, suggestedConfidence: row.bucket.state === 'suggested' ? row.bucket.confidence : null }
        const out = await deps.repo.replaceDecision({ ...fresh(actor, id, 'category', { category: override, basis }) }) // source 'owner': the owner chose this category
        results.push({ id, result: out.outcome === 'unchanged' ? 'unchanged' : 'confirmed', bucket: override, overridden: true })
      } catch { skip('failed') }
      continue
    }
    if (row.bucket.state !== 'suggested' || !row.bucket.key) { skip('no_suggestion'); continue }
    if (row.bucket.confidence !== 'high') { skip('not_high_confidence'); continue }
    if (!BATCH_APPROVABLE_BUCKETS.includes(row.bucket.key)) { skip('needs_individual_review'); continue }
    if (row.relationship.state === 'suggested') { skip('relationship_suggested'); continue }
    // A mixed-purpose merchant (retail, grocery, fuel, food, Apple...) never goes through on a suggestion alone: the owner must pick the category.
    if (row.bucket.mixed) { skip('mixed_purpose'); continue }
    try {
      const base = { source: 'rule' as const, confidence: 'high' as Confidence, basis: { mode: 'suggestion_batch', reasons: row.bucket.reasons, confidence: 'high' } }
      const out = await deps.repo.replaceDecision({ ...fresh(actor, id, 'category', { category: row.bucket.key }), ...base })
      results.push({ id, result: out.outcome === 'unchanged' ? 'unchanged' : 'confirmed', bucket: row.bucket.key })
    } catch { skip('failed') }
  }
  const confirmed = results.filter(r => r.result === 'confirmed').length
  // Remember AFTER the decisions are saved. A rule failure never undoes an approval; it is reported so the owner knows nothing was remembered.
  const rules = await rememberMerchants(deps, actor, remember, results, rows, ctx)
  logNote(deps, { event: 'spending.batch', organizationId: org, outcome: `confirmed=${confirmed}/${results.length} rules=${rules.saved.length}` })
  return { outcome: 'batch', confirmed, unchanged: results.filter(r => r.result === 'unchanged').length, skipped: results.filter(r => r.result === 'skipped').length, results, rules }
}

async function rememberMerchants(deps: SpendingDeps, actor: BankActor, remember: Set<string>, results: BatchItemResult[], rows: Map<string, ReturnType<typeof explorerFromContext>['rows'][number]>, ctx: SpendingContext) {
  const out = { saved: [] as Array<{ merchantKey: string; label: string; category: string }>, skipped: [] as Array<{ merchantKey: string; reason: 'unknown_merchant' | 'conflicting_categories' | 'unavailable' | 'failed' }> }
  if (!remember.size) return out
  const decided = new Map<string, Set<string>>()
  const labels = new Map<string, string>()
  for (const r of results) {
    const row = rows.get(r.id)
    if (!row || r.result === 'skipped' || !r.bucket) continue
    decided.set(row.merchantKey, new Set([...(decided.get(row.merchantKey) ?? []), r.bucket]))
    labels.set(row.merchantKey, row.merchant)
  }
  const wanted = new Set([...remember].map(id => rows.get(id)?.merchantKey).filter((k): k is string => !!k))
  for (const key of wanted) {
    const cats = decided.get(key)
    if (!cats) continue // nothing under this merchant was actually approved
    if (key === 'UNKNOWN MERCHANT' || key.length < 3) { out.skipped.push({ merchantKey: key, reason: 'unknown_merchant' }); continue }
    if (cats.size !== 1) { out.skipped.push({ merchantKey: key, reason: 'conflicting_categories' }); continue }
    const category = [...cats][0]
    if (!BATCH_APPROVABLE_BUCKETS.includes(category)) { out.skipped.push({ merchantKey: key, reason: 'failed' }); continue }
    if (ctx.rulesAvailable === false) { out.skipped.push({ merchantKey: key, reason: 'unavailable' }); continue }
    try { await deps.repo.upsertMerchantRule(actor.organizationId, actor.userId, { merchantKey: key, merchantLabel: (labels.get(key) ?? key).slice(0, 80), category }); out.saved.push({ merchantKey: key, label: labels.get(key) ?? key, category }) } catch { out.skipped.push({ merchantKey: key, reason: 'failed' }) }
  }
  return out
}

/** Forget a remembered category. Earlier approvals are untouched; only future suggestions stop using the rule. */
async function forgetRule(deps: SpendingDeps, actor: BankActor, rawKey: unknown) {
  if (typeof rawKey !== 'string' || !rawKey.trim() || rawKey.length > 80) throw bad('Choose the merchant to forget.')
  const done = await deps.repo.revokeMerchantRule(actor.organizationId, actor.userId, rawKey)
  logNote(deps, { event: 'spending.rule_forgotten', organizationId: actor.organizationId, outcome: done ? 'revoked' : 'nothing_to_forget' })
  return { outcome: done ? 'forgotten' : 'nothing_to_forget' }
}

/** BANK-6B Smart Review: the same unreviewed transactions, grouped by merchant + suggested category, with exceptions kept out of bulk approval. Read-only. */
export async function getSmartReview(deps: SpendingDeps, actor: BankActor, rawQuery: Record<string, unknown> = {}) {
  assertAuthority(actor)
  const asOf = today(deps)
  const ctx = await deps.repo.loadContext(actor.organizationId, addDays(asOf, -200))
  const q = parseQuery(rawQuery, ctx.hierarchy)
  const environment = deps.environment ?? 'sandbox'
  const accounts = q.accounts ?? 'mapped'
  const { rows } = explorerFromContext(ctx, asOf, accounts, environment)
  const from = q.from ?? addDays(asOf, -89)
  const inWindow = rows.filter(r => r.date >= from && (!q.to || r.date <= q.to))
  const built = buildSmartReview(inWindow, ctx.txs, { activeRuleKeys: new Set((ctx.merchantRules ?? []).map(r => r.merchantKey)) })
  return {
    asOf, window: { from, to: q.to ?? asOf }, accounts, environment, ...built, hierarchy: ctx.hierarchy ?? defaultHierarchy(), coverage: ctx.legacyCoverage ?? {complete:true,reason:null},
    rulesAvailable: ctx.rulesAvailable === true, maxBatch: MAX_BATCH,
    merchantRules: (ctx.merchantRules ?? []).map(r => ({ merchantKey: r.merchantKey, label: r.merchantLabel ?? r.merchantKey, category: r.category, categoryLabel: bucketLabel(r.category) })),
    options: { buckets: categoryOptions(ctx.hierarchy ?? defaultHierarchy()), batchBuckets: explicitBatchKeys(ctx.hierarchy ?? defaultHierarchy()) },
    draftScope: createHash('sha256').update(`${actor.organizationId}:${actor.userId}:review-draft`).digest('hex').slice(0, 16),
  }
}

/** Reports use complete snapshot evidence, never an Explorer page. */
export async function getSpendingReport(deps: SpendingDeps, actor: BankActor, raw: Record<string, unknown>): Promise<SpendingReport> {
  assertAuthority(actor)
  if (!REPORT_MODES.includes(raw.report as ReportMode)) throw bad('Choose a reporting perspective.')
  const validDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v
  const asOf = today(deps), from = raw.from ?? addDays(asOf, -89), to = raw.to ?? asOf
  if (!validDate(from) || !validDate(to) || String(from) > String(to)) throw bad('Choose a valid reporting date range.')
  const account = raw.account === undefined || raw.account === '' ? undefined : requireId(raw.account, 'account')
  const scope = { from: from as string, to: to as string, accounts: raw.accounts === 'all' ? 'all' as const : 'mapped' as const, environment: deps.environment ?? 'sandbox', account }
  if (!deps.repo.loadReportContext) return buildSpendingReport([], raw.report as ReportMode, scope, APPROVED_REPORTING_POLICY, { complete: false, reason: 'Complete reporting is not available until the reviewed schema is installed.' })
  const ctx = await deps.repo.loadReportContext(actor.organizationId, addDays(scope.from, -110))
  const { rows } = explorerFromContext(ctx, asOf, 'all', scope.environment, true)
  const report = buildSpendingReport(rows, raw.report as ReportMode, scope, APPROVED_REPORTING_POLICY, ctx.reportCoverage ?? { complete: false, reason: 'Evidence coverage was not verified.' }, ctx.hierarchy)
  if (Buffer.byteLength(JSON.stringify(report), 'utf8') > 4_500_000) return { ...report, summary:null,groups:[],rows:[],coverage:{complete:false,reason:'Complete drill-down exceeds the response safety limit. Choose a narrower date/account scope.'} }
  return report
}

/** The audit trail of one transaction for the owner: what was decided, by rule or by the owner, and what was later undone. */
export async function getTransactionHistory(deps: SpendingDeps, actor: BankActor, rawId: unknown) {
  assertAuthority(actor)
  const id = requireId(rawId, 'transaction')
  const ev = await deps.repo.getEvidence(actor.organizationId, id)
  if (!ev) throw new BankConnectionError('not_found', 404, 'Transaction not found.')
  const history = (await deps.repo.historyFor(actor.organizationId, id)).map(h => ({ ...h, label: h.kind === 'category' ? bucketLabel(h.category) : h.kind }))
  return { history }
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
  if (input.action === 'confirm_batch') return confirmBatch(deps, actor, input.transactionIds, input.categoryOverrides, input.rememberTransactionIds)
  if (input.action === 'forget_rule') return forgetRule(deps, actor, input.merchantKey)
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
      const hierarchy = deps.repo.loadHierarchy ? await deps.repo.loadHierarchy(org) : defaultHierarchy()
      if (!canAssign(input.bucket, hierarchy)) throw bad('Choose an active spending category.')
      if (!bucketFitsDirection(input.bucket, ev.amountMinor < 0 ? 'money_in' : 'money_out')) throw bad(ev.amountMinor < 0 ? 'That category describes money going out, but this is money coming in.' : 'That category describes money coming in, but this is money going out.')
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
