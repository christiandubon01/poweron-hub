/**
 * src/services/spending/smartReview.ts
 *
 * BANK-6B: the Smart Review view. PURE: it only REGROUPS rows the explorer already built. It decides nothing, persists nothing, and every
 * transaction stays individually visible (a group is a lens over rows, never a hiding place). Eligibility is recomputed by the server on every
 * request and again, independently, when the owner approves (confirmBatch); nothing here is trusted by the browser or by the approval.
 *
 *   GROUP      = unreviewed, posted, money-out transactions of ONE normalized merchant that share ONE suggested everyday category.
 *   EXCEPTION  = everything else the owner has not reviewed (money in, owner draws / personal, payroll, transfers, bills / projects / debt,
 *                pending, unclear). Exceptions are never offered for bulk approval.
 *   FLAG       = a reason one transaction inside a group deserves a look (unusual amount, possible duplicate, contradicts the owner's earlier
 *                decisions, or contradicts the bank's own category). Flagged rows are shown, marked, and are not selected by "select group".
 */
import { providerBucketOf } from './classifier'
import { BATCH_APPROVABLE_BUCKETS, bucketLabel, type BucketKey, type Confidence } from './taxonomy'
import type { EvidenceTx, ExplorerRow } from './types'

export type RowFlag = 'unusual_amount' | 'possible_duplicate' | 'history_conflict' | 'provider_disagrees'
export type ExceptionReason = 'money_in' | 'owner_or_personal' | 'payroll' | 'transfer' | 'bill_or_project' | 'pending' | 'unclear'

export interface SmartRow { id: string; date: string; name: string; amountMinor: number; flags: RowFlag[] }
export interface SmartGroup {
  id: string
  merchantKey: string
  merchant: string
  bucket: { key: BucketKey; label: string }
  confidence: Confidence
  /** 'owner_rule' = the owner remembered this category for the merchant; otherwise a computed suggestion. */
  basis: string | null
  /** Needs the owner to pick the category before it can be approved (mixed-purpose merchant, or not a high-confidence suggestion). */
  needsChoice: boolean
  mixed: boolean
  count: number
  totalMinor: number
  flaggedCount: number
  reasons: string[]
  rows: SmartRow[]
}
export interface SmartException {
  id: string; date: string; name: string; merchant: string; amountMinor: number; direction: ExplorerRow['direction']
  reason: ExceptionReason; why: string; suggested: { key: BucketKey | null; label: string | null; confidence: Confidence | null }
}

export const EXCEPTION_LABELS: Record<ExceptionReason, string> = {
  money_in: 'Money in (deposits, customer payments, refunds)', owner_or_personal: 'Owner draws and personal', payroll: 'Payroll and people', transfer: 'Transfers',
  bill_or_project: 'Bills, debt and projects', pending: 'Still pending', unclear: 'Unclear merchant or weak match',
}
const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2) }
export const MAX_EXCEPTIONS_PER_REASON = 100

function exceptionOf(r: ExplorerRow): { reason: ExceptionReason; why: string } | null {
  if (r.pending) return { reason: 'pending', why: 'Pending transactions can change. Approve them after they post.' }
  if (r.direction !== 'money_out') return { reason: 'money_in', why: 'Money coming in is always your individual decision.' }
  const key = r.bucket.key
  if (r.relationship.state === 'suggested') {
    if (r.relationship.kind === 'payroll') return { reason: 'payroll', why: 'Looks like payroll. Decide it individually.' }
    if (r.relationship.kind === 'transfer') return { reason: 'transfer', why: 'Looks like a movement between accounts.' }
    return { reason: 'bill_or_project', why: 'It may belong to a bill, debt or project. Decide it individually.' }
  }
  if (r.bucket.state === 'suggested') {
    if (key === 'owner_draw' || key === 'personal_owner') return { reason: 'owner_or_personal', why: 'Owner draws and personal spending are your individual decision.' }
    if (key === 'payroll_people') return { reason: 'payroll', why: 'Payroll is your individual decision.' }
    if (key === 'transfers') return { reason: 'transfer', why: 'Transfers are your individual decision.' }
    if (key && BATCH_APPROVABLE_BUCKETS.includes(key) && r.bucket.confidence !== 'low') return null // a group member
  }
  return { reason: 'unclear', why: r.bucket.state === 'suggested' ? 'The match is weak. Pick the category yourself.' : 'Nothing recognised this merchant yet.' }
}

export function buildSmartReview(rows: ExplorerRow[], txs: EvidenceTx[], opts: { activeRuleKeys?: Set<string> } = {}) {
  const tx = new Map(txs.map(t => [t.id, t]))
  const open = rows.filter(r => r.review !== 'ignored' && r.bucket.state !== 'confirmed' && r.relationship.state !== 'confirmed')
  // The owner's earlier confirmed decisions per merchant: a new suggestion that contradicts them is flagged, never silently preferred.
  const decided = new Map<string, Set<string>>()
  for (const r of rows) if (r.bucket.state === 'confirmed' && r.bucket.key) decided.set(r.merchantKey, new Set([...(decided.get(r.merchantKey) ?? []), r.bucket.key]))

  const byGroup = new Map<string, ExplorerRow[]>()
  const exceptions = new Map<ExceptionReason, SmartException[]>()
  const exceptionTotals = new Map<ExceptionReason, { count: number; totalMinor: number }>()
  for (const r of open) {
    const ex = exceptionOf(r)
    if (ex) {
      const list = exceptions.get(ex.reason) ?? []
      const t = exceptionTotals.get(ex.reason) ?? { count: 0, totalMinor: 0 }
      t.count += 1; t.totalMinor += Math.abs(r.amountMinor); exceptionTotals.set(ex.reason, t)
      if (list.length < MAX_EXCEPTIONS_PER_REASON) list.push({ id: r.id, date: r.date, name: r.name, merchant: r.merchant, amountMinor: r.amountMinor, direction: r.direction, reason: ex.reason, why: ex.why, suggested: { key: r.bucket.state === 'suggested' ? r.bucket.key : null, label: r.bucket.state === 'suggested' ? r.bucket.label : null, confidence: r.bucket.confidence } })
      exceptions.set(ex.reason, list)
      continue
    }
    const gid = `${r.merchantKey}|${r.bucket.key}`
    byGroup.set(gid, [...(byGroup.get(gid) ?? []), r])
  }

  const groups: SmartGroup[] = []
  for (const [gid, members] of byGroup) {
    const first = members[0]
    const bucketKey = first.bucket.key as BucketKey
    const amounts = members.map(m => m.amountMinor)
    const med = median(amounts)
    const dupKey = (m: ExplorerRow) => `${m.date}|${m.amountMinor}`
    const dupCount = new Map<string, number>()
    for (const m of members) dupCount.set(dupKey(m), (dupCount.get(dupKey(m)) ?? 0) + 1)
    const earlier = decided.get(first.merchantKey)
    const smartRows: SmartRow[] = members.map(m => {
      const flags: RowFlag[] = []
      if (members.length >= 3 && m.amountMinor >= med * 3 && m.amountMinor - med >= 5000) flags.push('unusual_amount')
      if ((dupCount.get(dupKey(m)) ?? 0) > 1) flags.push('possible_duplicate')
      if (earlier && [...earlier].some(k => k !== bucketKey)) flags.push('history_conflict')
      const evidence = tx.get(m.id)
      const provider = evidence ? providerBucketOf(evidence) : null
      if (provider && provider !== bucketKey && m.bucket.basis !== 'owner_rule') flags.push('provider_disagrees')
      return { id: m.id, date: m.date, name: m.name, amountMinor: m.amountMinor, flags }
    }).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
    const confidences = members.map(m => m.bucket.confidence ?? 'low')
    const confidence: Confidence = confidences.includes('low') ? 'low' : confidences.includes('possible') ? 'possible' : 'high'
    const allRule = members.every(m => m.bucket.basis === 'owner_rule')
    const mixed = members.some(m => m.bucket.mixed) // a remembered rule prefills the category but never removes the owner's explicit confirmation
    groups.push({
      id: gid, merchantKey: first.merchantKey, merchant: first.merchant, bucket: { key: bucketKey, label: bucketLabel(bucketKey) }, confidence,
      basis: allRule ? 'owner_rule' : (first.bucket.basis ?? null), needsChoice: mixed || confidence !== 'high', mixed,
      count: members.length, totalMinor: amounts.reduce((a, b) => a + b, 0), flaggedCount: smartRows.filter(x => x.flags.length).length,
      reasons: first.bucket.reasons.slice(0, 2), rows: smartRows,
    })
  }
  groups.sort((a, b) => b.totalMinor - a.totalMinor || a.merchantKey.localeCompare(b.merchantKey) || a.bucket.key.localeCompare(b.bucket.key))
  const order: ExceptionReason[] = ['unclear', 'owner_or_personal', 'payroll', 'transfer', 'bill_or_project', 'money_in', 'pending']
  return {
    groups,
    exceptions: order.filter(k => exceptionTotals.has(k)).map(k => ({ reason: k, label: EXCEPTION_LABELS[k], ...exceptionTotals.get(k)!, rows: exceptions.get(k) ?? [] })),
    totals: { groupedCount: groups.reduce((s, g) => s + g.count, 0), groupedMinor: groups.reduce((s, g) => s + g.totalMinor, 0), groups: groups.length, exceptionCount: [...exceptionTotals.values()].reduce((s, t) => s + t.count, 0) },
    activeRuleKeys: [...(opts.activeRuleKeys ?? [])],
  }
}
