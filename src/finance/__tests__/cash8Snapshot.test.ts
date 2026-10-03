import { describe, expect, it } from 'vitest'
import { buildCashOsSnapshot } from '../cashOsSnapshot'
import type { CashOsSourceBundle } from '@/services/cashOsReadService'
import type { CashOsSessionSetup } from '@/services/cashOsSessionSetup'
import type { FinancialAccountRow, FinancialTransactionRow } from '../ledgerTypes'
import type { BackupData } from '@/services/backupDataService'

const ORG = 'org-1'
const DAY = '2026-09-29'
const setup: CashOsSessionSetup = { version: 1, organizationId: ORG,
  payrollPaidThroughDate: '2026-09-28', protectionHorizonDays: 7,
  operatingFloorMinor: 1000, taxReserve: { kind: 'disabled' },
  includeOptionalObligations: false, includeOpenShiftEstimates: false,
  timezoneConfirmed: true, confirmedAt: '2026-09-29T20:00:00Z' }

const account: FinancialAccountRow = { id: 'bank', organization_id: ORG, display_name: 'Bank',
  account_type: 'checking', account_class: 'asset', ownership_context: 'business',
  include_in_cash: true, currency: 'USD', status: 'active', source_type: 'manual',
  source_metadata: {}, created_at: '', updated_at: '', archived_at: null }

const transaction: FinancialTransactionRow = { id: 'opening', organization_id: ORG,
  account_id: 'bank', amount_minor: 100_000, currency: 'USD', transaction_date: DAY,
  effective_at: null, posted_at: null, status: 'posted', transaction_kind: 'opening_balance',
  economic_effect: 'none', economic_amount_minor: 0, description: 'Opening', counterparty: null,
  category: null, project_id: null, employee_id: null, debt_account_id: null,
  source_type: 'opening_balance', source_organization_id: null, source_kind: null,
  source_record_id: null, source_effective_date: null, source_timestamp: null,
  source_metadata: {}, idempotency_key: 'opening', created_at: '', updated_at: '',
  voided_at: null, voided_by: null, void_reason: null }

function sources(overrides: Partial<CashOsSourceBundle> = {}): CashOsSourceBundle {
  return { organizationId: ORG, asOfDate: DAY, asOfTimestamp: '2026-09-29T20:00:00Z',
    accounts: [account], transactions: [transaction], obligations: [], occurrences: [], commitments: [],
    timeEntries: [], sessions: [], bridges: [], employees: [], liabilityTerms: [],
    backup: { projects: [], logs: [], settings: {}, employees: [] } as unknown as BackupData,
    ...overrides }
}

function assemble(source: CashOsSourceBundle = sources(), assumed = setup,
  horizonDays: 7 | 14 | 30 | 60 | 90 = 30,
  confidenceMode: 'conservative' | 'likely' | 'upside' = 'conservative') {
  return buildCashOsSnapshot({ ...source, setup: assumed, horizonDays, confidenceMode })
}

describe('CASH-8 pure engine assembly', () => {
  it('builds CASH-5, CASH-4, CASH-6, and CASH-7 in one snapshot', () => {
    const result = assemble()
    expect(result.payroll.liabilities).toEqual([])
    expect(result.allocation.organizationId).toBe(ORG)
    expect(result.collectionClock.activeFunding).toEqual([])
    expect(result.projection.organizationId).toBe(ORG)
  })
  it('reuses the exact CASH-4 day-zero policy and totals in CASH-7', () => {
    const result = assemble()
    expect(result.projection.anchor.closingCashMinor).toBe(result.allocation.totalCashMinor)
    expect(result.projection.anchor.protectedCashMinor).toBe(result.allocation.protectedCashMinor)
    expect(result.projection.anchor.trulyFreeCashMinor).toBe(result.allocation.trulyFreeCashMinor)
  })
  it('does not invent a floor when the owner explicitly enters zero', () => {
    const result = assemble(sources(), { ...setup, operatingFloorMinor: 0 })
    expect(result.allocation.totalProtectedRequirementMinor).toBe(0)
    expect(result.projection.anchor.trulyFreeCashMinor).toBe(100_000)
  })
  it('uses CASH-7 summary for the fourteen-day low', () => {
    const result = assemble(sources(), setup, 7)
    expect(result.projection.summary.fourteenDayLowestTotalCashMinor).toBe(100_000)
  })
  it('horizon changes projection without changing day-zero allocation', () => {
    const a = assemble(sources(), setup, 7)
    const b = assemble(sources(), setup, 90)
    expect(a.projection.days).toHaveLength(7)
    expect(b.projection.days).toHaveLength(90)
    expect(a.allocation.trulyFreeCashMinor).toBe(b.allocation.trulyFreeCashMinor)
  })
  it('confidence mode is passed to the projection', () => {
    expect(assemble(sources(), setup, 30, 'upside').projection.confidenceMode).toBe('upside')
  })
  it('derives base-wage payroll exposure and protects it exactly once', () => {
    const result = assemble(sources({
      timeEntries: [{ id: 'te1', organizationId: ORG, employeeProfileId: 'p1', workDate: DAY,
        paidMinutes: 480, status: 'complete', approvalStatus: 'none' }],
      bridges: [{ employeeProfileId: 'p1', backupEmployeeId: 'emp1' }],
      employees: [{ backupEmployeeId: 'emp1', hourly_rate: 25 }],
    }))
    expect(result.payrollExposureMinor).toBe(20_000)
    expect(result.allocation.totalProtectedRequirementMinor).toBe(21_000)
    expect(result.projection.anchor.trulyFreeCashMinor).toBe(79_000)
  })
  it('reports missing wage instead of deriving zero payroll as complete', () => {
    const result = assemble(sources({
      timeEntries: [{ id: 'te1', organizationId: ORG, employeeProfileId: 'p1', workDate: DAY,
        paidMinutes: 480, status: 'complete', approvalStatus: 'none' }],
      bridges: [{ employeeProfileId: 'p1', backupEmployeeId: 'emp1' }],
      employees: [{ backupEmployeeId: 'emp1' }],
    }))
    expect(result.payrollDiagnostics.some(d => d.kind === 'missing_cash_wage')).toBe(true)
  })
  it('keeps unreconciled finalized session attribution unattributed', () => {
    const result = assemble(sources({
      timeEntries: [{ id: 'te1', organizationId: ORG, employeeProfileId: 'p1', workDate: DAY,
        paidMinutes: 480, status: 'complete', approvalStatus: 'none' }],
      sessions: [{ id: 's1', organizationId: ORG, employeeProfileId: 'p1', workDate: DAY,
        clockInAt: '2026-09-29T12:00:00Z', lunchOutAt: null, lunchInAt: null,
        clockOutAt: '2026-09-29T20:00:00Z', paidMinutes: 400, projectId: 'job' }],
      bridges: [{ employeeProfileId: 'p1', backupEmployeeId: 'emp1' }],
      employees: [{ backupEmployeeId: 'emp1', hourly_rate: 25 }],
    }))
    expect(result.payrollAllocations[0].reconciled).toBe(false)
    expect(result.payrollAllocations[0].unattributedAmountMinor).toBe(20_000)
    expect(result.payrollExposureMinor).toBe(20_000)
  })
  it('rejects setup from a different organization', () => {
    expect(() => assemble(sources(), { ...setup, organizationId: 'org-2' })).toThrow('organization mismatch')
  })
  it('precomputes account balances with CASH-2', () => {
    expect(assemble().accountBalancesMinor.bank).toBe(100_000)
  })
})
