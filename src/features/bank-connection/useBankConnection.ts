/**
 * src/features/bank-connection/useBankConnection.ts
 *
 * Browser state for the sandbox bank connection card. Talks only to the authenticated Netlify functions; receives only
 * SANITIZED data (no token, no cursor, no provider response). Connecting a bank has no effect on any Cash OS number.
 */
import { useCallback, useEffect, useState } from 'react'
import { authedJsonHeaders } from '@/services/authedFetch'
import { openPlaidLink } from './plaidLink'

const BASE = '/.netlify/functions'

export interface BankConnectionSummary {
  id: string
  provider: string
  status: 'connecting' | 'healthy' | 'login_required' | 'error' | 'disconnected'
  institutionName: string | null
  connectedAt: string | null
  disconnectedAt: string | null
  lastSuccessfulSyncAt: string | null
}

/** `unavailable` = the caller may not manage bank connections (or it is not configured); the card renders nothing. */
export type BankConnectionLoad = 'loading' | 'ready' | 'unavailable'

async function request(path: string, init: { method: 'GET' | 'POST'; body?: unknown }) {
  const res = await fetch(`${BASE}/${path}`, { method: init.method, headers: await authedJsonHeaders(), body: init.body === undefined ? undefined : JSON.stringify(init.body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(typeof data?.error === 'string' ? data.error : 'Request failed.'), { status: res.status })
  return data
}

export function useBankConnection() {
  const [load, setLoad] = useState<BankConnectionLoad>('loading')
  const [connections, setConnections] = useState<BankConnectionSummary[]>([])
  const [environment, setEnvironment] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const data = await request('plaid-connection-status', { method: 'GET' })
      setConnections(Array.isArray(data.connections) ? data.connections : [])
      setEnvironment(typeof data.environment === 'string' ? data.environment : null)
      setLoad('ready')
    } catch {
      setLoad('unavailable')
    }
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  const runLink = useCallback(async (body: Record<string, unknown>, onDone: (publicToken: string) => Promise<void>) => {
    setBusy(true); setMessage(null)
    try {
      const { linkToken } = await request('plaid-link-token', { method: 'POST', body })
      await openPlaidLink({
        linkToken,
        onSuccess: async publicToken => {
          try { await onDone(publicToken); await refresh() } catch (error) { setMessage((error as Error).message) } finally { setBusy(false) }
        },
        onExit: () => setBusy(false),
      })
    } catch (error) {
      setMessage((error as Error).message || 'Could not start the bank connection.')
      setBusy(false)
    }
  }, [refresh])

  /** New connection. The public token goes straight to the server and is not kept. */
  const connect = useCallback(() => runLink({}, publicToken => request('plaid-exchange', { method: 'POST', body: { publicToken } })), [runLink])
  /** Re-authentication of an existing connection (no new Item). */
  const reconnect = useCallback((itemId: string) => runLink({ mode: 'update', itemId }, () => request('plaid-exchange', { method: 'POST', body: { mode: 'update_complete', itemId } })), [runLink])
  const disconnect = useCallback(async (itemId: string) => {
    setBusy(true); setMessage(null)
    try { await request('plaid-disconnect', { method: 'POST', body: { itemId } }); await refresh() }
    catch (error) { setMessage((error as Error).message) }
    finally { setBusy(false) }
  }, [refresh])

  return { load, connections, environment, busy, message, connect, reconnect, disconnect, refresh }
}
