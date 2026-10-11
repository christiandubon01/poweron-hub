/**
 * src/features/cash-position/usePosition.ts
 *
 * Browser state for the consolidated cash position (PLAID-3C). Talks only to the authenticated plaid-position function, which answers { enabled: false } until the
 * server switch is on and refuses anyone who is not an owner or admin. The browser sends nothing but the window length; the organization, role and environment
 * are the server's. It receives sanitized figures (no token, no provider id, no organization id) and never writes anything.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { authedJsonHeaders } from '@/services/authedFetch'
import type { ConsolidatedPositionData, PositionResponse } from '@/finance/bankPosition'

export type PositionDays = 30 | 60 | 90
/** `off` = nothing to show: switched off, not an owner/admin, or the first load failed. The panel renders nothing. */
export type PositionLoad = 'loading' | 'ready' | 'off'

export function usePosition() {
  const [days, setDaysState] = useState<PositionDays>(30)
  const [data, setData] = useState<ConsolidatedPositionData | null>(null)
  const [load, setLoad] = useState<PositionLoad>('loading')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)

  const fetchPosition = useCallback(async (d: PositionDays) => {
    const mine = ++seq.current
    setBusy(true)
    try {
      const res = await fetch(`/.netlify/functions/plaid-position?days=${d}`, { method: 'GET', headers: await authedJsonHeaders() })
      if (mine !== seq.current) return
      if (res.status === 401 || res.status === 403 || res.status === 404) { setLoad('off'); setData(null); return }
      const body = await res.json().catch(() => ({})) as PositionResponse & { error?: string }
      if (!res.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'The cash position could not be loaded.')
      if (!body || (body as { enabled?: boolean }).enabled !== true) { setLoad('off'); setData(null); return }
      setData(body as ConsolidatedPositionData); setLoad('ready'); setError(null)
    } catch (e) {
      if (mine !== seq.current) return
      setError((e as Error).message || 'The cash position could not be loaded.')
      // A failed REFRESH keeps the last good figures and says so. A failed FIRST load shows nothing: with the feature off (the default) the screen must stay exactly as it
      // was, and an error is never allowed to stand in for a figure.
      setLoad(prev => (prev === 'ready' ? 'ready' : 'off'))
    } finally {
      if (mine === seq.current) setBusy(false)
    }
  }, [])

  useEffect(() => { void fetchPosition(days) }, [days, fetchPosition])
  const setDays = useCallback((d: PositionDays) => setDaysState(d), [])
  const refresh = useCallback(() => fetchPosition(days), [days, fetchPosition])
  return { data, load, days, setDays, busy, error, refresh }
}
