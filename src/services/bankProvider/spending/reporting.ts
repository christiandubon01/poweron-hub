/** BANK-6G: bank EVIDENCE reports, never canonical accounting. One row belongs to one reporting slot. */
import type { ExplorerRow } from './types'
import { categoryName, defaultHierarchy, type SpendingHierarchy } from './hierarchy'

export * from '../../../finance/bankSpendingReports'
import { REPORT_MODES, type ReportingPolicy, type ReportMode, type ReportScope, type ReportSlot, type SpendingReport } from '../../../finance/bankSpendingReports'
type ReportRow = ExplorerRow & { activity: string; reportParent: string; reportLeaf: string; unresolved: boolean }
const ACTIVITY_LABELS: Record<string, string> = { ignored: 'Ignored Activity', business: 'Business spending', personal: 'Personal & owner outflows', debt: 'Debt repayments', transfer: 'Transfers', refund: 'Refunds', income: 'Money in', unresolved: 'Unresolved / other money activity' }
type AmountRow = Pick<ExplorerRow, 'pending' | 'review' | 'removed' | 'amountMinor' | 'direction'>
const posted = (r: AmountRow) => !r.pending && r.review !== 'ignored' && !r.removed
export function activityOf(r: ExplorerRow): string {
  if (r.review === 'ignored') return 'ignored'
  const rel = r.relationship, key = r.bucket.state === 'confirmed' ? r.bucket.key : null
  if (rel.state === 'confirmed' && rel.kind === 'transfer' && rel.target?.type === 'counterpart_tx') return 'transfer'
  // A category or an unpaired transfer decision is not proof of an INTERNAL relationship.
  if (key === 'transfers' || rel.kind === 'transfer' && rel.state !== 'none') return 'unresolved'
  if (rel.state === 'confirmed' && rel.kind === 'debt') return 'debt'
  if (r.direction === 'money_out' && (r.scope.value === 'personal' || key === 'owner_draw')) return 'personal'
  if (r.direction === 'money_in') return key === 'refund' ? 'refund' : 'income'
  // A proposed debt/transfer is unresolved movement, never ordinary operating expense.
  if (rel.state === 'suggested' && ['debt', 'transfer'].includes(rel.kind)) return 'unresolved'
  if (r.direction === 'money_out' && r.scope.value === 'business') return 'business'
  return 'unresolved'
}
export function buildSpendingReport(input: Array<ExplorerRow & { removed?: boolean }>, mode: ReportMode, scope: ReportScope, policy: ReportingPolicy, coverage: SpendingReport['coverage'], hierarchy = defaultHierarchy()): SpendingReport {
  const result: SpendingReport = { mode, scope, hierarchy, coverage, summary: null, groups: [], rows: [] }
  // Duplicate IDs indicate unstable coverage. Never deduplicate evidence silently or claim exact totals.
  if (new Set(input.map(r => r.id)).size !== input.length) result.coverage = { complete: false, reason: 'Evidence changed during pagination. Refresh before reporting.' }
  if (input.some(r => !Number.isSafeInteger(r.amountMinor))) result.coverage = { complete: false, reason: 'Evidence has an unsupported amount. Totals are unavailable.' }
  if (!result.coverage.complete) return result
  const monetary = (r: AmountRow) => !r.pending && !r.removed &&
    (r.review !== 'ignored' || mode === 'all_money' && policy.ignoredCashMovement === 'include')
  const slots = new Map<string, ReportSlot>()
  const slot = (key: string, label: string, color: string | null = null): ReportSlot => ({ key, label, color, count: 0, postedCount: 0, outMinor: 0, inMinor: 0, children: [] })
  const add = (s: ReportSlot, r: ReportRow) => {
    s.count++; if (!monetary(r)) return; s.postedCount++;
    if (r.direction === 'money_out') s.outMinor += r.amountMinor
    if (r.direction === 'money_in') s.inMinor += Math.abs(r.amountMinor)
  }
  for (const original of input) {
    if (original.date < scope.from || original.date > scope.to || original.account.environment !== scope.environment || scope.account && original.account.ref !== scope.account || scope.accounts === 'mapped' && !original.account.mapped) continue
    const activity = activityOf(original)
    if (mode === 'business' && (!posted(original) || activity !== 'business')) continue
    if (mode === 'unassigned' && (!original.unassigned || !posted(original))) continue
    const confirmed = original.bucket.state === 'confirmed'
    const key = mode === 'unassigned' || confirmed ? original.bucket.key : null
    const unclassified = !key || key === 'other_needs_review'
    const cat = hierarchy.categories.find(c => c.key === key)
    const parent = hierarchy.parents.find(p => p.key === cat?.parentKey)
    const parentKey = mode === 'all_money' ? activity : unclassified ? '__unclassified' : parent?.key ?? '__no_parent'
    const parentLabel = mode === 'all_money' ? ACTIVITY_LABELS[activity] : unclassified ? 'Not classified' : parent?.name ?? 'No parent assigned'
    const leafKey = activity === 'ignored' ? '__ignored' : unclassified ? '__unclassified' : key!
    const unresolved = activity !== 'ignored' && (activity === 'unresolved' || original.relationship.state === 'suggested' || original.relationship.state === 'none' || original.scope.value === 'unclear')
    const r: ReportRow = { ...original, activity, reportParent: parentKey, reportLeaf: leafKey, unresolved }
    result.rows.push(r)
    const p = slots.get(parentKey) ?? slot(parentKey, parentLabel, mode === 'all_money' ? null : parent?.color ?? null)
    slots.set(parentKey, p)
    const c = p.children.find(c => c.key === leafKey) ?? slot(leafKey, activity === 'ignored' ? 'Ignored Activity' : unclassified ? 'Not classified' : categoryName(key, hierarchy))
    if (!p.children.includes(c)) p.children.push(c)
    add(p, r); add(c, r)
  }
  result.groups = [...slots.values()].sort((a, b) => b.outMinor - a.outMinor || b.inMinor - a.inMinor || a.key.localeCompare(b.key))
  for (const p of result.groups) p.children.sort((a, b) => b.outMinor - a.outMinor || b.inMinor - a.inMinor)
  const rs = result.rows, live = rs.filter(monetary)
  const outMinor = result.groups.reduce((n, p) => n + p.outMinor, 0), inMinor = result.groups.reduce((n, p) => n + p.inMinor, 0)
  if (![outMinor, inMinor, inMinor - outMinor].every(Number.isSafeInteger)) return { ...result, coverage: { complete: false, reason: 'Totals exceed supported precision.' }, rows: [], groups: [], summary: null }
  const ignoredPosted = live.filter(r => r.review === 'ignored')
  result.summary = { count: rs.length, postedCount: live.length, outMinor, inMinor, netMovementMinor: inMinor - outMinor,
    ignoredPostedCount: ignoredPosted.length, ignoredOutMinor: ignoredPosted.filter(r => r.direction === 'money_out').reduce((n, r) => n + r.amountMinor, 0), ignoredInMinor: ignoredPosted.filter(r => r.direction === 'money_in').reduce((n, r) => n + Math.abs(r.amountMinor), 0),
    pendingCount: rs.filter(r => r.pending).length, ignoredCount: rs.filter(r => r.review === 'ignored').length, removedCount: rs.filter(r => r.removed).length, unresolvedCount: rs.filter(r => r.unresolved).length }
  return result
}
