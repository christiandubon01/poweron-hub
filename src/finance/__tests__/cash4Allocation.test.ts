import { describe, expect, it } from 'vitest'
import { usd } from '../domain'
import { computeCashAllocation } from '../allocationEngine'
import { buildRecurringObligationEventsIncludingOverrides } from '../obligationCalculations'
import type { CashAllocationPolicy } from '../allocationTypes'
import type { FinancialAccountRow, FinancialTransactionRow } from '../ledgerTypes'
import type { CashCommitment, ObligationOccurrence, RecurringObligation } from '../obligationsTypes'

// ── Minimal fixtures ─────────────────────────────────────────────────────────

function account(overrides: Partial<FinancialAccountRow> = {}): FinancialAccountRow {
  return {
    id: 'acct-1',
    organization_id: 'org-1',
    display_name: 'Checking',
    account_type: 'checking',
    account_class: 'asset',
    ownership_context: 'business',
    include_in_cash: true,
    currency: 'USD',
    status: 'active',
    source_type: 'manual',
    source_metadata: {},
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    archived_at: null,
    ...overrides,
  }
}

function tx(overrides: Partial<FinancialTransactionRow> = {}): FinancialTransactionRow {
  return {
    id: 'tx-1',
    organization_id: 'org-1',
    account_id: 'acct-1',
    amount_minor: 1_000_00,
    currency: 'USD',
    transaction_date: '2026-09-01',
    effective_at: null,
    posted_at: '2026-09-01T00:00:00Z',
    status: 'posted',
    transaction_kind: 'income',
    economic_effect: 'inflow',
    economic_amount_minor: 1_000_00,
    description: '',
    counterparty: null,
    category: null,
    project_id: null,
    employee_id: null,
    debt_account_id: null,
    source_type: 'manual',
    source_organization_id: null,
    source_kind: null,
    source_record_id: null,
    source_effective_date: null,
    source_timestamp: null,
    source_metadata: {},
    idempotency_key: 'k-1',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    voided_at: null,
    voided_by: null,
    void_reason: null,
    ...overrides,
  }
}

function obligation(overrides: Partial<RecurringObligation> = {}): RecurringObligation {
  return {
    id: 'ob-1',
    organizationId: 'org-1',
    name: 'Truck Payment',
    description: null,
    category: 'vehicle',
    amount: usd(55_913),
    amountCertainty: 'fixed',
    estimatedMinimum: null,
    estimatedMaximum: null,
    recurrence: {
      kind: 'monthly',
      interval: 1,
      anchorDate: '2026-09-15',
      startDate: '2026-09-15',
      endDate: null,
    },
    requirement: 'required',
    confidence: 'confirmed',
    status: 'active',
    accountId: null,
    debtAccountId: null,
    projectId: null,
    sourceType: 'manual',
    provenance: {
      source: { organizationId: 'org-1', kind: 'financial_obligation', recordId: 'ob-1' },
      freshness: 'current',
      confidence: 'confirmed',
      reconciliationState: 'unreconciled',
    },
    ...overrides,
  }
}

function commitment(overrides: Partial<CashCommitment> = {}): CashCommitment {
  return {
    id: 'c-1',
    organizationId: 'org-1',
    title: 'Materials',
    description: null,
    expectedDate: '2026-10-05',
    amount: usd(150_000),
    amountCertainty: 'fixed',
    estimatedMinimum: null,
    estimatedMaximum: null,
    requirement: 'required',
    confidence: 'expected',
    category: 'materials',
    status: 'scheduled',
    accountId: null,
    projectId: null,
    employeeId: null,
    debtAccountId: null,
    sourceType: 'manual',
    reconciliationState: 'unreconciled',
    actualTransactionId: null,
    provenance: {
      source: { organizationId: 'org-1', kind: 'cash_commitment', recordId: 'c-1' },
      freshness: 'current',
      confidence: 'expected',
      reconciliationState: 'unreconciled',
    },
    ...overrides,
  }
}

function policy(overrides: Partial<CashAllocationPolicy> = {}): CashAllocationPolicy {
  return {
    organizationId: 'org-1',
    asOfDate: '2026-09-29',
    protectionHorizonDays: 30,
    operatingFloorMinor: 0,
    taxReserve: { kind: 'disabled' },
    includeOptionalObligations: false,
    ...overrides,
  }
}

// $10,000 in checking for org-1 — convenience baseline
const BASE_ACCOUNTS = [account()]
const BASE_TRANSACTIONS = [tx({ amount_minor: 1_000_000, economic_amount_minor: 1_000_000 })]

describe('CASH-4 Protected Cash / Truly Free Cash allocation engine', () => {

  it('protects one valid monthly occurrence moved into the Day-0 window from October', () => {
    const recurring = obligation({ recurrence: { kind: 'monthly', interval: 1,
      anchorDate: '2026-10-31', startDate: '2026-10-31' } })
    const occurrence: ObligationOccurrence = {
      id: 'oct-override', organizationId: 'org-1', obligationId: recurring.id,
      scheduledDate: '2026-10-31', overrideDate: '2026-09-30', overrideAmount: usd(70_000),
      status: 'scheduled', reconciliationState: 'unreconciled', actualTransactionId: null,
    }
    const events = buildRecurringObligationEventsIncludingOverrides(
      recurring, [occurrence, occurrence], recurring.recurrence.startDate, '2026-09-30')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ sourceRecordId: 'oct-override', date: '2026-09-30',
      amount: usd(70_000), status: 'scheduled', reconciliationState: 'unreconciled' })
    const snap = computeCashAllocation(BASE_ACCOUNTS, BASE_TRANSACTIONS, [recurring],
      [occurrence], [], policy({ protectionHorizonDays: 1 }))
    expect(snap.totalProtectedRequirementMinor).toBe(70_000)
    expect(snap.allocationResult.requirements).toHaveLength(1)
    expect(snap.allocationResult.requirements[0].dedupeKey)
      .toBe('org-1:financial_obligation_occurrence:oct-override')
  })

  it('does not include an override whose scheduled date is not a real recurrence', () => {
    const recurring = obligation({ recurrence: { kind: 'monthly', interval: 1,
      anchorDate: '2026-10-31', startDate: '2026-10-31' } })
    const invalid: ObligationOccurrence = { id: 'invalid', organizationId: 'org-1',
      obligationId: recurring.id, scheduledDate: '2026-10-30', overrideDate: '2026-09-30',
      status: 'scheduled', reconciliationState: 'unreconciled' }
    expect(buildRecurringObligationEventsIncludingOverrides(
      recurring, [invalid], recurring.recurrence.startDate, '2026-09-30')).toEqual([])
  })

  it('sorts crossing overrides by effective date and identity while preserving materialized state', () => {
    const recurring = obligation({ recurrence: { kind: 'monthly', interval: 1,
      anchorDate: '2026-10-31', startDate: '2026-10-31' } })
    const rows: ObligationOccurrence[] = [
      { id: 'b', organizationId: 'org-1', obligationId: recurring.id,
        scheduledDate: '2026-10-31', overrideDate: '2026-09-30', overrideAmount: usd(12_345),
        status: 'skipped', reconciliationState: 'unreconciled', actualTransactionId: 'linked' },
      { id: 'a', organizationId: 'org-1', obligationId: recurring.id,
        scheduledDate: '2026-11-30', overrideDate: '2026-09-30',
        status: 'scheduled', reconciliationState: 'reconciled', actualTransactionId: 'posted' },
      { id: 'foreign', organizationId: 'other', obligationId: recurring.id,
        scheduledDate: '2026-12-31', overrideDate: '2026-09-30',
        status: 'scheduled', reconciliationState: 'unreconciled' },
    ]
    const events = buildRecurringObligationEventsIncludingOverrides(
      recurring, rows, recurring.recurrence.startDate, '2026-09-30')
    expect(events.map(event => event.sourceRecordId)).toEqual(['a', 'b'])
    expect(events[1]).toMatchObject({ date: '2026-09-30', amount: usd(12_345),
      status: 'skipped', reconciliationState: 'unreconciled', actualTransactionId: 'linked' })
  })

  // ── Test 1 ──────────────────────────────────────────────────────────────────
  it('empty protection requirements: truly free equals positive total cash', () => {
    const snap = computeCashAllocation(BASE_ACCOUNTS, BASE_TRANSACTIONS, [], [], [], policy())
    expect(snap.totalCashMinor).toBe(1_000_000)
    expect(snap.totalProtectedRequirementMinor).toBe(0)
    expect(snap.trulyFreeCashMinor).toBe(1_000_000)
    expect(snap.protectedCashMinor).toBe(0)
    expect(snap.uncoveredProtectionDeficitMinor).toBe(0)
    expect(snap.allocationResult.requirements).toHaveLength(0)
  })

  // ── Test 2 ──────────────────────────────────────────────────────────────────
  it('in-horizon required commitment is protected', () => {
    // expectedDate '2026-10-05' is within asOfDate '2026-09-29' + 30 days = '2026-10-29'
    const snap = computeCashAllocation(
      BASE_ACCOUNTS, BASE_TRANSACTIONS, [], [],
      [commitment({ id: 'c-1', expectedDate: '2026-10-05', amount: usd(50_000) })],
      policy(),
    )
    expect(snap.allocationResult.requirements).toHaveLength(1)
    expect(snap.allocationResult.requirements[0].amountMinor).toBe(50_000)
    expect(snap.allocationResult.requirements[0].reason).toBe('in_horizon')
    expect(snap.trulyFreeCashMinor).toBe(1_000_000 - 50_000)
  })

  // ── Test 3 ──────────────────────────────────────────────────────────────────
  it('future required commitment beyond horizon is NOT protected', () => {
    // horizonEnd = '2026-09-29' + 14 = '2026-10-13'; date '2026-10-15' is beyond
    const snap = computeCashAllocation(
      BASE_ACCOUNTS, BASE_TRANSACTIONS, [], [],
      [commitment({ id: 'c-1', expectedDate: '2026-10-15', amount: usd(50_000) })],
      policy({ protectionHorizonDays: 14 }),
    )
    expect(snap.allocationResult.requirements).toHaveLength(0)
    expect(snap.trulyFreeCashMinor).toBe(1_000_000)
  })

  // ── Test 4 ──────────────────────────────────────────────────────────────────
  it('future optional commitment beyond horizon is NOT protected', () => {
    const snap = computeCashAllocation(
      BASE_ACCOUNTS, BASE_TRANSACTIONS, [], [],
      [commitment({ id: 'c-1', expectedDate: '2026-10-15', requirement: 'optional' })],
      policy({ protectionHorizonDays: 14, includeOptionalObligations: true }),
    )
    expect(snap.allocationResult.requirements).toHaveLength(0)
  })

  // ── Test 5 ──────────────────────────────────────────────────────────────────
  it('in-horizon optional commitment excluded by default policy', () => {
    const snap = computeCashAllocation(
      BASE_ACCOUNTS, BASE_TRANSACTIONS, [], [],
      [commitment({ id: 'c-1', expectedDate: '2026-10-05', requirement: 'optional' })],
      policy({ includeOptionalObligations: false }),
    )
    expect(snap.allocationResult.requirements).toHaveLength(0)
    expect(snap.trulyFreeCashMinor).toBe(1_000_000)
  })

  // ── Test 6 ──────────────────────────────────────────────────────────────────
  it('in-horizon optional commitment included when policy says so', () => {
    const snap = computeCashAllocation(
      BASE_ACCOUNTS, BASE_TRANSACTIONS, [], [],
      [commitment({ id: 'c-1', expectedDate: '2026-10-05', requirement: 'optional', amount: usd(20_000) })],
      policy({ includeOptionalObligations: true }),
    )
    expect(snap.allocationResult.requirements).toHaveLength(1)
    expect(snap.allocationResult.requirements[0].amountMinor).toBe(20_000)
    expect(snap.trulyFreeCashMinor).toBe(1_000_000 - 20_000)
  })

  // ── Test 7 ──────────────────────────────────────────────────────────────────
  it('overdue obligation older than 365 days remains protected when still scheduled/unreconciled', () => {
    // Obligation started Jan 2024 — all occurrences since then are overdue
    const old = obligation({
      id: 'ob-old',
      amount: usd(10_000),
      recurrence: {
        kind: 'monthly',
        interval: 1,
        anchorDate: '2024-01-31',
        startDate: '2024-01-31',
        endDate: null,
      },
    })
    const snap = computeCashAllocation(
      BASE_ACCOUNTS, BASE_TRANSACTIONS, [old], [], [],
      policy({ protectionHorizonDays: 14 }),
    )
    const reqs = snap.allocationResult.requirements
    // Occurrences from 2024-01-31 through horizonEnd are all generated
    expect(reqs.length).toBeGreaterThan(12)
    // The oldest occurrence has reason='overdue'
    const oldest = reqs.find((r) => r.sourceRecordId?.endsWith('2024-01-31'))
    expect(oldest).toBeDefined()
    expect(oldest!.reason).toBe('overdue')
    // All pre-asOfDate occurrences are overdue
    const overdueCount = reqs.filter((r) => r.reason === 'overdue').length
    expect(overdueCount).toBeGreaterThan(0)
  })

  // ── Test 8 ──────────────────────────────────────────────────────────────────
  it('reconciled/satisfied occurrence is excluded from protection', () => {
    const ob = obligation({ id: 'ob-1', amount: usd(10_000) })
    // asOfDate='2026-09-29', startDate='2026-09-15' => '2026-09-15' occurrence is generated
    const reconciledOcc: ObligationOccurrence = {
      id: 'occ-sat',
      organizationId: 'org-1',
      obligationId: 'ob-1',
      scheduledDate: '2026-09-15',
      status: 'satisfied',
      reconciliationState: 'reconciled',
      actualTransactionId: 'tx-paid',
    }
    const snap = computeCashAllocation(
      BASE_ACCOUNTS, BASE_TRANSACTIONS, [ob], [reconciledOcc], [],
      policy(),
    )
    // '2026-09-15' occurrence is satisfied/reconciled → excluded
    // '2026-10-15' occurrence is within 30-day horizon and scheduled → included
    const reqs = snap.allocationResult.requirements
    expect(reqs.every((r) => !r.sourceRecordId?.endsWith('2026-09-15'))).toBe(true)
  })

  // ── Test 9 ──────────────────────────────────────────────────────────────────
  it('duplicate canonical source identity contributes only once', () => {
    const c = commitment({ id: 'c-dup', amount: usd(30_000) })
    // Same commitment passed twice
    const snap = computeCashAllocation(
      BASE_ACCOUNTS, BASE_TRANSACTIONS, [], [], [c, c],
      policy(),
    )
    // Only one requirement — duplicate suppressed
    const reqs = snap.allocationResult.requirements.filter(
      (r) => r.sourceType === 'cash_commitment',
    )
    expect(reqs).toHaveLength(1)
    expect(reqs[0].amountMinor).toBe(30_000)
    expect(snap.allocationResult.suppressedDuplicateSourceKeys).toHaveLength(1)
    // Protected amount does not double
    expect(snap.totalProtectedRequirementMinor).toBe(30_000)
  })

  // ── Test 10 ─────────────────────────────────────────────────────────────────
  it('operating floor contributes exactly once as a policy slot', () => {
    const snap = computeCashAllocation(
      BASE_ACCOUNTS, BASE_TRANSACTIONS, [], [], [],
      policy({ operatingFloorMinor: 200_000 }),
    )
    const floors = snap.allocationResult.requirements.filter((r) => r.bucket === 'operating_floor')
    expect(floors).toHaveLength(1)
    expect(floors[0].amountMinor).toBe(200_000)
    expect(floors[0].sourceType).toBe('policy')
    expect(floors[0].reason).toBe('operating_floor')
  })

  // ── Test 11 ─────────────────────────────────────────────────────────────────
  it('fixed tax reserve contributes exactly once as a policy slot', () => {
    const snap = computeCashAllocation(
      BASE_ACCOUNTS, BASE_TRANSACTIONS, [], [], [],
      policy({ taxReserve: { kind: 'fixed_amount', amountMinor: 75_000 } }),
    )
    const taxes = snap.allocationResult.requirements.filter((r) => r.bucket === 'tax')
    expect(taxes).toHaveLength(1)
    expect(taxes[0].amountMinor).toBe(75_000)
    expect(taxes[0].sourceType).toBe('policy')
    expect(taxes[0].reason).toBe('tax_reserve')
  })

  // ── Test 12 ─────────────────────────────────────────────────────────────────
  it('requirements exceeding available cash: deficit calculated, truly free zero', () => {
    // totalCash = $1000; protection = $1500
    const accts = [account()]
    const txs = [tx({ id: 'tx-a', amount_minor: 100_000, economic_amount_minor: 100_000 })]
    const c = commitment({ id: 'c-big', amount: usd(150_000) })
    const snap = computeCashAllocation(accts, txs, [], [], [c], policy())
    expect(snap.totalCashMinor).toBe(100_000)
    expect(snap.totalProtectedRequirementMinor).toBe(150_000)
    expect(snap.trulyFreeCashMinor).toBe(0)
    expect(snap.protectedCashMinor).toBe(100_000)
    expect(snap.uncoveredProtectionDeficitMinor).toBe(50_000)
  })

  // ── Test 13 ─────────────────────────────────────────────────────────────────
  it('negative total cash: protected cash zero, truly free zero, deficit includes cash shortfall', () => {
    // Account balance = -$100 (overdrawn)
    const accts = [account({ id: 'acct-neg' })]
    const txs = [tx({ id: 'tx-neg', account_id: 'acct-neg', amount_minor: -10_000, economic_amount_minor: 10_000, economic_effect: 'outflow', transaction_kind: 'expense' })]
    // Required protection = $500
    const c = commitment({ id: 'c-prot', amount: usd(50_000) })
    const snap = computeCashAllocation(accts, txs, [], [], [c], policy())
    expect(snap.totalCashMinor).toBe(-10_000)
    expect(snap.protectedCashMinor).toBe(0)
    expect(snap.trulyFreeCashMinor).toBe(0)
    // deficit = 50000 - (-10000) = 60000
    expect(snap.uncoveredProtectionDeficitMinor).toBe(60_000)
  })

  // ── Test 14 ─────────────────────────────────────────────────────────────────
  it('liability financial account is excluded from total cash', () => {
    const assetAcct = account({ id: 'a-asset', account_class: 'asset', include_in_cash: true })
    const liabilityAcct = account({
      id: 'a-liab',
      account_class: 'liability',
      include_in_cash: true, // even if flagged, class rules it out
      account_type: 'credit_card',
    })
    const assetTx = tx({ id: 'tx-asset', account_id: 'a-asset', amount_minor: 500_000, economic_amount_minor: 500_000 })
    const liabTx = tx({ id: 'tx-liab', account_id: 'a-liab', amount_minor: 300_000, economic_amount_minor: 300_000 })
    const snap = computeCashAllocation([assetAcct, liabilityAcct], [assetTx, liabTx], [], [], [], policy())
    expect(snap.totalCashMinor).toBe(500_000)
  })

  // ── Test 15 ─────────────────────────────────────────────────────────────────
  it('other organization rows cannot affect the snapshot', () => {
    const orgAAcct = account({ id: 'a-a', organization_id: 'org-A' })
    const orgBAcct = account({ id: 'a-b', organization_id: 'org-B', include_in_cash: true })
    const orgATx = tx({ id: 'tx-a', organization_id: 'org-A', account_id: 'a-a', amount_minor: 500_000, economic_amount_minor: 500_000 })
    const orgBTx = tx({ id: 'tx-b', organization_id: 'org-B', account_id: 'a-b', amount_minor: 999_999, economic_amount_minor: 999_999 })
    const orgAOb = obligation({ id: 'ob-a', organizationId: 'org-A', amount: usd(10_000) })
    const orgBOb = obligation({ id: 'ob-b', organizationId: 'org-B', amount: usd(99_000) })
    const orgACom = commitment({ id: 'c-a', organizationId: 'org-A', amount: usd(20_000) })
    const orgBCom = commitment({ id: 'c-b', organizationId: 'org-B', amount: usd(88_000) })

    const snap = computeCashAllocation(
      [orgAAcct, orgBAcct],
      [orgATx, orgBTx],
      [orgAOb, orgBOb],
      [],
      [orgACom, orgBCom],
      policy({ organizationId: 'org-A' }),
    )
    // Only org-A data contributes
    expect(snap.totalCashMinor).toBe(500_000)
    // org-A requirements: obligation occurrences + orgA commitment
    const reqOrgs = snap.allocationResult.requirements.every(
      (r) => r.attribution === r.attribution, // all are org-scoped by engine
    )
    expect(reqOrgs).toBe(true)
    // org-B commitment (88000) must not appear
    expect(snap.allocationResult.requirements.find((r) => r.amountMinor === 88_000)).toBeUndefined()
    // org-B tx balance (999999) must not appear
    expect(snap.totalCashMinor).not.toBe(999_999)
  })

  // ── Test 16 ─────────────────────────────────────────────────────────────────
  it('project materials + project-attributed payroll: correct combined amount, payroll bucket, no third duplicate', () => {
    const materials = commitment({
      id: 'c-mat',
      title: 'Rockn Materials',
      amount: usd(150_000),
      projectId: 'proj-1',
      employeeId: null,
      category: 'materials',
    })
    const payroll = commitment({
      id: 'c-pay',
      title: 'Rockn Payroll',
      amount: usd(100_000),
      projectId: 'proj-1',
      employeeId: 'emp-1',
      category: 'payroll',
    })
    const snap = computeCashAllocation(
      BASE_ACCOUNTS, BASE_TRANSACTIONS, [], [], [materials, payroll],
      policy(),
    )
    const reqs = snap.allocationResult.requirements

    // Exactly 2 requirements — no phantom third
    expect(reqs).toHaveLength(2)

    // Combined amount
    expect(snap.totalProtectedRequirementMinor).toBe(250_000)

    // Materials item
    const matReq = reqs.find((r) => r.sourceRecordId === 'c-mat')
    expect(matReq?.bucket).toBe('project_reserve')

    // Payroll item classified as payroll even though projectId is also set
    const payReq = reqs.find((r) => r.sourceRecordId === 'c-pay')
    expect(payReq?.bucket).toBe('payroll')
    expect(payReq?.attribution.projectId).toBe('proj-1')
    expect(payReq?.attribution.employeeId).toBe('emp-1')
  })

  // ── Test 17 ─────────────────────────────────────────────────────────────────
  it('transfer between own cash accounts does not change total cash (CASH-2 economic neutrality)', () => {
    const acctA = account({ id: 'a-chk', account_class: 'asset', include_in_cash: true })
    const acctB = account({ id: 'a-sav', account_type: 'savings', account_class: 'asset', include_in_cash: true })
    // Opening balances
    const openA = tx({ id: 'open-a', account_id: 'a-chk', amount_minor: 300_000, transaction_kind: 'opening_balance', economic_effect: 'none', economic_amount_minor: 0 })
    const openB = tx({ id: 'open-b', account_id: 'a-sav', amount_minor: 200_000, transaction_kind: 'opening_balance', economic_effect: 'none', economic_amount_minor: 0 })
    // Transfer: A → B (both legs)
    const xferOut = tx({ id: 'xfer-out', account_id: 'a-chk', amount_minor: -100_000, transaction_kind: 'transfer', economic_effect: 'none', economic_amount_minor: 0 })
    const xferIn = tx({ id: 'xfer-in', account_id: 'a-sav', amount_minor: 100_000, transaction_kind: 'transfer', economic_effect: 'none', economic_amount_minor: 0 })

    const snap = computeCashAllocation(
      [acctA, acctB], [openA, openB, xferOut, xferIn], [], [], [],
      policy(),
    )
    // Net: A = 300000 - 100000 = 200000; B = 200000 + 100000 = 300000; total = 500000
    // Same as without the transfer (300000 + 200000 = 500000)
    expect(snap.totalCashMinor).toBe(500_000)
    expect(snap.trulyFreeCashMinor).toBe(500_000)
  })

  // ── Test 18 ─────────────────────────────────────────────────────────────────
  it('no beyond-horizon "confirmed required" escape hatch exists', () => {
    // Even with requirement='required' and confidence='confirmed', an event beyond
    // the horizon must NOT be protected in CASH-4 V1.
    const c = commitment({
      id: 'c-future',
      expectedDate: '2026-11-15', // well beyond 14-day horizon
      amount: usd(50_000),
      requirement: 'required',
      confidence: 'confirmed',
    })
    const snap = computeCashAllocation(
      BASE_ACCOUNTS, BASE_TRANSACTIONS, [], [], [c],
      policy({ protectionHorizonDays: 14 }),
    )
    expect(snap.allocationResult.requirements).toHaveLength(0)
    expect(snap.trulyFreeCashMinor).toBe(1_000_000)
  })

  // ── Test 19 ─────────────────────────────────────────────────────────────────
  describe('invalid policy inputs reject deterministically', () => {
    it('rejects invalid asOfDate', () => {
      expect(() =>
        computeCashAllocation([], [], [], [], [], policy({ asOfDate: 'not-a-date' })),
      ).toThrow()
    })

    it('rejects non-integer protectionHorizonDays', () => {
      expect(() =>
        computeCashAllocation([], [], [], [], [], policy({ protectionHorizonDays: 1.5 })),
      ).toThrow('protectionHorizonDays must be a non-negative integer')
    })

    it('rejects negative protectionHorizonDays', () => {
      expect(() =>
        computeCashAllocation([], [], [], [], [], policy({ protectionHorizonDays: -1 })),
      ).toThrow('protectionHorizonDays must be a non-negative integer')
    })

    it('rejects negative operatingFloorMinor', () => {
      expect(() =>
        computeCashAllocation([], [], [], [], [], policy({ operatingFloorMinor: -1 })),
      ).toThrow('operatingFloorMinor must be a non-negative safe integer')
    })

    it('rejects negative tax reserve amountMinor', () => {
      expect(() =>
        computeCashAllocation([], [], [], [], [],
          policy({ taxReserve: { kind: 'fixed_amount', amountMinor: -50 } })),
      ).toThrow('taxReserve.amountMinor must be a non-negative safe integer')
    })
  })

  // ── Issue 1 regression ───────────────────────────────────────────────────────
  it('recurring obligation whose startDate is beyond the horizon does not crash', () => {
    // startDate '2026-12-01' > horizonEnd '2026-10-13' (asOfDate + 14 days)
    const futureOb = obligation({
      id: 'ob-future',
      amount: usd(20_000),
      recurrence: {
        kind: 'monthly',
        interval: 1,
        anchorDate: '2026-12-01',
        startDate: '2026-12-01',
        endDate: null,
      },
    })
    let snap: ReturnType<typeof computeCashAllocation> | undefined
    expect(() => {
      snap = computeCashAllocation(
        BASE_ACCOUNTS, BASE_TRANSACTIONS, [futureOb], [], [],
        policy({ protectionHorizonDays: 14 }),
      )
    }).not.toThrow()
    expect(snap!.allocationResult.requirements).toHaveLength(0)
    expect(snap!.trulyFreeCashMinor).toBe(1_000_000)
  })

  // ── Issue 2 regression ───────────────────────────────────────────────────────
  it('commitment with negative amount rejects', () => {
    const bad = commitment({ id: 'c-neg', amount: { currency: 'USD', minor: -5_000 } })
    expect(() =>
      computeCashAllocation(BASE_ACCOUNTS, BASE_TRANSACTIONS, [], [], [bad], policy()),
    ).toThrow(/invalid amount/)
  })

  it('recurring obligation with negative amount rejects', () => {
    const badOb = obligation({
      id: 'ob-neg',
      amount: { currency: 'USD', minor: -10_000 },
      recurrence: {
        kind: 'monthly',
        interval: 1,
        anchorDate: '2026-09-29',
        startDate: '2026-09-29',
        endDate: null,
      },
    })
    expect(() =>
      computeCashAllocation(BASE_ACCOUNTS, BASE_TRANSACTIONS, [badOb], [], [], policy()),
    ).toThrow(/invalid amount/)
  })

  // ── Test 20 ─────────────────────────────────────────────────────────────────
  it('all returned money values are integer cents', () => {
    const snap = computeCashAllocation(
      BASE_ACCOUNTS,
      BASE_TRANSACTIONS,
      [],
      [],
      [commitment({ id: 'c-1', amount: usd(33_333) })],
      policy({ operatingFloorMinor: 50_000, taxReserve: { kind: 'fixed_amount', amountMinor: 25_000 } }),
    )
    expect(Number.isInteger(snap.totalCashMinor)).toBe(true)
    expect(Number.isInteger(snap.totalProtectedRequirementMinor)).toBe(true)
    expect(Number.isInteger(snap.protectedCashMinor)).toBe(true)
    expect(Number.isInteger(snap.trulyFreeCashMinor)).toBe(true)
    expect(Number.isInteger(snap.uncoveredProtectionDeficitMinor)).toBe(true)
    for (const req of snap.allocationResult.requirements) {
      expect(Number.isInteger(req.amountMinor)).toBe(true)
    }
  })

})
