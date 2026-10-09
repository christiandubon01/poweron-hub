// @vitest-environment happy-dom
/** BANK-6F step 7: financial account cards (presentation only; balances are shown exactly as before). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('@/services/authedFetch', () => ({ authedJsonHeaders: async () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer t' }) }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => ({ select: () => ({ eq: async () => ({ data: [], error: null }) }) }), rpc: async () => ({ data: null, error: null }) } }))
vi.mock('@/store/demoStore', () => ({ useDemoMode: () => ({ isDemoMode: false, hasHydrated: true }) }))
import { CashTransactionsView } from './CashOsViews'
import { money } from './cashOsUi'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const flush = async () => { await act(async () => { await new Promise(r => setTimeout(r, 5)) }) }
const acct = (over: Record<string, unknown>) => ({ id: 'a', display_name: 'Account', status: 'active', ownership_context: 'business', account_class: 'asset', account_type: 'checking', include_in_cash: true, ...over })
const snapshot = (accounts: unknown[], balances: Record<string, number>) => ({ accounts, transactions: [], accountBalancesMinor: balances, setup: null }) as any

describe('BANK-6F step 7 · financial account cards', () => {
  let host: HTMLDivElement, root: Root
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: 'no' }) }))) })
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

  it('each card shows the name, Business/Personal · type, the SAME money() balance, and Asset/Liability and cash inclusion as chips', async () => {
    const accounts = [acct({ id: 'chk', display_name: 'WF Business Checking' }), acct({ id: 'card', display_name: 'Business Card', account_class: 'liability', account_type: 'credit_card', include_in_cash: false })]
    const balances = { chk: 1840255, card: -211508 }
    await act(async () => { root.render(<CashTransactionsView snapshot={snapshot(accounts, balances)} onAdd={() => {}} />) }); await flush()
    const cards = [...host.querySelectorAll('[data-testid="account-card"]')] as HTMLElement[]
    expect(cards).toHaveLength(2)
    expect(cards.map(c => c.querySelector('[data-testid="account-card-balance"]')!.textContent)).toEqual([money(1840255), money(-211508)])
    expect(cards.map(c => c.querySelector('[data-testid="account-card-type"]')!.textContent)).toEqual(['Business · Checking', 'Business · Credit card'])
    expect(cards.map(c => [...c.querySelectorAll('[data-tone]')].map(x => x.textContent))).toEqual([['Asset', 'Included in cash'], ['Liability', 'Excluded from cash']])
    expect(cards[0].querySelector('[data-testid="account-card-balance"]')!.className).toContain('tabular-nums')
  })

  it('D11: "+ Add" keeps the orange Cash OS action at a 44px touch target', async () => {
    await act(async () => { root.render(<CashTransactionsView snapshot={snapshot([acct({})], { a: 0 })} onAdd={() => {}} />) }); await flush()
    const add = [...host.querySelectorAll('button')].find(b => b.textContent === '+ Add')!
    expect(add.className).toContain('min-h-[44px]'); expect(add.className).toContain('bg-orange-500')
  })
})
