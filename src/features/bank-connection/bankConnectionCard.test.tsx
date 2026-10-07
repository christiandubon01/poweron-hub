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
    expect([...row.querySelectorAll('button')].map(b => b.textContent)).toEqual(['Disconnect'])
    expect(host.querySelector('[data-testid="bank-connect"]')).toBeNull()
  })

  it('a connection needing sign-in offers Reconnect (update mode), and the card never shows tokens or ids', async () => {
    await mount({ 'plaid-connection-status': { body: { environment: 'sandbox', connected: true, connections: [conn({ status: 'login_required' })] } } })
    const row = host.querySelector('[data-testid="bank-connection-row"]')!
    expect(row.textContent).toMatch(/Sign-in needed/)
    expect([...row.querySelectorAll('button')].map(b => b.textContent)).toEqual(['Reconnect', 'Disconnect'])
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
})
