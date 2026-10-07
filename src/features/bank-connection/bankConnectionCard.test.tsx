// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('@/services/authedFetch', () => ({ authedJsonHeaders: async () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer t' }) }))
const openPlaidLink = vi.fn()
vi.mock('./plaidLink', () => ({ openPlaidLink: (o: unknown) => openPlaidLink(o) }))
import BankConnectionCard from './BankConnectionCard'

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const flush = async () => { await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }
const conn = (over: Record<string, unknown> = {}) => ({ id: 'i1', provider: 'plaid', status: 'healthy', institutionName: 'First Platypus Bank', connectedAt: '2026-10-06T12:00:00Z', disconnectedAt: null, lastSuccessfulSyncAt: null, ...over })

describe('BankConnectionCard (BANK-2)', () => {
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
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); openPlaidLink.mockReset() })
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

  it('renders nothing for callers who cannot manage bank connections (403) or when unconfigured', async () => {
    await mount({ 'plaid-connection-status': { status: 403, body: { error: 'Only owners and admins can manage bank connections.' } } })
    expect(host.querySelector('[data-testid="bank-connection-card"]')).toBeNull()
    expect(host.textContent).toBe('')
  })

  it('shows a not-connected state with a Connect button and the zero-effect promise', async () => {
    await mount({ 'plaid-connection-status': { body: { environment: 'sandbox', connected: false, connections: [] } } })
    expect(host.querySelector('[data-testid="bank-not-connected"]')!.textContent).toMatch(/does not change any balance or report/)
    expect(host.querySelector('[data-testid="bank-connect"]')).not.toBeNull()
    expect(host.textContent).toMatch(/sandbox/i)
  })

  it('a connected bank shows its sanitized status (icon + text, not color alone) with Disconnect and no Reconnect', async () => {
    await mount({ 'plaid-connection-status': { body: { environment: 'sandbox', connected: true, connections: [conn()] } } })
    const row = host.querySelector('[data-testid="bank-connection-row"]')!
    expect(row.textContent).toMatch(/First Platypus Bank/); expect(row.textContent).toMatch(/Connected/); expect(row.textContent).toContain('●')
    expect([...row.querySelectorAll('button')].map(b => b.textContent)).toEqual(['Disconnect', 'Find bank accounts']) // BANK-3 adds the account retry control
    expect(host.querySelector('[data-testid="bank-connect"]')).toBeNull()
  })

  it('a connection needing sign-in offers Reconnect (update mode), and the card never shows tokens or ids', async () => {
    await mount({ 'plaid-connection-status': { body: { environment: 'sandbox', connected: true, connections: [conn({ status: 'login_required' })] } } })
    const row = host.querySelector('[data-testid="bank-connection-row"]')!
    expect(row.textContent).toMatch(/Sign-in needed/)
    expect([...row.querySelectorAll('button')].map(b => b.textContent)).toEqual(['Reconnect', 'Disconnect', 'Find bank accounts'])
    expect(host.innerHTML).not.toMatch(/access-|v1:|public-|link-sandbox/)
  })

  it('Connect asks the server for a link token, opens Link, and sends the public token straight to the server (not stored)', async () => {
    await mount({
      'plaid-connection-status': { body: { environment: 'sandbox', connected: false, connections: [] } },
      'plaid-link-token': { body: { linkToken: 'link-sandbox-1', mode: 'new' } },
      'plaid-exchange': { body: { outcome: 'created' } },
    })
    await act(async () => { (host.querySelector('[data-testid="bank-connect"]') as HTMLButtonElement).click() })
    await flush()
    expect(openPlaidLink).toHaveBeenCalledTimes(1)
    const opts = openPlaidLink.mock.calls[0][0] as { linkToken: string; onSuccess: (t: string) => Promise<void> }
    expect(opts.linkToken).toBe('link-sandbox-1')
    await act(async () => { await opts.onSuccess('public-sandbox-abcdef123456') })
    const exchangeCall = fetchMock.mock.calls.find(c => String(c[0]).endsWith('plaid-exchange'))!
    expect(JSON.parse((exchangeCall[1] as { body: string }).body)).toEqual({ publicToken: 'public-sandbox-abcdef123456' })
    expect(host.innerHTML).not.toContain('public-sandbox')
  })

  it('a failed link-token request shows a sanitized message and no Link opens', async () => {
    await mount({
      'plaid-connection-status': { body: { environment: 'sandbox', connected: false, connections: [] } },
      'plaid-link-token': { status: 502, body: { error: 'The bank connection service is unavailable.' } },
    })
    await act(async () => { (host.querySelector('[data-testid="bank-connect"]') as HTMLButtonElement).click() })
    await flush()
    expect(openPlaidLink).not.toHaveBeenCalled()
    expect(host.querySelector('[role="alert"]')!.textContent).toMatch(/unavailable/)
  })

  it('Disconnect asks for confirmation first and does nothing if declined', async () => {
    await mount({ 'plaid-connection-status': { body: { environment: 'sandbox', connected: true, connections: [conn()] } }, 'plaid-disconnect': { body: { status: 'disconnected' } } })
    vi.stubGlobal('confirm', () => false); (window as any).confirm = () => false
    const btn = [...host.querySelectorAll('button')].find(b => b.textContent === 'Disconnect') as HTMLButtonElement
    await act(async () => { btn.click() }); await flush()
    expect(fetchMock.mock.calls.some(c => String(c[0]).endsWith('plaid-disconnect'))).toBe(false)
    ;(window as any).confirm = () => true
    await act(async () => { btn.click() }); await flush()
    const call = fetchMock.mock.calls.find(c => String(c[0]).endsWith('plaid-disconnect'))!
    expect(JSON.parse((call[1] as { body: string }).body)).toEqual({ itemId: 'i1' })
  })

  it('uses 44px touch targets and the app theme tokens', async () => {
    await mount({ 'plaid-connection-status': { body: { environment: 'sandbox', connected: false, connections: [] } } })
    expect(host.querySelector('[data-testid="bank-connect"]')!.className).toContain('min-h-[44px]')
  })

  describe('BANK-3 account discovery + mapping', () => {
    const acct = (over: Record<string, unknown> = {}) => ({ id: 'a1', connectionId: 'i1', institutionName: 'Tartan Bank', name: 'Tartan Checking', officialName: null, mask: '0000', type: 'depository', subtype: 'checking', live: true, mapping: null, ...over })
    const cash = [{ id: 'f1', displayName: 'Wells Fargo Business Checking 6960', accountType: 'checking', ownershipContext: 'business' }, { id: 'f2', displayName: 'Savings', accountType: 'savings', ownershipContext: 'business' }]
    const base = (accounts: unknown[]) => ({ 'plaid-connection-status': { body: { environment: 'sandbox', connected: true, connections: [conn()] } }, 'plaid-accounts': { body: { accounts, cashAccounts: cash } } })

    it('shows bank accounts compactly as Bank account vs Cash OS account, with no ids, balances or raw data', async () => {
      await mount(base([acct(), acct({ id: 'a2', name: 'Tartan Savings', mask: '1111', subtype: 'savings', mapping: { id: 'm1', financialAccountId: 'f1', financialAccountName: 'Wells Fargo Business Checking 6960' } })]))
      const rows = [...host.querySelectorAll('[data-testid="bank-account-row"]')]
      expect(rows).toHaveLength(2)
      expect(rows[0].textContent).toMatch(/Bank account · Tartan Checking ••••0000/); expect(rows[0].textContent).toMatch(/Checking/); expect(rows[0].textContent).toMatch(/Not mapped/)
      expect(rows[1].textContent).toMatch(/Cash OS account → Wells Fargo Business Checking 6960/); expect(rows[1].textContent).toMatch(/Mapped/)
      expect([...rows[0].querySelectorAll('button')].map(b => b.textContent)).toEqual(['Map account'])
      expect([...rows[1].querySelectorAll('button')].map(b => b.textContent)).toEqual(['Change mapping', 'Remove mapping'])
      expect(host.textContent).not.toMatch(/\ba1\b|\bi1\b|balance|access|token|json/i)
    })

    it('mapping is an explicit owner choice: pick a Cash OS account, Save posts the ids only, and nothing is auto-selected', async () => {
      await mount(base([acct()]))
      await act(async () => { (host.querySelector('[data-testid="bank-account-row"] button') as HTMLButtonElement).click() })
      const select = host.querySelector('select') as HTMLSelectElement
      expect(select.value).toBe('')
      expect([...select.options].map(o => o.textContent)).toContain('Wells Fargo Business Checking 6960 · Checking · Business')
      const save = [...host.querySelectorAll('button')].find(b => b.textContent === 'Save mapping') as HTMLButtonElement
      expect(save.disabled).toBe(true)
      await act(async () => { select.value = 'f1'; select.dispatchEvent(new Event('change', { bubbles: true })) })
      await act(async () => { (([...host.querySelectorAll('button')].find(b => b.textContent === 'Save mapping')) as HTMLButtonElement).click() })
      await flush()
      const post = fetchMock.mock.calls.find(([u, init]) => String(u).endsWith('plaid-accounts') && init?.method === 'POST')!
      expect(JSON.parse(post[1].body)).toEqual({ action: 'map', providerAccountId: 'a1', financialAccountId: 'f1' })
    })

    it('removing a mapping asks for confirmation and posts only the bank account id', async () => {
      vi.stubGlobal('confirm', () => true)
      await mount(base([acct({ mapping: { id: 'm1', financialAccountId: 'f1', financialAccountName: 'Wells Fargo Business Checking 6960' } })]))
      await act(async () => { ([...host.querySelectorAll('button')].find(b => b.textContent === 'Remove mapping') as HTMLButtonElement).click() })
      await flush()
      const post = fetchMock.mock.calls.find(([u, init]) => String(u).endsWith('plaid-accounts') && init?.method === 'POST')!
      expect(JSON.parse(post[1].body)).toEqual({ action: 'unmap', providerAccountId: 'a1' })
    })

    it('a Cash OS account already mapped elsewhere is disabled in the chooser', async () => {
      await mount(base([acct(), acct({ id: 'a2', mask: '1111', mapping: { id: 'm1', financialAccountId: 'f1', financialAccountName: 'Wells Fargo Business Checking 6960' } })]))
      await act(async () => { (host.querySelector('[data-testid="bank-account-row"] button') as HTMLButtonElement).click() })
      const opt = [...(host.querySelector('select') as HTMLSelectElement).options].find(o => o.value === 'f1')!
      expect(opt.disabled).toBe(true); expect(opt.textContent).toMatch(/already mapped/)
    })

    it('accounts that are no longer live offer no mapping controls and are not listed as connected', async () => {
      await mount(base([acct({ live: false })]))
      expect(host.querySelector('[data-testid="bank-account-row"]')).toBeNull()
      expect(host.querySelector('[data-testid="bank-no-accounts"]')).not.toBeNull()
    })

    it('shows a retry control when no accounts have been loaded, and retry calls only the discover action', async () => {
      await mount(base([]))
      await act(async () => { ([...host.querySelectorAll('button')].find(b => b.textContent === 'Find bank accounts') as HTMLButtonElement).click() })
      await flush()
      const post = fetchMock.mock.calls.find(([u, init]) => String(u).endsWith('plaid-accounts') && init?.method === 'POST')!
      expect(JSON.parse(post[1].body)).toEqual({ action: 'discover', itemId: 'i1' })
    })
  })
})
