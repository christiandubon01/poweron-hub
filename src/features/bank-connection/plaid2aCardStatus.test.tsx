// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('@/services/authedFetch', () => ({ authedJsonHeaders: async () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer t' }) }))
vi.mock('./plaidLink', () => ({ openPlaidLink: vi.fn(), readPendingOauth: () => null, rememberLinkToken: () => undefined, clearPendingOauth: () => undefined }))
import BankConnectionCard from './BankConnectionCard'

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const flush = async () => { await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }
const conn = (over: Record<string, unknown> = {}) => ({ id: 'i1', provider: 'plaid', status: 'healthy', environment: 'production', institutionName: 'Wells Fargo', connectedAt: '2026-10-07T12:00:00Z', disconnectedAt: null, lastSuccessfulSyncAt: null, ...over })
const acct = (id: string, mask: string) => ({ id, connectionId: 'i1', institutionName: 'Wells Fargo', name: 'Checking', officialName: null, mask, type: 'depository', subtype: 'checking', live: true, mapping: null })
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()
const sync = (over: Record<string, unknown> = {}) => ({ connectionId: 'i1', state: 'synced', lastSyncedAt: hoursAgo(2), counts: { posted: 10, pending: 2, removed: 0 }, updatesAvailable: false, accounts: [], webhookLastAt: null, itemNotice: null, ...over })

describe('PLAID-2A bank card status', () => {
  let host: HTMLDivElement, root: Root, fetchMock: ReturnType<typeof vi.fn>
  const mount = async (responses: Record<string, { status?: number; body: unknown }>) => {
    fetchMock = vi.fn(async (url: string, init?: any) => {
      const key = Object.keys(responses).find(k => String(url).endsWith(k))!
      const r = responses[key] ?? { status: 500, body: {} }
      return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body }
    })
    vi.stubGlobal('fetch', fetchMock)
    await act(async () => { root.render(<BankConnectionCard />) })
    await flush()
  }
  const base = (syncs: unknown[], over: Record<string, unknown> = {}, connection = conn()) => ({
    'plaid-connection-status': { body: { environment: 'production', connected: true, connections: [connection] } },
    'plaid-accounts': { body: { accounts: [acct('a1', '3809'), acct('a2', '6951')], cashAccounts: [] } },
    'plaid-sync': { body: { syncs, resumableSyncEnabled: true, autoSyncEnabled: true, ...over } },
  })
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('shows, per account, when it last synced, how many transactions it holds and its newest transaction date', async () => {
    await mount(base([sync({ accounts: [{ id: 'a1', posted: 120, pending: 3, newestDate: '2026-10-15' }, { id: 'a2', posted: 1, pending: 0, newestDate: null }] })]))
    const rows = [...host.querySelectorAll('[data-testid="bank-account-freshness"]')].map(n => n.textContent)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatch(/Last synced .* · 123 transactions \(3 pending\) · newest 2026-10-15/)
    expect(rows[1]).toMatch(/· 1 transaction$/)
  })
  it('warns once when the last sync is more than 24 hours old, and stays quiet at 10 hours', async () => {
    await mount(base([sync({ lastSyncedAt: hoursAgo(30) })]))
    const old = [...host.querySelectorAll('[data-testid="bank-attention"] li')].map(n => n.textContent)
    expect(old.filter(t => /last synced over 24 hours ago/.test(t!))).toHaveLength(1)
    act(() => root.unmount()); host.innerHTML = ''; root = createRoot(host)
    await mount(base([sync({ lastSyncedAt: hoursAgo(10) })]))
    expect(host.textContent).not.toMatch(/last synced over 24 hours ago/)
  })
  it('a connection needing sign-in shows "Sign in to Wells Fargo again" (Plaid Link update mode), and the manual Sync button is still there', async () => {
    await mount(base([sync({ state: 'login_required' })], {}, conn({ status: 'login_required' })))
    const labels = [...host.querySelectorAll('[data-testid="bank-connection-row"] button')].map(b => b.textContent)
    expect(labels).toContain('Sign in to Wells Fargo again'); expect(labels).toContain('Sync again')
    expect(host.textContent).toMatch(/needs you to sign in again/)
  })
  it('a "sign in soon" bank notice shows the warning and the same button while the connection still works, and clears when the notice is gone', async () => {
    await mount(base([sync({ itemNotice: { code: 'PENDING_EXPIRATION', receivedAt: hoursAgo(1) } })]))
    expect(host.querySelector('[data-testid="bank-signin-again"]')!.textContent).toBe('Sign in to Wells Fargo again')
    expect(host.querySelector('[data-testid="bank-attention"]')!.textContent).toMatch(/will need you to sign in again soon/)
    act(() => root.unmount()); host.innerHTML = ''; root = createRoot(host)
    await mount(base([sync()]))
    expect(host.querySelector('[data-testid="bank-signin-again"]')).toBeNull()
    expect(host.textContent).not.toMatch(/sign in again soon/)
  })
  it('the wording is true to the server: automatic when it is on, plain manual when it is off', async () => {
    await mount(base([sync({ webhookLastAt: hoursAgo(1) })]))
    expect(host.querySelector('[data-testid="bank-auto-sync-note"]')!.textContent).toMatch(/Updates automatically when your bank reports new activity/)
    expect(host.querySelector('[data-testid="bank-auto-sync-last"]')).not.toBeNull()
    expect(host.textContent).not.toMatch(/Owner-requested only|never automatic/i)
    act(() => root.unmount()); host.innerHTML = ''; root = createRoot(host)
    await mount(base([sync()], { autoSyncEnabled: false }))
    expect(host.querySelector('[data-testid="bank-auto-sync-note"]')!.textContent).toMatch(/not turned on for this site yet/)
  })
  it('"Turn on automatic updates" appears only for a production connection with automatic sync on and no bank notice yet, needs confirmation, and posts the typed REGISTER action', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await mount(base([sync()]))
    const button = host.querySelector('[data-testid="bank-register-webhook"]') as HTMLButtonElement
    expect(button).not.toBeNull()
    await act(async () => { button.click() })
    await flush()
    expect(confirm).toHaveBeenCalledTimes(1)
    const post = fetchMock.mock.calls.find(c => c[1]?.method === 'POST' && String(c[0]).endsWith('plaid-sync'))!
    expect(JSON.parse(post[1].body)).toEqual({ action: 'register_webhook', itemId: 'i1', confirm: 'REGISTER' })
    // not for a sandbox connection, not once a bank notice has arrived, not when automatic sync is off
    for (const [syncs, over, connection] of [[[sync()], {}, conn({ environment: 'sandbox' })], [[sync({ webhookLastAt: hoursAgo(1) })], {}, conn()], [[sync()], { autoSyncEnabled: false }, conn()]] as const) {
      act(() => root.unmount()); host.innerHTML = ''; root = createRoot(host)
      await mount(base([...syncs], over, connection))
      expect(host.querySelector('[data-testid="bank-register-webhook"]')).toBeNull()
    }
  })
  it('declining the confirmation sends nothing', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    await mount(base([sync()]))
    await act(async () => { (host.querySelector('[data-testid="bank-register-webhook"]') as HTMLButtonElement).click() })
    expect(fetchMock.mock.calls.some(c => c[1]?.method === 'POST')).toBe(false)
  })
})
