import { describe, expect, it } from 'vitest'
import { computeCashAllocation } from '../allocationEngine'
import { computeCashProjection } from '../cashProjection'
import { computeProjectCollectionClock, deriveProjectCollectionSignals } from '../projectCollectionClock'
import type { CashProjectionInput, CashProjectionPolicy } from '../cashProjectionTypes'
import type { CashAllocationPolicy, FinancialLiabilityInput } from '../allocationTypes'
import type { FinancialAccountRow, FinancialTransactionRow } from '../ledgerTypes'
import type { CashCommitment, ObligationOccurrence, RecurringObligation } from '../obligationsTypes'
import type { ClockProject, ProjectCollectionEvidence } from '../projectCollectionClockTypes'

const ORG = 'org-1'
const DAY = '2026-09-29'

function account(id = 'bank', overrides: Partial<FinancialAccountRow> = {}): FinancialAccountRow {
  return { id, organization_id: ORG, display_name: id, account_type: 'checking', account_class: 'asset',
    ownership_context: 'business', include_in_cash: true, currency: 'USD', status: 'active',
    source_type: 'manual', source_metadata: {}, created_at: '', updated_at: '', archived_at: null, ...overrides }
}

function tx(id: string, date: string, amount: number, overrides: Partial<FinancialTransactionRow> = {}): FinancialTransactionRow {
  return { id, organization_id: ORG, account_id: 'bank', amount_minor: amount, currency: 'USD',
    transaction_date: date, effective_at: null, posted_at: null, status: 'posted',
    transaction_kind: amount >= 0 ? 'income' : 'expense', economic_effect: amount >= 0 ? 'inflow' : 'outflow',
    economic_amount_minor: Math.abs(amount), description: id, counterparty: null, category: null,
    project_id: null, employee_id: null, debt_account_id: null, source_type: 'manual',
    source_organization_id: null, source_kind: null, source_record_id: null,
    source_effective_date: null, source_timestamp: null, source_metadata: {}, idempotency_key: id,
    created_at: '', updated_at: '', voided_at: null, voided_by: null, void_reason: null, ...overrides }
}

function commitment(id: string, date: string, amount: number, overrides: Partial<CashCommitment> = {}): CashCommitment {
  return { id, organizationId: ORG, title: id, expectedDate: date, amount: { currency: 'USD', minor: amount },
    amountCertainty: 'fixed', requirement: 'required', confidence: 'confirmed', status: 'scheduled',
    sourceType: 'manual', reconciliationState: 'unreconciled',
    provenance: { source: { organizationId: ORG, kind: 'cash_commitment', recordId: id },
      freshness: 'current', confidence: 'confirmed', reconciliationState: 'unreconciled' }, ...overrides }
}

function obligation(overrides: Partial<RecurringObligation> = {}): RecurringObligation {
  return { id: 'rent', organizationId: ORG, name: 'Rent', amount: { currency: 'USD', minor: 1000 },
    amountCertainty: 'fixed', recurrence: { kind: 'weekly', interval: 1,
      anchorDate: '2026-09-30', startDate: '2026-09-30' }, requirement: 'required',
    confidence: 'confirmed', status: 'active', sourceType: 'manual',
    provenance: { source: { organizationId: ORG, kind: 'financial_obligation', recordId: 'rent' },
      freshness: 'current', confidence: 'confirmed', reconciliationState: 'unreconciled' }, ...overrides }
}

function payroll(amount = 1000): FinancialLiabilityInput {
  return { organizationId: ORG, dueDate: DAY, amountMinor: amount, requirement: 'required',
    attribution: { employeeId: 'emp', projectId: 'p1' }, label: 'Earned payroll',
    provenance: { source: { organizationId: ORG, kind: 'employee_time_entry', recordId: 'te1' },
      freshness: 'current', confidence: 'expected', reconciliationState: 'unreconciled' } }
}

function project(overrides: Partial<ClockProject> = {}): ClockProject {
  return { organizationId: ORG, projectId: 'p1', projectName: 'Job', status: 'active',
    contractMinor: 10000, depositPct: 10, phaseTimeline: [{ phaseName: 'First', paymentTriggerPct: 30,
      confirmedStartDate: '2026-10-01', actualEndDate: '2026-10-20' },
    { phaseName: 'Second', paymentTriggerPct: 20, confirmedStartDate: '2026-10-10', actualEndDate: '2026-10-30' }], ...overrides }
}

function evidence(amount = 0): ProjectCollectionEvidence {
  return { organizationId: ORG, projectId: 'p1', lifetimeCollectedMinor: amount,
    unknownDateCollectedMinor: 0, manualAdjustmentMinor: 0, syntheticBackfillMinor: 0,
    unresolvedLogMinor: 0, headerPaidMinor: null, headerLastCollectedAmountMinor: null,
    datedCollections: [], diagnostics: [] }
}

type Options = Partial<Omit<CashProjectionInput, 'policy' | 'allocationSnapshot' | 'collectionClock'>> & {
  horizonDays?: CashProjectionPolicy['horizonDays']
  confidenceMode?: CashProjectionPolicy['confidenceMode']
  allocation?: Partial<CashAllocationPolicy>
  asOfDate?: string
  cash?: number
  snapshot?: CashProjectionInput['allocationSnapshot']
  scenarioEvents?: CashProjectionInput['scenarioEvents']
}

function makeInput(options: Options = {}): CashProjectionInput {
  const asOfDate = options.asOfDate ?? DAY
  const accounts = options.accounts ?? [account()]
  const transactions = options.transactions ?? [tx('opening', asOfDate, options.cash ?? 5000)]
  const obligations = options.obligations ?? []
  const occurrences = options.occurrences ?? []
  const commitments = options.commitments ?? []
  const derivedLiabilities = options.derivedLiabilities ?? []
  const projects = options.projects ?? []
  const collectionEvidence = options.collectionEvidence ?? []
  const cashAllocationPolicy: CashAllocationPolicy = {
    organizationId: ORG, asOfDate, protectionHorizonDays: 7, operatingFloorMinor: 0,
    taxReserve: { kind: 'disabled' }, includeOptionalObligations: false, ...options.allocation,
  }
  const allocationSnapshot = options.snapshot ?? computeCashAllocation(accounts, transactions, obligations,
    occurrences, commitments, cashAllocationPolicy, derivedLiabilities)
  const collectionClock = computeProjectCollectionClock({ organizationId: ORG, asOfDate, projects,
    collectionEvidence, commitments, obligations, occurrences, payrollLiabilities: derivedLiabilities,
    allocationSnapshot })
  return { policy: { organizationId: ORG, asOfDate, horizonDays: options.horizonDays ?? 7,
    confidenceMode: options.confidenceMode ?? 'conservative', cashAllocationPolicy },
    allocationSnapshot, accounts, transactions, obligations, occurrences, commitments,
    derivedLiabilities, projects, collectionEvidence, collectionClock,
    scenarioEvents: options.scenarioEvents }
}

describe('CASH-7 deterministic projection', () => {
  it('anchors on the CASH-2 as-of close and never replays same-day transactions', () => {
    const result = computeCashProjection(makeInput({ transactions: [tx('prior', '2026-09-28', 4000),
      tx('today', DAY, 1000), tx('tomorrow', '2026-09-30', -500)] }))
    expect(result.anchor.closingCashMinor).toBe(5000)
    expect(result.anchor.events).toEqual([])
    expect(result.days[0]).toMatchObject({ openingCashMinor: 5000, outflowMinor: 500, closingCashMinor: 4500 })
  })

  it('uses future posted cash-account movements, including net-zero internal transfers', () => {
    const input = makeInput({ accounts: [account(), account('bank2'), account('excluded', { include_in_cash: false })],
      transactions: [tx('opening', DAY, 5000), tx('transfer-out', '2026-09-30', -700,
        { transaction_kind: 'transfer', economic_effect: 'none', economic_amount_minor: 0 }),
      tx('transfer-in', '2026-09-30', 700, { account_id: 'bank2', transaction_kind: 'transfer',
        economic_effect: 'none', economic_amount_minor: 0 }),
      tx('external', '2026-10-01', -300, { account_id: 'excluded' })] })
    const result = computeCashProjection(input)
    expect(result.days[0]).toMatchObject({ inflowMinor: 700, outflowMinor: 700, closingCashMinor: 5000 })
    expect(result.days[1].closingCashMinor).toBe(5000)
    expect(result.days[0].events).toHaveLength(2)
  })

  it('reduces cash for a transfer from included cash to an excluded account', () => {
    const result = computeCashProjection(makeInput({ accounts: [account(), account('excluded',
      { include_in_cash: false })], transactions: [tx('opening', DAY, 5000),
      tx('cash-leg', '2026-09-30', -400, { transaction_kind: 'transfer',
        economic_effect: 'none', economic_amount_minor: 0 }),
      tx('excluded-leg', '2026-09-30', 400, { account_id: 'excluded',
        transaction_kind: 'transfer', economic_effect: 'none', economic_amount_minor: 0 })] }))
    expect(result.days[0]).toMatchObject({ outflowMinor: 400, inflowMinor: 0, closingCashMinor: 4600 })
  })

  it.each([7, 14, 30, 60, 90] as const)('returns exactly %i future closes', horizonDays => {
    const result = computeCashProjection(makeInput({ horizonDays }))
    expect(result.days).toHaveLength(horizonDays)
    expect(result.days[0].date).toBe('2026-09-30')
    expect(result.days[result.days.length - 1]?.date).toBe(({ 7: '2026-10-06', 14: '2026-10-13',
      30: '2026-10-29', 60: '2026-11-28', 90: '2026-12-28' } as const)[horizonDays])
  })

  it('rejects invalid horizon and date', () => {
    expect(() => computeCashProjection(makeInput({ horizonDays: 8 as 7 }))).toThrow(/horizon/)
    expect(() => computeCashProjection(makeInput({ asOfDate: '2026-02-31' }))).toThrow(/calendar date/)
  })

  it('fails closed on anchor cash, scope, policy, and protection mismatch', () => {
    const input = makeInput({ commitments: [commitment('c', '2026-10-01', 1000)] })
    expect(() => computeCashProjection({ ...input, allocationSnapshot: { ...input.allocationSnapshot,
      totalCashMinor: 1 } })).toThrow(/anchor mismatch/)
    expect(() => computeCashProjection({ ...input, allocationSnapshot: { ...input.allocationSnapshot,
      organizationId: 'other' } })).toThrow(/scope\/date/)
    expect(() => computeCashProjection({ ...input, allocationSnapshot: { ...input.allocationSnapshot,
      policy: { ...input.allocationSnapshot.policy, operatingFloorMinor: 9 } } })).toThrow(/policy mismatch/)
    expect(() => computeCashProjection({ ...input, allocationSnapshot: { ...input.allocationSnapshot,
      allocationResult: { ...input.allocationSnapshot.allocationResult, requirements: [] } } })).toThrow(/protection parity/)
  })

  it('protects payroll without making work date a bank payday', () => {
    const result = computeCashProjection(makeInput({ derivedLiabilities: [payroll()] }))
    expect(result.anchor).toMatchObject({ closingCashMinor: 5000,
      totalProtectedRequirementMinor: 1000, trulyFreeCashMinor: 4000 })
    expect(result.days.every(d => d.closingCashMinor === 5000 && d.trulyFreeCashMinor === 4000)).toBe(true)
    expect(result.undatedMarkers).toContainEqual(expect.objectContaining({ reason: 'unknown_payment_date' }))
  })

  it('keeps operating floor and tax reserve protected without cash movement', () => {
    const result = computeCashProjection(makeInput({ allocation: { operatingFloorMinor: 800,
      taxReserve: { kind: 'fixed_amount', amountMinor: 500 } } }))
    expect(result.anchor.totalProtectedRequirementMinor).toBe(1300)
    expect(result.days[0]).toMatchObject({ closingCashMinor: 5000,
      totalProtectedRequirementMinor: 1300, trulyFreeCashMinor: 3700, outflowMinor: 0 })
  })

  it('brings a future commitment into protection before due, then retires it on payment', () => {
    const result = computeCashProjection(makeInput({ allocation: { protectionHorizonDays: 2 },
      commitments: [commitment('c', '2026-10-03', 1000)] }))
    expect(result.anchor.totalProtectedRequirementMinor).toBe(0)
    expect(result.days[1].totalProtectedRequirementMinor).toBe(1000)
    expect(result.days[3]).toMatchObject({ outflowMinor: 1000, closingCashMinor: 4000,
      totalProtectedRequirementMinor: 0, trulyFreeCashMinor: 4000 })
    expect(result.days[2].trulyFreeCashMinor).toBe(4000)
  })

  it('expands through the display end plus CASH-4 protection horizon', () => {
    const result = computeCashProjection(makeInput({ horizonDays: 14,
      allocation: { protectionHorizonDays: 7 },
      commitments: [commitment('day21', '2026-10-20', 500)] }))
    expect(result.anchor.totalProtectedRequirementMinor).toBe(0)
    expect(result.days[13]).toMatchObject({ date: '2026-10-13', closingCashMinor: 5000,
      totalProtectedRequirementMinor: 500 })
    expect(result.datedEvents).toHaveLength(0)
  })

  it('uses CASH-3 recurrence and includes an override moved into the read window once', () => {
    const o = obligation({ recurrence: { kind: 'monthly', interval: 1,
      anchorDate: '2026-10-31', startDate: '2026-10-31' } })
    const occurrence: ObligationOccurrence = { id: 'oct', organizationId: ORG, obligationId: 'rent',
      scheduledDate: '2026-10-31', overrideDate: '2026-10-01', status: 'scheduled',
      reconciliationState: 'unreconciled' }
    const input = makeInput({ obligations: [o], occurrences: [occurrence],
      allocation: { protectionHorizonDays: 1 } })
    const result = computeCashProjection(input)
    expect(result.days[1].outflowMinor).toBe(1000)
    expect(result.datedEvents.filter(e => e.sourceKey.endsWith(':oct'))).toHaveLength(1)
  })

  it('matches CASH-4 Day-0 protection for an October occurrence moved to September 30', () => {
    const o = obligation({ recurrence: { kind: 'monthly', interval: 1,
      anchorDate: '2026-10-31', startDate: '2026-10-31' } })
    const occurrence: ObligationOccurrence = { id: 'oct', organizationId: ORG, obligationId: 'rent',
      scheduledDate: '2026-10-31', overrideDate: '2026-09-30',
      overrideAmount: { currency: 'USD', minor: 1200 }, status: 'scheduled',
      reconciliationState: 'unreconciled' }
    const input = makeInput({ obligations: [o], occurrences: [occurrence],
      allocation: { protectionHorizonDays: 1 } })
    expect(input.allocationSnapshot.allocationResult.requirements).toHaveLength(1)
    expect(input.allocationSnapshot.allocationResult.requirements[0]).toMatchObject({
      dedupeKey: `${ORG}:financial_obligation_occurrence:oct`, amountMinor: 1200 })
    const result = computeCashProjection(input)
    expect(result.anchor.totalProtectedRequirementMinor).toBe(1200)
    expect(result.datedEvents.filter(e => e.sourceKey === `${ORG}:financial_obligation_occurrence:oct`))
      .toHaveLength(1)
    expect(result.days[0]).toMatchObject({ outflowMinor: 1200, closingCashMinor: 3800,
      totalProtectedRequirementMinor: 0, trulyFreeCashMinor: 3800 })
  })

  it('excludes reconciled, satisfied, and optional plans unless policy includes optional', () => {
    const plans = [commitment('reconciled', '2026-10-01', 1000, { status: 'satisfied',
      reconciliationState: 'reconciled', actualTransactionId: 'tx1' }),
    commitment('optional', '2026-10-01', 300, { requirement: 'optional' })]
    expect(computeCashProjection(makeInput({ commitments: plans })).days[1].outflowMinor).toBe(0)
    expect(computeCashProjection(makeInput({ commitments: plans,
      allocation: { includeOptionalObligations: true } })).days[1].outflowMinor).toBe(300)
  })

  it('retains an overdue plan as protection and marker without replaying its cash', () => {
    const result = computeCashProjection(makeInput({ commitments: [commitment('old', '2026-09-28', 1200)] }))
    expect(result.anchor.totalProtectedRequirementMinor).toBe(1200)
    expect(result.days[0]).toMatchObject({ outflowMinor: 0, closingCashMinor: 5000,
      totalProtectedRequirementMinor: 1200 })
    expect(result.datedMarkers).toContainEqual(expect.objectContaining({ reason: 'overdue_unsettled' }))
  })

  it.each(['conservative', 'likely', 'upside'] as const)('keeps required possible costs in %s', confidenceMode => {
    const result = computeCashProjection(makeInput({ confidenceMode, commitments: [commitment('possible',
      '2026-10-01', 500, { confidence: 'possible' })] }))
    expect(result.days[1].outflowMinor).toBe(500)
  })

  it('admits multiple strict project milestones only in upside', () => {
    const options = { projects: [project()], collectionEvidence: [evidence()], horizonDays: 90 as const }
    const conservative = computeCashProjection(makeInput(options))
    const likely = computeCashProjection(makeInput({ ...options, confidenceMode: 'likely' }))
    const upside = computeCashProjection(makeInput({ ...options, confidenceMode: 'upside' }))
    expect(conservative.datedEvents.filter(e => e.movementBasis === 'project_collection')).toHaveLength(0)
    expect(likely.datedEvents.filter(e => e.movementBasis === 'project_collection')).toHaveLength(0)
    expect(upside.datedEvents.filter(e => e.movementBasis === 'project_collection').length).toBeGreaterThan(1)
    expect(upside.datedEvents.filter(e => e.movementBasis === 'project_collection').map(e => e.amountMinor))
      .toEqual([1000, 3000, 4000, 2000])
  })

  it('preserves CASH-6 next collection selection after exposing the full schedule', () => {
    const input = makeInput({ projects: [project()], collectionEvidence: [evidence()] })
    const { signals } = deriveProjectCollectionSignals(input.projects[0], input.collectionEvidence[0], DAY)
    expect(signals).toHaveLength(4)
    expect(input.collectionClock.activeFunding[0].nextCollection).toEqual(signals[0])
  })

  it('shows unknown collection amount after unlinked cash without numerical income', () => {
    const result = computeCashProjection(makeInput({ projects: [project()],
      collectionEvidence: [evidence(500)], confidenceMode: 'upside', horizonDays: 90 }))
    expect(result.datedEvents.filter(e => e.movementBasis === 'project_collection')).toHaveLength(0)
    expect(result.datedMarkers).toContainEqual(expect.objectContaining({ reason: 'unknown_amount' }))
  })

  it('shows unknown collection date and due-today collection as markers only', () => {
    const p = project({ depositPct: 10, plannedStart: null, startDate: null,
      phaseTimeline: [{ phaseName: 'No date', paymentTriggerPct: 0 }] })
    const unknown = computeCashProjection(makeInput({ projects: [p], collectionEvidence: [evidence()],
      confidenceMode: 'upside' }))
    expect(unknown.undatedMarkers).toContainEqual(expect.objectContaining({ reason: 'unknown_date' }))
    const today = computeCashProjection(makeInput({ projects: [project({ phaseTimeline: [
      { phaseName: 'First', paymentTriggerPct: 30, confirmedStartDate: DAY, actualEndDate: '2026-10-20' },
      { phaseName: 'Second', paymentTriggerPct: 20, confirmedStartDate: '2026-10-10', actualEndDate: '2026-10-30' },
    ] })],
      collectionEvidence: [evidence()], confidenceMode: 'upside' }))
    expect(today.datedMarkers).toContainEqual(expect.objectContaining({ reason: 'overdue_unsettled' }))
    expect(today.datedEvents.every(e => e.date > DAY)).toBe(true)
  })

  it('includes a completed unpaid project in collection follow-up', () => {
    const result = computeCashProjection(makeInput({ projects: [project({ status: 'completed' })],
      collectionEvidence: [evidence()], confidenceMode: 'upside' }))
    expect(result.datedEvents.some(e => e.movementBasis === 'project_collection')).toBe(true)
  })

  it('never duplicates project-required-cost or payroll attribution lenses', () => {
    const result = computeCashProjection(makeInput({ projects: [project()], collectionEvidence: [evidence()],
      commitments: [commitment('material', '2026-09-30', 500, { projectId: 'p1' })],
      derivedLiabilities: [payroll()] }))
    expect(result.days[0].outflowMinor).toBe(500)
    expect(result.anchor.totalProtectedRequirementMinor).toBe(1500)
  })

  it('uses exact ledger linkage to suppress duplicate planned movement and retire its claim', () => {
    const result = computeCashProjection(makeInput({ transactions: [tx('opening', DAY, 5000),
      tx('paid', '2026-10-01', -1000)], commitments: [commitment('c', '2026-10-01', 1000,
      { actualTransactionId: 'paid' })] }))
    expect(result.days[1].outflowMinor).toBe(1000)
    expect(result.days[1].events).toHaveLength(1)
    expect(result.days[1].trulyFreeCashMinor).toBe(4000)
    expect(result.datedMarkers).toContainEqual(expect.objectContaining({ reason: 'source_overlap' }))
  })

  it('retires an overdue claim on its exact future posted ledger payment', () => {
    const result = computeCashProjection(makeInput({ transactions: [tx('opening', DAY, 5000),
      tx('paid', '2026-10-01', -1000)], commitments: [commitment('old', '2026-09-28', 1000,
      { actualTransactionId: 'paid' })] }))
    expect(result.anchor.totalProtectedRequirementMinor).toBe(1000)
    expect(result.days[1]).toMatchObject({ outflowMinor: 1000, closingCashMinor: 4000,
      totalProtectedRequirementMinor: 0, trulyFreeCashMinor: 4000 })
  })

  it('does not replay a linked payment already contained in Day-0 cash', () => {
    const result = computeCashProjection(makeInput({ transactions: [tx('opening', DAY, 5000),
      tx('paid', DAY, -1000)], commitments: [commitment('c', '2026-10-01', 1000,
      { actualTransactionId: 'paid' })] }))
    expect(result.anchor.closingCashMinor).toBe(4000)
    expect(result.days[1].outflowMinor).toBe(0)
    expect(result.diagnostics.some(d => d.startsWith('linked_payment_in_opening:'))).toBe(true)
  })

  it('keeps a mismatched exact-linked claim protected while using only ledger movement', () => {
    const result = computeCashProjection(makeInput({ transactions: [tx('opening', DAY, 5000),
      tx('paid', '2026-10-01', -900)], commitments: [commitment('c', '2026-10-01', 1000,
      { actualTransactionId: 'paid' })] }))
    expect(result.days[1]).toMatchObject({ outflowMinor: 900, closingCashMinor: 4100,
      totalProtectedRequirementMinor: 1000 })
    expect(result.diagnostics.some(d => d.startsWith('linked_payment_mismatch:'))).toBe(true)
  })

  it('does not fuzzy-match two unlinked same-amount same-date movements', () => {
    const result = computeCashProjection(makeInput({ transactions: [tx('opening', DAY, 5000),
      tx('paid', '2026-10-01', -1000)], commitments: [commitment('c', '2026-10-01', 1000)] }))
    expect(result.days[1].outflowMinor).toBe(2000)
  })

  it('computes lows, earliest ties, protection deficit, and 14-day low beyond a 7-day display', () => {
    const result = computeCashProjection(makeInput({ cash: 2000,
      commitments: [commitment('short', '2026-10-02', 1000),
        commitment('later', '2026-10-10', 1500)],
      allocation: { protectionHorizonDays: 0 } }))
    expect(result.summary.lowestTotalCashMinor).toBe(1000)
    expect(result.summary.lowestTotalCashDate).toBe('2026-10-02')
    expect(result.summary.fourteenDayLowestTotalCashMinor).toBe(-500)
    expect(result.summary.fourteenDayLowestTotalCashDate).toBe('2026-10-10')
    expect(result.summary.lowestTrulyFreeCashMinor).toBe(1000)
  })

  it('reports first protection deficit and zero days when Day 0 or first future day breaches', () => {
    const day0 = computeCashProjection(makeInput({ cash: 100,
      allocation: { operatingFloorMinor: 200 } }))
    expect(day0.summary).toMatchObject({ firstProtectionDeficitDate: DAY,
      daysCovered: { days: 0, bounded: false } })
    const tomorrow = computeCashProjection(makeInput({ cash: 100,
      commitments: [commitment('c', '2026-09-30', 200)], allocation: { protectionHorizonDays: 0 } }))
    expect(tomorrow.summary.daysCovered).toEqual({ days: 0, bounded: false })
    expect(tomorrow.days[0].closingCashMinor).toBe(-100)
  })

  it('returns a horizon-bounded days-covered count when no breach occurs', () => {
    expect(computeCashProjection(makeInput()).summary.daysCovered).toEqual({ days: 7, bounded: true })
  })

  it('counts six safe future closes before a seventh-day breach', () => {
    const result = computeCashProjection(makeInput({ cash: 500,
      commitments: [commitment('last', '2026-10-06', 600)],
      allocation: { protectionHorizonDays: 0 } }))
    expect(result.summary.daysCovered).toEqual({ days: 6, bounded: false })
  })

  it('admits confirmed, then expected, then possible scenario income by confidence', () => {
    const scenarioEvents = [
      { scenarioId: 'confirmed', action: 'add' as const, date: '2026-09-30', direction: 'inflow' as const,
        amountMinor: 100, confidence: 'confirmed' as const, requirement: 'optional' as const, label: 'Confirmed' },
      { scenarioId: 'expected', action: 'add' as const, date: '2026-09-30', direction: 'inflow' as const,
        amountMinor: 200, confidence: 'expected' as const, requirement: 'optional' as const, label: 'Expected' },
      { scenarioId: 'possible', action: 'add' as const, date: '2026-09-30', direction: 'inflow' as const,
        amountMinor: 300, confidence: 'possible' as const, requirement: 'optional' as const, label: 'Possible' },
    ]
    expect(computeCashProjection(makeInput({ scenarioEvents })).days[0].inflowMinor).toBe(100)
    const likely = computeCashProjection(makeInput({ scenarioEvents, confidenceMode: 'likely' }))
    expect(likely.days[0].inflowMinor).toBe(300)
    expect(likely.days[0].uncertainty.includedExpectedEventCount).toBe(1)
    const upside = computeCashProjection(makeInput({ scenarioEvents, confidenceMode: 'upside' }))
    expect(upside.days[0].inflowMinor).toBe(600)
    expect(upside.days[0].uncertainty.highestIncludedConfidence).toBe('possible')
  })

  it('supports in-memory add and replacement without changing source inputs', () => {
    const scenarios = [{ scenarioId: 'income', action: 'add' as const, date: '2026-09-30',
      direction: 'inflow' as const, amountMinor: 200, confidence: 'confirmed' as const,
      requirement: 'optional' as const, label: 'Extra service' },
    { scenarioId: 'delay', action: 'replace' as const, replacesSourceKey: `${ORG}:cash_commitment:c`,
      date: '2026-10-03', direction: 'outflow' as const, amountMinor: 1000,
      confidence: 'confirmed' as const, requirement: 'required' as const, label: 'Delayed purchase' }]
    const input = makeInput({ commitments: [commitment('c', '2026-09-30', 1000)], scenarioEvents: scenarios })
    const result = computeCashProjection(input)
    expect(result.days[0]).toMatchObject({ inflowMinor: 200, outflowMinor: 0 })
    expect(result.days[3].outflowMinor).toBe(1000)
    expect(input.commitments[0].expectedDate).toBe('2026-09-30')
    expect(input.scenarioEvents?.[1].date).toBe('2026-10-03')
  })

  it('moves a planned commitment payment and protection date without changing its input', () => {
    const input = makeInput({ allocation: { protectionHorizonDays: 0 },
      commitments: [commitment('c', '2026-10-01', 1000)],
      scenarioEvents: [{ scenarioId: 'delay', action: 'replace',
        replacesSourceKey: `${ORG}:cash_commitment:c`, date: '2026-10-05',
        direction: 'outflow', amountMinor: 1000, confidence: 'confirmed',
        requirement: 'required', label: 'Delayed purchase' }] })
    const result = computeCashProjection(input)
    expect(result.days[1]).toMatchObject({ date: '2026-10-01', outflowMinor: 0,
      totalProtectedRequirementMinor: 0 })
    expect(result.days[5]).toMatchObject({ date: '2026-10-05', outflowMinor: 1000,
      totalProtectedRequirementMinor: 0, closingCashMinor: 4000 })
    expect(result.datedEvents.some(e => e.sourceKey === `${ORG}:cash_commitment:c`)).toBe(false)
    expect(result.datedEvents.filter(e => e.sourceKey === 'scenario:delay')).toHaveLength(1)
    expect(input.commitments[0]).toMatchObject({ expectedDate: '2026-10-01', amount: { minor: 1000 } })
  })

  it('uses a replacement planned amount once in future protection and payment', () => {
    const result = computeCashProjection(makeInput({ allocation: { protectionHorizonDays: 1 },
      commitments: [commitment('c', '2026-10-01', 1000)],
      scenarioEvents: [{ scenarioId: 'larger', action: 'replace',
        replacesSourceKey: `${ORG}:cash_commitment:c`, date: '2026-10-05',
        direction: 'outflow', amountMinor: 1500, confidence: 'confirmed',
        requirement: 'required', label: 'Larger purchase' }] }))
    expect(result.days[4]).toMatchObject({ date: '2026-10-04', outflowMinor: 0,
      totalProtectedRequirementMinor: 1500, trulyFreeCashMinor: 3500 })
    expect(result.days[5]).toMatchObject({ outflowMinor: 1500,
      totalProtectedRequirementMinor: 0, closingCashMinor: 3500 })
    expect(result.days[5].events).toHaveLength(1)
  })

  it('moves a linked ledger payment while retaining the underlying claim date and amount', () => {
    const input = makeInput({ allocation: { protectionHorizonDays: 0 },
      transactions: [tx('opening', DAY, 5000), tx('paid', '2026-10-01', -1000)],
      commitments: [commitment('c', '2026-10-01', 1000, { actualTransactionId: 'paid' })],
      scenarioEvents: [{ scenarioId: 'move-payment', action: 'replace',
        replacesSourceKey: `${ORG}:financial_transaction:paid`, date: '2026-10-05',
        direction: 'outflow', amountMinor: 1000, confidence: 'confirmed',
        requirement: 'required', label: 'Moved ledger payment' }] })
    const result = computeCashProjection(input)
    expect(result.days[1]).toMatchObject({ date: '2026-10-01', outflowMinor: 0,
      totalProtectedRequirementMinor: 1000, trulyFreeCashMinor: 4000 })
    expect(result.days[5]).toMatchObject({ date: '2026-10-05', outflowMinor: 1000,
      totalProtectedRequirementMinor: 0, closingCashMinor: 4000 })
    expect(input.commitments[0].expectedDate).toBe('2026-10-01')
  })

  it('rejects changed linked-ledger payment cents instead of settling the full claim', () => {
    const input = makeInput({ transactions: [tx('opening', DAY, 5000),
      tx('paid', '2026-10-01', -1000)],
      commitments: [commitment('c', '2026-10-01', 1000, { actualTransactionId: 'paid' })],
      scenarioEvents: [{ scenarioId: 'partial', action: 'replace',
        replacesSourceKey: `${ORG}:financial_transaction:paid`, date: '2026-10-05',
        direction: 'outflow', amountMinor: 500, confidence: 'confirmed',
        requirement: 'required', label: 'Partial ledger payment' }] })
    expect(() => computeCashProjection(input)).toThrow(/Unsupported partial settlement/)
  })

  it('does not create project income from missing stored terms or timeline defaults', () => {
    const result = computeCashProjection(makeInput({ projects: [project({ depositPct: undefined,
      phaseTimeline: [{ phaseName: 'No term' }] })], collectionEvidence: [evidence()],
      confidenceMode: 'upside', horizonDays: 90 }))
    expect(result.datedEvents.filter(e => e.movementBasis === 'project_collection')).toHaveLength(0)
  })

  it('rejects duplicate or missing scenario identities and past scenario dates', () => {
    const event = { scenarioId: 'x', action: 'add' as const, date: '2026-10-01',
      direction: 'inflow' as const, amountMinor: 100, confidence: 'confirmed' as const,
      requirement: 'optional' as const, label: 'X' }
    expect(() => computeCashProjection(makeInput({ scenarioEvents: [event, event] }))).toThrow(/Duplicate scenario/)
    expect(() => computeCashProjection(makeInput({ scenarioEvents: [{ ...event, action: 'replace',
      replacesSourceKey: 'missing' }] }))).toThrow(/source missing/)
    expect(() => computeCashProjection(makeInput({ scenarioEvents: [{ ...event, date: DAY }] }))).toThrow(/after asOfDate/)
    expect(() => computeCashProjection(makeInput({ scenarioEvents: [{ ...event, date: '2026-02-31' }] })))
      .toThrow(/calendar date/)
  })

  it('isolates organizations and rejects unsafe cents', () => {
    const result = computeCashProjection(makeInput({ accounts: [account(), account('other',
      { organization_id: 'other' })], transactions: [tx('opening', DAY, 5000),
      tx('other', '2026-09-30', -4000, { account_id: 'other', organization_id: 'other' })] }))
    expect(result.days[0].closingCashMinor).toBe(5000)
    expect(() => computeCashProjection(makeInput({ commitments: [commitment('bad',
      '2026-10-01', Number.MAX_SAFE_INTEGER + 1)] }))).toThrow(/safe integer/)
  })
})
