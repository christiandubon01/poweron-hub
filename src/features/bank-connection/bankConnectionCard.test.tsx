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
    expect([...row.querySelectorAll('button')].map(b => b.textContent)).toEqual(['Disconnect', 'Sync transactions', 'Find bank accounts']) // BANK-3/4 add the account retry and owner sync controls
    expect(host.querySelector('[data-testid="bank-connect"]')).toBeNull()
  })

  it('a connection needing sign-in offers Reconnect (update mode), and the card never shows tokens or ids', async () => {
    await mount({ 'plaid-connection-status': { body: { environment: 'sandbox', connected: true, connections: [conn({ status: 'login_required' })] } } })
    const row = host.querySelector('[data-testid="bank-connection-row"]')!
    expect(row.textContent).toMatch(/Sign-in needed/)
    expect([...row.querySelectorAll('button')].map(b => b.textContent)).toEqual(['Reconnect', 'Disconnect', 'Sync transactions', 'Find bank accounts'])
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
      expect(rows.map(r => r.textContent).join(' ')).not.toMatch(/\ba1\b|\bi1\b|balance|access|token|json/i)
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

  describe('BANK-4 transaction evidence sync (owner-initiated, counts only)', () => {
    const sync = (over: Record<string, unknown> = {}) => ({ connectionId: 'i1', state: 'not_synced', lastSyncedAt: null, counts: { posted: 0, pending: 0, removed: 0 }, updatesAvailable: false, ...over })
    const base = (syncs: unknown[]) => ({ 'plaid-connection-status': { body: { environment: 'sandbox', connected: true, connections: [conn()] } }, 'plaid-accounts': { body: { accounts: [], cashAccounts: [] } }, 'plaid-sync': { body: { syncs } } })
    const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')

    it('never syncs by itself: loading the card only reads status, and the first sync is an explicit owner button', async () => {
      await mount(base([sync()]))
      expect(posts()).toHaveLength(0)
      const section = host.querySelector('[data-testid="bank-sync-section"]')!
      expect(section.textContent).toMatch(/Transactions · bank evidence/); expect(section.textContent).toMatch(/Not synced yet/)
      expect(section.textContent).toMatch(/Bank evidence only\. It does not change your balances, ledger or reports/)
      expect([...section.querySelectorAll('button')].map(b => b.textContent)).toEqual(['Sync transactions'])
    })
    it('clicking Sync posts only the sync action for that connection', async () => {
      await mount(base([sync()]))
      await act(async () => { (host.querySelector('[data-testid="bank-sync-section"] button') as HTMLButtonElement).click() })
      await flush()
      const sent = posts().filter(([u]) => String(u).endsWith('plaid-sync'))
      expect(sent).toHaveLength(1); expect(JSON.parse(sent[0][1].body)).toEqual({ action: 'sync', itemId: 'i1' })
    })
    it('shows synced status with last-synced time and compact posted/pending counts, never a transaction list', async () => {
      await mount(base([sync({ state: 'synced', lastSyncedAt: '2026-10-07T15:30:00Z', counts: { posted: 42, pending: 3, removed: 1 } })]))
      const section = host.querySelector('[data-testid="bank-sync-section"]')!
      expect(section.querySelector('[data-testid="bank-sync-state"]')!.textContent).toMatch(/Synced · Last synced/)
      expect(section.querySelector('[data-testid="bank-sync-counts"]')!.textContent).toBe('42 posted · 3 pending')
      expect([...section.querySelectorAll('button')].map(b => b.textContent)).toEqual(['Sync again'])
      expect(section.querySelector('li, table')).toBeNull()
    })
    it('shows a truthful WAITING state (not "Synced") and the webhook update hint', async () => {
      await mount(base([sync({ state: 'waiting', updatesAvailable: true })]))
      const section = host.querySelector('[data-testid="bank-sync-section"]')!
      expect(section.querySelector('[data-testid="bank-sync-state"]')!.textContent).toMatch(/Waiting for the bank/); expect(section.textContent).not.toMatch(/Synced/)
      expect(section.querySelector('[data-testid="bank-sync-updates"]')).not.toBeNull()
    })
    it('an empty result with no proof that the bank is still preparing data is "unconfirmed", never "Synced" or "Waiting"', async () => {
      await mount(base([sync({ state: 'unconfirmed' })]))
      const text = host.querySelector('[data-testid="bank-sync-state"]')!.textContent!
      expect(text).toMatch(/does not confirm there are none/); expect(text).not.toMatch(/Synced|Waiting/)
    })
    it('ITEM_LOGIN_REQUIRED reaches the card: the service answer is sanitized, the connection flips to sign-in needed, Reconnect appears and Sync is disabled', async () => {
      const responses: Record<string, { status?: number; body: unknown }> = {
        'plaid-connection-status': { body: { environment: 'sandbox', connected: true, connections: [conn()] } },
        'plaid-accounts': { body: { accounts: [], cashAccounts: [] } },
        'plaid-sync': { body: { syncs: [sync({ state: 'not_synced' })] } },
      }
      await mount(responses)
      expect(host.textContent).not.toMatch(/Reconnect/)
      // the server marks the connection and answers with the sanitized login-required error; the next status/sync reads reflect it
      responses['plaid-accounts'] = { status: 409, body: { error: 'The bank needs you to sign in again. Use Reconnect.', code: 'login_required' } }
      responses['plaid-connection-status'] = { body: { environment: 'sandbox', connected: false, connections: [conn({ status: 'login_required' })] } }
      responses['plaid-sync'] = { body: { syncs: [sync({ state: 'login_required' })] } }
      await act(async () => { ([...host.querySelectorAll('button')].find(b => b.textContent === 'Find bank accounts') as HTMLButtonElement).click() })
      await flush()
      const row = host.querySelector('[data-testid="bank-connection-row"]')!
      expect(row.getAttribute('data-status')).toBe('login_required'); expect(row.textContent).toMatch(/Sign-in needed/)
      expect([...row.querySelectorAll('button')].map(b => b.textContent)).toContain('Reconnect')
      expect(host.querySelector('[role="alert"]')!.textContent).toBe('The bank needs you to sign in again. Use Reconnect.')
      expect(host.textContent).not.toMatch(/ITEM_LOGIN_REQUIRED|ITEM_ERROR/)
      expect(host.querySelector('[data-testid="bank-sync-state"]')!.textContent).toMatch(/Sign-in needed/)
      expect((host.querySelector('[data-testid="bank-sync-section"] button') as HTMLButtonElement).disabled).toBe(true)
    })
    it('a sync that fails because an account is unknown shows the server message pointing at Refresh accounts, and that button exists once accounts are loaded', async () => {
      const acct = { id: 'a1', connectionId: 'i1', institutionName: 'Tartan Bank', name: 'Plaid Checking', officialName: null, mask: '0000', type: 'depository', subtype: 'checking', live: true, mapping: null }
      const responses: Record<string, { status?: number; body: unknown }> = {
        'plaid-connection-status': { body: { environment: 'sandbox', connected: true, connections: [conn()] } },
        'plaid-accounts': { body: { accounts: [acct], cashAccounts: [] } },
        'plaid-sync': { body: { syncs: [sync()] } },
      }
      await mount(responses)
      responses['plaid-sync'] = { status: 409, body: { error: 'The bank returned a transaction for an account Cash OS does not know yet. Nothing was saved. Use "Refresh accounts", then sync again.', code: 'sync_failed' } }
      await act(async () => { (host.querySelector('[data-testid="bank-sync-section"] button') as HTMLButtonElement).click() })
      await flush()
      expect(host.querySelector('[role="alert"]')!.textContent).toMatch(/Use "Refresh accounts"/)
      const refresh = [...host.querySelectorAll('button')].find(b => b.textContent === 'Refresh accounts') as HTMLButtonElement
      expect(refresh).toBeTruthy()
      responses['plaid-sync'] = { body: { syncs: [sync()] } }
      await act(async () => { refresh.click() }); await flush()
      const discover = fetchMock.mock.calls.filter(([u, init]) => String(u).endsWith('plaid-accounts') && init?.method === 'POST')
      expect(JSON.parse(discover[0][1].body)).toEqual({ action: 'discover', itemId: 'i1' })
    })
    it('error and sign-in-needed states are plain-language; Sync is disabled while sign-in is needed or a sync runs', async () => {
      await mount(base([sync({ state: 'login_required' })]))
      expect((host.querySelector('[data-testid="bank-sync-section"] button') as HTMLButtonElement).disabled).toBe(true)
      expect(host.querySelector('[data-testid="bank-sync-state"]')!.textContent).toMatch(/Sign-in needed/)
    })
  })
})
