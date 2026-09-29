import { describe, expect, it } from 'vitest'
import {
  buildPayrollExposure,
  type ClosedTimeEntryInput,
  type EmployeeRateInput,
  type ManualPayrollCommitmentLike,
  type OpenSessionInput,
  type PayrollExposurePolicy,
  type ProfileIdentityBridge,
} from '../adapters/employeeFinanceAdapter'
import { computeCashAllocation } from '../allocationEngine'
import type { CashAllocationPolicy, FinancialLiabilityInput } from '../allocationTypes'
import type { FinancialAccountRow, FinancialTransactionRow } from '../ledgerTypes'

// ── Shared constants ──────────────────────────────────────────────────────────

const ORG = 'org-1'
const OTHER_ORG = 'org-2'
const PROFILE_1 = 'profile-1'
const EMP_1 = 'emp-1'

// paidThroughDate='2026-09-14', asOfDate='2026-09-29'
// work_date of '2026-09-15' is in the window, '2026-09-14' is excluded.

// ── Factory helpers ───────────────────────────────────────────────────────────

function makePolicy(overrides: Partial<PayrollExposurePolicy> = {}): PayrollExposurePolicy {
  return {
    organizationId: ORG,
    asOfDate: '2026-09-29',
    asOfTimestamp: '2026-09-29T20:00:00.000Z',
    paidThroughDate: '2026-09-14',
    includeOpenShiftEstimates: false,
    ...overrides,
  }
}

function makeBridge(profileId = PROFILE_1, backupId: string | null = EMP_1): ProfileIdentityBridge {
  return { employeeProfileId: profileId, backupEmployeeId: backupId }
}

function makeEmployee(backupId = EMP_1, overrides: Partial<EmployeeRateInput> = {}): EmployeeRateInput {
  return { backupEmployeeId: backupId, hourly_rate: 25, ...overrides }
}

function makeEntry(overrides: Partial<ClosedTimeEntryInput> = {}): ClosedTimeEntryInput {
  return {
    id: 'te-1',
    organizationId: ORG,
    employeeProfileId: PROFILE_1,
    workDate: '2026-09-15',
    paidMinutes: 480,   // 8 hours
    status: 'complete',
    approvalStatus: 'none',
    ...overrides,
  }
}

function makeSession(overrides: Partial<OpenSessionInput> = {}): OpenSessionInput {
  return {
    id: 'sess-1',
    organizationId: ORG,
    employeeProfileId: PROFILE_1,
    workDate: '2026-09-29',
    clockInAt: '2026-09-29T14:00:00.000Z',
    lunchOutAt: null,
    lunchInAt: null,
    clockOutAt: null,
    paidMinutes: null,
    projectId: null,
    ...overrides,
  }
}

const defaultBridges = [makeBridge()]
const defaultEmployees = [makeEmployee()]

// Minimal CASH-4 helpers for integration tests
function account(overrides: Partial<FinancialAccountRow> = {}): FinancialAccountRow {
  return {
    id: 'acct-1', organization_id: ORG, display_name: 'Checking',
    account_type: 'checking', account_class: 'asset', ownership_context: 'business',
    include_in_cash: true, currency: 'USD', status: 'active', source_type: 'manual',
    source_metadata: {}, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    archived_at: null, ...overrides,
  }
}

function tx(economicAmountMinor: number, overrides: Partial<FinancialTransactionRow> = {}): FinancialTransactionRow {
  return {
    id: 'tx-1', organization_id: ORG, account_id: 'acct-1',
    amount_minor: economicAmountMinor, currency: 'USD',
    transaction_date: '2026-09-01', effective_at: null, posted_at: '2026-09-01T00:00:00Z',
    status: 'posted', transaction_kind: 'income', economic_effect: 'inflow',
    economic_amount_minor: economicAmountMinor, description: '',
    counterparty: null, category: null, project_id: null, employee_id: null,
    debt_account_id: null, source_type: 'manual', source_organization_id: null,
    source_kind: null, source_record_id: null, source_effective_date: null,
    source_timestamp: null, source_metadata: {}, idempotency_key: 'k-1',
    created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
    voided_at: null, voided_by: null, void_reason: null, ...overrides,
  }
}

const baseCash4Policy: CashAllocationPolicy = {
  organizationId: ORG,
  asOfDate: '2026-09-29',
  protectionHorizonDays: 30,
  operatingFloorMinor: 0,
  taxReserve: { kind: 'disabled' },
  includeOptionalObligations: false,
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CASH-5B payroll exposure', () => {

  // ── Closed confirmed entries ────────────────────────────────────────────────

  it('1: closed complete entry after paidThroughDate produces confirmed payroll exposure', () => {
    const result = buildPayrollExposure(makePolicy(), [makeEntry()], [], defaultBridges, defaultEmployees, [], [])
    expect(result.liabilities).toHaveLength(1)
    const l = result.liabilities[0]
    // 8 hrs × $25/hr = $200 = 20000 cents
    expect(l.amountMinor).toBe(20_000)
    expect(l.provenance.confidence).toBe('confirmed')
    expect(l.provenance.source.kind).toBe('employee_time_entry')
    expect(l.provenance.source.recordId).toBe('te-1')
    expect(result.diagnostics.filter(d => d.kind !== 'incomplete_time_entry')).toHaveLength(0)
  })

  it('2: corrected closed entry produces confirmed exposure', () => {
    const result = buildPayrollExposure(makePolicy(), [makeEntry({ status: 'corrected' })], [], defaultBridges, defaultEmployees, [], [])
    expect(result.liabilities).toHaveLength(1)
    expect(result.liabilities[0].provenance.confidence).toBe('confirmed')
  })

  it('3: auto_closed entry produces confirmed exposure', () => {
    const result = buildPayrollExposure(makePolicy(), [makeEntry({ status: 'auto_closed' })], [], defaultBridges, defaultEmployees, [], [])
    expect(result.liabilities).toHaveLength(1)
    expect(result.liabilities[0].provenance.confidence).toBe('confirmed')
  })

  it('4: incomplete entry with usable paid_minutes produces expected confidence + diagnostic', () => {
    const result = buildPayrollExposure(makePolicy(), [makeEntry({ status: 'incomplete', paidMinutes: 240 })], [], defaultBridges, defaultEmployees, [], [])
    expect(result.liabilities).toHaveLength(1)
    expect(result.liabilities[0].provenance.confidence).toBe('expected')
    const diag = result.diagnostics.find(d => d.kind === 'incomplete_time_entry')
    expect(diag).toBeDefined()
    expect(diag?.sourceId).toBe('te-1')
  })

  it('5: open entry / null paid_minutes does not produce confirmed time-entry exposure', () => {
    const result = buildPayrollExposure(makePolicy(), [makeEntry({ status: 'open', paidMinutes: null })], [], defaultBridges, defaultEmployees, [], [])
    expect(result.liabilities).toHaveLength(0)
  })

  // ── Open session estimates ─────────────────────────────────────────────────

  it('6: open session produces expected estimate when includeOpenShiftEstimates=true', () => {
    // asOf='2026-09-29T20:00:00Z', clockIn='2026-09-29T14:00:00Z' → 6 hrs = 360 min
    // 360 min × 2500 cents/hr / 60 = 15000 cents
    const policy = makePolicy({ includeOpenShiftEstimates: true })
    const result = buildPayrollExposure(policy, [], [makeSession()], defaultBridges, defaultEmployees, [], [])
    expect(result.liabilities).toHaveLength(1)
    expect(result.liabilities[0].amountMinor).toBe(15_000)
    expect(result.liabilities[0].provenance.confidence).toBe('expected')
    expect(result.liabilities[0].provenance.source.kind).toBe('employee_work_session')
    expect(result.liabilities[0].provenance.source.recordId).toBe('sess-1')
  })

  it('7: active lunch stops estimated paid-minute accrual (currently on lunch)', () => {
    // clockIn=14:00, lunchOut=17:00, lunchIn=null, asOf=20:00
    // totalMinutes = 360, lunchElapsed = 180 → paidMinutes = 180
    // 180 × 2500 / 60 = 7500
    const policy = makePolicy({ includeOpenShiftEstimates: true })
    const session = makeSession({
      clockInAt: '2026-09-29T14:00:00.000Z',
      lunchOutAt: '2026-09-29T17:00:00.000Z',
      lunchInAt: null,
    })
    const result = buildPayrollExposure(policy, [], [session], defaultBridges, defaultEmployees, [], [])
    expect(result.liabilities).toHaveLength(1)
    expect(result.liabilities[0].amountMinor).toBe(7_500)
  })

  it('8: completed lunch duration is subtracted from estimated paid minutes', () => {
    // clockIn=14:00, lunchOut=17:00, lunchIn=17:30, clockOut=null, asOf=20:00
    // totalMinutes=360, lunch=30, paidMinutes=330
    // 330 × 2500 / 60 = 13750
    const policy = makePolicy({ includeOpenShiftEstimates: true })
    const session = makeSession({
      clockInAt: '2026-09-29T14:00:00.000Z',
      lunchOutAt: '2026-09-29T17:00:00.000Z',
      lunchInAt: '2026-09-29T17:30:00.000Z',
    })
    const result = buildPayrollExposure(policy, [], [session], defaultBridges, defaultEmployees, [], [])
    expect(result.liabilities).toHaveLength(1)
    expect(result.liabilities[0].amountMinor).toBe(13_750)
  })

  it('9: open estimates disabled — no session liability emitted', () => {
    const policy = makePolicy({ includeOpenShiftEstimates: false })
    const result = buildPayrollExposure(policy, [], [makeSession()], defaultBridges, defaultEmployees, [], [])
    expect(result.liabilities).toHaveLength(0)
  })

  // ── Double-counting prevention ─────────────────────────────────────────────

  it('10: closed time_entry prevents sessions for the same employee+date being added', () => {
    const policy = makePolicy({ includeOpenShiftEstimates: true })
    // Closed time entry for '2026-09-29'
    const entry = makeEntry({ workDate: '2026-09-29', paidMinutes: 480, status: 'complete' })
    // Session for the same day
    const session = makeSession({ workDate: '2026-09-29' })
    const result = buildPayrollExposure(policy, [entry], [session], defaultBridges, defaultEmployees, [], [])
    expect(result.liabilities).toHaveLength(1)
    expect(result.liabilities[0].provenance.source.kind).toBe('employee_time_entry')
  })

  // ── Date boundary filtering ────────────────────────────────────────────────

  it('11: workDate <= paidThroughDate is excluded (paidThroughDate is inclusive)', () => {
    // paidThroughDate='2026-09-14'; entry at '2026-09-14' must be excluded
    const entry = makeEntry({ workDate: '2026-09-14' })
    const result = buildPayrollExposure(makePolicy(), [entry], [], defaultBridges, defaultEmployees, [], [])
    expect(result.liabilities).toHaveLength(0)
  })

  it('12: workDate > asOfDate is excluded (future entries not yet earned)', () => {
    const entry = makeEntry({ workDate: '2026-09-30' })
    const result = buildPayrollExposure(makePolicy(), [entry], [], defaultBridges, defaultEmployees, [], [])
    expect(result.liabilities).toHaveLength(0)
  })

  it('13: other organization entries are excluded', () => {
    const entry = makeEntry({ organizationId: OTHER_ORG })
    const result = buildPayrollExposure(makePolicy(), [entry], [], defaultBridges, defaultEmployees, [], [])
    expect(result.liabilities).toHaveLength(0)
  })

  // ── Wage resolution ────────────────────────────────────────────────────────

  it('14: hourly_rate is used as the base cash wage (not costRate or bill rate)', () => {
    // hourly_rate=30, costRate=36 (loaded W-2) → should use 30 → 3000 cents/hr
    // 480 min × 3000 / 60 = 24000
    const emp = makeEmployee(EMP_1, { hourly_rate: 30, costRate: 36 })
    const result = buildPayrollExposure(makePolicy(), [makeEntry()], [], defaultBridges, [emp], [], [])
    expect(result.liabilities).toHaveLength(1)
    expect(result.liabilities[0].amountMinor).toBe(24_000)
  })

  it('15: W-2 stale costRate can reverse-decode to base only with valid payroll multiplier', () => {
    // costRate=30, payrollMultiplier=1.25 → base=24 → 2400 cents/hr
    // 480 × 2400 / 60 = 19200
    const emp = makeEmployee(EMP_1, { hourly_rate: null, costRate: 30, classification: 'W-2' })
    const result = buildPayrollExposure(makePolicy(), [makeEntry()], [], defaultBridges, [emp], [], [], 1.25)
    expect(result.liabilities).toHaveLength(1)
    expect(result.liabilities[0].amountMinor).toBe(19_200)
  })

  it('16: W-2 stale costRate without payrollMultiplier produces missing_cash_wage (no billRate fallback)', () => {
    // No hourly_rate, costRate present but W-2 needs multiplier → can't decode → diagnostic
    const emp = makeEmployee(EMP_1, { hourly_rate: null, costRate: 30, classification: 'W-2' })
    const result = buildPayrollExposure(makePolicy(), [makeEntry()], [], defaultBridges, [emp], [], [])
    expect(result.liabilities).toHaveLength(0)
    const diag = result.diagnostics.find(d => d.kind === 'missing_cash_wage')
    expect(diag).toBeDefined()
  })

  it('17: opCost is never used — buildPayrollExposure has no settings parameter', () => {
    // Employee with no rate fields. Since buildPayrollExposure accepts no settings/opCost,
    // it cannot fall back to settings.opCost — produces missing_cash_wage.
    const emp: EmployeeRateInput = { backupEmployeeId: EMP_1, hourly_rate: null, costRate: null }
    const result = buildPayrollExposure(makePolicy(), [makeEntry()], [], defaultBridges, [emp], [], [])
    expect(result.liabilities).toHaveLength(0)
    expect(result.diagnostics.some(d => d.kind === 'missing_cash_wage')).toBe(true)
  })

  it('18: missing rate returns missing_cash_wage diagnostic and no money', () => {
    const emp: EmployeeRateInput = { backupEmployeeId: EMP_1 }
    const result = buildPayrollExposure(makePolicy(), [makeEntry()], [], defaultBridges, [emp], [], [])
    expect(result.liabilities).toHaveLength(0)
    const diag = result.diagnostics.find(d => d.kind === 'missing_cash_wage')
    expect(diag).toBeDefined()
    expect(diag?.sourceId).toBe('te-1')
  })

  it('19: missing backup_employee_id returns missing_employee_bridge diagnostic and no money', () => {
    const bridge = makeBridge(PROFILE_1, null)  // null backupEmployeeId
    const result = buildPayrollExposure(makePolicy(), [makeEntry()], [], [bridge], defaultEmployees, [], [])
    expect(result.liabilities).toHaveLength(0)
    const diag = result.diagnostics.find(d => d.kind === 'missing_employee_bridge')
    expect(diag).toBeDefined()
  })

  // ── CASH-4 integration ─────────────────────────────────────────────────────

  it('20: employee_time_entry provenance is retained through CASH-4 ProtectedRequirement', () => {
    const { liabilities } = buildPayrollExposure(makePolicy(), [makeEntry()], [], defaultBridges, defaultEmployees, [], [])
    const snap = computeCashAllocation([], [], [], [], [], baseCash4Policy, liabilities)
    expect(snap.allocationResult.requirements).toHaveLength(1)
    const req = snap.allocationResult.requirements[0]
    expect(req.sourceType).toBe('derived_liability')
    expect(req.sourceRecordId).toBe('te-1')
    expect(req.bucket).toBe('payroll')
  })

  it('21: employee_work_session provenance is retained for provisional estimate in CASH-4', () => {
    const policy = makePolicy({ includeOpenShiftEstimates: true })
    const { liabilities } = buildPayrollExposure(policy, [], [makeSession()], defaultBridges, defaultEmployees, [], [])
    const snap = computeCashAllocation([], [], [], [], [], baseCash4Policy, liabilities)
    expect(snap.allocationResult.requirements).toHaveLength(1)
    const req = snap.allocationResult.requirements[0]
    expect(req.sourceType).toBe('derived_liability')
    expect(req.sourceRecordId).toBe('sess-1')
    expect(req.confidence).toBe('expected')
  })

  it('22: same canonical source key dedupes exactly once in CASH-4', () => {
    const { liabilities } = buildPayrollExposure(makePolicy(), [makeEntry()], [], defaultBridges, defaultEmployees, [], [])
    expect(liabilities).toHaveLength(1)
    const doubled = [...liabilities, ...liabilities]   // same provenance twice
    const snap = computeCashAllocation([], [], [], [], [], baseCash4Policy, doubled)
    expect(snap.allocationResult.requirements).toHaveLength(1)
    expect(snap.allocationResult.suppressedDuplicateSourceKeys).toHaveLength(1)
  })

  it('23: employee + project attribution classifies as payroll, not project_reserve', () => {
    // Session with projectId set; employeeId wins in classifyBucket
    const policy = makePolicy({ includeOpenShiftEstimates: true })
    const session = makeSession({ projectId: 'proj-1' })
    const { liabilities } = buildPayrollExposure(policy, [], [session], defaultBridges, defaultEmployees, [], [])
    expect(liabilities).toHaveLength(1)
    expect(liabilities[0].attribution.projectId).toBe('proj-1')
    expect(liabilities[0].attribution.employeeId).toBe(EMP_1)

    const snap = computeCashAllocation([], [], [], [], [], baseCash4Policy, liabilities)
    expect(snap.allocationResult.requirements[0].bucket).toBe('payroll')
  })

  it('24: manual payroll commitment overlap emits diagnostic; no fuzzy suppression occurs', () => {
    const comm: ManualPayrollCommitmentLike = { id: 'comm-1', organizationId: ORG, employeeId: EMP_1 }
    const result = buildPayrollExposure(makePolicy(), [makeEntry()], [], defaultBridges, defaultEmployees, [], [comm])
    expect(result.liabilities).toHaveLength(1)  // derived payroll still returned
    const diag = result.diagnostics.find(d => d.kind === 'potential_manual_payroll_overlap')
    expect(diag).toBeDefined()
    expect(diag?.sourceId).toBe('comm-1')
  })

  it('25: derived liability reduces Truly Free Cash correctly', () => {
    // totalCash=100_000; derived payroll=20_000 → trulyFree=80_000
    const { liabilities } = buildPayrollExposure(makePolicy(), [makeEntry()], [], defaultBridges, defaultEmployees, [], [])
    expect(liabilities[0].amountMinor).toBe(20_000)
    const snap = computeCashAllocation(
      [account()],
      [tx(100_000)],
      [], [], [],
      baseCash4Policy,
      liabilities,
    )
    expect(snap.totalCashMinor).toBe(100_000)
    expect(snap.trulyFreeCashMinor).toBe(80_000)
    expect(snap.protectedCashMinor).toBe(20_000)
  })

  it('26: existing CASH-4 call signature with 6 args remains backward compatible', () => {
    // computeCashAllocation without the 7th arg must not error
    const snap = computeCashAllocation([], [], [], [], [], baseCash4Policy)
    expect(snap.trulyFreeCashMinor).toBe(0)
    expect(snap.totalCashMinor).toBe(0)
  })

  it('27: negative/malformed amountMinor on a derived liability causes the engine to throw', () => {
    const { liabilities } = buildPayrollExposure(makePolicy(), [makeEntry()], [], defaultBridges, defaultEmployees, [], [])
    const bad: FinancialLiabilityInput = { ...liabilities[0], amountMinor: -100 }
    expect(() => computeCashAllocation([], [], [], [], [], baseCash4Policy, [bad])).toThrow(/invalid amountMinor/)
  })

  it('28: no source is counted once as time_entry and again as session for the same finalized day', () => {
    const policy = makePolicy({ includeOpenShiftEstimates: true })
    // Closed time entry for workDate '2026-09-29'
    const closedEntry = makeEntry({ workDate: '2026-09-29', paidMinutes: 480, status: 'complete' })
    // Two sessions on the same day (one closed, one open)
    const closedSession = makeSession({ id: 'sess-closed', workDate: '2026-09-29', clockOutAt: '2026-09-29T18:00:00.000Z', paidMinutes: 240 })
    const openSession = makeSession({ id: 'sess-open', workDate: '2026-09-29' })

    const result = buildPayrollExposure(
      policy, [closedEntry], [closedSession, openSession], defaultBridges, defaultEmployees, [], [],
    )
    // Only the time_entry liability; both sessions suppressed because closed entry handled the day
    expect(result.liabilities).toHaveLength(1)
    expect(result.liabilities[0].provenance.source.kind).toBe('employee_time_entry')
  })

})
