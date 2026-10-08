/**
 * src/features/bank-connection/useBankConnection.ts
 *
 * Browser state for the sandbox bank connection card. Talks only to the authenticated Netlify functions; receives only
 * SANITIZED data (no token, no cursor, no provider response). Connecting a bank has no effect on any Cash OS number.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { authedJsonHeaders } from '@/services/authedFetch'
import { clearPendingOauth, openPlaidLink, readPendingOauth, rememberLinkToken } from './plaidLink'

const BASE = '/.netlify/functions'

export interface BankConnectionSummary {
  id: string
  provider: string
  status: 'connecting' | 'healthy' | 'login_required' | 'error' | 'disconnected'
  /** Optional only for responses from a server that predates environments (treated as sandbox). */
  environment?: 'sandbox' | 'production'
  institutionName: string | null
  connectedAt: string | null
  disconnectedAt: string | null
  lastSuccessfulSyncAt: string | null
}

/** Sanitized bank account as shown to the owner: no provider id, no balance, no token. */
export interface BankAccountSummary {
  id: string
  connectionId: string
  institutionName: string | null
  name: string | null
  officialName: string | null
  mask: string | null
  type: string | null
  subtype: string | null
  live: boolean
  mapping: { id: string; financialAccountId: string; financialAccountName: string } | null
}
/** Sanitized sync status: state, last synced time and evidence COUNTS only (no transaction text, ids or amounts). */
export interface BankSyncSummary {
  connectionId: string
  state: 'not_synced' | 'syncing' | 'waiting' | 'unconfirmed' | 'synced' | 'error' | 'login_required'
  lastSyncedAt: string | null
  counts: { posted: number; pending: number; removed: number }
  updatesAvailable: boolean
}
export interface CashAccountOption { id: string; displayName: string; accountType: string; ownershipContext: string }

/** `unavailable` = the caller may not manage bank connections (or it is not configured); the card renders nothing. */
export type BankConnectionLoad = 'loading' | 'ready' | 'unavailable'

async function request(path: string, init: { method: 'GET' | 'POST'; body?: unknown }) {
  const res = await fetch(`${BASE}/${path}`, { method: init.method, headers: await authedJsonHeaders(), body: init.body === undefined ? undefined : JSON.stringify(init.body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(typeof data?.error === 'string' ? data.error : 'Request failed.'), { status: res.status, code: typeof data?.code === 'string' ? data.code : undefined })
  return data
}

export function useBankConnection() {
  const [load, setLoad] = useState<BankConnectionLoad>('loading')
  const [connections, setConnections] = useState<BankConnectionSummary[]>([])
  const [environment, setEnvironment] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<BankAccountSummary[]>([])
  const [cashAccounts, setCashAccounts] = useState<CashAccountOption[]>([])
  const [syncs, setSyncs] = useState<BankSyncSummary[]>([])
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
  /** Account list is best-effort: a failure here never hides an otherwise valid connection. */
  const refreshAccounts = useCallback(async () => {
    try {
      const data = await request('plaid-accounts', { method: 'GET' })
      setAccounts(Array.isArray(data.accounts) ? data.accounts : [])
      setCashAccounts(Array.isArray(data.cashAccounts) ? data.cashAccounts : [])
    } catch { /* keep the last known list */ }
  }, [])
  const refreshSyncs = useCallback(async () => {
    try {
      const data = await request('plaid-sync', { method: 'GET' })
      setSyncs(Array.isArray(data.syncs) ? data.syncs : [])
    } catch { /* keep the last known status */ }
  }, [])
  useEffect(() => { void refresh(); void refreshAccounts(); void refreshSyncs() }, [refresh, refreshAccounts, refreshSyncs])

  /** Separate, retry-safe call (never part of the connection exchange): fetch + save the bank's accounts, then reload the list. */
  const discoverAccounts = useCallback(async (itemId: string) => {
    await request('plaid-accounts', { method: 'POST', body: { action: 'discover', itemId } })
    await refreshAccounts()
  }, [refreshAccounts])

  /** What happens after Link succeeds: the public token goes straight to the server (never kept), then the list and accounts reload. */
  const handleLinkSuccess = useCallback(async (onDone: (publicToken: string) => Promise<void>, publicToken: string) => {
    clearPendingOauth()
    try {
      await onDone(publicToken)
      const status = await request('plaid-connection-status', { method: 'GET' })
      setConnections(Array.isArray(status.connections) ? status.connections : [])
      const live = (status.connections as BankConnectionSummary[] | undefined)?.filter(c => c.status !== 'disconnected') ?? []
      for (const c of live) {
        try { await discoverAccounts(c.id) } catch (error) { setMessage(`Connected, but the bank accounts could not be loaded yet: ${(error as Error).message}`); await refresh(); await refreshSyncs() }
      }
    } catch (error) { setMessage((error as Error).message) } finally { setBusy(false) }
  }, [discoverAccounts, refresh, refreshSyncs])

  const runLink = useCallback(async (body: Record<string, unknown>, onDone: (publicToken: string) => Promise<void>) => {
    setBusy(true); setMessage(null)
    try {
      const { linkToken } = await request('plaid-link-token', { method: 'POST', body })
      rememberLinkToken({ linkToken, mode: body.mode === 'update' ? 'update' : 'new', itemId: typeof body.itemId === 'string' ? body.itemId : null })
      await openPlaidLink({
        linkToken,
        onSuccess: publicToken => handleLinkSuccess(onDone, publicToken),
        onExit: () => { clearPendingOauth(); setBusy(false) },
      })
    } catch (error) {
      setMessage((error as Error).message || 'Could not start the bank connection.')
      setBusy(false)
    }
  }, [handleLinkSuccess])

  // Returning from an OAuth bank (e.g. Wells Fargo): resume the SAME Link session with the returned URL. Runs once, only on an OAuth return.
  const resumed = useRef(false)
  useEffect(() => {
    if (resumed.current) return
    const pending = readPendingOauth()
    if (!pending) return
    resumed.current = true
    const returnedUri = window.location.href
    try { window.history.replaceState(null, '', window.location.pathname) } catch { /* ignore */ }
    const onDone = pending.mode === 'update' && pending.itemId
      ? (async () => { await request('plaid-exchange', { method: 'POST', body: { mode: 'update_complete', itemId: pending.itemId } }) })
      : (async (publicToken: string) => { await request('plaid-exchange', { method: 'POST', body: { publicToken } }) })
    setBusy(true)
    void Promise.resolve(openPlaidLink({
      linkToken: pending.linkToken, receivedRedirectUri: returnedUri,
      onSuccess: publicToken => handleLinkSuccess(onDone, publicToken),
      onExit: () => { clearPendingOauth(); setBusy(false) },
    })).catch(error => { setMessage((error as Error).message || 'Could not resume the bank connection.'); setBusy(false) })
  }, [handleLinkSuccess])

  /** New connection. The public token goes straight to the server and is not kept. */
  const connect = useCallback(() => runLink({}, publicToken => request('plaid-exchange', { method: 'POST', body: { publicToken } })), [runLink])
  /** Re-authentication of an existing connection (no new Item). */
  const reconnect = useCallback((itemId: string) => runLink({ mode: 'update', itemId }, () => request('plaid-exchange', { method: 'POST', body: { mode: 'update_complete', itemId } })), [runLink])
  const disconnect = useCallback(async (itemId: string) => {
    setBusy(true); setMessage(null)
    try { await request('plaid-disconnect', { method: 'POST', body: { itemId } }); await refresh(); await refreshAccounts() }
    catch (error) { setMessage((error as Error).message) }
    finally { setBusy(false) }
  }, [refresh, refreshAccounts])

  const findAccounts = useCallback(async (itemId: string) => {
    setBusy(true); setMessage(null)
    try { await discoverAccounts(itemId) } catch (error) { setMessage((error as Error).message) }
    finally { await refresh(); await refreshSyncs(); setBusy(false) } // a sign-in-needed result changes the connection status: show Reconnect
  }, [discoverAccounts])
  /** Owner-requested only: never automatic. Stores bank evidence; changes no balance, ledger or report. */
  const syncNow = useCallback(async (itemId: string) => {
    setBusy(true); setMessage(null)
    try { await request('plaid-sync', { method: 'POST', body: { action: 'sync', itemId } }) }
    catch (error) { setMessage((error as Error).message) }
    finally { await refreshSyncs(); await refresh(); setBusy(false) }
  }, [refreshSyncs, refresh])
  const mapAccount = useCallback(async (providerAccountId: string, financialAccountId: string) => {
    setBusy(true); setMessage(null)
    try { await request('plaid-accounts', { method: 'POST', body: { action: 'map', providerAccountId, financialAccountId } }); await refreshAccounts() }
    catch (error) { setMessage((error as Error).message) } finally { setBusy(false) }
  }, [refreshAccounts])
  const unmapAccount = useCallback(async (providerAccountId: string) => {
    setBusy(true); setMessage(null)
    try { await request('plaid-accounts', { method: 'POST', body: { action: 'unmap', providerAccountId } }); await refreshAccounts() }
    catch (error) { setMessage((error as Error).message) } finally { setBusy(false) }
  }, [refreshAccounts])

  return { load, connections, accounts, cashAccounts, findAccounts, mapAccount, unmapAccount, syncs, syncNow, environment, busy, message, connect, reconnect, disconnect, refresh }
}
