/**
 * src/features/spending-explorer/useSpendingExplorer.ts
 *
 * Browser state for the Spending Explorer. Talks only to the authenticated plaid-spending function. It receives sanitized rows and
 * aggregates (names, amounts, labels) and never a token, credential, raw provider response or organization id.
 * PLAID TRANSACTION = EVIDENCE: nothing here changes a balance, the ledger or a report; the only writes are interpretation decisions.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { authedJsonHeaders } from '@/services/authedFetch'

const URL_BASE = '/.netlify/functions/plaid-spending'

export type ExplorerView = 'review_queue' | 'all' | 'known_bills' | 'unassigned' | 'repeated_spending' | 'needs_review'
export type Confidence = 'high' | 'possible' | 'low'
export interface Target { type: string | null; id: string | null; label: string | null }
export interface ExplorerRow {
  id: string; date: string; name: string; merchant: string; amountMinor: number; direction: 'money_out' | 'money_in' | 'zero'; pending: boolean
  account: { ref: string; label: string; mask: string | null; ownership: 'business' | 'personal' | null; mappedTo: string | null; mapped: boolean; environment: 'sandbox' | 'production' | null }
  bucket: { key: string | null; label: string | null; state: 'confirmed' | 'suggested' | 'none'; confidence: Confidence | null; reasons: string[] }
  relationship: { kind: string; label: string; target: Target | null; state: 'confirmed' | 'suggested' | 'none'; confidence: Confidence | null; reasons: string[] }
  review: 'suggested' | 'confirmed' | 'needs_review' | 'ignored'
  scope: { value: 'business' | 'personal' | 'unclear'; source: 'owner' | 'account' | 'none' }
  unassigned: boolean; repeatedPattern: boolean; pattern: { cadence: string; occurrences: number; kind: 'obligation_like' | 'spending_pattern' } | null
}
export interface BucketTotal { key: string; label: string; totalMinor: number; count: number; previousMinor: number; deltaMinor: number; merchants: number; repeatedMerchants: number }
export interface Analytics {
  asOf: string; windowDays: number
  unassigned: { totalMinor: number; count: number; previousMinor: number; deltaMinor: number; byBucket: BucketTotal[] }
  knownBills: { totalMinor: number; count: number; confirmedCount: number; suggestedCount: number }
  pending: { totalMinor: number; count: number }
  review: { needsReviewCount: number; repeatedPatternCount: number }
  unclassified: { totalMinor: number; count: number }
  observations: Array<{ id: string; basis: 'deterministic'; text: string }>
  suggestions: Array<{ id: string; basis: 'heuristic'; title: string; detail: string }>
}
export interface Options {
  buckets: Array<{ key: string; label: string; hint: string; flow?: 'in' | 'out' }>
  /** Server rule, shown so the browser can preselect: only these buckets can be approved in a batch (and only from a high-confidence suggestion). */
  batchBuckets?: string[]; maxBatch?: number
  accounts: Array<{ ref: string; label: string; mask: string | null }>
  obligations: Array<{ id: string; label: string; amountMinor: number }>
  commitments: Array<{ id: string; label: string; amountMinor: number; expectedDate: string }>
  debts: Array<{ id: string; label: string }>
  projects: Array<{ id: string; name: string }>
}
export type AccountScope = 'mapped' | 'all'
export interface ExplorerMeta { billCandidates: number; activeObligations: number; scheduledCommitments: number; evidenceRows: number; hiddenUnmapped: number; olderThanPeriod: number; periodFrom: string }
export interface ReviewCounts { reviewed: number; unreviewed: number; excluded: number }
export interface HistoryEntry { label: string; kind: string; status: string; source: string; decidedAt: string | null; undoneAt: string | null; undoReason: string | null; createdAt: string }
export interface BatchResult { confirmed: number; unchanged: number; skipped: number; results: Array<{ id: string; result: string; reason?: string }> }
export interface ExplorerData { draftScope?: string; reviewCounts?: ReviewCounts; asOf: string; accounts: AccountScope; environment?: 'sandbox' | 'production'; meta: ExplorerMeta; analytics: Analytics; viewCounts: Record<ExplorerView, number>; total: number; rows: ExplorerRow[]; options: Options }

export interface Filters {
  view: ExplorerView; accounts: AccountScope; days: 30 | 60 | 90; bucket: string; account: string; scope: string; review: string; confidence: string; project: string; search: string; min: string; max: string
}
export const DEFAULT_FILTERS: Filters = { view: 'review_queue', accounts: 'mapped', days: 90, bucket: '', account: '', scope: '', review: '', confidence: '', project: '', search: '', min: '', max: '' }

export type DecisionBody =
  | { action: 'set_bucket'; transactionId: string; bucket: string }
  | { action: 'set_relationship'; transactionId: string; kind: string; targetType?: string; targetId?: string }
  | { action: 'accept_suggestion' | 'reject_suggestion'; transactionId: string; dimension: 'bucket' | 'relationship' }
  | { action: 'undo'; transactionId: string; dimension: 'bucket' | 'relationship' | 'ignore' }
  | { action: 'ignore' | 'unignore'; transactionId: string }
  | { action: 'confirm_batch'; transactionIds: string[]; categoryOverrides?: Record<string, string> }

const isoDaysAgo = (asOf: string, days: number): string => new Date(Date.parse(`${asOf}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10)
const PAGE = 100

export function queryString(f: Filters, asOf: string | null, offset = 0): string {
  const p = new URLSearchParams({ view: f.view, limit: String(PAGE), offset: String(offset), accounts: f.accounts })
  if (asOf) p.set('from', isoDaysAgo(asOf, f.days))
  for (const k of ['bucket', 'account', 'scope', 'review', 'confidence', 'project', 'search'] as const) if (f[k]) p.set(k, f[k])
  const min = Number(f.min), max = Number(f.max)
  if (f.min.trim() && Number.isFinite(min) && min >= 0) p.set('minMinor', String(Math.round(min * 100)))
  if (f.max.trim() && Number.isFinite(max) && max >= 0) p.set('maxMinor', String(Math.round(max * 100)))
  return p.toString()
}

async function call(path: string, init: { method: 'GET' | 'POST'; body?: unknown }) {
  const res = await fetch(path, { method: init.method, headers: await authedJsonHeaders(), body: init.body === undefined ? undefined : JSON.stringify(init.body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(typeof data?.error === 'string' ? data.error : 'Request failed.'), { status: res.status })
  return data
}

/** `unavailable` = the caller may not review spending (or nothing is configured): the explorer renders nothing. */
export type ExplorerLoad = 'loading' | 'ready' | 'unavailable'

export function useSpendingExplorer() {
  const [load, setLoad] = useState<ExplorerLoad>('loading')
  const [data, setData] = useState<ExplorerData | null>(null)
  const [rows, setRows] = useState<ExplorerRow[]>([])
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const asOf = useRef<string | null>(null)
  const seq = useRef(0)

  const fetchPage = useCallback(async (f: Filters, offset: number) => {
    const mine = ++seq.current
    try {
      const out = await call(`${URL_BASE}?${queryString(f, asOf.current, offset)}`, { method: 'GET' }) as ExplorerData
      if (mine !== seq.current) return
      asOf.current = out.asOf
      setData(out); setRows(prev => offset === 0 ? out.rows : [...prev, ...out.rows]); setLoad('ready')
    } catch (error) {
      if (mine !== seq.current) return
      setLoad(prev => (prev === 'ready' ? 'ready' : 'unavailable'))
      if (load === 'ready') setMessage((error as Error).message)
    }
  }, [load])

  useEffect(() => {
    const t = setTimeout(() => { void fetchPage(filters, 0) }, filters.search ? 250 : 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters])

  const refresh = useCallback(() => fetchPage(filters, 0), [fetchPage, filters])
  const loadMore = useCallback(() => fetchPage(filters, rows.length), [fetchPage, filters, rows.length])
  /** One owner decision. Always followed by a fresh read: the server is the only source of truth for what is confirmed. */
  const decide = useCallback(async (body: DecisionBody) => {
    setBusy(true); setMessage(null)
    try { await call(URL_BASE, { method: 'POST', body }) } catch (error) { setMessage((error as Error).message) }
    finally { await fetchPage(filters, 0); setBusy(false) }
  }, [fetchPage, filters])
  /** Selected-batch approval. The SERVER decides which rows are eligible; the answer says how many were approved and why others were left for individual review. */
  const decideBatch = useCallback(async (transactionIds: string[], categoryOverrides?: Record<string, string>): Promise<BatchResult | null> => {
    setBusy(true); setMessage(null)
    try { return await call(URL_BASE, { method: 'POST', body: { action: 'confirm_batch', transactionIds, ...(categoryOverrides && Object.keys(categoryOverrides).length ? { categoryOverrides } : {}) } }) as BatchResult }
    catch (error) { setMessage((error as Error).message); return null }
    finally { await fetchPage(filters, 0); setBusy(false) }
  }, [fetchPage, filters])
  /** The audit trail of one transaction (read-only). */
  const loadHistory = useCallback(async (transactionId: string): Promise<HistoryEntry[]> => {
    const out = await call(`${URL_BASE}?history=${encodeURIComponent(transactionId)}`, { method: 'GET' })
    return Array.isArray(out.history) ? out.history : []
  }, [])
  const update = useCallback((patch: Partial<Filters>) => setFilters(f => ({ ...f, ...patch })), [])
  const reset = useCallback(() => setFilters(f => ({ ...DEFAULT_FILTERS, view: f.view })), [])
  return { load, data, rows, filters, update, reset, busy, message, decide, decideBatch, loadHistory, refresh, loadMore }
}
