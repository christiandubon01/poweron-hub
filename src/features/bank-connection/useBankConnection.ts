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
  /** PLAID-1B: sanitized failure code, what to do next, and when the last attempt happened (absent from older servers). */
  lastErrorCode?: string | null
  recovery?: 'retry' | 'reconnect' | 'refresh_accounts' | 'owner_review' | 'none'
  recoveryText?: string
  lastAttemptAt?: string | null
}
export interface CashAccountOption { id: string; displayName: string; accountType: string; ownershipContext: string }
/** PLAID-1A: one shared account as the bank reports it (no provider id, balance or token). */
export interface SharedAccountView { name: string | null; officialName: string | null; mask: string | null; type: string | null; subtype: string | null; mapped?: boolean; previouslyConnected?: boolean }
/** PLAID-1A read-only comparison of what the bank shares now versus what Cash OS stores for ONE existing connection. */
export interface AccountAdditionPreview {
  itemId: string
  itemPreserved: boolean
  connected: SharedAccountView[]
  available: SharedAccountView[]
  noLongerShared: SharedAccountView[]
  skipped: number
  previewToken: string
}

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
  const [accountAdditionsEnabled, setAccountAdditionsEnabled] = useState(false)
  const [addPreview, setAddPreview] = useState<AccountAdditionPreview | null>(null)
  const [backgroundSyncEnabled, setBackgroundSyncEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const data = await request('plaid-connection-status', { method: 'GET' })
      setConnections(Array.isArray(data.connections) ? data.connections : [])
      setEnvironment(typeof data.environment === 'string' ? data.environment : null)
      setAccountAdditionsEnabled(data.accountAdditionsEnabled === true)
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
      setBackgroundSyncEnabled(data.backgroundSyncEnabled === true)
      return Array.isArray(data.syncs) ? data.syncs as BankSyncSummary[] : []
    } catch { /* keep the last known status */ return null }
  }, [])
  useEffect(() => { void refresh(); void refreshAccounts(); void refreshSyncs() }, [refresh, refreshAccounts, refreshSyncs])

  /** Separate, retry-safe call (never part of the connection exchange): fetch + save the bank's accounts, then reload the list. */
  const discoverAccounts = useCallback(async (itemId: string) => {
    await request('plaid-accounts', { method: 'POST', body: { action: 'discover', itemId } })
    await refreshAccounts()
  }, [refreshAccounts])

  /**
   * PLAID-1A: read-only comparison for one existing connection (connected / newly shared / no longer shared). Saves nothing. Used after an
   * "Add accounts" Link and on demand.
   */
  const previewAccounts = useCallback(async (itemId: string) => {
    const data = await request('plaid-accounts', { method: 'POST', body: { action: 'preview', itemId } })
    setAddPreview({ itemId, itemPreserved: data.itemPreserved === true, connected: data.connected ?? [], available: data.available ?? [], noLongerShared: data.noLongerShared ?? [], skipped: Number(data.skipped) || 0, previewToken: String(data.previewToken ?? '') })
  }, [])

  /** What happens after Link succeeds: the public token goes straight to the server (never kept), then the list and accounts reload. */
  const handleLinkSuccess = useCallback(async (onDone: (publicToken: string, institutionId: string | null) => Promise<unknown>, publicToken: string, institutionId: string | null = null, addAccountsItemId: string | null = null) => {
    clearPendingOauth()
    try {
      const done = await onDone(publicToken, institutionId) as { connection?: { id?: unknown } } | undefined
      if (addAccountsItemId) {
        // Adding accounts to an EXISTING connection: nothing is saved automatically. The owner reviews the preview and saves explicitly.
        await refresh()
        await previewAccounts(addAccountsItemId)
        return
      }
      const status = await request('plaid-connection-status', { method: 'GET' })
      setConnections(Array.isArray(status.connections) ? status.connections : [])
      // Discover accounts only for the connection this Link just created (when known). Other connections are never touched as a side effect, so
      // accounts newly shared on an existing connection are only ever saved through its own reviewed preview (PLAID-1A).
      const createdId = typeof done?.connection?.id === 'string' ? done.connection.id : null
      const live = (status.connections as BankConnectionSummary[] | undefined)?.filter(c => c.status !== 'disconnected' && (!createdId || c.id === createdId)) ?? []
      for (const c of live) {
        try { await discoverAccounts(c.id) } catch (error) { setMessage(`Connected, but the bank accounts could not be loaded yet: ${(error as Error).message}`); await refresh(); await refreshSyncs() }
      }
    } catch (error) { setMessage((error as Error).message) } finally { setBusy(false) }
  }, [discoverAccounts, refresh, refreshSyncs, previewAccounts])

  const runLink = useCallback(async (body: Record<string, unknown>, onDone: (publicToken: string, institutionId: string | null) => Promise<unknown>) => {
    setBusy(true); setMessage(null)
    try {
      const { linkToken } = await request('plaid-link-token', { method: 'POST', body })
      const mode = body.mode === 'update' || body.mode === 'add_accounts' ? body.mode : 'new'
      const itemId = typeof body.itemId === 'string' ? body.itemId : null
      rememberLinkToken({ linkToken, mode, itemId })
      await openPlaidLink({
        linkToken,
        onSuccess: (publicToken, institutionId) => handleLinkSuccess(onDone, publicToken, institutionId, mode === 'add_accounts' ? itemId : null),
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
    const onDone = pending.mode === 'add_accounts' && pending.itemId
      ? (async () => { /* update mode keeps the same Item and access token: there is nothing to exchange */ })
      : pending.mode === 'update' && pending.itemId
      ? (async () => { await request('plaid-exchange', { method: 'POST', body: { mode: 'update_complete', itemId: pending.itemId } }) })
      : (async (publicToken: string, institutionId: string | null) => { await request('plaid-exchange', { method: 'POST', body: { publicToken, ...(institutionId ? { institutionId } : {}) } }) })
    setBusy(true)
    void Promise.resolve(openPlaidLink({
      linkToken: pending.linkToken, receivedRedirectUri: returnedUri,
      onSuccess: (publicToken, institutionId) => handleLinkSuccess(onDone, publicToken, institutionId, pending.mode === 'add_accounts' ? pending.itemId : null),
      onExit: () => { clearPendingOauth(); setBusy(false) },
    })).catch(error => { setMessage((error as Error).message || 'Could not resume the bank connection.'); setBusy(false) })
  }, [handleLinkSuccess])

  /**
   * New connection. The public token goes straight to the server and is not kept. `differentInstitution` is the owner's statement, asked by the card
   * when a connection already exists, that this is a DIFFERENT bank; the server still refuses a bank that is already connected (PLAID-1A).
   */
  const connect = useCallback((differentInstitution = false) => runLink(differentInstitution ? { differentInstitution: true } : {},
    (publicToken, institutionId) => request('plaid-exchange', { method: 'POST', body: { publicToken, ...(institutionId ? { institutionId } : {}) } })), [runLink])
  /** PLAID-1A: update mode with Account Select on the EXISTING connection. No exchange, no new Item; the owner then reviews a preview. */
  const addAccounts = useCallback((itemId: string) => runLink({ mode: 'add_accounts', itemId }, async () => { /* same Item, same access token */ }), [runLink])
  const reviewSharedAccounts = useCallback(async (itemId: string) => {
    setBusy(true); setMessage(null)
    try { await previewAccounts(itemId) } catch (error) { setMessage((error as Error).message) } finally { setBusy(false) }
  }, [previewAccounts])
  /** Saves ONLY the previewed newly shared accounts, unmapped: they stay out of reports until the owner maps them. */
  const saveNewAccounts = useCallback(async () => {
    if (!addPreview) return
    setBusy(true); setMessage(null)
    try {
      const out = await request('plaid-accounts', { method: 'POST', body: { action: 'save_new', itemId: addPreview.itemId, previewToken: addPreview.previewToken } })
      setAddPreview(null)
      await refreshAccounts()
      setMessage(`${Number(out.saved) || 0} new account(s) saved as bank evidence. They are not included in reports until you map them.`)
    } catch (error) { setMessage((error as Error).message) } finally { setBusy(false) }
  }, [addPreview, refreshAccounts])
  const dismissPreview = useCallback(() => setAddPreview(null), [])
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
  /**
   * Owner-requested only: never automatic. Stores bank evidence; changes no balance, ledger or report. PLAID-1B: when the server runs syncs in the
   * background, the request is accepted at once (202) and the card follows the status until the run ends (at most the 16-minute lease).
   */
  const syncNow = useCallback(async (itemId: string) => {
    setBusy(true); setMessage(null)
    try {
      if (!backgroundSyncEnabled) { await request('plaid-sync', { method: 'POST', body: { action: 'sync', itemId } }); return }
      const res = await fetch(`${BASE}/plaid-sync-background`, { method: 'POST', headers: await authedJsonHeaders(), body: JSON.stringify({ itemId }) })
      if (res.status !== 202) throw new Error('Background sync is not available on this site yet. Nothing was changed.')
      const deadline = Date.now() + 16 * 60 * 1000
      await new Promise(r => setTimeout(r, 3000))
      for (;;) {
        const list = await refreshSyncs()
        const mine = list?.find(s => s.connectionId === itemId)
        if (!mine || mine.state !== 'syncing' || Date.now() > deadline) break
        await new Promise(r => setTimeout(r, 5000))
      }
    }
    catch (error) { setMessage((error as Error).message) }
    finally { await refreshSyncs(); await refresh(); setBusy(false) }
  }, [refreshSyncs, refresh, backgroundSyncEnabled])
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

  return { load, connections, accounts, cashAccounts, findAccounts, mapAccount, unmapAccount, syncs, syncNow, environment, busy, message, connect, reconnect, disconnect, refresh,
    accountAdditionsEnabled, addPreview, addAccounts, reviewSharedAccounts, saveNewAccounts, dismissPreview }
}
