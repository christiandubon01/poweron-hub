/**
 * src/features/spending-explorer/useSmartReview.ts
 *
 * Browser state for Smart Review (BANK-6B). Talks only to the authenticated plaid-spending function. It receives sanitized groups and exceptions and
 * sends back transaction IDS, category CHOICES and "remember" marks. The merchant, the category that gets remembered and the eligibility of every row are
 * decided by the server. Nothing here is a decision until the owner confirms, and a decision labels bank evidence only.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { authedJsonHeaders } from '@/services/authedFetch'
import type { BatchResult, Confidence } from './useSpendingExplorer'

const URL_BASE = '/.netlify/functions/plaid-spending'

export type RowFlag = 'unusual_amount' | 'possible_duplicate' | 'history_conflict' | 'provider_disagrees'
export interface SmartRow { id: string; date: string; name: string; amountMinor: number; flags: RowFlag[] }
export interface SmartGroup {
  id: string; merchantKey: string; merchant: string; bucket: { key: string; label: string }; confidence: Confidence; basis: string | null
  needsChoice: boolean; mixed: boolean; count: number; totalMinor: number; flaggedCount: number; reasons: string[]; rows: SmartRow[]
}
export interface SmartException { id: string; date: string; name: string; merchant: string; amountMinor: number; direction: 'money_out' | 'money_in' | 'zero'; reason: string; why: string; suggested: { key: string | null; label: string | null; confidence: Confidence | null } }
export interface SmartExceptionGroup { reason: string; label: string; count: number; totalMinor: number; rows: SmartException[] }
export interface MerchantRuleView { merchantKey: string; label: string; category: string; categoryLabel: string }
export interface SmartData {
  asOf: string; accounts: 'mapped' | 'all'; environment?: string; groups: SmartGroup[]; exceptions: SmartExceptionGroup[]
  totals: { groupedCount: number; groupedMinor: number; groups: number; exceptionCount: number }
  rulesAvailable: boolean; maxBatch: number; merchantRules: MerchantRuleView[]; draftScope: string
  options: { buckets: Array<{ key: string; label: string; hint: string; flow?: 'in' | 'out' }>; batchBuckets: string[] }
}
export interface SmartBatchResult extends BatchResult { rules?: { saved: Array<{ merchantKey: string; label: string; category: string }>; skipped: Array<{ merchantKey: string; reason: string }> } }

async function call(path: string, init: { method: 'GET' | 'POST'; body?: unknown }) {
  const res = await fetch(path, { method: init.method, headers: await authedJsonHeaders(), body: init.body === undefined ? undefined : JSON.stringify(init.body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(typeof data?.error === 'string' ? data.error : 'Request failed.'), { status: res.status })
  return data
}

export function useSmartReview() {
  const [data, setData] = useState<SmartData | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const seq = useRef(0)
  const fetchAll = useCallback(async () => {
    const mine = ++seq.current
    try {
      const out = await call(`${URL_BASE}?smart=1&accounts=mapped`, { method: 'GET' }) as SmartData
      if (mine !== seq.current) return
      setData(out); setState('ready')
    } catch (error) {
      if (mine !== seq.current) return
      setState(prev => (prev === 'ready' ? 'ready' : 'error')); setMessage((error as Error).message)
    }
  }, [])
  useEffect(() => { void fetchAll() }, [fetchAll])

  /** Approve the selection. The server re-decides every row; the answer says what was approved, what was left, and which merchants were remembered. */
  const approve = useCallback(async (transactionIds: string[], categoryOverrides: Record<string, string>, rememberTransactionIds: string[]): Promise<SmartBatchResult | null> => {
    setBusy(true); setMessage(null)
    try {
      return await call(URL_BASE, { method: 'POST', body: { action: 'confirm_batch', transactionIds, ...(Object.keys(categoryOverrides).length ? { categoryOverrides } : {}), ...(rememberTransactionIds.length ? { rememberTransactionIds } : {}) } }) as SmartBatchResult
    } catch (error) { setMessage((error as Error).message); return null } finally { await fetchAll(); setBusy(false) }
  }, [fetchAll])
  const forget = useCallback(async (merchantKey: string) => {
    setBusy(true); setMessage(null)
    try { await call(URL_BASE, { method: 'POST', body: { action: 'forget_rule', merchantKey } }) } catch (error) { setMessage((error as Error).message) } finally { await fetchAll(); setBusy(false) }
  }, [fetchAll])
  /** One individual decision for an exception row (the existing set_bucket action). */
  const setBucket = useCallback(async (transactionId: string, bucket: string) => {
    setBusy(true); setMessage(null)
    try { await call(URL_BASE, { method: 'POST', body: { action: 'set_bucket', transactionId, bucket } }) } catch (error) { setMessage((error as Error).message) } finally { await fetchAll(); setBusy(false) }
  }, [fetchAll])
  return { data, state, busy, message, approve, forget, setBucket, refresh: fetchAll }
}
