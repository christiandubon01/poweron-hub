// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import DebtKiller from '@/views/DebtKiller'

const setEditingSpy = vi.fn()
const confirmSetupSpy = vi.fn()

const control = vi.hoisted(() => ({
  demo: false,
  cashStatus: 'loading' as string,
  cashScope: null as any,
  cashSources: null as any,
  cashSetup: null as any,
  cashSnapshot: null as any,
  cashReason: null as string | null,
  cashEditing: false,
}))

vi.mock('@/store/demoStore', () => ({
  useDemoMode: () => ({ isDemoMode: control.demo, hasHydrated: true }),
}))

vi.mock('@/hooks/useCashOsSnapshot', () => ({
  useCashOsSnapshot: () => ({
    status: control.cashStatus,
    scope: control.cashScope,
    setup: control.cashSetup,
    sources: control.cashSources,
    snapshot: control.cashSnapshot,
    reason: control.cashReason,
    error: null,
    editing: control.cashEditing,
    setEditing: setEditingSpy,
    resetSetup: vi.fn(),
    confirmSetup: confirmSetupSpy,
    refresh: vi.fn(),
    lastRefreshedAt: null,
    horizonDays: 30,
    setHorizonDays: vi.fn(),
    confidenceMode: 'conservative',
    setConfidenceMode: vi.fn(),
  }),
}))

vi.mock('@/components/v15r/cash-os/CashOsDebtPlan', () => ({
  default: (props: { sources: unknown; snapshot: unknown }) => (
    <div data-testid="canonical-debt-plan">
      Canonical Debt Plan · sources={(props.sources ? 'yes' : 'no')} snapshot={(props.snapshot ? 'yes' : 'no')}
    </div>
  ),
}))

const stubSources = {
  organizationId: 'org-1',
  asOfDate: '2026-09-30',
  asOfTimestamp: '2026-09-30T20:00:00Z',
  accounts: [
    { id: 'bank', display_name: 'Main Checking', status: 'active', account_class: 'asset',
      account_type: 'checking', include_in_cash: true },
  ],
  transactions: [
    { id: 't1', transaction_date: '2026-09-28', description: 'Opening', amount_minor: 250000,
      transaction_kind: 'opening_balance', category: null, project_id: null, status: 'posted',
      account_id: 'bank' },
  ],
  obligations: [
    { id: 'ob1', name: 'Rent', amount: { minor: 200000 },
      recurrence: { kind: 'monthly', startDate: '2026-01-01' },
      requirement: 'required', confidence: 'confirmed', status: 'active', category: null },
  ],
  commitments: [
    { id: 'co1', title: 'Materials purchase', amount: { minor: 50000 },
      expectedDate: '2026-10-05', requirement: 'required', confidence: 'confirmed',
      status: 'scheduled', category: null },
  ],
  occurrences: [], timeEntries: [], sessions: [], bridges: [], employees: [],
  backup: {} as any,
  obligations_meta: undefined,
}

const stubScope = { context: { organizationId: 'org-1', userId: 'user-1' }, storedTimezone: 'America/Los_Angeles' }

describe('CASH-8 Debt Killer workspace shell', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    control.demo = false
    control.cashStatus = 'loading'
    control.cashScope = null
    control.cashSources = null
    control.cashSetup = null
    control.cashSnapshot = null
    control.cashReason = null
    control.cashEditing = false
    setEditingSpy.mockClear()
    confirmSetupSpy.mockClear()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => { root.unmount() })
    host.remove()
  })

  async function click(label: string) {
    const button = [...host.querySelectorAll('button')].find(node => node.textContent?.trim() === label)
    expect(button).toBeDefined()
    await act(async () => {
      button!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  }

  // ─── Existing shell contract ────────────────────────────────────────────

  it('defaults Debt Killer to Outlook with no fake zero during loading', async () => {
    await act(async () => { root.render(<DebtKiller />) })
    expect(host.querySelector('h1')?.textContent).toBe('Outlook')
    expect(host.textContent).toContain('Loading canonical cash sources')
    expect(host.textContent).not.toContain('$0')
  })

  it('keeps the seven Debt Killer workspace tabs in order', async () => {
    await act(async () => { root.render(<DebtKiller />) })
    expect([...host.querySelectorAll('nav button')].map(node => node.textContent)).toEqual([
      'Outlook', 'Calendar', 'Projects', 'Payroll', 'Transactions', 'Obligations', 'Debt Plan',
    ])
  })

  it('CORE-CLOSE-2A: Debt Plan renders canonical component, not legacy mock data', async () => {
    control.cashStatus = 'setup_required'
    control.cashScope = stubScope
    control.cashSources = stubSources
    await act(async () => { root.render(<DebtKiller />) })
    await click('Debt Plan')
    expect(host.textContent).not.toContain('Legacy Debt Plan')
    expect(host.querySelector('[data-testid="canonical-debt-plan"]')).toBeTruthy()
  })

  it('does not put a Money or Performance tab inside Debt Killer', async () => {
    await act(async () => { root.render(<DebtKiller />) })
    const labels = [...host.querySelectorAll('nav button')].map(node => node.textContent)
    expect(labels).not.toContain('Performance')
    expect(labels).not.toContain('Money')
  })

  it('CORE-CLOSE-2A: Debt Plan shows unavailable message in Demo Mode — no legacy mock', async () => {
    control.demo = true
    await act(async () => { root.render(<DebtKiller />) })
    await click('Debt Plan')
    expect(host.textContent).toContain('Cash OS unavailable in Demo Mode')
    expect(host.textContent).not.toContain('Legacy Debt Plan')
    expect(host.querySelector('[data-testid="canonical-debt-plan"]')).toBeFalsy()
  })

  // ─── CASH-OS-UI-1A: Non-blocking gate ──────────────────────────────────

  it('shows seven tabs when status is setup_required — workspace is not blocked', async () => {
    control.cashStatus = 'setup_required'
    control.cashScope = stubScope
    control.cashSources = stubSources
    control.cashReason = 'SESSION_SETUP_REQUIRED'
    await act(async () => { root.render(<DebtKiller />) })
    const navButtons = [...host.querySelectorAll('nav button')].map(n => n.textContent)
    expect(navButtons).toEqual(['Outlook', 'Calendar', 'Projects', 'Payroll', 'Transactions', 'Obligations', 'Debt Plan'])
  })

  it('shows assumptions banner (not a setup form) when setup_required', async () => {
    control.cashStatus = 'setup_required'
    control.cashScope = stubScope
    control.cashSources = stubSources
    control.cashReason = 'SESSION_SETUP_REQUIRED'
    await act(async () => { root.render(<DebtKiller />) })
    expect(host.textContent).toContain('Some calculations need Session Assumptions')
    // The setup form itself must NOT appear as the full page content
    expect(host.textContent).not.toContain('Wages paid through')
  })

  it('Session Assumptions button is visible in the top-right area when scope is known', async () => {
    control.cashStatus = 'setup_required'
    control.cashScope = stubScope
    control.cashSources = stubSources
    await act(async () => { root.render(<DebtKiller />) })
    const buttons = [...host.querySelectorAll('button')].map(n => n.textContent?.trim())
    expect(buttons).toContain('Session assumptions')
  })

  it('opens assumptions sheet when Session Assumptions button is clicked', async () => {
    control.cashStatus = 'setup_required'
    control.cashScope = stubScope
    control.cashSources = stubSources
    await act(async () => { root.render(<DebtKiller />) })
    await click('Session assumptions')
    expect(setEditingSpy).toHaveBeenCalledWith(true)
    // Sheet dialog should now be visible
    expect(host.querySelector('[role="dialog"]')).not.toBeNull()
    // Form is inside the sheet
    expect(host.textContent).toContain('Wages paid through')
  })

  it('dismisses assumptions sheet without saving when Close button is clicked', async () => {
    control.cashStatus = 'setup_required'
    control.cashScope = stubScope
    control.cashSources = stubSources
    await act(async () => { root.render(<DebtKiller />) })
    await click('Session assumptions')
    expect(host.querySelector('[role="dialog"]')).not.toBeNull()
    await click('✕ Close')
    expect(setEditingSpy).toHaveBeenCalledWith(false)
    expect(confirmSetupSpy).not.toHaveBeenCalled()
    expect(host.querySelector('[role="dialog"]')).toBeNull()
  })

  it('Transactions tab shows accounts and ledger rows from sources during setup_required', async () => {
    control.cashStatus = 'setup_required'
    control.cashScope = stubScope
    control.cashSources = stubSources
    control.cashReason = 'SESSION_SETUP_REQUIRED'
    await act(async () => { root.render(<DebtKiller />) })
    await click('Transactions')
    expect(host.textContent).toContain('Main Checking')
    expect(host.textContent).toContain('Opening')
    expect(host.textContent).toContain('$2,500.00')
  })

  it('Obligations tab shows obligations and commitments from sources during setup_required', async () => {
    control.cashStatus = 'setup_required'
    control.cashScope = stubScope
    control.cashSources = stubSources
    control.cashReason = 'SESSION_SETUP_REQUIRED'
    await act(async () => { root.render(<DebtKiller />) })
    await click('Obligations')
    expect(host.textContent).toContain('Rent')
    expect(host.textContent).toContain('Materials purchase')
  })

  it('Outlook during setup_required shows Needs assumptions for protected/free/forecast — not $0', async () => {
    control.cashStatus = 'setup_required'
    control.cashScope = stubScope
    control.cashSources = stubSources
    control.cashReason = 'SESSION_SETUP_REQUIRED'
    await act(async () => { root.render(<DebtKiller />) })
    expect(host.textContent).toContain('Needs assumptions')
    // Must not show a misleading $0 for protected/free/forecast values
    expect(host.textContent).not.toContain('PROTECTED</span><strong')
  })

  it('CORE-CLOSE-2A: Debt Plan shows fallback when setup_required and sources not yet loaded — no legacy mock', async () => {
    control.cashStatus = 'setup_required'
    control.cashScope = stubScope
    control.cashSources = null
    control.cashReason = 'SESSION_SETUP_REQUIRED'
    await act(async () => { root.render(<DebtKiller />) })
    await click('Debt Plan')
    // preSetup requires sources !== null; without sources the fallback renders
    // The critical contract: DebtKillerLegacy is never shown
    expect(host.textContent).not.toContain('Legacy Debt Plan')
  })

  it('no calls to confirmSetup just from opening Cash OS or changing tabs', async () => {
    control.cashStatus = 'setup_required'
    control.cashScope = stubScope
    control.cashSources = stubSources
    await act(async () => { root.render(<DebtKiller />) })
    for (const label of ['Calendar', 'Projects', 'Payroll', 'Transactions', 'Obligations', 'Debt Plan', 'Outlook']) {
      await click(label)
    }
    expect(confirmSetupSpy).not.toHaveBeenCalled()
  })

  it('CORE-CLOSE-2A: Debt Plan passes sources to CashOsDebtPlan during setup_required (preSetup)', async () => {
    control.cashStatus = 'setup_required'
    control.cashScope = stubScope
    control.cashSources = stubSources
    await act(async () => { root.render(<DebtKiller />) })
    await click('Debt Plan')
    const el = host.querySelector('[data-testid="canonical-debt-plan"]')
    expect(el).toBeTruthy()
    expect(el!.textContent).toContain('sources=yes')
    expect(el!.textContent).toContain('snapshot=no')
  })

  it('ready-state renders Outlook when authoritative', async () => {
    const readySnapshot = {
      organizationId: 'org-1', asOfDate: '2026-09-30', asOfTimestamp: '2026-09-30T20:00:00Z',
      setup: { version: 1, organizationId: 'org-1', payrollPaidThroughDate: '2026-09-28',
        protectionHorizonDays: 7, operatingFloorMinor: 0, taxReserve: { kind: 'disabled' },
        includeOptionalObligations: false, includeOpenShiftEstimates: false,
        timezoneConfirmed: true, confirmedAt: '2026-09-29T20:00:00Z' },
      allocation: {} as any, payroll: { liabilities: [] }, payrollDiagnostics: [],
      payrollAllocations: [], payrollExposureMinor: 0, accountBalancesMinor: { bank: 250000 },
      collectionClock: { activeFunding: [], collectionFollowUp: [], unattributedPayrollMinor: 0, diagnostics: [] },
      projection: { organizationId: 'org-1', asOfDate: '2026-09-30', horizonDays: 30,
        confidenceMode: 'conservative',
        anchor: { date: '2026-09-30', openingCashMinor: 250000, inflowMinor: 0, outflowMinor: 0,
          closingCashMinor: 250000, totalProtectedRequirementMinor: 0, protectedCashMinor: 0,
          trulyFreeCashMinor: 250000, protectionDeficitMinor: 0, operatingFloorMinor: 0,
          events: [], markers: [], uncertainty: { highestIncludedConfidence: null,
            includedExpectedEventCount: 0, includedPossibleEventCount: 0,
            unresolvedMarkerCount: 0, unresolvedSourceKeys: [] } },
        days: [],
        summary: { lowestTotalCashMinor: 250000, lowestTotalCashDate: '2026-09-30',
          lowestTrulyFreeCashMinor: 250000, lowestTrulyFreeCashDate: '2026-09-30',
          firstProtectionDeficitDate: null, fourteenDayLowestTotalCashMinor: 250000,
          fourteenDayLowestTotalCashDate: '2026-09-30', daysCovered: { days: 30, bounded: true } },
        datedEvents: [], datedMarkers: [], undatedMarkers: [], diagnostics: [] },
      accounts: [{ id: 'bank', display_name: 'Main Checking', status: 'active', include_in_cash: true,
        account_type: 'checking', account_class: 'asset' } as any],
      transactions: [{ id: 't1', transaction_date: '2026-09-28', description: 'Opening',
        amount_minor: 250000, status: 'posted', account_id: 'bank' } as any],
      obligations: [], occurrences: [], commitments: [], timeEntries: [],
      sessions: [], bridges: [], employees: [], backup: {} as any, readinessDiagnostics: [],
    }
    control.cashStatus = 'ready'
    control.cashScope = stubScope
    control.cashSetup = readySnapshot.setup
    control.cashSnapshot = readySnapshot
    control.cashEditing = false
    await act(async () => { root.render(<DebtKiller />) })
    // Ready state: Outlook renders TOTAL CASH metric
    expect(host.textContent).toContain('TOTAL CASH')
    expect(host.textContent).toContain('$2,500.00')
    expect(host.textContent).not.toContain('Needs assumptions')
  })

  it('CORE-CLOSE-2A: Debt Plan passes snapshot to CashOsDebtPlan in ready state', async () => {
    const readySnapshot = {
      organizationId: 'org-1', asOfDate: '2026-09-30', asOfTimestamp: '2026-09-30T20:00:00Z',
      setup: { version: 1, organizationId: 'org-1', payrollPaidThroughDate: '2026-09-28',
        protectionHorizonDays: 7, operatingFloorMinor: 0, taxReserve: { kind: 'disabled' },
        includeOptionalObligations: false, includeOpenShiftEstimates: false,
        timezoneConfirmed: true, confirmedAt: '2026-09-29T20:00:00Z' },
      allocation: { trulyFreeCashMinor: 100000 } as any,
      payroll: { liabilities: [] }, payrollDiagnostics: [],
      payrollAllocations: [], payrollExposureMinor: 0, accountBalancesMinor: { bank: 250000 },
      collectionClock: { activeFunding: [], collectionFollowUp: [], unattributedPayrollMinor: 0, diagnostics: [] },
      projection: { organizationId: 'org-1', asOfDate: '2026-09-30', horizonDays: 30,
        confidenceMode: 'conservative',
        anchor: { date: '2026-09-30', openingCashMinor: 250000, inflowMinor: 0, outflowMinor: 0,
          closingCashMinor: 250000, totalProtectedRequirementMinor: 0, protectedCashMinor: 0,
          trulyFreeCashMinor: 100000, protectionDeficitMinor: 0, operatingFloorMinor: 0,
          events: [], markers: [], uncertainty: { highestIncludedConfidence: null,
            includedExpectedEventCount: 0, includedPossibleEventCount: 0,
            unresolvedMarkerCount: 0, unresolvedSourceKeys: [] } },
        days: [],
        summary: { lowestTotalCashMinor: 250000, lowestTotalCashDate: '2026-09-30',
          lowestTrulyFreeCashMinor: 100000, lowestTrulyFreeCashDate: '2026-09-30',
          firstProtectionDeficitDate: null, fourteenDayLowestTotalCashMinor: 250000,
          fourteenDayLowestTotalCashDate: '2026-09-30', daysCovered: { days: 30, bounded: true } },
        datedEvents: [], datedMarkers: [], undatedMarkers: [], diagnostics: [] },
      accounts: [{ id: 'bank', display_name: 'Checking', status: 'active', include_in_cash: true,
        account_type: 'checking', account_class: 'asset' } as any],
      transactions: [{ id: 't1', transaction_date: '2026-09-28', description: 'Opening',
        amount_minor: 250000, status: 'posted', account_id: 'bank' } as any],
      obligations: [], occurrences: [], commitments: [], timeEntries: [],
      sessions: [], bridges: [], employees: [], backup: {} as any, readinessDiagnostics: [],
    }
    control.cashStatus = 'ready'
    control.cashScope = stubScope
    control.cashSetup = readySnapshot.setup
    control.cashSnapshot = readySnapshot
    control.cashEditing = false
    await act(async () => { root.render(<DebtKiller />) })
    await click('Debt Plan')
    const el = host.querySelector('[data-testid="canonical-debt-plan"]')
    expect(el).toBeTruthy()
    expect(el!.textContent).toContain('sources=yes')
    expect(el!.textContent).toContain('snapshot=yes')
  })

  // ─── CORE-CLOSE-2A: empty state gap ────────────────────────────────────────

  it('CORE-CLOSE-2A: Debt Plan renders CashOsDebtPlan on LEDGER_EMPTY when sources exist', async () => {
    const emptyWithLiability = {
      ...stubSources,
      accounts: [
        { id: 'bank', display_name: 'Main Checking', status: 'active', account_class: 'asset',
          account_type: 'checking', include_in_cash: true },
        { id: 'cc1', display_name: 'Business Visa', status: 'active', account_class: 'liability',
          account_type: 'credit_card', include_in_cash: false },
      ],
    }
    control.cashStatus = 'empty'
    control.cashScope = stubScope
    control.cashSources = emptyWithLiability
    await act(async () => { root.render(<DebtKiller />) })
    await click('Debt Plan')
    const el = host.querySelector('[data-testid="canonical-debt-plan"]')
    expect(el).toBeTruthy()
    expect(el!.textContent).toContain('sources=yes')
    // No authoritative snapshot — Truly Free Cash must not be shown
    expect(el!.textContent).toContain('snapshot=no')
  })

  it('CORE-CLOSE-2A: non-Debt-Plan tabs retain Ledger empty card on LEDGER_EMPTY', async () => {
    control.cashStatus = 'empty'
    control.cashScope = stubScope
    control.cashSources = stubSources
    await act(async () => { root.render(<DebtKiller />) })
    // Default tab is Outlook — must see the Ledger empty card
    expect(host.textContent).toContain('Ledger empty')
    expect(host.querySelector('[data-testid="canonical-debt-plan"]')).toBeFalsy()
  })
})
