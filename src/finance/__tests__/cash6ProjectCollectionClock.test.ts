import { describe, expect, it, vi } from 'vitest'
import type { BackupData } from '@/services/backupDataService'
import { readClockProjects, readProjectCollectionEvidence } from '../adapters/projectFinanceAdapter'
import { allocatePayrollLiabilityToProjects, computeProjectCollectionClock } from '../projectCollectionClock'
import type { CashAllocationSnapshot, FinancialLiabilityInput } from '../allocationTypes'
import type { CashCommitment, ObligationOccurrence, RecurringObligation } from '../obligationsTypes'
import type { ClockProject, ProjectCollectionClockInput, ProjectCollectionEvidence } from '../projectCollectionClockTypes'

const ORG = 'org-1'
const DAY = '2026-09-29'
const scope = { organizationId: ORG }

function project(overrides: Partial<ClockProject> = {}): ClockProject {
  return {
    organizationId: ORG, projectId: 'p1', projectName: 'Project 1', status: 'active', contractMinor: 100_000,
    depositPct: 10, phaseTimeline: [{ phaseName: 'Rough', paymentTriggerPct: 30,
      confirmedStartDate: '2026-10-01', actualEndDate: '2026-10-20' },
    { phaseName: 'Finish', paymentTriggerPct: 20, confirmedStartDate: '2026-10-10', actualEndDate: '2026-10-30' }],
    ...overrides,
  }
}

function evidence(projectId = 'p1', lifetimeCollectedMinor = 0): ProjectCollectionEvidence {
  return { organizationId: ORG, projectId, lifetimeCollectedMinor, unknownDateCollectedMinor: 0,
    manualAdjustmentMinor: 0, syntheticBackfillMinor: 0, unresolvedLogMinor: 0,
    headerPaidMinor: null, headerLastCollectedAmountMinor: null,
    datedCollections: [], diagnostics: [] }
}

function snapshot(required: readonly { key: string; amountMinor: number }[] = [], cash = 0): CashAllocationSnapshot {
  const total = required.reduce((sum, r) => sum + r.amountMinor, 0)
  return {
    organizationId: ORG, asOfDate: DAY, totalCashMinor: cash,
    totalProtectedRequirementMinor: total, protectedCashMinor: Math.min(Math.max(0, cash), total),
    trulyFreeCashMinor: Math.max(0, cash - total), uncoveredProtectionDeficitMinor: Math.max(0, total - cash),
    allocationResult: { organizationId: ORG, asOfDate: DAY, totalProtectedRequirementMinor: total,
      suppressedDuplicateSourceKeys: [], requirements: required.map(r => ({
        dedupeKey: r.key, label: r.key, bucket: 'project_reserve' as const, amountMinor: r.amountMinor,
        reason: 'in_horizon' as const, confidence: 'confirmed' as const,
        sourceType: 'cash_commitment' as const, sourceRecordId: r.key, attribution: {},
      })) },
    policy: { organizationId: ORG, asOfDate: DAY, protectionHorizonDays: 30, operatingFloorMinor: 0,
      taxReserve: { kind: 'disabled' }, includeOptionalObligations: false },
  }
}

function commitment(id = 'c1', overrides: Partial<CashCommitment> = {}): CashCommitment {
  return {
    id, organizationId: ORG, title: id, expectedDate: '2026-10-01', amount: { currency: 'USD', minor: 2_500 },
    amountCertainty: 'fixed', requirement: 'required', confidence: 'confirmed', category: 'materials',
    status: 'scheduled', projectId: 'p1', sourceType: 'manual', reconciliationState: 'unreconciled',
    provenance: { source: { organizationId: ORG, kind: 'cash_commitment', recordId: id }, freshness: 'current',
      confidence: 'confirmed', reconciliationState: 'unreconciled' }, ...overrides,
  }
}

function obligation(overrides: Partial<RecurringObligation> = {}): RecurringObligation {
  return {
    id: 'o1', organizationId: ORG, name: 'Permit', amount: { currency: 'USD', minor: 3_000 },
    amountCertainty: 'fixed', recurrence: { kind: 'weekly', interval: 1, anchorDate: '2026-09-30', startDate: '2026-09-30' },
    requirement: 'required', confidence: 'confirmed', status: 'active', projectId: 'p1', category: 'permit', sourceType: 'manual',
    provenance: { source: { organizationId: ORG, kind: 'financial_obligation', recordId: 'o1' }, freshness: 'current',
      confidence: 'confirmed', reconciliationState: 'unreconciled' }, ...overrides,
  }
}

function payroll(amountMinor = 1_001): FinancialLiabilityInput {
  return { organizationId: ORG, dueDate: DAY, amountMinor, requirement: 'required', label: 'Payroll',
    attribution: { employeeId: 'emp-1', projectId: null },
    provenance: { source: { organizationId: ORG, kind: 'employee_time_entry', recordId: 'te-1', effectiveDate: DAY },
      freshness: 'current', confidence: 'confirmed', reconciliationState: 'unreconciled' } }
}

function input(overrides: Partial<ProjectCollectionClockInput> = {}): ProjectCollectionClockInput {
  return { organizationId: ORG, asOfDate: DAY, projects: [project()], collectionEvidence: [evidence()],
    commitments: [], obligations: [], occurrences: [], payrollLiabilities: [], allocationSnapshot: snapshot(), ...overrides }
}

function entry(overrides: Partial<ProjectCollectionClockInput> = {}) {
  return computeProjectCollectionClock(input(overrides)).activeFunding[0]
}

describe('CASH-6 collection evidence', () => {
  it('keeps genuine dated logs, synthetic backfill, and manual adjustment in distinct evidence', () => {
    const backup = { projects: [{ id: 'p1', status: 'active', contract: 1000, paid: 999,
      lastCollectedAmount: 888, finance: { manualPaidAdjustment: 4 } }], logs: [
      { id: 'genuine', projId: 'p1', date: '2026-09-20', collected: 10, paymentsCollected: 12 },
      { id: 'log-paidbackfill-p1-1', projId: 'p1', date: '2026-09-21', collected: 5 },
      { id: 'dead', projId: 'p1', date: '2026-09-22', collected: 100, deletedAt: '2026-09-23' },
    ] } as unknown as BackupData
    const [result] = readProjectCollectionEvidence(scope, backup)
    expect(result.lifetimeCollectedMinor).toBe(2_100)
    expect(result.unknownDateCollectedMinor).toBe(900)
    expect(result.manualAdjustmentMinor).toBe(400)
    expect(result.syntheticBackfillMinor).toBe(500)
    expect(result.headerPaidMinor).toBe(99_900)
    expect(result.headerLastCollectedAmountMinor).toBe(88_800)
    expect(result.datedCollections).toEqual([{ sourceKey: `${ORG}:project_collection:genuine`, date: '2026-09-20', amountMinor: 1_200 }])
    expect(result.diagnostics).toContain('synthetic_paid_backfill:log-paidbackfill-p1-1')
  })

  it('uses collected when paymentsCollected is zero, matching lifetime authority', () => {
    const backup = { projects: [{ id: 'p1', status: 'active', contract: 1000 }], logs: [
      { id: 'l1', projId: 'p1', date: '2026-09-20', paymentsCollected: 0, collected: 7 },
    ] } as unknown as BackupData
    expect(readProjectCollectionEvidence(scope, backup)[0].lifetimeCollectedMinor).toBe(700)
  })

  it('retains invalid-date cash only as unknown-date lifetime evidence', () => {
    const backup = { projects: [{ id: 'p1', status: 'active', contract: 1000 }], logs: [
      { id: 'l1', projId: 'p1', date: '2026-02-31', collected: 7 },
    ] } as unknown as BackupData
    const [result] = readProjectCollectionEvidence(scope, backup)
    expect(result.lifetimeCollectedMinor).toBe(700)
    expect(result.unknownDateCollectedMinor).toBe(700)
    expect(result.datedCollections).toHaveLength(0)
  })

  it('normalizes stored project fields without inventing schedule defaults or adding CO value', () => {
    const backup = { projects: [{ id: 'p1', name: 'P', status: 'active', contract: 1000,
      changeOrders: [{ id: 'co1', totalCost: 500 }], phase_timeline: [{ phase_name: 'Rough' }] }] } as unknown as BackupData
    const [result] = readClockProjects(scope, backup)
    expect(result.contractMinor).toBe(100_000)
    expect(result.depositPct).toBeUndefined()
    expect(result.phaseTimeline[0].paymentTriggerPct).toBeUndefined()
  })
})

describe('CASH-6 deterministic collection schedule', () => {
  it('uses saved percentages and explicit schedule dates with possible confidence', () => {
    const result = entry()
    expect(result.nextCollection).toMatchObject({ amountMinor: 10_000, expectedDate: '2026-10-01',
      confidence: 'possible', timingState: 'future', phase: 'Deposit' })
  })

  it('does not invent a deposit or equal phase percentages', () => {
    const result = entry({ projects: [project({ depositPct: undefined,
      phaseTimeline: [{ phaseName: 'Rough', confirmedStartDate: '2026-10-01' }] })] })
    expect(result.nextCollection).toBeNull()
  })

  it('rejects oversubscribed and invalid percentages instead of clamping', () => {
    for (const pct of [91, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = entry({ projects: [project({ depositPct: pct })] })
      expect(result.nextCollection).toBeNull()
      expect(result.diagnostics.some(d => d.includes('schedule_percentage') || d === 'oversubscribed_schedule')).toBe(true)
    }
  })

  it('does not use wall-clock time to fill a missing date', () => {
    const p = project({ phaseTimeline: [{ phaseName: 'Rough', paymentTriggerPct: 0 }] })
    const now = vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('wall clock used') })
    let first, second
    try {
      first = entry({ projects: [p] }).nextCollection
      second = entry({ projects: [p], asOfDate: DAY }).nextCollection
    } finally {
      now.mockRestore()
    }
    expect(first).toEqual(second)
    expect(first?.expectedDate).toBeNull()
    expect(first?.timingState).toBe('unknown')
  })

  it('does not skip an undated deposit to call a later phase the next collection', () => {
    const p = project({ phaseTimeline: [
      { phaseName: 'Rough', paymentTriggerPct: 20 },
      { phaseName: 'Finish', paymentTriggerPct: 0, confirmedStartDate: '2026-10-10' },
    ] })
    const a = entry({ projects: [p] })
    expect(a.nextCollection?.phase).toBe('Deposit')
    expect(a.nextCollection?.expectedDate).toBeNull()
  })

  it('rejects phase dates that reverse the saved payment sequence', () => {
    const p = project({ phaseTimeline: [
      { phaseName: 'Rough', paymentTriggerPct: 30, confirmedStartDate: '2026-10-10' },
      { phaseName: 'Finish', paymentTriggerPct: 20, confirmedStartDate: '2026-10-01', actualEndDate: '2026-10-30' },
    ] })
    const a = entry({ projects: [p] })
    expect(a.nextCollection).toBeNull()
    expect(a.diagnostics).toContain('inconsistent_schedule_dates')
  })

  it('keeps timing but not next amount after unlinked prior collections', () => {
    const result = entry({ collectionEvidence: [evidence('p1', 20_000)] })
    expect(result.nextCollection).toMatchObject({ expectedDate: '2026-10-01', amountMinor: null })
    expect(result.diagnostics).toContain('unlinked_historical_collections')
  })

  it('does not treat remaining contract balance as the next payment amount', () => {
    const result = entry({ collectionEvidence: [evidence('p1', 95_000)] })
    expect(result.nextCollection?.amountMinor).toBeNull()
  })

  it.each([
    ['2026-10-02', 'overdue'], ['2026-10-01', 'due_today'], [DAY, 'future'],
  ] as const)('classifies %s collection timing as %s', (asOfDate, timingState) => {
    const result = entry({ asOfDate, allocationSnapshot: { ...snapshot(), asOfDate,
      allocationResult: { ...snapshot().allocationResult, asOfDate } } })
    expect(result.nextCollection?.timingState).toBe(timingState)
  })

  it('invalid explicit date stays unknown and is diagnosed', () => {
    const result = entry({ projects: [project({ phaseTimeline: [{ phaseName: 'Rough', paymentTriggerPct: 0,
      confirmedStartDate: '2026-02-31' }] })] })
    expect(result.nextCollection?.expectedDate).toBeNull()
    expect(result.diagnostics.some(d => d.startsWith('invalid_date:'))).toBe(true)
  })

  it('rejects invalid policy dates and non-integer contract cents', () => {
    expect(() => computeProjectCollectionClock(input({ asOfDate: '2026-02-31' }))).toThrow(/Invalid calendar date/)
    expect(() => entry({ projects: [project({ contractMinor: 10.5 })] })).toThrow(/safe integer cents/)
  })

  it('has no next collection when recorded lifetime cash covers the contract', () => {
    expect(entry({ collectionEvidence: [evidence('p1', 100_000)] }).nextCollection).toBeNull()
  })

  it('does not infer an overdue unpaid milestone from unlinked prior cash', () => {
    const asOfDate = '2026-11-01'
    const s = { ...snapshot(), asOfDate, allocationResult: { ...snapshot().allocationResult, asOfDate } }
    const a = entry({ asOfDate, allocationSnapshot: s, collectionEvidence: [evidence('p1', 20_000)] })
    expect(a.nextCollection).toBeNull()
    expect(a.diagnostics).toContain('unlinked_historical_collections')
  })
})

describe('CASH-6 required costs and coverage', () => {
  it('includes required same-day commitment without subtracting historical collections', () => {
    const a = entry({ commitments: [commitment()], collectionEvidence: [evidence('p1', 1_000)] })
    expect(a.requiredBeforeCollectionMinor).toBe(2_500)
    expect(a.requiredCosts).toHaveLength(1)
  })

  it('excludes optional, satisfied, reconciled, and future commitments', () => {
    const a = entry({ commitments: [
      commitment('optional', { requirement: 'optional' }),
      commitment('satisfied', { status: 'satisfied' }),
      commitment('reconciled', { reconciliationState: 'reconciled' }),
      commitment('future', { expectedDate: '2026-10-02' }),
    ] })
    expect(a.requiredBeforeCollectionMinor).toBe(0)
  })

  it('includes each active recurring occurrence once, applying status and amount override', () => {
    const occurrence: ObligationOccurrence = { id: 'occ-1', organizationId: ORG, obligationId: 'o1',
      scheduledDate: '2026-09-30', status: 'scheduled', reconciliationState: 'unreconciled',
      overrideAmount: { currency: 'USD', minor: 4_000 } }
    const a = entry({ obligations: [obligation(), obligation()], occurrences: [occurrence] })
    expect(a.requiredBeforeCollectionMinor).toBe(4_000)
    expect(a.requiredCosts).toHaveLength(1)
    expect(a.requiredCosts[0].canonicalSourceKey).toBe(`${ORG}:financial_obligation_occurrence:occ-1`)
  })

  it('excludes reconciled and satisfied recurring occurrences', () => {
    const occurrence: ObligationOccurrence = { id: 'occ-1', organizationId: ORG, obligationId: 'o1',
      scheduledDate: '2026-09-30', status: 'satisfied', reconciliationState: 'reconciled' }
    expect(entry({ obligations: [obligation()], occurrences: [occurrence] }).requiredBeforeCollectionMinor).toBe(0)
  })

  it('ignores a cross-organization occurrence override', () => {
    const foreign: ObligationOccurrence = { id: 'foreign', organizationId: 'other', obligationId: 'o1',
      scheduledDate: '2026-09-30', status: 'satisfied', reconciliationState: 'reconciled' }
    const a = entry({ obligations: [obligation()], occurrences: [foreign] })
    expect(a.requiredBeforeCollectionMinor).toBe(3_000)
  })

  it('diagnoses an invalid commitment date without monetary exposure', () => {
    const a = entry({ commitments: [commitment('bad', { expectedDate: '2026-02-31' })] })
    expect(a.requiredBeforeCollectionMinor).toBe(0)
    expect(a.diagnostics.some(d => d.startsWith('invalid_date:commitment:'))).toBe(true)
  })

  it('does not accept actual logs or estimate budgets as cost inputs', () => {
    const backup = { projects: [{ id: 'p1', name: 'Project 1', status: 'active', contract: 1000,
      deposit_pct: 10, phase_timeline: [{ phase_name: 'Rough', payment_trigger_pct: 0,
        confirmed_start_date: '2026-10-01' }], mtoRows: [{ id: 'm1', qty: 100, unitCost: 10 }],
      laborRows: [{ id: 'h1', hrs: 100 }], changeOrders: [{ id: 'co1', totalCost: 500, materialCost: 200 }] }],
    logs: [{ id: 'actual', projId: 'p1', date: '2026-09-20', mat: 200, hrs: 8, miles: 50, collected: 0 }] } as unknown as BackupData
    const a = entry({ projects: readClockProjects(scope, backup),
      collectionEvidence: readProjectCollectionEvidence(scope, backup) })
    expect(a.requiredCosts).toEqual([])
    expect(a.requiredBeforeCollectionMinor).toBe(0)
  })

  it('keeps required and gap null when collection date is unknown', () => {
    const a = entry({ projects: [project({ phaseTimeline: [{ phaseName: 'Rough', paymentTriggerPct: 0 }] })],
      commitments: [commitment()] })
    expect(a.requiredBeforeCollectionMinor).toBeNull()
    expect(a.fundingGapMinor).toBeNull()
    expect(a.coverageStatus).toBe('indeterminate')
  })

  it('fully covers exact matching CASH-4 requirement only when globally funded', () => {
    const key = `${ORG}:cash_commitment:c1`
    const a = entry({ commitments: [commitment()], allocationSnapshot: snapshot([{ key, amountMinor: 2_500 }], 2_500) })
    expect(a).toMatchObject({ requiredBeforeCollectionMinor: 2_500, reservedForRequiredCostsMinor: 2_500,
      fundingGapMinor: 0, coverageStatus: 'fully_covered' })
  })

  it('global full coverage remains proof even if an explicit reservation maps the source to zero', () => {
    const key = `${ORG}:cash_commitment:c1`
    const a = entry({ commitments: [commitment()], allocationSnapshot: snapshot([{ key, amountMinor: 2_500 }], 2_500),
      explicitReservations: { [key]: 0 } })
    expect(a.reservedForRequiredCostsMinor).toBe(2_500)
    expect(a.fundingGapMinor).toBe(0)
  })

  it('does not claim explicit cash already used by globally protected requirements', () => {
    const protectedKey = `${ORG}:cash_commitment:c1`
    const extraKey = `${ORG}:cash_commitment:c2`
    expect(() => entry({ commitments: [commitment(), commitment('c2')],
      allocationSnapshot: snapshot([{ key: protectedKey, amountMinor: 2_500 }], 3_000),
      explicitReservations: { [extraKey]: 1_000 } })).toThrow(/cash beyond globally protected/)
  })

  it('does not cover a source absent from CASH-4 even when all listed requirements are funded', () => {
    const a = entry({ commitments: [commitment()], allocationSnapshot: snapshot([], 100_000) })
    expect(a.coverageStatus).toBe('indeterminate')
    expect(a.reservedForRequiredCostsMinor).toBeNull()
    expect(a.fundingGapMinor).toBeNull()
  })

  it('does not allocate globally short cash without explicit reservation', () => {
    const key = `${ORG}:cash_commitment:c1`
    const a = entry({ commitments: [commitment()], allocationSnapshot: snapshot([{ key, amountMinor: 2_500 }], 1_000) })
    expect(a.coverageStatus).toBe('indeterminate')
    expect(a.fundingGapMinor).toBeNull()
  })

  it('computes exact gap from a valid explicit source reservation', () => {
    const key = `${ORG}:cash_commitment:c1`
    const a = entry({ commitments: [commitment()], allocationSnapshot: snapshot([], 2_000),
      explicitReservations: { [key]: 1_000 } })
    expect(a).toMatchObject({ reservedForRequiredCostsMinor: 1_000, fundingGapMinor: 1_500,
      coverageStatus: 'explicitly_allocated' })
  })

  it('rejects reservations above the canonical liability or available cash', () => {
    const key = `${ORG}:cash_commitment:c1`
    expect(() => entry({ commitments: [commitment()], allocationSnapshot: snapshot([], 10_000),
      explicitReservations: { [key]: 2_501 } })).toThrow(/Reservation exceeds/)
    expect(() => entry({ commitments: [commitment()], allocationSnapshot: snapshot([], 500),
      explicitReservations: { [key]: 1_000 } })).toThrow(/available cash/)
  })

  it('suppresses duplicate canonical commitment keys', () => {
    const a = entry({ commitments: [commitment(), commitment()] })
    expect(a.requiredBeforeCollectionMinor).toBe(2_500)
    expect(a.diagnostics.some(d => d.startsWith('duplicate_required_source:'))).toBe(true)
  })

  it('rejects duplicate project and collection-evidence identities', () => {
    expect(() => computeProjectCollectionClock(input({ projects: [project(), project()] }))).toThrow(/Duplicate project identity/)
    expect(() => computeProjectCollectionClock(input({ collectionEvidence: [evidence(), evidence()] }))).toThrow(/Duplicate collection evidence/)
  })
})

describe('CASH-6 payroll attribution and risk groups', () => {
  const sessions = [
    { id: 'a', employeeProfileId: 'profile-1', workDate: DAY, paidMinutes: 6, projectId: 'p1' },
    { id: 'b', employeeProfileId: 'profile-1', workDate: DAY, paidMinutes: 4, projectId: 'p2' },
  ]

  it('splits one finalized liability into exact project slices without new liabilities', () => {
    const allocation = allocatePayrollLiabilityToProjects(payroll(1_001), 'profile-1', DAY, 10, sessions, true)
    expect(allocation.slices.map(s => s.amountMinor)).toEqual([601, 400])
    expect(allocation.slices.reduce((sum, s) => sum + s.amountMinor, 0)).toBe(1_001)
    const result = computeProjectCollectionClock(input({ projects: [project(), project({ projectId: 'p2' })],
      collectionEvidence: [evidence(), evidence('p2')], payrollLiabilities: [payroll(1_001)], payrollAllocations: [allocation] }))
    expect(result.activeFunding.map(e => e.requiredBeforeCollectionMinor).sort()).toEqual([400, 601])
  })

  it('uses stable session identity for an exact-cent rounding remainder', () => {
    const first = allocatePayrollLiabilityToProjects(payroll(101), 'profile-1', DAY, 2,
      sessions.map(s => ({ ...s, paidMinutes: 1 })), true)
    const reversed = allocatePayrollLiabilityToProjects(payroll(101), 'profile-1', DAY, 2,
      [...sessions].reverse().map(s => ({ ...s, paidMinutes: 1 })), true)
    expect(first.slices).toEqual(reversed.slices)
    expect(first.slices.map(s => s.amountMinor)).toEqual([51, 50])
  })

  it('leaves the liability unattributed on incomplete or mismatched sessions', () => {
    for (const [minutes, complete] of [[9, true], [10, false]] as const) {
      const allocation = allocatePayrollLiabilityToProjects(payroll(), 'profile-1', DAY, minutes, sessions, complete)
      expect(allocation.slices).toHaveLength(1)
      expect(allocation.slices[0].projectId).toBeNull()
      expect(allocation.unattributedAmountMinor).toBe(1_001)
      expect(allocation.diagnostics).toHaveLength(1)
    }
  })

  it('reports a no-project session share separately', () => {
    const allocation = allocatePayrollLiabilityToProjects(payroll(1_000), 'profile-1', DAY, 10,
      [{ ...sessions[0] }, { ...sessions[1], projectId: null }], true)
    const result = computeProjectCollectionClock(input({ payrollLiabilities: [payroll(1_000)], payrollAllocations: [allocation] }))
    expect(result.unattributedPayrollMinor).toBe(400)
    expect(result.activeFunding[0].requiredBeforeCollectionMinor).toBe(600)
  })

  it('allocates one source reservation across project slices without overclaiming', () => {
    const liability = payroll(1_000)
    const allocation = allocatePayrollLiabilityToProjects(liability, 'profile-1', DAY, 10, sessions, true)
    const key = allocation.canonicalSourceKey
    const result = computeProjectCollectionClock(input({ projects: [project(), project({ projectId: 'p2' })],
      collectionEvidence: [evidence(), evidence('p2')], payrollLiabilities: [liability],
      payrollAllocations: [allocation], allocationSnapshot: snapshot([], 500), explicitReservations: { [key]: 500 } }))
    const byId = new Map(result.activeFunding.map(e => [e.projectId, e]))
    expect(byId.get('p1')?.reservedForRequiredCostsMinor).toBe(300)
    expect(byId.get('p2')?.reservedForRequiredCostsMinor).toBe(200)
    expect(result.activeFunding.reduce((sum, e) => sum + e.reservedForRequiredCostsMinor!, 0)).toBe(500)
  })

  it('uses source-level CASH-4 full coverage for each proven payroll slice', () => {
    const liability = payroll(1_000)
    const allocation = allocatePayrollLiabilityToProjects(liability, 'profile-1', DAY, 10, sessions, true)
    const result = computeProjectCollectionClock(input({ projects: [project(), project({ projectId: 'p2' })],
      collectionEvidence: [evidence(), evidence('p2')], payrollLiabilities: [liability], payrollAllocations: [allocation],
      allocationSnapshot: snapshot([{ key: allocation.canonicalSourceKey, amountMinor: 1_000 }], 1_000) }))
    expect(result.activeFunding.map(e => e.fundingGapMinor)).toEqual([0, 0])
  })

  it('uses an open-session liability directly once when it already has project attribution', () => {
    const liability: FinancialLiabilityInput = { ...payroll(750),
      attribution: { employeeId: 'emp-1', projectId: 'p1' },
      provenance: { ...payroll(750).provenance,
        source: { organizationId: ORG, kind: 'employee_work_session', recordId: 'session-1', effectiveDate: DAY } } }
    const a = entry({ payrollLiabilities: [liability, liability] })
    expect(a.requiredBeforeCollectionMinor).toBe(750)
    expect(a.requiredCosts).toHaveLength(1)
  })

  it('returns completed unpaid projects as follow-up and omits canceled, archived, deleted', () => {
    const result = computeProjectCollectionClock(input({ projects: [
      project({ projectId: 'done', status: 'completed' }),
      project({ projectId: 'canceled', status: 'canceled' }),
      project({ projectId: 'archived', archived: true }),
      project({ projectId: 'deleted', deletedAt: '2026-09-28' }),
    ], collectionEvidence: [evidence('done'), evidence('canceled'), evidence('archived'), evidence('deleted')] }))
    expect(result.activeFunding).toHaveLength(0)
    expect(result.collectionFollowUp.map(e => e.projectId)).toEqual(['done'])
  })

  it('omits completed projects with no recorded receivable', () => {
    const result = computeProjectCollectionClock(input({ projects: [project({ status: 'completed' })],
      collectionEvidence: [evidence('p1', 100_000)] }))
    expect(result.collectionFollowUp).toHaveLength(0)
  })

  it('sorts by funding risk before timing or contract size with explainable keys', () => {
    const p1 = project({ projectId: 'large', contractMinor: 1_000_000 })
    const p2 = project({ projectId: 'small', contractMinor: 100_000 })
    const result = computeProjectCollectionClock(input({ projects: [p1, p2],
      collectionEvidence: [evidence('large'), evidence('small')],
      commitments: [commitment('small-cost', { projectId: 'small' })], allocationSnapshot: snapshot([], 10_000),
      explicitReservations: { [`${ORG}:cash_commitment:small-cost`]: 0 } }))
    expect(result.activeFunding.map(e => e.projectId)).toEqual(['small', 'large'])
    expect(result.activeFunding[0].sortReasons).toContain('risk:known_gap')
    expect(result.activeFunding[0].sortReasons).toContain('gap_minor:2500')
  })

  it('orders known gap, unknown coverage, covered cost, then no required cost', () => {
    const ids = ['gap', 'unknown', 'covered', 'none']
    const result = computeProjectCollectionClock(input({
      projects: ids.map(projectId => project({ projectId })),
      collectionEvidence: ids.map(projectId => evidence(projectId)),
      commitments: [
        commitment('gap-cost', { projectId: 'gap', amount: { currency: 'USD', minor: 300 } }),
        commitment('unknown-cost', { projectId: 'unknown', amount: { currency: 'USD', minor: 200 } }),
        commitment('covered-cost', { projectId: 'covered', amount: { currency: 'USD', minor: 100 } }),
      ],
      allocationSnapshot: snapshot([{ key: `${ORG}:cash_commitment:covered-cost`, amountMinor: 100 }], 100),
      explicitReservations: { [`${ORG}:cash_commitment:gap-cost`]: 0 },
    }))
    expect(result.activeFunding.map(e => e.projectId)).toEqual(ids)
    expect(result.activeFunding.map(e => e.riskState)).toEqual(['known_gap', 'coverage_unknown', 'covered', 'no_required_cost'])
  })
})
