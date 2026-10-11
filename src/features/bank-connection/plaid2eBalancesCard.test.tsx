// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('@/services/authedFetch', () => ({ authedJsonHeaders: async () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer t' }) }))
vi.mock('./plaidLink', () => ({ openPlaidLink: vi.fn(), readPendingOauth: () => null, rememberLinkToken: () => undefined, clearPendingOauth: () => undefined }))
import BankConnectionCard from './BankConnectionCard'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const flush = async () => { await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }
const conn = { id: 'i1', provider: 'plaid', status: 'healthy', environment: 'production', institutionName: 'Wells Fargo', connectedAt: '2026-10-06T12:00:00Z', disconnectedAt: null, lastSuccessfulSyncAt: null }
const base = { accountRef: 'r', connectionId: 'i1', mask: '1234', restricted: false, ageHours: 1, observedAt: '2026-10-11T11:00:00Z', observedIsProvider: true,
  bankBalanceMinor: null, availableMinor: null, owedMinor: null, creditInFavourMinor: null, unusedCreditMinor: null, creditLimitMinor: null }
const BALANCES = { enabled: true, accounts: [
  { ...base, accountRef: 'a', name: 'Business Checking', accountClass: 'bank_cash', freshness: 'fresh', bankBalanceMinor: 123_456, availableMinor: 100_000 },
  { ...base, accountRef: 'b', name: 'Savings', accountClass: 'bank_cash', freshness: 'aging', bankBalanceMinor: 500_000, availableMinor: null },
  { ...base, accountRef: 'c', name: 'Visa', accountClass: 'credit_card', freshness: 'stale', owedMinor: 230_000, unusedCreditMinor: 770_000, creditLimitMinor: 1_000_000 },
] }

describe('PLAID-2E balances on the bank card', () => {
  let host: HTMLDivElement, root: Root, fetchMock: ReturnType<typeof vi.fn>
  const mount = async (responses: Record<string, { status?: number; body: unknown }>) => {
    fetchMock = vi.fn(async (url: string, init?: any) => {
      const key = Object.keys(responses).find(k => String(url).endsWith(k))
      const r = (key && responses[key]) || { status: 500, body: {} }
      return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body }
    })
    vi.stubGlobal('fetch', fetchMock)
    await act(async () => { root.render(<BankConnectionCard />) })
    await flush()
  }
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })
  const status = { 'plaid-connection-status': { body: { environment: 'production', connected: true, connections: [conn] } } }

  it('is invisible when the server has balances switched off or does not know them', async () => {
    await mount({ ...status, 'plaid-balances': { body: { enabled: false, accounts: [] } } })
    expect(host.querySelector('[data-testid="bank-balances-section"]')).toBeNull()
    await act(async () => { root.unmount() }); root = createRoot(host)
    await mount({ ...status })
    expect(host.querySelector('[data-testid="bank-balances-section"]')).toBeNull()
  })

  it('shows bank cash, card debt and unused credit as three different things, with freshness, and never calls credit cash', async () => {
    await mount({ ...status, 'plaid-balances': { body: BALANCES } })
    const cash = host.querySelector('[data-testid="bank-balances-cash"]')!.textContent!
    expect(cash).toMatch(/Business Checking ••••1234: \$1,234\.56 in the account/); expect(cash).toMatch(/available \$1,000\.00/)
    expect(cash).toMatch(/Savings[^]*available not reported by the bank/)   // unknown stays unknown, never copied from the balance
    const cards = host.querySelector('[data-testid="bank-balances-cards"]')!.textContent!
    expect(cards).toMatch(/owe \$2,300\.00/); expect(cards).toMatch(/unused credit \$7,700\.00 \(not cash\)/)
    expect(cash).not.toMatch(/7,700|2,300/)                                // card numbers never appear among cash
    const fresh = [...host.querySelectorAll('[data-testid="bank-balance-freshness"]')].map(e => e.textContent)
    expect(fresh[0]).toMatch(/Fresh/); expect(fresh[1]).toMatch(/Getting old/); expect(fresh[2]).toMatch(/Stale/)
    expect(host.textContent).toMatch(/Account balances are not profit/)
    expect(host.innerHTML).not.toMatch(/access-|v1:|public-/)
  })

  it('Refresh balances asks the server for one refresh of that connection and reloads', async () => {
    await mount({ ...status, 'plaid-balances': { body: BALANCES } })
    await act(async () => { (host.querySelector('[data-testid="bank-balances-refresh"]') as HTMLButtonElement).click() }); await flush()
    const post = fetchMock.mock.calls.find(c => String(c[0]).endsWith('plaid-balances') && c[1]?.method === 'POST')!
    expect(JSON.parse(post[1].body)).toEqual({ action: 'refresh', itemId: 'i1' })
  })

  it('PLAID-2H: the card lists what needs attention, actions first, from the status it already has', async () => {
    await mount({ ...status, 'plaid-balances': { body: BALANCES }, 'plaid-sync': { body: { syncs: [{ connectionId: 'i1', state: 'error', lastSyncedAt: null, counts: { posted: 0, pending: 0, removed: 0 }, updatesAvailable: false, lastErrorCode: 'ACCOUNT_UNKNOWN', recovery: 'refresh_accounts', recoveryText: 'Review or refresh the accounts.' }] } } })
    const items = [...host.querySelectorAll('[data-testid="bank-attention"] li')]
    expect(items[0].getAttribute('data-severity')).toBe('action'); expect(items[0].textContent).toMatch(/ACCOUNT_UNKNOWN/)
    expect(items.some(i => /stale/.test(i.textContent ?? ''))).toBe(true)
  })

  it('PLAID-2H: a blocked update is explained in counts, offers a confirmed discard, and says discarding does not shrink an oversized update', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await mount({ ...status, 'plaid-sync': { body: { syncs: [{ connectionId: 'i1', state: 'error', lastSyncedAt: null, counts: { posted: 0, pending: 0, removed: 0 }, updatesAvailable: false, lastErrorCode: 'RUN_TOO_LARGE', recovery: 'owner_review',
      recoveryText: 'This needs owner review before syncing again.', blocked: { runId: '11111111-1111-4111-8111-111111111111', reason: 'RUN_TOO_LARGE', stagedRows: 60000, pagesStaged: 120, restarts: 0, applyFailures: 0, startedAt: '2026-10-11T00:00:00Z' } }], resumableSyncEnabled: true } } })
    const box = host.querySelector('[data-testid="bank-sync-blocked"]')!
    expect(box.textContent).toMatch(/60,000 changes \(120 pages\)/); expect(box.textContent).toMatch(/Nothing from it was saved/); expect(box.textContent).toMatch(/stops at the same limit/)
    await act(async () => { (host.querySelector('[data-testid="bank-sync-discard"]') as HTMLButtonElement).click() }); await flush()
    const post = fetchMock.mock.calls.find(c => String(c[0]).endsWith('plaid-sync') && c[1]?.method === 'POST')!
    expect(JSON.parse(post[1].body)).toEqual({ action: 'discard_blocked_run', itemId: 'i1', runId: '11111111-1111-4111-8111-111111111111', confirm: 'DISCARD' })
    confirm.mockRestore()
  })
})
