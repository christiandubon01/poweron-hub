// @vitest-environment happy-dom
// Regression: a successful Cash OS mutation must refresh the CURRENT view from authoritative data.
// Real DebtKiller + real useCashOsSnapshot + real CashOsAccountMenu / CashOsAddSheet /
// manualLedgerService. Only the network edge is faked: Supabase writes mutate an in-memory ledger and
// readCashOsSources reads that ledger after a latency, exactly like production reads.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import DebtKiller from '@/views/DebtKiller'
import { useCashOsSnapshot } from '@/hooks/useCashOsSnapshot'
import { cashOsSessionKey } from '@/services/cashOsSessionSetup'
import { accountBalanceMinor } from '@/finance/ledgerCalculations'

const db = vi.hoisted(() => ({
  accounts: [] as any[], transactions: [] as any[], events: [] as string[], readLatency: 40, writeLatency: 15,
  onWrite: null as null | (() => void),
}))

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

vi.mock('@/store/demoStore', () => ({ useDemoMode: () => ({ isDemoMode: false, hasHydrated: true }) }))

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
            const isAccount = table === 'financial_accounts'
            const saved = isAccount
              ? { id: `acc-${db.accounts.length + 1}`, status: 'active', archived_at: null, ...row }
              : { id: `tx-${db.transactions.length + 1}`, status: 'posted', ...row }
            ;(isAccount ? db.accounts : db.transactions).push(saved)
            db.events.push(`write:${table}:insert`)
            db.onWrite?.()
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
            for (const acc of db.accounts) {
              if (filters.every(([c, v]) => acc[c] === v)) Object.assign(acc, patch)
            }
            db.events.push(`write:${table}:update`)
            db.onWrite?.()
            return { error: null }
          })().then(resolve),
        }
        return chain
      },
    }),
  },
}))

vi.mock('@/services/cashOsReadService', () => ({
  CASH_OS_TIMEZONE: 'America/Los_Angeles',
  resolveCashOsScope: async () => ({ context: { organizationId: 'org-1', userId: 'user-1' }, storedTimezone: 'America/Los_Angeles' }),
  readCashOsSources: async () => {
    db.events.push('read:start')
    const accounts = db.accounts.map(a => ({ ...a }))
    const transactions = db.transactions.map(t => ({ ...t }))
    await sleep(db.readLatency)
    db.events.push('read:end')
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

const seedAccount = (over: Record<string, unknown> = {}) => ({
  id: 'bank', organization_id: 'org-1', display_name: 'Wells Fargo Personal Checking Acc',
  account_type: 'checking', account_class: 'asset', ownership_context: 'personal',
  include_in_cash: true, status: 'active', archived_at: null, ...over,
})
const seedTx = (amount_minor: number) => ({
  id: 'seed', organization_id: 'org-1', account_id: 'bank', status: 'posted', transaction_date: '2026-09-01',
  transaction_kind: 'opening_balance', amount_minor, description: 'Opening balance', category: null, project_id: null,
})

describe('Cash OS mutation → authoritative refresh → current view', () => {
  let host: HTMLDivElement
  let root: Root

  async function until(check: () => boolean, ms = 3000) {
    const end = Date.now() + ms
    while (!check() && Date.now() < end) await act(async () => { await sleep(10) })
    if (!check()) throw new Error(`timeout waiting; view=${host.textContent?.slice(0, 400)}`)
  }
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
  const accountCard = (name: string) =>
    [...host.querySelectorAll('strong')].find(s => s.textContent === name)?.closest('div.rounded-xl') as HTMLElement | undefined

  async function mountOnTransactions() {
    await act(async () => { root.render(<DebtKiller />) })
    await until(() => !!byText('nav button', 'Transactions'))
    await click(byText('nav button', 'Transactions'))
    await until(() => host.textContent?.includes('Financial accounts') === true)
  }

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    db.accounts = [seedAccount()]
    db.transactions = [seedTx(100)]
    db.events = []; db.onWrite = null
    sessionStorage.clear()
    sessionStorage.setItem(cashOsSessionKey('org-1'), JSON.stringify({ version: 1, organizationId: 'org-1',
      payrollPaidThroughDate: '2026-09-28', protectionHorizonDays: 7, operatingFloorMinor: 0,
      taxReserve: { kind: 'disabled' }, includeOptionalObligations: false, includeOpenShiftEstimates: false,
      timezoneConfirmed: true, confirmedAt: '2026-09-29T20:00:00Z' }))
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  })
  afterEach(async () => { await act(async () => { root.unmount() }); host.remove(); vi.unstubAllGlobals() })

  it('rename: Save keeps the form saving until refreshed data lands, then the same tab shows the new name', async () => {
    await mountOnTransactions()
    expect(accountCard('Wells Fargo Personal Checking Acc')).toBeTruthy()
    const readsBefore = db.events.filter(e => e === 'read:start').length

    await click(host.querySelector('button[aria-label="Account options"]'))
    await click(byText('button', 'Edit account'))
    await setValue(host.querySelector('input[type="text"]') as HTMLInputElement, 'Wells Fargo Personal Checking 3809')
    await click(byText('button', 'Save'))

    // Write accepted, authoritative refresh still reading: the form is still "Saving…", old card not yet replaced.
    await until(() => db.events.includes('write:financial_accounts:update'))
    await until(() => db.events.filter(e => e === 'read:start').length === readsBefore + 1)
    expect(byText('button', 'Saving…')).toBeTruthy()

    await until(() => !!accountCard('Wells Fargo Personal Checking 3809'))
    expect(accountCard('Wells Fargo Personal Checking Acc')).toBeUndefined()
    expect(byText('button', 'Saving…')).toBeUndefined()
    expect(currentTab()).toBe('Transactions')

    // The refresh read started strictly after the write was accepted.
    const write = db.events.indexOf('write:financial_accounts:update')
    expect(db.events.indexOf('read:start', write)).toBeGreaterThan(write)
  })

  it('reconcile $1 -> $53: the sheet closes only after refresh and the visible balance is $53.00', async () => {
    await mountOnTransactions()
    expect(accountCard('Wells Fargo Personal Checking Acc')?.textContent).toContain('$1.00')

    await click(byText('button', '+ Add'))
    await click(byText('nav button', 'Opening Balance / Reconcile'))
    await setValue(host.querySelector('form input[type="text"]') as HTMLInputElement, '53')
    expect(host.textContent).toContain('+$52.00')
    await click(host.querySelector('form button[type="submit"]'))

    // Mid-refresh: the sheet is still open (not closed ahead of the refreshed data).
    await until(() => db.events.includes('write:financial_transactions:insert'))
    expect(host.querySelector('[role="dialog"]')).toBeTruthy()

    await until(() => !host.querySelector('[role="dialog"]'))
    expect(accountCard('Wells Fargo Personal Checking Acc')?.textContent).toContain('$53.00')
    expect(currentTab()).toBe('Transactions')
    expect(db.transactions.filter(t => t.transaction_kind === 'balance_reconciliation')).toHaveLength(1)
    expect(db.transactions[db.transactions.length - 1].amount_minor).toBe(5200)
  })

  it('reconcile an overdrawn checking account $0 -> -$103 persists -10300 and shows -$103.00', async () => {
    db.transactions = [seedTx(0)]
    await mountOnTransactions()
    await click(byText('button', '+ Add'))
    await click(byText('nav button', 'Opening Balance / Reconcile'))
    await setValue(host.querySelector('form input[type="text"]') as HTMLInputElement, '-103')
    expect(host.textContent).toContain('-$103.00')
    expect(host.textContent).not.toContain('+$103.00')
    await click(host.querySelector('form button[type="submit"]'))
    await until(() => !host.querySelector('[role="dialog"]'))
    expect(db.transactions[db.transactions.length - 1].amount_minor).toBe(-10300)
    expect(accountCard('Wells Fargo Personal Checking Acc')?.textContent).toContain('-$103.00')
  })

  it('create account: the new account appears in the open workspace without leaving the sheet or tab', async () => {
    await mountOnTransactions()
    await click(byText('button', '+ Add'))
    await setValue(host.querySelector('form input[type="text"]') as HTMLInputElement, 'Savings Buffer')
    await click(host.querySelector('form button[type="submit"]'))
    await until(() => host.textContent?.includes('Account created: Savings Buffer') === true)
    // The sheet is still open (opening-balance step), yet the refreshed workspace behind it already
    // lists the new account: authoritative refresh happened without closing the sheet or changing tab.
    await until(() => !!accountCard('Savings Buffer'))
    expect(host.querySelector('[role="dialog"]')).toBeTruthy()
    expect(currentTab()).toBe('Transactions')
    expect(db.accounts.map(a => a.display_name)).toContain('Savings Buffer')

    await click(byText('button', 'Skip'))
    await until(() => !host.querySelector('[role="dialog"]'))
    expect(accountCard('Savings Buffer')).toBeTruthy()
  })

  it('archive then restore move the card between Active and Archived immediately', async () => {
    // A second cash account keeps the workspace ready (archiving the only one returns to account setup).
    db.accounts.push(seedAccount({ id: 'savings', display_name: 'Savings' }))
    db.transactions.push({ ...seedTx(500), id: 'seed2', account_id: 'savings' })
    await mountOnTransactions()
    const menu = accountCard('Wells Fargo Personal Checking Acc')!.querySelector('button[aria-label="Account options"]')
    await click(menu)
    await click(byText('button', 'Archive account'))
    await click(byText('button', 'Archive'))
    await until(() => host.textContent?.includes('Show 1 archived account') === true)
    expect(accountCard('Wells Fargo Personal Checking Acc')).toBeUndefined()

    await click(byText('button', '▼ Show 1 archived account'))
    await click(byText('button', 'Restore'))
    await until(() => !!accountCard('Wells Fargo Personal Checking Acc'))
    expect(host.textContent).not.toContain('archived account')
    expect(currentTab()).toBe('Transactions')
  })

  it('no mutation surface uses a timer, reload or polling workaround', () => {
    for (const rel of [
      'src/components/v15r/cash-os/CashOsAddSheet.tsx',
      'src/components/v15r/cash-os/CashOsAccountMenu.tsx',
      'src/components/v15r/cash-os/CashOsObligations.tsx',
      'src/components/v15r/cash-os/CashOsDebtPlan.tsx',
      'src/components/v15r/cash-os/CashOsDebtTermsEditor.tsx',
      'src/views/DebtKiller.tsx',
    ]) {
      const src = readFileSync(resolve(process.cwd(), rel), 'utf8')
      expect(src, rel).not.toMatch(/setTimeout|setInterval|location\.reload|window\.location\.reload/)
    }
  })
})

// ── Central contract ───────────────────────────────────────────────────────────

describe('useCashOsSnapshot refresh contract', () => {
  let host: HTMLDivElement
  let root: Root
  let api: ReturnType<typeof useCashOsSnapshot>
  function Probe() {
    api = useCashOsSnapshot(false)
    return <div>{api.status}:{api.refreshing ? 'refreshing' : 'idle'}:{api.sources?.accounts[0]?.display_name ?? '-'}</div>
  }
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    db.accounts = [seedAccount({ display_name: 'Old' })]; db.transactions = [seedTx(100)]; db.events = []
    sessionStorage.setItem(cashOsSessionKey('org-1'), JSON.stringify({ version: 1, organizationId: 'org-1',
      payrollPaidThroughDate: '2026-09-28', protectionHorizonDays: 7, operatingFloorMinor: 0,
      taxReserve: { kind: 'disabled' }, includeOptionalObligations: false, includeOpenShiftEstimates: false,
      timezoneConfirmed: true, confirmedAt: '2026-09-29T20:00:00Z' }))
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  })
  afterEach(async () => { await act(async () => { root.unmount() }); host.remove(); vi.unstubAllGlobals() })

  async function ready() {
    await act(async () => { root.render(<Probe />) })
    const end = Date.now() + 3000
    while (!host.textContent?.startsWith('ready:idle:Old') && Date.now() < end) await act(async () => { await sleep(10) })
    expect(host.textContent).toBe('ready:idle:Old')
  }

  it('refresh() resolves only after the refreshed data is committed, keeping the old view mounted meanwhile', async () => {
    await ready()
    db.accounts[0].display_name = 'New'
    let resolved = false
    let promise!: Promise<void>
    await act(async () => { promise = api.refresh().then(() => { resolved = true }) })
    await act(async () => { await sleep(10) })
    expect(resolved).toBe(false)
    expect(host.textContent).toBe('ready:refreshing:Old')
    await act(async () => { await promise })
    expect(resolved).toBe(true)
    expect(host.textContent).toBe('ready:idle:New')
  })

  it('a refresh superseded by a global data event still resolves with the final fresh data', async () => {
    await ready()
    db.accounts[0].display_name = 'New'
    let resolved = false
    let promise!: Promise<void>
    await act(async () => {
      promise = api.refresh().then(() => { resolved = true })
      await sleep(10)
      window.dispatchEvent(new Event('poweron-data-saved'))
    })
    await act(async () => { await promise })
    expect(resolved).toBe(true)
    expect(host.textContent).toBe('ready:idle:New')
  })

  it('unmounting releases a pending refresh instead of leaving a mutation form hanging', async () => {
    await ready()
    let resolved = false
    await act(async () => { void api.refresh().then(() => { resolved = true }) })
    await act(async () => { root.unmount() })
    await act(async () => { await sleep(5) })
    expect(resolved).toBe(true)
    root = createRoot(host)
  })
})
