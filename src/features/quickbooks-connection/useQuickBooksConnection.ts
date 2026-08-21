/**
 * src/features/quickbooks-connection/useQuickBooksConnection.ts
 *
 * QBO-3A — browser-side QuickBooks connection state for the global menu.
 *
 * Lives OUTSIDE src/features/billing-draft so the QBO-2D firewall rule that the
 * billing-draft writer makes no network call (no `fetch(` in billing-draft `.ts`)
 * stays intact. The billing-draft feature remains pure/presentational; this hook
 * is the connection-plumbing layer that drives the QuickBooks ▾ menu.
 *
 * Fetches SANITIZED status only (no realmId, no tokens, no encrypted blobs) from
 * qbo-connection-status, drives the same-tab OAuth connect redirect through
 * qbo-authorize, and performs disconnect through qbo-disconnect. The browser
 * never sees a token, refresh token, realmId, authorization code, or client
 * secret — only the sanitized status shape and the sanitized ?qbo= callback
 * signal.
 *
 * Connection is NOT required for billing preparation: Prepare Invoice, Invoice
 * Drafts, and Import QuickBooks PDF remain available regardless of status. This
 * hook does not gate any billing action.
 */
import { useCallback, useEffect, useState } from 'react'

import { authedJsonHeaders } from '@/services/authedFetch'
import type { QuickBooksConnectionStatus } from '@/features/billing-draft/components/QuickBooksMenu'

// QBO-3A-RUN-2: Netlify does not route nested files as
// /.netlify/functions/quickbooks/<file>; the registered endpoints are the
// top-level entry points in netlify/functions/qbo-*.ts, which delegate to the
// secure handlers under netlify/functions/quickbooks/. The browser must hit the
// registered top-level names below — never the nested path.
const STATUS_URL = '/.netlify/functions/qbo-connection-status'
const AUTHORIZE_URL = '/.netlify/functions/qbo-authorize'
const DISCONNECT_URL = '/.netlify/functions/qbo-disconnect'

export type QboCallbackSignal = 'connected' | 'cancelled' | 'error'

export interface QuickBooksConnection {
  /** Sanitized status, or null until first load completes. */
  readonly status: QuickBooksConnectionStatus | null
  /** Sanitized ?qbo= callback signal read on mount (then cleared). */
  readonly callbackSignal: QboCallbackSignal | null
  readonly accountOpen: boolean
  readonly disconnecting: boolean
  readonly connecting: boolean
  readonly disconnectError: string | null
  readonly refresh: () => Promise<void>
  readonly connect: () => Promise<void>
  readonly disconnect: () => Promise<void>
  readonly openAccount: () => void
  readonly closeAccount: () => void
  readonly clearCallbackSignal: () => void
}

/** Read & strip the sanitized ?qbo= signal from the URL on mount. */
function readCallbackSignal(): QboCallbackSignal | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const qbo = params.get('qbo')
    if (qbo === 'connected' || qbo === 'cancelled' || qbo === 'error') {
      params.delete('qbo')
      const search = params.toString()
      const cleanUrl = `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`
      window.history.replaceState({}, '', cleanUrl)
      return qbo
    }
  } catch {
    /* ignore — URL manipulation must never break the menu */
  }
  return null
}

export function useQuickBooksConnection(): QuickBooksConnection {
  const [status, setStatus] = useState<QuickBooksConnectionStatus | null>(null)
  const [callbackSignal, setCallbackSignal] = useState<QboCallbackSignal | null>(null)
  const [accountOpen, setAccountOpen] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [disconnectError, setDisconnectError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(STATUS_URL, { method: 'GET', headers: await authedJsonHeaders() })
      if (res.ok) {
        const data = await res.json()
        // QBO-3A-RUN-3: propagate the server-reported connectedAt timestamp so
        // the QuickBooks Account modal can render it. Never fabricated locally.
        setStatus({
          connected: !!data?.connected,
          companyName: data?.companyName ?? null,
          connectedAt: typeof data?.connectedAt === 'string' ? data.connectedAt : null,
        })
      } else {
        setStatus({ connected: false })
      }
    } catch {
      setStatus({ connected: false })
    }
  }, [])

  // On mount: read the sanitized callback signal and load status. A 'connected'
  // signal means a callback just succeeded — refresh to pick up the new state.
  useEffect(() => {
    const signal = readCallbackSignal()
    setCallbackSignal(signal)
    void refresh()
  }, [refresh])

  // Auto-dismiss the sanitized callback toast after a few seconds.
  useEffect(() => {
    if (!callbackSignal) return
    const t = setTimeout(() => setCallbackSignal(null), 6000)
    return () => clearTimeout(t)
  }, [callbackSignal])

  const connect = useCallback(async () => {
    setConnecting(true)
    try {
      const res = await fetch(AUTHORIZE_URL, {
        method: 'POST',
        headers: await authedJsonHeaders(),
        body: JSON.stringify({ returnPath: window.location.pathname || '/' }),
      })
      if (res.ok) {
        const data = await res.json()
        const authorizationUrl = data?.authorizationUrl
        if (typeof authorizationUrl === 'string' && authorizationUrl) {
          // Same-tab OAuth redirect (no popup). The browser goes to Intuit and
          // returns through qbo-callback, which 302s back here with ?qbo=….
          window.location.href = authorizationUrl
          return
        }
      }
      setCallbackSignal('error')
    } catch {
      setCallbackSignal('error')
    } finally {
      setConnecting(false)
    }
  }, [])

  const disconnect = useCallback(async () => {
    setDisconnecting(true)
    setDisconnectError(null)
    try {
      const res = await fetch(DISCONNECT_URL, {
        method: 'POST',
        headers: await authedJsonHeaders(),
        body: '{}',
      })
      if (res.ok) {
        await refresh()
        setAccountOpen(false)
      } else {
        setDisconnectError('QuickBooks could not be disconnected. Please try again.')
      }
    } catch {
      setDisconnectError('QuickBooks could not be disconnected. Please try again.')
    } finally {
      setDisconnecting(false)
    }
  }, [refresh])

  const openAccount = useCallback(() => setAccountOpen(true), [])
  const closeAccount = useCallback(() => {
    setAccountOpen(false)
    setDisconnectError(null)
  }, [])
  const clearCallbackSignal = useCallback(() => setCallbackSignal(null), [])

  return {
    status,
    callbackSignal,
    accountOpen,
    disconnecting,
    connecting,
    disconnectError,
    refresh,
    connect,
    disconnect,
    openAccount,
    closeAccount,
    clearCallbackSignal,
  }
}