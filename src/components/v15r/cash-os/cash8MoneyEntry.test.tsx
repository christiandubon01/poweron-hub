// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import CashOsAddSheet from './CashOsAddSheet'
import { CashTransactionsView } from './CashOsViews'
import DebtKiller from '@/views/DebtKiller'

// ─── Write-service mocks ───────────────────────────────────────────────────────

const { mockCreate, mockOpeningBalance, mockTransaction, mockTransfer, mockCardPayment } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockOpeningBalance: vi.fn(),
  mockTransaction: vi.fn(),
  mockTransfer: vi.fn(),
  mockCardPayment: vi.fn(),
}))

vi.mock('@/services/manualLedgerService', () => ({
  createFinancialAccount: mockCreate,
  recordOpeningBalance: mockOpeningBalance,
  recordManualTransaction: mockTransaction,
  recordFinancialTransfer: mockTransfer,
  recordFinancialCardPayment: mockCardPayment,
}))

// ─── DebtKiller shell mocks ────────────────────────────────────────────────────

vi.mock('@/store/demoStore', () => ({
  useDemoMode: () => ({ isDemoMode: false, hasHydrated: true }),
}))

vi.mock('@/views/DebtKillerLegacy', () => ({
  default: () => <div>Legacy Debt Plan</div>,
}))

const cashControl = vi.hoisted(() => ({
  status: 'loading' as string,
  scope: null as any,
  sources: null as any,
  setup: null as any,
  snapshot: null as any,
  reason: null as string | null,
  editing: false,
}))

vi.mock('@/hooks/useCashOsSnapshot', () => ({
  useCashOsSnapshot: () => ({
    status: cashControl.status, scope: cashControl.scope,
    sources: cashControl.sources, setup: cashControl.setup,
    snapshot: cashControl.snapshot, reason: cashControl.reason,
    error: null, editing: cashControl.editing,
    setEditing: vi.fn(), resetSetup: vi.fn(), confirmSetup: vi.fn(),
    refresh: vi.fn(), lastRefreshedAt: null,
    horizonDays: 30, setHorizonDays: vi.fn(),
    confidenceMode: 'conservative', setConfidenceMode: vi.fn(),
  }),
}))

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const stubScope = { context: { organizationId: 'org-1', userId: 'user-1' }, storedTimezone: 'America/Los_Angeles' }

const stubSources: any = {
  organizationId: 'org-1', asOfDate: '2026-09-30', asOfTimestamp: '2026-09-30T20:00:00Z',
  accounts: [
    { id: 'acct-1', display_name: 'Main Checking', status: 'active', account_type: 'checking',
      account_class: 'asset', ownership_context: 'business', include_in_cash: true },
    { id: 'acct-2', display_name: 'Main Savings', status: 'active', account_type: 'savings',
      account_class: 'asset', ownership_context: 'business', include_in_cash: true },
    { id: 'acct-cc', display_name: 'Business Visa', status: 'active', account_type: 'credit_card',
      account_class: 'liability', ownership_context: 'business', include_in_cash: false },
  ],
  transactions: [], obligations: [], occurrences: [], commitments: [],
  timeEntries: [], sessions: [], bridges: [], employees: [], backup: {} as any,
}

function makeSnapshot(accounts: any[] = [], transactions: any[] = []): any {
  return {
    accounts, transactions,
    accountBalancesMinor: Object.fromEntries(accounts.map((a: any) => [a.id, 0])),
    obligations: [], commitments: [],
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setInputValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

function setSelectValue(el: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set
  setter?.call(el, value)
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

async function click(host: HTMLElement, label: string) {
  const button = [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === label)
  expect(button, `Button "${label}" not found`).toBeDefined()
  await act(async () => {
    button!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CASH-8 money entry', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    mockCreate.mockReset(); mockOpeningBalance.mockReset()
    mockTransaction.mockReset(); mockTransfer.mockReset(); mockCardPayment.mockReset()
    cashControl.status = 'loading'; cashControl.scope = null; cashControl.sources = null
    cashControl.setup = null; cashControl.snapshot = null; cashControl.reason = null; cashControl.editing = false
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => { root.unmount() })
    host.remove()
  })

  // 1. No-account Transactions state offers "Add your first account"
  it('no-account Transactions tab offers Add your first account', async () => {
    const snap = makeSnapshot([])
    await act(async () => { root.render(<CashTransactionsView snapshot={snap} onAdd={vi.fn()} />) })
    expect(host.textContent).toContain('Add your first account')
  })

  // 2. + Add button calls onAdd
  it('+ Add button in Transactions tab calls onAdd', async () => {
    const snap = makeSnapshot([
      { id: 'a1', display_name: 'Checking', status: 'active', account_type: 'checking',
        account_class: 'asset', ownership_context: 'business', include_in_cash: true },
    ])
    const onAdd = vi.fn()
    await act(async () => { root.render(<CashTransactionsView snapshot={snap} onAdd={onAdd} />) })
    await click(host, '+ Add')
    expect(onAdd).toHaveBeenCalled()
  })

  // 3. Asset account calls createFinancialAccount with asset class
  it('asset account calls createFinancialAccount with asset class', async () => {
    mockCreate.mockResolvedValue({ id: 'new-1', display_name: 'Main Checking', account_class: 'asset' })
    await act(async () => {
      root.render(<CashOsAddSheet organizationId="org-1" sources={stubSources} onClose={vi.fn()} onSuccess={vi.fn()} />)
    })
    const nameInput = host.querySelector('input[placeholder="e.g. Wells Fargo Business Checking"]') as HTMLInputElement
    await act(async () => { setInputValue(nameInput, 'Main Checking') })
    await click(host, 'Create account')
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ accountClass: 'asset', accountType: 'checking' }))
  })

  // 4. Cash-on-hand account (type: 'cash')
  it('cash-on-hand account calls createFinancialAccount with type cash', async () => {
    mockCreate.mockResolvedValue({ id: 'new-2', display_name: 'Petty Cash', account_class: 'asset' })
    await act(async () => {
      root.render(<CashOsAddSheet organizationId="org-1" sources={stubSources} onClose={vi.fn()} onSuccess={vi.fn()} />)
    })
    const nameInput = host.querySelector('input[placeholder="e.g. Wells Fargo Business Checking"]') as HTMLInputElement
    await act(async () => { setInputValue(nameInput, 'Petty Cash') })
    const typeSelect = host.querySelector('select') as HTMLSelectElement
    await act(async () => { setSelectValue(typeSelect, 'cash') })
    await click(host, 'Create account')
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ accountType: 'cash', accountClass: 'asset' }))
  })

  // 5. Liability account forced includeInCash: false
  it('liability account always sets includeInCash false', async () => {
    mockCreate.mockResolvedValue({ id: 'new-3', display_name: 'Business Visa', account_class: 'liability' })
    await act(async () => {
      root.render(<CashOsAddSheet organizationId="org-1" sources={stubSources} onClose={vi.fn()} onSuccess={vi.fn()} />)
    })
    const nameInput = host.querySelector('input[placeholder="e.g. Wells Fargo Business Checking"]') as HTMLInputElement
    await act(async () => { setInputValue(nameInput, 'Business Visa') })
    const typeSelect = host.querySelector('select') as HTMLSelectElement
    await act(async () => { setSelectValue(typeSelect, 'credit_card') })
    await click(host, 'Create account')
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ accountClass: 'liability', includeInCash: false }))
  })

  // 6. Optional opening balance calls recordOpeningBalance
  it('opening balance calls recordOpeningBalance after account creation', async () => {
    mockCreate.mockResolvedValue({ id: 'new-4', display_name: 'Main Checking', account_class: 'asset' })
    mockOpeningBalance.mockResolvedValue(undefined)
    await act(async () => {
      root.render(<CashOsAddSheet organizationId="org-1" sources={stubSources} onClose={vi.fn()} onSuccess={vi.fn()} />)
    })
    const nameInput = host.querySelector('input[placeholder="e.g. Wells Fargo Business Checking"]') as HTMLInputElement
    await act(async () => { setInputValue(nameInput, 'Main Checking') })
    await click(host, 'Create account')
    const amountInput = host.querySelector('input[placeholder="0.00"]') as HTMLInputElement
    await act(async () => { setInputValue(amountInput, '1000') })
    await click(host, 'Set opening balance')
    expect(mockOpeningBalance).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'new-4', amountMinor: 100000 }))
  })

  // 7. Income calls recordManualTransaction with kind: 'income', economicEffect: 'inflow'
  it('income calls recordManualTransaction with kind income and inflow', async () => {
    mockTransaction.mockResolvedValue(undefined)
    await act(async () => {
      root.render(<CashOsAddSheet organizationId="org-1" sources={stubSources} onClose={vi.fn()} onSuccess={vi.fn()} />)
    })
    await click(host, 'Income')
    const amountInput = host.querySelector('input[placeholder="0.00"]') as HTMLInputElement
    await act(async () => { setInputValue(amountInput, '25.00') })
    await click(host, 'Record income')
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockTransaction).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'income', economicEffect: 'inflow', amountMinor: 2500,
    }))
  })

  // 8. Expense calls recordManualTransaction with kind: 'expense', economicEffect: 'outflow'
  it('expense calls recordManualTransaction with kind expense and outflow', async () => {
    mockTransaction.mockResolvedValue(undefined)
    await act(async () => {
      root.render(<CashOsAddSheet organizationId="org-1" sources={stubSources} onClose={vi.fn()} onSuccess={vi.fn()} />)
    })
    await click(host, 'Expense')
    const amountInput = host.querySelector('input[placeholder="0.00"]') as HTMLInputElement
    await act(async () => { setInputValue(amountInput, '50.00') })
    await click(host, 'Record expense')
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockTransaction).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'expense', economicEffect: 'outflow', amountMinor: 5000,
    }))
  })

  // 9. Amount is always a positive integer minor unit
  it('amount is always a positive integer minor unit regardless of mode', async () => {
    mockTransaction.mockResolvedValue(undefined)
    await act(async () => {
      root.render(<CashOsAddSheet organizationId="org-1" sources={stubSources} onClose={vi.fn()} onSuccess={vi.fn()} />)
    })
    await click(host, 'Expense')
    const amountInput = host.querySelector('input[placeholder="0.00"]') as HTMLInputElement
    await act(async () => { setInputValue(amountInput, '12.50') })
    await click(host, 'Record expense')
    const call = mockTransaction.mock.calls[0][0]
    expect(call.amountMinor).toBe(1250)
    expect(call.amountMinor).toBeGreaterThan(0)
    expect(call.economicAmountMinor).toBe(1250)
    expect(call.economicAmountMinor).toBeGreaterThan(0)
  })

  // 10. Transfer rejects same source/destination
  it('transfer shows error when source and destination are the same account', async () => {
    await act(async () => {
      root.render(<CashOsAddSheet organizationId="org-1" sources={stubSources} onClose={vi.fn()} onSuccess={vi.fn()} />)
    })
    await click(host, 'Transfer')
    const selects = [...host.querySelectorAll('select')] as HTMLSelectElement[]
    await act(async () => {
      setSelectValue(selects[0], 'acct-1')
      setSelectValue(selects[1], 'acct-1')
    })
    expect(host.textContent).toContain('Source and destination must be different')
  })

  // 11. Transfer uses recordFinancialTransfer
  it('transfer calls recordFinancialTransfer', async () => {
    mockTransfer.mockResolvedValue(undefined)
    await act(async () => {
      root.render(<CashOsAddSheet organizationId="org-1" sources={stubSources} onClose={vi.fn()} onSuccess={vi.fn()} />)
    })
    await click(host, 'Transfer')
    const amountInput = host.querySelector('input[placeholder="0.00"]') as HTMLInputElement
    await act(async () => { setInputValue(amountInput, '100') })
    await click(host, 'Record transfer')
    expect(mockTransfer).toHaveBeenCalledTimes(1)
    expect(mockTransfer).toHaveBeenCalledWith(expect.objectContaining({
      sourceAccountId: 'acct-1', targetAccountId: 'acct-2', amountMinor: 10000,
    }))
  })

  // 12. Transfer does NOT call recordManualTransaction
  it('transfer does not call recordManualTransaction', async () => {
    mockTransfer.mockResolvedValue(undefined)
    await act(async () => {
      root.render(<CashOsAddSheet organizationId="org-1" sources={stubSources} onClose={vi.fn()} onSuccess={vi.fn()} />)
    })
    await click(host, 'Transfer')
    const amountInput = host.querySelector('input[placeholder="0.00"]') as HTMLInputElement
    await act(async () => { setInputValue(amountInput, '100') })
    await click(host, 'Record transfer')
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  // 13. Card payment uses recordFinancialCardPayment
  it('card payment calls recordFinancialCardPayment', async () => {
    mockCardPayment.mockResolvedValue(undefined)
    await act(async () => {
      root.render(<CashOsAddSheet organizationId="org-1" sources={stubSources} onClose={vi.fn()} onSuccess={vi.fn()} />)
    })
    await click(host, 'Card / Loan Payment')
    const amountInput = host.querySelector('input[placeholder="0.00"]') as HTMLInputElement
    await act(async () => { setInputValue(amountInput, '500') })
    await click(host, 'Record payment')
    expect(mockCardPayment).toHaveBeenCalledTimes(1)
    expect(mockCardPayment).toHaveBeenCalledWith(expect.objectContaining({
      cashAccountId: 'acct-1', liabilityAccountId: 'acct-cc', amountMinor: 50000,
    }))
  })

  // 14. Card payment does NOT call recordManualTransaction
  it('card payment does not call recordManualTransaction', async () => {
    mockCardPayment.mockResolvedValue(undefined)
    await act(async () => {
      root.render(<CashOsAddSheet organizationId="org-1" sources={stubSources} onClose={vi.fn()} onSuccess={vi.fn()} />)
    })
    await click(host, 'Card / Loan Payment')
    const amountInput = host.querySelector('input[placeholder="0.00"]') as HTMLInputElement
    await act(async () => { setInputValue(amountInput, '500') })
    await click(host, 'Record payment')
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  // 15. Double-submit prevented while request is pending
  it('submit button is disabled and shows pending text while request is in-flight', async () => {
    let resolveCreate!: (value: any) => void
    mockCreate.mockImplementation(() => new Promise(resolve => { resolveCreate = resolve }))
    await act(async () => {
      root.render(<CashOsAddSheet organizationId="org-1" sources={stubSources} onClose={vi.fn()} onSuccess={vi.fn()} />)
    })
    const nameInput = host.querySelector('input[placeholder="e.g. Wells Fargo Business Checking"]') as HTMLInputElement
    await act(async () => { setInputValue(nameInput, 'Test Account') })
    await act(async () => {
      const btn = [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Create account')!
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(host.textContent).toContain('Creating…')
    await act(async () => {
      resolveCreate({ id: 'new-acct', display_name: 'Test Account', account_class: 'asset' })
    })
    expect(host.textContent).not.toContain('Creating…')
  })

  // 16. Successful write triggers onSuccess callback — via account creation + skip OB
  it('successful write triggers the onSuccess callback', async () => {
    mockCreate.mockResolvedValue({ id: 'new-acct', display_name: 'Test Account', account_class: 'asset' })
    const onSuccess = vi.fn()
    await act(async () => {
      root.render(<CashOsAddSheet organizationId="org-1" sources={stubSources} onClose={vi.fn()} onSuccess={onSuccess} />)
    })
    const nameInput = host.querySelector('input[placeholder="e.g. Wells Fargo Business Checking"]') as HTMLInputElement
    await act(async () => { setInputValue(nameInput, 'Test Account') })
    await click(host, 'Create account')
    // OB sub-step is shown; skip it — this is the completion event
    await click(host, 'Skip')
    expect(onSuccess).toHaveBeenCalled()
  })

  // 17. No project log / service call writes
  it('add sheet submits only call manualLedgerService — no project or service-call writes', async () => {
    mockTransaction.mockResolvedValue(undefined)
    await act(async () => {
      root.render(<CashOsAddSheet organizationId="org-1" sources={stubSources} onClose={vi.fn()} onSuccess={vi.fn()} />)
    })
    await click(host, 'Income')
    const amountInput = host.querySelector('input[placeholder="0.00"]') as HTMLInputElement
    await act(async () => { setInputValue(amountInput, '100') })
    await click(host, 'Record income')
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockOpeningBalance).not.toHaveBeenCalled()
    expect(mockTransfer).not.toHaveBeenCalled()
    expect(mockCardPayment).not.toHaveBeenCalled()
  })

  // 18. Session Assumptions behavior intact
  it('Session Assumptions sheet still opens when its button is clicked', async () => {
    cashControl.status = 'setup_required'
    cashControl.scope = stubScope
    cashControl.sources = stubSources
    await act(async () => { root.render(<DebtKiller />) })
    const sessionBtn = [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Session assumptions')
    expect(sessionBtn).toBeDefined()
    await act(async () => {
      sessionBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(host.querySelector('[aria-label="Session assumptions"]')).not.toBeNull()
  })

  // 19. Seven-tab navigation intact
  it('all seven Cash OS workspace tabs are present in order', async () => {
    await act(async () => { root.render(<DebtKiller />) })
    const navLabels = [...host.querySelectorAll('nav button')].map(b => b.textContent)
    expect(navLabels).toEqual(['Outlook', 'Calendar', 'Projects', 'Payroll', 'Transactions', 'Obligations', 'Debt Plan'])
  })

  // 20. Debt Plan still renders legacy component
  it('Debt Plan tab still renders the legacy component', async () => {
    await act(async () => { root.render(<DebtKiller />) })
    await click(host, 'Debt Plan')
    expect(host.textContent).toContain('Legacy Debt Plan')
  })

  // 21. Loan account payment: cash decreases, liability decreases, no operating expense
  it('loan account payment calls recordFinancialCardPayment — no operating expense created', async () => {
    const sourcesWithLoan = {
      ...stubSources,
      accounts: [
        ...stubSources.accounts,
        { id: 'acct-loan', display_name: 'Business Loan', status: 'active', account_type: 'loan',
          account_class: 'liability', ownership_context: 'business', include_in_cash: false },
      ],
    }
    mockCardPayment.mockResolvedValue(undefined)
    await act(async () => {
      root.render(<CashOsAddSheet organizationId="org-1" sources={sourcesWithLoan} onClose={vi.fn()} onSuccess={vi.fn()} />)
    })
    await click(host, 'Card / Loan Payment')
    const selects = [...host.querySelectorAll('select')] as HTMLSelectElement[]
    // selects[1] is the liability selector; choose the loan account
    await act(async () => { setSelectValue(selects[1], 'acct-loan') })
    const amountInput = host.querySelector('input[placeholder="0.00"]') as HTMLInputElement
    await act(async () => { setInputValue(amountInput, '300') })
    await click(host, 'Record payment')
    expect(mockCardPayment).toHaveBeenCalledTimes(1)
    expect(mockCardPayment).toHaveBeenCalledWith(expect.objectContaining({
      cashAccountId: 'acct-1',
      liabilityAccountId: 'acct-loan',
      amountMinor: 30000,
    }))
    // Paired card_debt_payment is handled by the RPC; no standalone transaction write
    expect(mockTransaction).not.toHaveBeenCalled()
  })
})
