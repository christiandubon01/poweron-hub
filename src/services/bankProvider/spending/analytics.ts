/**
 * src/services/spending/analytics.ts
 *
 * BANK-5 money-bleed analysis. PURE over explorer rows. Two kinds of output are kept deliberately apart:
 *   - OBSERVATIONS are deterministic arithmetic over posted evidence (totals, counts, deltas versus the previous period).
 *   - SUGGESTIONS are heuristics ("appears recurring", "looks like duplicates"), always labelled as such and always carrying the
 *     transactions they are based on. "Large" is never "wasteful": only the signals below ever raise a flag.
 * Pending evidence never enters a total; it is reported on its own. Nothing here changes any canonical financial truth.
 */
import { merchantKey } from './merchant'
import { BUCKETS, bucketLabel, isDiscretionary, type BucketKey } from './taxonomy'
import type { ExplorerRow } from './types'

export const addDays = (date: string, days: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
const gap = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
const money = (minor: number): string => `$${Math.round(Math.abs(minor) / 100).toLocaleString('en-US')}`

export interface RecurringPattern { merchantKey: string; label: string; cadence: 'weekly' | 'biweekly' | 'monthly'; occurrences: number; typicalAmountMinor: number; lastDate: string; confidence: 'high' | 'possible' }

const CADENCES: Array<{ cadence: RecurringPattern['cadence']; min: number; max: number }> = [
  { cadence: 'weekly', min: 5, max: 9 }, { cadence: 'biweekly', min: 12, max: 16 }, { cadence: 'monthly', min: 26, max: 35 },
]
const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2) }

/** Recurring = the same merchant, a regular gap, and a stable amount. Deterministic; thresholds are explicit. */
export function detectRecurring(rows: Array<Pick<ExplorerRow, 'id' | 'date' | 'amountMinor' | 'merchantKey' | 'merchant' | 'pending' | 'direction'>>): Map<string, RecurringPattern> {
  const groups = new Map<string, typeof rows>()
  for (const r of rows) {
    if (r.pending || r.direction !== 'money_out') continue
    groups.set(r.merchantKey, [...(groups.get(r.merchantKey) ?? []), r])
  }
  const out = new Map<string, RecurringPattern>()
  for (const [key, list] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (list.length < 2) continue
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
    const gaps = sorted.slice(1).map((r, i) => gap(sorted[i].date, r.date)).filter(g => g > 0)
    if (!gaps.length) continue
    const typical = median(sorted.map(r => r.amountMinor))
    const stable = sorted.filter(r => Math.abs(r.amountMinor - typical) <= Math.max(100, typical * 0.2)).length
    for (const c of CADENCES) {
      const fits = gaps.filter(g => g >= c.min && g <= c.max).length
      const ok3 = sorted.length >= 3 && fits >= Math.ceil(gaps.length * 0.66) && stable >= Math.ceil(sorted.length * 0.66)
      const ok2 = sorted.length === 2 && c.cadence === 'monthly' && fits === 1 && Math.abs(sorted[0].amountMinor - sorted[1].amountMinor) <= Math.max(100, typical * 0.05)
      if (ok3 || ok2) { out.set(key, { merchantKey: key, label: sorted[sorted.length - 1].merchant, cadence: c.cadence, occurrences: sorted.length, typicalAmountMinor: typical, lastDate: sorted[sorted.length - 1].date, confidence: ok3 ? 'high' : 'possible' }); break }
    }
  }
  return out
}

export interface BucketTotal { key: BucketKey; label: string; totalMinor: number; count: number; previousMinor: number; deltaMinor: number; confirmedMinor: number; suggestedMinor: number; merchants: number; recurringMerchants: number }
export interface Observation { id: string; basis: 'deterministic'; text: string; amountMinor: number | null; bucket: BucketKey | null; txIds: string[] }
export interface LeakSuggestion { id: string; basis: 'heuristic'; kind: 'possible_untracked_subscription' | 'duplicate_looking_recurring' | 'project_like_materials_unassigned' | 'bank_finance_fees' | 'growing_category' | 'repeated_unassigned_merchant'; title: string; detail: string; amountMinor: number; txIds: string[] }

export interface SpendingAnalytics {
  asOf: string
  windowDays: number
  unassigned: { totalMinor: number; count: number; previousMinor: number; deltaMinor: number; byBucket: BucketTotal[] }
  knownBills: { totalMinor: number; count: number; confirmedCount: number; suggestedCount: number }
  personal: { totalMinor: number; count: number }
  transfers: { totalMinor: number; count: number }
  pending: { totalMinor: number; count: number }
  review: { needsReviewCount: number; recurringUnknownCount: number }
  observations: Observation[]
  suggestions: LeakSuggestion[]
  /** Shaped for a future Outlook widget ("Money Bleeding - 30 days"); nothing consumes it yet. */
  moneyBleed: { windowDays: number; currentMinor: number; previousMinor: number; deltaMinor: number; topBuckets: Array<{ key: BucketKey; label: string; totalMinor: number }> }
}

const effBucket = (r: ExplorerRow): BucketKey => (r.bucket.key ?? 'other_needs_review') as BucketKey

export function analyze(rows: ExplorerRow[], asOf: string, windowDays = 30): SpendingAnalytics {
  const curStart = addDays(asOf, -(windowDays - 1)), prevStart = addDays(asOf, -(2 * windowDays - 1)), prevEnd = addDays(asOf, -windowDays)
  const posted = rows.filter(r => !r.pending && r.review !== 'ignored')
  const cur = (r: ExplorerRow) => r.date >= curStart && r.date <= asOf
  const prev = (r: ExplorerRow) => r.date >= prevStart && r.date <= prevEnd
  const outflow = posted.filter(r => r.direction === 'money_out')
  const leak = outflow.filter(r => r.unassigned)
  const sum = (xs: ExplorerRow[]) => xs.reduce((n, r) => n + r.amountMinor, 0)

  const byBucket = new Map<BucketKey, BucketTotal>()
  const slot = (key: BucketKey): BucketTotal => {
    let b = byBucket.get(key)
    if (!b) { b = { key, label: bucketLabel(key), totalMinor: 0, count: 0, previousMinor: 0, deltaMinor: 0, confirmedMinor: 0, suggestedMinor: 0, merchants: 0, recurringMerchants: 0 }; byBucket.set(key, b) }
    return b
  }
  const merchants = new Map<BucketKey, Set<string>>(), recurringM = new Map<BucketKey, Set<string>>()
  for (const r of leak.filter(cur)) {
    const k = effBucket(r), b = slot(k)
    b.totalMinor += r.amountMinor; b.count += 1
    if (r.bucket.state === 'confirmed') b.confirmedMinor += r.amountMinor; else b.suggestedMinor += r.amountMinor
    merchants.set(k, (merchants.get(k) ?? new Set()).add(r.merchantKey))
    if (r.recurringUnknown) recurringM.set(k, (recurringM.get(k) ?? new Set()).add(r.merchantKey))
  }
  for (const r of leak.filter(prev)) slot(effBucket(r)).previousMinor += r.amountMinor
  for (const b of byBucket.values()) { b.deltaMinor = b.totalMinor - b.previousMinor; b.merchants = merchants.get(b.key)?.size ?? 0; b.recurringMerchants = recurringM.get(b.key)?.size ?? 0 }
  const bucketRows = [...byBucket.values()].filter(b => b.totalMinor > 0 || b.previousMinor > 0).sort((a, b) => b.totalMinor - a.totalMinor || a.key.localeCompare(b.key))

  const leakCur = leak.filter(cur), leakPrev = leak.filter(prev)
  const known = outflow.filter(r => cur(r) && ['obligation', 'debt', 'payroll'].includes(r.relationship.kind) && r.relationship.state !== 'none')
  const personal = outflow.filter(r => cur(r) && r.scope.value === 'personal' && r.scope.source === 'owner')
  const transfers = posted.filter(r => cur(r) && r.relationship.kind === 'transfer' && r.relationship.state !== 'none' && r.direction === 'money_out')
  const pend = rows.filter(r => r.pending && r.direction === 'money_out')

  const observations: Observation[] = []
  for (const b of bucketRows.filter(x => x.totalMinor > 0)) {
    const d = b.deltaMinor
    observations.push({
      id: `bucket:${b.key}`, basis: 'deterministic', bucket: b.key, amountMinor: b.totalMinor,
      txIds: leakCur.filter(r => effBucket(r) === b.key).map(r => r.id).slice(0, 25),
      text: `${b.label} ${money(b.totalMinor)} in ${windowDays} days · ${b.merchants} merchant${b.merchants === 1 ? '' : 's'}${b.recurringMerchants ? ` · ${b.recurringMerchants} appear recurring` : ''}${b.previousMinor || d ? ` · ${d >= 0 ? '+' : '-'}${money(d)} vs previous ${windowDays} days` : ''}`,
    })
  }

  const suggestions: LeakSuggestion[] = []
  const recurringLeak = new Map<string, ExplorerRow[]>()
  for (const r of leakCur.filter(x => x.recurringUnknown)) recurringLeak.set(r.merchantKey, [...(recurringLeak.get(r.merchantKey) ?? []), r])
  for (const [key, list] of [...recurringLeak].sort((a, b) => a[0].localeCompare(b[0]))) {
    const p = list[0].recurring
    suggestions.push({ id: `sub:${key}`, basis: 'heuristic', kind: 'possible_untracked_subscription', amountMinor: sum(list), txIds: list.map(r => r.id).slice(0, 25),
      title: `Possible untracked recurring expense: ${list[0].merchant}`, detail: `${money(list[0].amountMinor)} ${p?.cadence ?? 'recurring'} pattern, not tied to any known bill.` })
  }
  const recurringBuckets = new Map<BucketKey, string[]>()
  for (const [key, list] of recurringLeak) recurringBuckets.set(effBucket(list[0]), [...(recurringBuckets.get(effBucket(list[0])) ?? []), key])
  for (const [bucket, keys] of [...recurringBuckets].sort((a, b) => a[0].localeCompare(b[0]))) {
    const sorted = keys.sort()
    for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length; j++) {
      const a = recurringLeak.get(sorted[i])![0], b = recurringLeak.get(sorted[j])![0]
      const similarName = sorted[i].split(' ')[0] === sorted[j].split(' ')[0]
      const similarAmount = Math.abs(a.amountMinor - b.amountMinor) <= Math.max(100, a.amountMinor * 0.05)
      if (similarName || similarAmount) suggestions.push({ id: `dup:${sorted[i]}|${sorted[j]}`, basis: 'heuristic', kind: 'duplicate_looking_recurring', amountMinor: a.amountMinor + b.amountMinor, txIds: [a.id, b.id],
        title: `Two recurring ${bucketLabel(bucket).toLowerCase()} charges look alike`, detail: `${a.merchant} and ${b.merchant} recur on a similar schedule${similarName ? ' with similar names' : ' for a similar amount'}. Confirm both are intended.` })
    }
  }
  const mats = leakCur.filter(r => effBucket(r) === 'materials')
  if (mats.length) suggestions.push({ id: 'materials-unassigned', basis: 'heuristic', kind: 'project_like_materials_unassigned', amountMinor: sum(mats), txIds: mats.map(r => r.id).slice(0, 25),
    title: `${money(sum(mats))} of material purchases are not assigned to a project`, detail: `${mats.length} purchase${mats.length === 1 ? '' : 's'} look like job materials. Assign each to a project, or mark it general overhead.` })
  const fees = leakCur.filter(r => effBucket(r) === 'bank_finance_fees')
  if (fees.length) suggestions.push({ id: 'bank-fees', basis: 'heuristic', kind: 'bank_finance_fees', amountMinor: sum(fees), txIds: fees.map(r => r.id).slice(0, 25), title: `${money(sum(fees))} in bank and finance fees`, detail: `${fees.length} fee${fees.length === 1 ? '' : 's'} in ${windowDays} days.` })
  for (const b of bucketRows) {
    if (!isDiscretionary(b.key)) continue
    // Growth needs a pattern, not one big purchase: at least two purchases this period, and either a real baseline that grew by 25%+ or three
    // purchases in a category that had none. A single large transaction is never flagged just for being large.
    const grew = b.count >= 2 && b.totalMinor >= 5000 && ((b.previousMinor > 0 && b.totalMinor >= b.previousMinor * 1.25) || (b.previousMinor === 0 && b.count >= 3 && b.totalMinor >= 10000))
    if (grew) suggestions.push({ id: `grow:${b.key}`, basis: 'heuristic', kind: 'growing_category', amountMinor: b.deltaMinor, txIds: leakCur.filter(r => effBucket(r) === b.key).map(r => r.id).slice(0, 25),
      title: `${b.label} is up ${money(b.deltaMinor)}`, detail: `${money(b.totalMinor)} this period versus ${money(b.previousMinor)} in the previous ${windowDays} days.` })
  }
  const perMerchant = new Map<string, ExplorerRow[]>()
  for (const r of leakCur) if (!r.recurringUnknown) perMerchant.set(r.merchantKey, [...(perMerchant.get(r.merchantKey) ?? []), r])
  for (const [key, list] of [...perMerchant].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (list.length >= 3) suggestions.push({ id: `rep:${key}`, basis: 'heuristic', kind: 'repeated_unassigned_merchant', amountMinor: sum(list), txIds: list.map(r => r.id).slice(0, 25),
      title: `${list[0].merchant}: ${list.length} unassigned purchases`, detail: `${money(sum(list))} in ${windowDays} days with nothing assigned. Review whether these belong to a project or a known bill.` })
  }

  const discretionaryCur = leakCur.filter(r => isDiscretionary(effBucket(r))), discretionaryPrev = leakPrev.filter(r => isDiscretionary(effBucket(r)))
  const topDiscretionary = new Map<BucketKey, number>()
  for (const r of discretionaryCur) topDiscretionary.set(effBucket(r), (topDiscretionary.get(effBucket(r)) ?? 0) + r.amountMinor)
  return {
    asOf, windowDays,
    unassigned: { totalMinor: sum(leakCur), count: leakCur.length, previousMinor: sum(leakPrev), deltaMinor: sum(leakCur) - sum(leakPrev), byBucket: bucketRows },
    knownBills: { totalMinor: sum(known), count: known.length, confirmedCount: known.filter(r => r.relationship.state === 'confirmed').length, suggestedCount: known.filter(r => r.relationship.state === 'suggested').length },
    personal: { totalMinor: sum(personal), count: personal.length },
    transfers: { totalMinor: sum(transfers), count: transfers.length },
    pending: { totalMinor: sum(pend), count: pend.length },
    review: { needsReviewCount: outflow.filter(r => r.review === 'needs_review' || r.review === 'suggested').length, recurringUnknownCount: leak.filter(r => r.recurringUnknown).length },
    observations, suggestions,
    moneyBleed: { windowDays, currentMinor: sum(discretionaryCur), previousMinor: sum(discretionaryPrev), deltaMinor: sum(discretionaryCur) - sum(discretionaryPrev),
      topBuckets: [...topDiscretionary].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 4).map(([key, totalMinor]) => ({ key, label: bucketLabel(key), totalMinor })) },
  }
}
export { BUCKETS, merchantKey }
