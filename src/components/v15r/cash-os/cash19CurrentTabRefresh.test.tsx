// @vitest-environment happy-dom
// PRODUCTION REGRESSION: after "Reconcile balance" the CURRENT, still-mounted Transactions tab showed the
// OLD balance ($0.00) for 7+ seconds and only a tab round trip showed -$103.00.
//
// Root cause: public/sw.js answered every Supabase GET from Cache Storage first
// (stale-while-revalidate). The authoritative post-mutation read of the SAME url was therefore served the
// pre-write rows. The app committed that stale read, closed the sheet, and rendered $0.00; the background
// revalidation only made the NEXT read of that url correct.
//
// These tests use the actual path: DebtKiller → configured Session Assumptions → Transactions tab →
// CashTransactionsView account card, with the REAL service worker between the page and the network, and
// assert on the VISIBLE account card of the mounted tab without any tab change.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import DebtKiller from '@/views/DebtKiller'
import { cashOsSessionKey } from '@/services/cashOsSessionSetup'
import { accountBalanceMinor } from '@/finance/ledgerCalculations'
import { createServiceWorkerFetch } from './serviceWorkerHarness'

const db = vi.hoisted(() => ({
  accounts: [] as any[], transactions: [] as any[], networkGets: 0, readLatency: 25, writeLatency: 10,
  pageFetch: null as null | ((url: string, init?: RequestInit) => Promise<Response>),
}))
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const REST = 'https://proj.supabase.co/rest/v1'

vi.mock('@/store/demoStore', () => ({ useDemoMode: () => ({ isDemoMode: false, hasHydrated: true }) }))

// Writes go straight to the database (the worker never intercepts non-GET requests).
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    rpc: async () => ({ data: 'org-1', error: null }),
    from: (table: string) => ({
      insert: (row: any) => ({
        select: () => ({
          single: async () => {
            await sleep(db.writeLatency)
            const saved = { id: `tx-${db.transactions.length + 1}`, status: 'posted', ...row }
            db.transactions.push(saved)
            return { data: saved, error: null }
          },
        }),
      }),
      update: (patch: any) => {
        const filters: Array<[string, unknown]> = []
        const chain: any = {
          eq: (col: string, val: unknown) => { filters.push([col, val]); return chain },
          then: (resolve: (v: unknown) => void) => (async () => {
            await sleep(db.writeLatency)
            if (table === 'financial_accounts') {
              for (const acc of db.accounts) if (filters.every(([c, v]) => acc[c] === v)) Object.assign(acc, patch)
            }
            return { error: null }
          })().then(resolve),
        }
        return chain
      },
    }),
  },
}))

// The Cash OS reads are real HTTP GETs, issued through the service-worker-controlled fetch with the same
// production-shaped urls on every refresh (that identical url is what the cache keys on).
vi.mock('@/services/cashOsReadService', () => ({
  CASH_OS_TIMEZONE: 'America/Los_Angeles',
  resolveCashOsScope: async () => ({ context: { organizationId: 'org-1', userId: 'user-1' }, storedTimezone: 'America/Los_Angeles' }),
  readCashOsSources: async () => {
    const read = async (table: string) => {
      const res = await db.pageFetch!(`${REST}/${table}?select=*&organization_id=eq.org-1&order=id.asc&offset=0&limit=500`)
      return res.json()
    }
    const [accounts, transactions] = await Promise.all([read('financial_accounts'), read('financial_transactions')])
    return { organizationId: 'org-1', asOfDate: '2026-10-05', asOfTimestamp: '2026-10-05T20:00:00Z',
      accounts, transactions, obligations: [], occurrences: [], commitments: [], liabilityTerms: [],
      timeEntries: [], sessions: [], bridges: [], employees: [] }
  },
}))

vi.mock('@/finance/cashOsSnapshot', () => ({
  buildCashOsSnapshot: (input: any) => ({
    ...input, asOfDate: '2026-10-05', payrollDiagnostics: [],
    accountBalancesMinor: Object.fromEntries(input.accounts.map((a: any) =>
      [a.id, accountBalanceMinor(a.id, input.transactions)])),
  }),
}))
vi.mock('@/components/v15r/cash-os/CashOsOutlook', () => ({ default: () => <div>outlook</div> }))

const NAME = 'Wells Fargo Personal Checking 3809'
const seedAccount = () => ({
  id: 'wf3809', organization_id: 'org-1', display_name: NAME, account_type: 'checking', account_class: 'asset',
  ownership_context: 'personal', include_in_cash: true, status: 'active', archived_at: null,
})
const seedTx = () => ({
  id: 'seed', organization_id: 'org-1', account_id: 'wf3809', status: 'posted', transaction_date: '2026-09-01',
  transaction_kind: 'opening_balance', amount_minor: 0, description: 'Opening balance', category: null, project_id: null,
})

describe('Cash OS current-tab refresh through the real service worker', () => {
  let host: HTMLDivElement
  let root: Root

  async function until(check: () => boolean, ms = 3000) {
    const end = Date.now() + ms
    while (!check() && Date.now() < end) await act(async () => { await sleep(10) })
    if (!check()) throw new Error(`timeout waiting; view=${host.textContent?.slice(0, 500)}`)
  }
  const settleIdle = () => act(async () => { await sleep(200) })
  const click = async (el: Element | null | undefined) => {
    if (!el) throw new Error('element missing; view=' + host.textContent?.slice(0, 300))
    await act(async () => { (el as HTMLElement).click() })
  }
  const byText = (selector: string, text: string) =>
    [...host.querySelectorAll(selector)].find(e => e.textContent?.trim() === text)
  const setValue = async (input: HTMLInputElement, value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const currentTab = () => host.querySelector('nav button[aria-current="page"]')?.textContent
  const card = (name: string) =>
    [...host.querySelectorAll('strong')].find(s => s.textContent === name)?.closest('div.rounded-xl')?.textContent

  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    db.accounts = [seedAccount()]; db.transactions = [seedTx()]; db.networkGets = 0
    const sw = createServiceWorkerFetch(async (request: Request) => {
      db.networkGets++
      await sleep(db.readLatency)
      const table = new URL(request.url).pathname.split('/').pop()
      const rows = table === 'financial_accounts' ? db.accounts : table === 'financial_transactions' ? db.transactions : []
      return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    db.pageFetch = sw.pageFetch
    sessionStorage.clear()
    // Session Assumptions CONFIRMED: the normal configured path, not PreSetupTransactions.
    sessionStorage.setItem(cashOsSessionKey('org-1'), JSON.stringify({ version: 1, organizationId: 'org-1',
      payrollPaidThroughDate: '2026-09-28', protectionHorizonDays: 7, operatingFloorMinor: 0,
      taxReserve: { kind: 'disabled' }, includeOptionalObligations: false, includeOpenShiftEstimates: false,
      timezoneConfirmed: true, confirmedAt: '2026-09-29T20:00:00Z' }))
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)

    await act(async () => { root.render(<DebtKiller />) })
    await until(() => !!byText('nav button', 'Transactions'))
    await click(byText('nav button', 'Transactions'))
    await until(() => !!card(NAME))
    expect(host.textContent).toContain('Session assumptions · confirmed')
  })
  afterEach(async () => { await act(async () => { root.unmount() }); host.remove(); vi.unstubAllGlobals() })

  it('Reconcile to -$103.00: the SAME mounted Transactions card changes $0.00 -> -$103.00 with no tab change', async () => {
    expect(card(NAME)).toContain('$0.00')
    expect(card(NAME)).not.toContain('-$103.00')

    await click(byText('button', '+ Add'))
    await click(byText('nav button', 'Opening Balance / Reconcile'))
    await setValue(host.querySelector('form input[type="text"]') as HTMLInputElement, '-103')
    expect(host.textContent).toContain('-$103.00')
    await click(host.querySelector('form button[type="submit"]'))

    await until(() => !host.querySelector('[role="dialog"]'))
    await settleIdle() // no tab change, no manual refresh: just let everything in flight finish

    expect(currentTab()).toBe('Transactions')
    expect(db.transactions[db.transactions.length - 1].amount_minor).toBe(-10300)
    expect(card(NAME)).toContain('-$103.00')
    expect(card(NAME)).not.toMatch(/(^|[^-])\$0\.00/)
  })

  it('Rename: the same mounted card shows the new name with no tab change', async () => {
    const menu = [...host.querySelectorAll('strong')].find(s => s.textContent === NAME)!
      .closest('div.rounded-xl')!.querySelector('button[aria-label="Account options"]')
    await click(menu)
    await click(byText('button', 'Edit account'))
    await setValue(host.querySelector('input[type="text"]') as HTMLInputElement, 'Wells Fargo Personal Checking')
    await click(byText('button', 'Save'))
    await until(() => !byText('button', 'Saving…'))
    await settleIdle()
    expect(currentTab()).toBe('Transactions')
    expect(card('Wells Fargo Personal Checking')).toBeTruthy()
    expect(card(NAME)).toBeUndefined()
  })

  it('lifecycle comparison: a tab switch performs NO read, so it cannot be what fetches fresh data', async () => {
    await click(byText('button', '+ Add'))
    await click(byText('nav button', 'Opening Balance / Reconcile'))
    await setValue(host.querySelector('form input[type="text"]') as HTMLInputElement, '-103')
    await click(host.querySelector('form button[type="submit"]'))
    await until(() => !host.querySelector('[role="dialog"]'))
    await settleIdle()
    const readsBeforeSwitch = db.networkGets

    await click(byText('nav button', 'Outlook'))
    await click(byText('nav button', 'Transactions'))
    await settleIdle()

    expect(db.networkGets).toBe(readsBeforeSwitch)
    expect(card(NAME)).toContain('-$103.00')
  })
})
