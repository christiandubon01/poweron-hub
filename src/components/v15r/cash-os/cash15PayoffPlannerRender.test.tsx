// @vitest-environment happy-dom
// Regression test: CashOsPayoffPlanner renders visible planner UI for a
// production-shaped installment debt account (Wells Fargo Personal Credit Card).
// Covers: balance=$4877, APR=1%, scheduled_payment=$103, TFC=$1.
// Reproduces the CORE-CLOSE-2C production defect where NOTHING was visible
// under the Liability Accounts section.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import CashOsPayoffPlanner from '@/components/v15r/cash-os/CashOsPayoffPlanner'
import type { CashOsSourceBundle } from '@/services/cashOsReadService'
import type { CashOsSnapshot } from '@/finance/cashOsSnapshot'

// ── Production-shaped fixture ─────────────────────────────────────────────────

const WF_ACCOUNT_ID = 'wf-personal-cc'

const wfAccount = {
  id: WF_ACCOUNT_ID,
  organization_id: 'org-prod',
  display_name: 'Wells Fargo Personal Credit Card',
  account_type: 'credit_card' as const,
  account_class: 'liability' as const,
  ownership_context: 'personal' as const,
  include_in_cash: false,
  currency: 'USD' as const,
  status: 'active' as const,
  source_type: 'manual' as const,
  source_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
  archived_at: null,
}

// Opening balance posted on 2026-01-01 — $4,877.00 owed (positive = liability balance)
const wfOpeningTx = {
  id: 'tx-wf-open',
  organization_id: 'org-prod',
  account_id: WF_ACCOUNT_ID,
  transaction_date: '2026-01-01',
  description: 'Opening balance',
  amount_minor: 487700,
  transaction_kind: 'opening_balance' as const,
  category: null,
  project_id: null,
  status: 'posted' as const,
  source_type: 'manual' as const,
  source_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  reference_id: null,
}

const wfTerms = {
  id: 'terms-wf',
  organization_id: 'org-prod',
  account_id: WF_ACCOUNT_ID,
  debt_structure: 'installment' as const,
  apr_basis_points: 100,
  promo_apr_basis_points: null,
  promo_type: null,
  promo_started_on: null,
  promo_expires_on: null,
  minimum_payment_minor: null,
  payment_due_day: 2,
  next_due_date: '2026-11-02',
  scheduled_payment_minor: 10300,
  original_principal_minor: null,
  maturity_date: null,
  owner_notes: null,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
}

// Asset account for TFC calculation (not relevant to planner, just for valid snapshot)
const checkingAccount = {
  id: 'checking',
  organization_id: 'org-prod',
  display_name: 'Main Checking',
  account_type: 'checking' as const,
  account_class: 'asset' as const,
  ownership_context: 'business' as const,
  include_in_cash: true,
  currency: 'USD' as const,
  status: 'active' as const,
  source_type: 'manual' as const,
  source_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
  archived_at: null,
}

const checkingTx = {
  id: 'tx-checking-open',
  organization_id: 'org-prod',
  account_id: 'checking',
  transaction_date: '2026-01-01',
  description: 'Opening balance',
  amount_minor: 500000,
  transaction_kind: 'opening_balance' as const,
  category: null,
  project_id: null,
  status: 'posted' as const,
  source_type: 'manual' as const,
  source_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  reference_id: null,
}

const prodSources: CashOsSourceBundle = {
  organizationId: 'org-prod',
  asOfDate: '2026-10-05',
  asOfTimestamp: '2026-10-05T20:00:00Z',
  accounts: [checkingAccount, wfAccount],
  transactions: [checkingTx, wfOpeningTx] as any[],
  obligations: [],
  occurrences: [],
  commitments: [],
  timeEntries: [],
  sessions: [],
  bridges: [],
  employees: [],
  backup: {} as any,
  liabilityTerms: [wfTerms],
}

const prodSnapshot: CashOsSnapshot = {
  ...prodSources,
  setup: {
    version: 1,
    organizationId: 'org-prod',
    payrollPaidThroughDate: '2026-10-04',
    protectionHorizonDays: 7,
    operatingFloorMinor: 0,
    taxReserve: { kind: 'disabled' },
    includeOptionalObligations: false,
    includeOpenShiftEstimates: false,
    timezoneConfirmed: true,
    confirmedAt: '2026-10-05T10:00:00Z',
  },
  allocation: { trulyFreeCashMinor: 100 } as any,
  payroll: { liabilities: [] } as any,
  payrollDiagnostics: [],
  payrollAllocations: [],
  payrollExposureMinor: 0,
  accountBalancesMinor: { checking: 500000, [WF_ACCOUNT_ID]: 487700 },
  collectionClock: { activeFunding: [], collectionFollowUp: [], unattributedPayrollMinor: 0, diagnostics: [] } as any,
  projection: {
    organizationId: 'org-prod', asOfDate: '2026-10-05', horizonDays: 30,
    confidenceMode: 'conservative',
    anchor: { date: '2026-10-05', openingCashMinor: 500000, inflowMinor: 0, outflowMinor: 0,
      closingCashMinor: 500000, totalProtectedRequirementMinor: 0, protectedCashMinor: 0,
      trulyFreeCashMinor: 100, protectionDeficitMinor: 0, operatingFloorMinor: 0,
      events: [], markers: [], uncertainty: { highestIncludedConfidence: null,
        includedExpectedEventCount: 0, includedPossibleEventCount: 0,
        unresolvedMarkerCount: 0, unresolvedSourceKeys: [] } },
    days: [],
    summary: { lowestTotalCashMinor: 500000, lowestTotalCashDate: '2026-10-05',
      lowestTrulyFreeCashMinor: 100, lowestTrulyFreeCashDate: '2026-10-05',
      firstProtectionDeficitDate: null, fourteenDayLowestTotalCashMinor: 500000,
      fourteenDayLowestTotalCashDate: '2026-10-05', daysCovered: { days: 30, bounded: true } },
    datedEvents: [], datedMarkers: [], undatedMarkers: [], diagnostics: [],
  } as any,
  readinessDiagnostics: [],
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CORE-CLOSE-2C regression: CashOsPayoffPlanner renders for production debt', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => { root.unmount() })
    host.remove()
  })

  it('renders scope selector for installment liability with $4877 balance / 1% APR / $103 payment / $1 TFC', async () => {
    await act(async () => {
      root.render(<CashOsPayoffPlanner sources={prodSnapshot} snapshot={prodSnapshot} />)
    })
    const text = host.textContent ?? ''
    // Controls card must be visible — scope buttons
    expect(text).toContain('All')
    expect(text).toContain('Business')
    expect(text).toContain('Personal')
  })

  it('renders strategy selector for the production debt shape', async () => {
    await act(async () => {
      root.render(<CashOsPayoffPlanner sources={prodSnapshot} snapshot={prodSnapshot} />)
    })
    const text = host.textContent ?? ''
    expect(text).toContain('Avalanche')
    expect(text).toContain('Snowball')
    expect(text).toContain('Baseline')
  })

  it('renders modeled-extra input for the production debt shape', async () => {
    await act(async () => {
      root.render(<CashOsPayoffPlanner sources={prodSnapshot} snapshot={prodSnapshot} />)
    })
    const input = host.querySelector('input[type="text"]')
    expect(input).toBeTruthy()
  })

  it('renders TFC row showing $1.00 available', async () => {
    await act(async () => {
      root.render(<CashOsPayoffPlanner sources={prodSnapshot} snapshot={prodSnapshot} />)
    })
    const text = host.textContent ?? ''
    expect(text).toContain('$1.00')
  })

  it('renders debt projections card for the production Wells Fargo account', async () => {
    await act(async () => {
      root.render(<CashOsPayoffPlanner sources={prodSnapshot} snapshot={prodSnapshot} />)
    })
    const text = host.textContent ?? ''
    expect(text).toContain('Wells Fargo Personal Credit Card')
    // Should show a finite payoff date, not "Needs terms" or "Does not amortize"
    expect(text).not.toContain('Needs terms')
    expect(text).not.toContain('Does not amortize')
  })

  it('does NOT show the empty-state "No active liability accounts" message', async () => {
    await act(async () => {
      root.render(<CashOsPayoffPlanner sources={prodSnapshot} snapshot={prodSnapshot} />)
    })
    expect(host.textContent).not.toContain('No active liability accounts found')
  })

  it('renders planner controls even when a future-dated transaction exists on the liability account', async () => {
    // Regression: without asOfDate guard, a future-dated payment or large debit on
    // the WF account would reduce the Planner's computed balance toward 0.
    // At balanceMinor=0, sufficientDebts is empty → empty state → no planner UI.
    // With the asOfDate fix the future transaction is excluded and balance stays $4,877.
    const futureTx = {
      id: 'tx-wf-future-payoff',
      organization_id: 'org-prod',
      account_id: WF_ACCOUNT_ID,
      transaction_date: '2026-11-02', // future from asOfDate 2026-10-05
      description: 'Scheduled payment Nov 2',
      amount_minor: -487700,          // would zero balance without asOfDate guard
      transaction_kind: 'card_debt_payment' as const,
      status: 'posted' as const,
    }
    const sourcesWithFutureTx = {
      ...prodSources,
      transactions: [...prodSources.transactions, futureTx],
    }
    const snapshotWithFutureTx = {
      ...prodSnapshot,
      ...sourcesWithFutureTx,
      // accountBalancesMinor is computed with asOfDate, so WF balance is still 487700
      accountBalancesMinor: { checking: 500000, [WF_ACCOUNT_ID]: 487700 },
    }
    await act(async () => {
      root.render(
        <CashOsPayoffPlanner
          sources={snapshotWithFutureTx as any}
          snapshot={snapshotWithFutureTx as any}
        />,
      )
    })
    const text = host.textContent ?? ''
    // Scope selector must be visible — proves the empty-state branch was NOT hit
    expect(text).toContain('All')
    expect(text).toContain('Avalanche')
    expect(text).not.toContain('No active liability accounts found')
  })
})
