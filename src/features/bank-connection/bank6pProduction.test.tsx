// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('@/services/authedFetch', () => ({ authedJsonHeaders: async () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer t' }) }))
const openPlaidLink = vi.fn()
// Only the Link launcher is replaced: the real OAuth-resume helpers run against happy-dom's sessionStorage.
vi.mock('./plaidLink', async importOriginal => ({ ...(await importOriginal<typeof import('./plaidLink')>()), openPlaidLink: (o: unknown) => openPlaidLink(o) }))
import { clearPendingOauth, readPendingOauth, rememberLinkToken } from './plaidLink'
import BankConnectionCard from './BankConnectionCard'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const flush = async () => { await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }
const conn = (over: Record<string, unknown> = {}) => ({ id: 'i1', provider: 'plaid', status: 'healthy', environment: 'production', institutionName: 'Wells Fargo', connectedAt: '2026-10-08T12:00:00Z', disconnectedAt: null, lastSuccessfulSyncAt: null, ...over })

describe('BANK-6P Production connection card', () => {
  let host: HTMLDivElement, root: Root, fetchMock: ReturnType<typeof vi.fn>
  const mount = async (responses: Record<string, { status?: number; body: unknown }>) => {
    fetchMock = vi.fn(async (url: string) => {
      const key = Object.keys(responses).find(k => String(url).endsWith(k))!
      const r = responses[key] ?? { status: 500, body: {} }
      return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body }
    })
    vi.stubGlobal('fetch', fetchMock)
    await act(async () => { root.render(<BankConnectionCard />) })
    await flush()
  }
  const posts = () => fetchMock.mock.calls.filter(c => (c[1] as any)?.method === 'POST')
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); openPlaidLink.mockReset(); window.sessionStorage.clear(); window.history.replaceState(null, '', '/') })
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

  it('in Production, the earlier Sandbox connection is kept and explained but has NO actions, and Connect bank is offered', async () => {
    await mount({ 'plaid-connection-status': { body: { environment: 'production', connected: false, connections: [conn({ id: 's1', environment: 'sandbox', institutionName: 'Tartan Bank' })] } }, 'plaid-accounts': { body: { accounts: [], cashAccounts: [] } }, 'plaid-sync': { body: { syncs: [] } } })
    expect(host.querySelector('[data-testid="bank-connect"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="bank-connection-row"]')).toBeNull() // no row, so no Sync / Disconnect / Reconnect / Find accounts for it
    expect(host.querySelector('[data-testid="bank-other-environment"]')!.textContent).toMatch(/Tartan Bank · Sandbox test connection.*never used for your business numbers/)
    expect(host.textContent).toMatch(/production/i)
    expect(posts()).toEqual([]) // nothing connects, syncs, maps or disconnects by itself
  })

  it('the Sandbox test account keeps its mapping until the owner explicitly removes it (only then can the real account use that Cash OS account)', async () => {
    const accountsBody = { accounts: [{ id: 'pa1', connectionId: 's1', institutionName: 'Tartan Bank', name: 'Plaid Checking', officialName: null, mask: '0000', type: 'depository', subtype: 'checking', live: true, mapping: { id: 'm1', financialAccountId: 'fa1', financialAccountName: 'Wells Fargo Business Checking 6960' } }], cashAccounts: [{ id: 'fa1', displayName: 'Wells Fargo Business Checking 6960', accountType: 'checking', ownershipContext: 'business' }] }
    await mount({ 'plaid-connection-status': { body: { environment: 'production', connected: false, connections: [conn({ id: 's1', environment: 'sandbox', institutionName: 'Tartan Bank' })] } }, 'plaid-accounts': { body: accountsBody }, 'plaid-sync': { body: { syncs: [] } } })
    const row = host.querySelector('[data-testid="bank-other-environment-mapping"]')!
    expect(row.textContent).toMatch(/Plaid Checking.*→.*Wells Fargo Business Checking 6960/)
    expect(posts()).toEqual([]) // shown, never changed on its own
    vi.stubGlobal('confirm', () => true); window.confirm = () => true
    await act(async () => { (row.querySelector('button') as HTMLButtonElement).click() }); await flush()
    expect(posts().map(c => JSON.parse((c[1] as any).body))).toEqual([{ action: 'unmap', providerAccountId: 'pa1' }]) // the id only: no name, mask or balance guesses anything
  })

  it('a Production bank shows normal controls, plus a single-connection billing reminder with "Connect another bank"', async () => {
    await mount({ 'plaid-connection-status': { body: { environment: 'production', connected: true, connections: [conn()] } }, 'plaid-accounts': { body: { accounts: [], cashAccounts: [] } }, 'plaid-sync': { body: { syncs: [] } } })
    const row = host.querySelector('[data-testid="bank-connection-row"]')!
    expect(row.textContent).toMatch(/Wells Fargo/)
    expect([...row.querySelectorAll('button')].map(b => b.textContent)).toContain('Disconnect')
    expect(host.querySelector('[data-testid="bank-connect-another"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="bank-connect-another-note"]')!.textContent).toBe('Each connection is billed by Plaid. Connect a bank only once.')
  })

  it('Connect remembers only the short-lived LINK token, and the public token is sent straight to the server and never kept', async () => {
    await mount({ 'plaid-connection-status': { body: { environment: 'production', connected: false, connections: [] } }, 'plaid-accounts': { body: { accounts: [], cashAccounts: [] } }, 'plaid-sync': { body: { syncs: [] } },
      'plaid-link-token': { body: { linkToken: 'link-production-1', mode: 'new' } }, 'plaid-exchange': { body: { outcome: 'created' } } })
    await act(async () => { (host.querySelector('[data-testid="bank-connect"]') as HTMLButtonElement).click() })
    await flush()
    expect(JSON.parse(window.sessionStorage.getItem('poweron.plaid.oauth.link')!)).toMatchObject({ linkToken: 'link-production-1', mode: 'new', itemId: null })
    const opts = openPlaidLink.mock.calls[0][0] as { onSuccess: (t: string) => Promise<void> }
    await act(async () => { await opts.onSuccess('public-production-abcdef123456') })
    expect(window.sessionStorage.getItem('poweron.plaid.oauth.link')).toBeNull() // cleared as soon as Link succeeds
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain('public-production')
    expect(JSON.parse((posts().find(c => String(c[0]).endsWith('plaid-exchange'))![1] as any).body)).toEqual({ publicToken: 'public-production-abcdef123456' }) // no environment, no organization
  })

  it('returning from an OAuth bank resumes the SAME Link session with the returned URL, exactly once', async () => {
    rememberLinkToken({ linkToken: 'link-production-oauth', mode: 'new', itemId: null })
    window.history.replaceState(null, '', '/?oauth_state_id=abc-123')
    await mount({ 'plaid-connection-status': { body: { environment: 'production', connected: false, connections: [] } }, 'plaid-accounts': { body: { accounts: [], cashAccounts: [] } }, 'plaid-sync': { body: { syncs: [] } }, 'plaid-exchange': { body: { outcome: 'created' } } })
    expect(openPlaidLink).toHaveBeenCalledTimes(1)
    const opts = openPlaidLink.mock.calls[0][0] as { linkToken: string; receivedRedirectUri: string; onSuccess: (t: string) => Promise<void> }
    expect(opts.linkToken).toBe('link-production-oauth')
    expect(opts.receivedRedirectUri).toContain('oauth_state_id=abc-123')
    expect(window.location.search).toBe('') // the OAuth parameters are stripped from the address bar
    expect(posts()).toEqual([]) // resuming Link is not a connection until the owner finishes it; nothing syncs or maps
  })

  it('no OAuth return means no resume, and a stale or foreign stored token is discarded', () => {
    rememberLinkToken({ linkToken: 'link-x', mode: 'new', itemId: null }, 1_000)
    expect(readPendingOauth('?foo=1', 1_000)).toBeNull() // not an OAuth return: nothing resumes by itself
    expect(readPendingOauth('?oauth_state_id=a', 1_000 + 31 * 60 * 1000)).toBeNull() // older than 30 minutes
    expect(window.sessionStorage.getItem('poweron.plaid.oauth.link')).toBeNull() // and it was discarded
    rememberLinkToken({ linkToken: 'link-y', mode: 'update', itemId: 'i9' }, 5_000)
    expect(readPendingOauth('?oauth_state_id=a', 6_000)).toEqual({ linkToken: 'link-y', mode: 'update', itemId: 'i9' })
    clearPendingOauth(); expect(readPendingOauth('?oauth_state_id=a', 6_000)).toBeNull()
    window.sessionStorage.setItem('poweron.plaid.oauth.link', '{not json'); expect(readPendingOauth('?oauth_state_id=a')).toBeNull()
  })
})
