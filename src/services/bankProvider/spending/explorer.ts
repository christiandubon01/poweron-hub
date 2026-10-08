/**
 * src/services/spending/explorer.ts
 *
 * BANK-5: assemble explorer rows from provider EVIDENCE + owner DECISIONS + engine SUGGESTIONS, then filter them into the owner's views.
 * PURE. Evidence is never modified; a row is a read-only view of three independent dimensions plus a derived review state.
 */
import { analyze, detectRecurring, type SpendingAnalytics } from './analytics'
import { classifyAll, confidenceAtLeast, directionOf } from './classifier'
import { merchantKey, merchantLabel } from './merchant'
import { RELATIONSHIP_LABELS, SUBSCRIPTION_BUCKETS, bucketLabel, isBucketKey, type BucketKey, type Confidence, type RelationshipKind, type ReviewState } from './taxonomy'
import type { AccountContext, Decision, DebtOption, EvidenceTx, ExplorerRow, KnownBillCandidate, ProjectOption, RelationshipTarget } from './types'

export type ExplorerView = 'review_queue' | 'all' | 'known_bills' | 'unassigned' | 'repeated_spending' | 'needs_review'
export const EXPLORER_VIEWS: readonly ExplorerView[] = ['review_queue', 'all', 'known_bills', 'unassigned', 'repeated_spending', 'needs_review']

export interface ExplorerQuery {
  view?: ExplorerView
  from?: string
  to?: string
  /** provider account ref */
  account?: string
  bucket?: string
  scope?: 'business' | 'personal' | 'unclear'
  /** which provider accounts the view covers (service-level; the filter itself is applied when rows are built) */
  accounts?: AccountScope
  search?: string
  project?: string
  minMinor?: number
  maxMinor?: number
  confidence?: Confidence
  review?: ReviewState
  includePending?: boolean
  limit?: number
  offset?: number
}

/** 'mapped' (default for the owner's business view) = only provider accounts the owner explicitly mapped to a Cash OS account. 'all' = every connected account. */
export type AccountScope = 'mapped' | 'all'

export interface ExplorerInput {
  asOf: string
  /** Engine default is 'all' (pure); the service passes 'mapped' unless the owner asks for all connected accounts. */
  accountScope?: AccountScope
  /** With accountScope 'mapped': only accounts of Items in THIS environment are in the business view (evidence of the other environment is preserved and shown under 'all'). */
  activeEnvironment?: 'sandbox' | 'production'
  windowDays?: number
  txs: EvidenceTx[]
  accounts: AccountContext[]
  decisions: Decision[]
  bills: KnownBillCandidate[]
  obligationLabels: Map<string, string>
  commitmentLabels: Map<string, string>
  debts: DebtOption[]
  projects: ProjectOption[]
  /** BANK-6B: active owner-approved merchant rules (merchantKey -> category). Suggestions only. */
  ownerRules?: Map<string, BucketKey>
}

const KNOWN_MONEY = new Set<RelationshipKind>(['obligation', 'debt', 'payroll', 'transfer'])

export function buildRows(input: ExplorerInput): { rows: ExplorerRow[]; analytics: SpendingAnalytics; outOfScopeDates: string[] } {
  const accounts = new Map(input.accounts.map(a => [a.providerAccountRef, a]))
  const live = input.txs.filter(t => !t.removed)
  const suggestions = classifyAll({ txs: live, accounts, decisions: input.decisions, bills: input.bills, debts: input.debts, projects: input.projects, ownerRules: input.ownerRules })
  const confirmedBy = new Map<string, { bucket?: Decision; rel?: Decision; ignored?: Decision }>()
  for (const d of input.decisions) {
    if (d.status !== 'confirmed') continue
    const slot = confirmedBy.get(d.txId) ?? {}
    if (d.kind === 'category') slot.bucket = d
    else if (d.kind === 'ignored') slot.ignored = d
    else slot.rel = d
    confirmedBy.set(d.txId, slot)
  }
  const debtLabel = new Map(input.debts.map(d => [d.id, d.label])), projectLabel = new Map(input.projects.map(p => [p.id, p.name]))
  const targetOf = (d: Decision): RelationshipTarget | null => {
    if (d.obligationId) return { type: 'obligation', id: d.obligationId, label: input.obligationLabels.get(d.obligationId) ?? 'Recurring bill' }
    if (d.commitmentId) return { type: 'commitment', id: d.commitmentId, label: input.commitmentLabels.get(d.commitmentId) ?? 'Planned payment' }
    if (d.debtAccountId) return { type: 'debt_account', id: d.debtAccountId, label: debtLabel.get(d.debtAccountId) ?? 'Debt account' }
    if (d.projectId) return { type: 'project', id: d.projectId, label: projectLabel.get(d.projectId) ?? 'Project' }
    if (d.counterpartTxId) return { type: 'counterpart_tx', id: d.counterpartTxId, label: null }
    return null
  }

  const base = live.map((tx): ExplorerRow => {
    const acct = accounts.get(tx.providerAccountRef)
    const sug = suggestions.get(tx.id) ?? { bucket: null, relationship: null }
    const dec = confirmedBy.get(tx.id) ?? {}
    const direction = directionOf(tx.amountMinor)
    const bucketConfirmed = dec.bucket?.category && isBucketKey(dec.bucket.category) ? (dec.bucket.category as BucketKey) : null
    const bucket: ExplorerRow['bucket'] = bucketConfirmed
      ? { key: bucketConfirmed, label: bucketLabel(bucketConfirmed), state: 'confirmed', confidence: dec.bucket!.confidence ?? 'high', reasons: ['You confirmed this.'] }
      : sug.bucket ? { key: sug.bucket.bucket, label: bucketLabel(sug.bucket.bucket), state: 'suggested', confidence: sug.bucket.confidence, reasons: sug.bucket.reasons, basis: sug.bucket.basis, ...(sug.bucket.mixed ? { mixed: true } : {}) }
      : { key: direction === 'money_out' ? 'other_needs_review' : null, label: direction === 'money_out' ? bucketLabel('other_needs_review') : null, state: 'none', confidence: null, reasons: direction === 'money_out' ? ['Nothing recognised this transaction yet.'] : [] }
    const relationship: ExplorerRow['relationship'] = dec.rel
      ? { kind: dec.rel.kind as RelationshipKind, label: RELATIONSHIP_LABELS[dec.rel.kind as RelationshipKind], target: targetOf(dec.rel), state: 'confirmed', confidence: dec.rel.confidence ?? 'high', reasons: ['You confirmed this.'] }
      : sug.relationship ? { kind: sug.relationship.kind, label: RELATIONSHIP_LABELS[sug.relationship.kind], target: sug.relationship.target, state: 'suggested', confidence: sug.relationship.confidence, reasons: sug.relationship.reasons }
      : { kind: 'unknown', label: RELATIONSHIP_LABELS.unknown, target: null, state: 'none', confidence: null, reasons: [] }
    const ignored = !!dec.ignored
    const review: ReviewState = ignored ? 'ignored'
      : bucketConfirmed || (dec.rel && direction !== 'money_out') ? 'confirmed'
      : confidenceAtLeast(sug.bucket?.confidence, 'possible') || confidenceAtLeast(sug.relationship?.confidence, 'possible') ? 'suggested' : 'needs_review'
    const ownerPersonal = dec.rel?.kind === 'personal' || bucketConfirmed === 'personal_owner'
    const ownerBusiness = !!dec.rel && ['overhead', 'project', 'obligation', 'payroll'].includes(dec.rel.kind)
    const scope: ExplorerRow['scope'] = ownerPersonal ? { value: 'personal', source: 'owner' } : ownerBusiness ? { value: 'business', source: 'owner' }
      : acct?.ownership ? { value: acct.ownership, source: 'account' } : { value: 'unclear', source: 'none' }
    return {
      id: tx.id, date: tx.date, name: (tx.name ?? tx.merchantName ?? 'Unnamed transaction').slice(0, 120), merchant: merchantLabel(tx.name, tx.merchantName), merchantKey: merchantKey(tx.name, tx.merchantName),
      amountMinor: tx.amountMinor, direction, pending: tx.pending,
      account: { ref: tx.providerAccountRef, label: acct?.financialAccountName ?? acct?.label ?? 'Bank account', mask: acct?.mask ?? null, ownership: acct?.ownership ?? null, mappedTo: acct?.financialAccountName ?? null, mapped: !!acct?.financialAccountId, environment: acct?.environment ?? null },
      bucket, relationship, review, scope, unassigned: false, repeatedPattern: false, pattern: null,
    }
  })

  // Classification above ran over ALL evidence (so a transfer between a mapped and an unmapped account can still be paired). Everything that
  // produces totals, patterns and signals runs over the SCOPED rows only; evidence outside the scope is preserved and reported, never deleted.
  const inBusinessView = (r: ExplorerRow) => r.account.mapped && (!input.activeEnvironment || r.account.environment === input.activeEnvironment)
  const inScope = (input.accountScope ?? 'all') === 'all' ? base : base.filter(inBusinessView)
  const outOfScopeDates = (input.accountScope ?? 'all') === 'all' ? [] : base.filter(r => !inBusinessView(r)).map(r => r.date)
  const recurring = detectRecurring(inScope.filter(r => r.review !== 'ignored'))
  for (const r of inScope) {
    const rel = r.relationship
    const resolved = rel.state === 'confirmed'
      || (rel.state === 'suggested' && rel.kind !== 'unknown' && (rel.kind === 'transfer' ? confidenceAtLeast(rel.confidence, 'possible') : KNOWN_MONEY.has(rel.kind as RelationshipKind) && rel.confidence === 'high'))
      || (r.bucket.state === 'confirmed' && (r.bucket.key === 'personal_owner' || r.bucket.key === 'transfers' || r.bucket.key === 'owner_draw'))
    r.unassigned = r.direction === 'money_out' && !r.pending && r.review !== 'ignored' && !resolved
    const found = recurring.get(r.merchantKey)
    if (found && r.direction === 'money_out') {
      // A repeating merchant is a SPENDING PATTERN unless the context supports a bill/subscription reading.
      const billLike = (['obligation', 'debt', 'payroll'] as string[]).includes(rel.kind) && rel.state !== 'none'
        || (!!r.bucket.key && SUBSCRIPTION_BUCKETS.includes(r.bucket.key) && confidenceAtLeast(r.bucket.confidence, 'possible'))
      r.pattern = { cadence: found.cadence, occurrences: found.occurrences, kind: billLike ? 'obligation_like' : 'spending_pattern' }
    }
    r.repeatedPattern = r.unassigned && !!r.pattern
  }
  inScope.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
  return { rows: inScope, analytics: analyze(inScope, input.asOf, input.windowDays ?? 30), outOfScopeDates }
}

export function viewCounts(rows: ExplorerRow[]): Record<ExplorerView, number> {
  const out = Object.fromEntries(EXPLORER_VIEWS.map(v => [v, 0])) as Record<ExplorerView, number>
  for (const r of rows) for (const v of EXPLORER_VIEWS) if (inView(r, v)) out[v] += 1
  return out
}

export function inView(r: ExplorerRow, view: ExplorerView): boolean {
  switch (view) {
    // The owner's work list: everything not yet confirmed or excluded, money in and money out. Pending rows are listed (they can be categorized) but cannot be confirmed as relationships.
    case 'review_queue': return r.direction !== 'zero' && r.review !== 'confirmed' && r.review !== 'ignored'
    case 'known_bills': return r.direction === 'money_out' && ['obligation', 'debt', 'payroll'].includes(r.relationship.kind) && r.relationship.state !== 'none' && r.review !== 'ignored'
    case 'unassigned': return r.unassigned
    case 'repeated_spending': return r.repeatedPattern
    case 'needs_review': return r.direction === 'money_out' && r.review !== 'confirmed' && r.review !== 'ignored'
    default: return true
  }
}

export function filterRows(rows: ExplorerRow[], q: ExplorerQuery): ExplorerRow[] {
  const needle = (q.search ?? '').trim().toUpperCase()
  return rows.filter(r => {
    if (!inView(r, q.view ?? 'all')) return false
    if (q.includePending === false && r.pending) return false
    if (q.from && r.date < q.from) return false
    if (q.to && r.date > q.to) return false
    if (q.account && r.account.ref !== q.account) return false
    if (q.bucket && r.bucket.key !== q.bucket) return false
    if (q.scope && r.scope.value !== q.scope) return false
    if (q.review && r.review !== q.review) return false
    if (q.confidence && !(r.bucket.confidence === q.confidence || r.relationship.confidence === q.confidence)) return false
    if (q.project && !(r.relationship.kind === 'project' && r.relationship.target?.id === q.project)) return false
    if (q.minMinor !== undefined && Math.abs(r.amountMinor) < q.minMinor) return false
    if (q.maxMinor !== undefined && Math.abs(r.amountMinor) > q.maxMinor) return false
    if (needle && !`${r.name} ${r.merchant}`.toUpperCase().includes(needle)) return false
    return true
  })
}
