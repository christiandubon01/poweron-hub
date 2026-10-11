/**
 * src/features/spending-explorer/useMatchReview.ts
 *
 * Browser state for the Matches review (PLAID-3B). Talks only to the authenticated plaid-spending function. It receives sanitized proposals (account names,
 * dates, amounts, reasons) and sends back TWO transaction ids and the evidence fingerprint the owner was shown. Whether a pair is valid, what kind it is and
 * whether the evidence is still what the owner saw is decided by the server, which also re-checks the caller's organization and role on every request.
 * A decision labels bank evidence only; nothing here changes a balance, the ledger or any account.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { authedJsonHeaders } from '@/services/authedFetch'
import type { DecisionBody } from './useSpendingExplorer'
import type { AmbiguousGroup, MatchCounts, MatchItem, RefundMatch } from '@/finance/bankMatchReview'

export type { AmbiguousGroup, MatchCounts, MatchItem, RefundMatch }
export type MatchTab = 'review' | 'confirmed' | 'rejected' | 'all'
export interface MatchData {
  enabled: boolean
  /** The reviewed SQL is installed, so decisions can be recorded. False = read-only. */
  decisionsAvailable: boolean
  asOf?: string
  window?: { from: string; to: string }
  environment?: string
  coverage?: { complete: boolean; reason: string | null }
  tab?: MatchTab
  counts?: MatchCounts
  total?: number
  items?: MatchItem[]
  groups?: AmbiguousGroup[]
  refunds?: RefundMatch[]
  contract?: string
}
export type MatchLoad = 'loading' | 'ready' | 'disabled' | 'error'
export type MatchOutcome = 'confirmed' | 'rejected' | 'reversed' | 'unchanged' | 'nothing_to_reverse'
export interface PairRequest { outflowId: string; inflowId: string; fingerprint?: string | null }

const URL_BASE = '/.netlify/functions/plaid-spending'
const PAGE = 50

async function call(path: string, init: { method: 'GET' | 'POST'; body?: unknown }) {
  const res = await fetch(path, { method: init.method, headers: await authedJsonHeaders(), body: init.body === undefined ? undefined : JSON.stringify(init.body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(typeof data?.error === 'string' ? data.error : 'Request failed.'), { status: res.status, code: typeof data?.code === 'string' ? data.code : undefined })
  return data
}

const OUTCOME_TEXT: Record<MatchOutcome, string> = {
  confirmed: 'Match confirmed. The two transactions now count as one movement between your own accounts.',
  rejected: 'Marked as not a match. It will not be suggested again unless the evidence changes.',
  reversed: 'Match reversed. The two transactions are undecided again.',
  unchanged: 'Nothing changed: you had already decided this.',
  nothing_to_reverse: 'There was nothing to reverse: this match is not confirmed.',
}

export function useMatchReview(enabled: boolean) {
  const [data, setData] = useState<MatchData | null>(null)
  const [items, setItems] = useState<MatchItem[]>([])
  const [load, setLoad] = useState<MatchLoad>('loading')
  const [tab, setTabState] = useState<MatchTab>('review')
  /** The key of the item being decided (or 'other'): every action is disabled while one request is in flight, so a double tap cannot send two. */
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const seq = useRef(0)
  const inflight = useRef(false)

  const fetchPage = useCallback(async (t: MatchTab, offset: number) => {
    const mine = ++seq.current
    try {
      const out = await call(`${URL_BASE}?matches=1&tab=${t}&limit=${PAGE}&offset=${offset}`, { method: 'GET' }) as MatchData
      if (mine !== seq.current) return
      if (out.enabled !== true) { setLoad('disabled'); setData(out); setItems([]); return }
      setData(out); setItems(prev => (offset === 0 ? out.items ?? [] : [...prev, ...(out.items ?? [])])); setLoad('ready')
    } catch (error) {
      if (mine !== seq.current) return
      const status = (error as { status?: number }).status
      if (status === 403 || status === 404) { setLoad('disabled'); return }
      setLoad(prev => (prev === 'ready' ? 'ready' : 'error'))
      setMessage({ kind: 'error', text: (error as Error).message })
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    void fetchPage(tab, 0)
  }, [enabled, tab, fetchPage])

  const setTab = useCallback((t: MatchTab) => { setMessage(null); setTabState(t) }, [])
  const refresh = useCallback(() => fetchPage(tab, 0), [fetchPage, tab])
  const loadMore = useCallback(() => fetchPage(tab, items.length), [fetchPage, tab, items.length])

  /** One request at a time. Always followed by a fresh read: the server is the only source of truth for what is decided. */
  const run = useCallback(async (key: string, send: () => Promise<string>) => {
    if (inflight.current) return
    inflight.current = true; setBusy(key); setMessage(null)
    try { setMessage({ kind: 'ok', text: await send() }) }
    catch (error) { setMessage({ kind: 'error', text: (error as Error).message }) }
    finally { await fetchPage(tab, 0); inflight.current = false; setBusy(null) }
  }, [fetchPage, tab])

  /** confirm / reject / reverse one pair. The fingerprint is the evidence the owner was shown; the server rejects the decision if it no longer matches. */
  const decide = useCallback((key: string, decision: 'confirm' | 'reject' | 'reverse', pair: PairRequest) => run(key, async () => {
    const out = await call(URL_BASE, { method: 'POST', body: { action: `match_${decision}`, outflowId: pair.outflowId, inflowId: pair.inflowId, ...(decision === 'reverse' ? {} : { fingerprint: pair.fingerprint }) } })
    return OUTCOME_TEXT[out?.outcome as MatchOutcome] ?? 'Saved.'
  }), [run])

  /** A refund is decided through the existing category decisions (the same endpoint and rules as the Explorer). */
  const decideRefund = useCallback((key: string, body: DecisionBody, done: string) => run(key, async () => { await call(URL_BASE, { method: 'POST', body }); return done }), [run])

  return { data, items, load, tab, setTab, busy, message, dismissMessage: () => setMessage(null), decide, decideRefund, refresh, loadMore }
}
