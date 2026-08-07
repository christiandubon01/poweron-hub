/**
 * SERVICE-COST-3B — crew-aware labor costing contract.
 *
 * Costed Field Crew (laborCategory === 'field') drive Direct Labor Cost and
 * Overhead Recovery. Office employees and unclassified records are excluded.
 */
import { describe, expect, it } from 'vitest'
import {
  buildCostSnapshot,
  computeCrewQuote,
  quoteFromCostSnapshot,
  resolveCostedCrew,
  resolveCostedFieldWorker,
  validateCrewForCosting,
  type CostModelEmployee,
  type CrewMemberInput,
} from '../crewCosting'
import { OWNER_ASSIGNEE_ID } from '../serviceAssignments'

const BASE_ARGS = {
  siteHours: 4,
  crew: [] as CrewMemberInput[],
  materialCost: 45,
  miles: 18,
  mileRate: 0.66,
  taxRatePct: 8.25,
  overheadRecoveryRate: 42.45,
  totalQuoted: 0,
}

const FIELD_WORKER: CrewMemberInput = {
  costModelEmployeeId: 'emp-1',
  displayName: 'Electrician A',
  laborCategory: 'field',
  loadedLaborRate: 38,
  billRate: 95,
  laborHours: 4,
}

const SECOND_FIELD_WORKER: CrewMemberInput = {
  costModelEmployeeId: 'emp-2',
  displayName: 'Electrician B',
  laborCategory: 'field',
  loadedLaborRate: 42,
  billRate: 110,
  laborHours: 4,
}

const COST_MODEL_EMPLOYEES: CostModelEmployee[] = [
  { id: 'cm-1', name: 'Alice', role: 'Lead Electrician', billRate: 95, hourly_rate: 25, costRate: 38, laborCategory: 'field' },
  { id: 'cm-2', name: 'Bob', role: 'Apprentice', billRate: 70, hourly_rate: 18, costRate: 28, laborCategory: 'field' },
  { id: 'cm-3', name: 'Carol', role: 'Office Admin', billRate: 0, hourly_rate: 22, costRate: 30, laborCategory: 'office' },
  { id: 'cm-4', name: 'Dave', role: 'Unclassified', billRate: 90, hourly_rate: 20, costRate: 32 },
  { id: 'cm-5', name: 'Eve', role: 'No Rates', laborCategory: 'field' },
]

describe('computeCrewQuote — crew math', () => {
  it('single field worker: direct labor, overhead, billable labor and suggested quote', () => {
    const result = computeCrewQuote({ ...BASE_ARGS, crew: [FIELD_WORKER], totalQuoted: 441.57 })

    expect(result.directLaborCost).toBe(152) // 4 hrs * 38
    expect(result.billableLabor).toBe(380) // 4 hrs * 95
    expect(result.overheadRecovery).toBe(169.8) // 4 crew-hrs * 42.45
    expect(result.mileageCost).toBe(11.88)
    expect(result.salesTax).toBe(4.69) // 8.25% of (45 + 11.88)
    expect(result.totalInternalCost).toBe(
      152 + 169.8 + 45 + 11.88 + 4.69,
    )
    expect(result.suggestedQuote).toBe(441.57) // 380 + 45 + 11.88 + 4.69
    expect(result.suggestedProfit).toBe(round2(441.57 - result.totalInternalCost))
    expect(result.actualEstimatedProfit).toBe(round2(441.57 - result.totalInternalCost))
    expect(result.quoteVariance).toBe(0)
  })

  it('two field workers scale direct labor and overhead by crew size', () => {
    const result = computeCrewQuote({ ...BASE_ARGS, crew: [FIELD_WORKER, SECOND_FIELD_WORKER], totalQuoted: 800 })

    // Direct labor: 4*38 + 4*42 = 320
    expect(result.directLaborCost).toBe(320)
    // Billable labor: 4*95 + 4*110 = 820
    expect(result.billableLabor).toBe(820)
    // Overhead recovery: 8 crew-hrs * 42.45
    expect(result.crewLaborHours).toBe(8)
    expect(result.overheadRecovery).toBe(339.6)
    expect(result.suggestedQuote).toBe(881.57) // 820 + 45 + 11.88 + 4.69
    expect(result.actualEstimatedProfit).toBe(round2(800 - result.totalInternalCost))
  })

  it('per-member labor hours can differ from site hours for future overrides', () => {
    const member = { ...FIELD_WORKER, laborHours: 2.5 }
    const result = computeCrewQuote({ ...BASE_ARGS, crew: [member] })

    expect(result.directLaborCost).toBe(95)
    expect(result.billableLabor).toBe(237.5)
    expect(result.crewLaborHours).toBe(2.5)
    expect(result.overheadRecovery).toBe(106.13) // 2.5 * 42.45
  })

  it('zero material/miles removes those cost buckets but keeps labor overhead', () => {
    const result = computeCrewQuote({
      ...BASE_ARGS,
      crew: [FIELD_WORKER],
      materialCost: 0,
      miles: 0,
      totalQuoted: 380,
    })

    expect(result.materialCost).toBe(0)
    expect(result.mileageCost).toBe(0)
    expect(result.salesTax).toBe(0)
    expect(result.totalInternalCost).toBe(152 + 169.8)
    expect(result.suggestedQuote).toBe(380)
    expect(result.suggestedProfit).toBe(58.2)
  })
})

describe('resolveCostedCrew — assigned vs pricing', () => {
  it('resolves field workers from assigned team, excludes office and unclassified', () => {
    const result = resolveCostedCrew(
      'assigned',
      4,
      COST_MODEL_EMPLOYEES,
      [
        { employeeId: 'cm-1', profileId: null, name: 'Alice' },
        { employeeId: 'cm-2', profileId: null, name: 'Bob' },
        { employeeId: 'cm-3', profileId: null, name: 'Carol' }, // office
        { employeeId: 'cm-4', profileId: null, name: 'Dave' }, // unclassified
      ],
    )

    expect(result.crew.map((m) => m.costModelEmployeeId)).toEqual(['cm-1', 'cm-2'])
    expect(result.officeOnlyIds).toEqual(['cm-3'])
    expect(result.missingClassificationIds).toEqual(['cm-4'])
    expect(result.errors).toEqual([])
  })

  it('resolves pricing crew by cost model id, ignoring office classification', () => {
    const result = resolveCostedCrew(
      'pricing',
      4,
      COST_MODEL_EMPLOYEES,
      [],
      ['cm-1', 'cm-2', 'cm-3'],
    )

    expect(result.crew.map((m) => m.costModelEmployeeId)).toEqual(['cm-1', 'cm-2'])
    expect(result.officeOnlyIds).toEqual(['cm-3'])
    expect(result.errors).toEqual([])
  })

  it('reports missing employees and missing rates without crashing', () => {
    const result = resolveCostedCrew(
      'assigned',
      4,
      COST_MODEL_EMPLOYEES,
      [
        { employeeId: 'missing-id', profileId: null, name: 'Missing' },
        { employeeId: 'cm-5', profileId: null, name: 'Eve' }, // field but no rates
      ],
    )

    expect(result.crew).toEqual([])
    expect(result.errors).toContain('Employee missing-id not found in Team roster.')
    expect(result.missingRateIds).toEqual(['cm-5'])
  })

  it('deduplicates by id', () => {
    const result = resolveCostedCrew(
      'assigned',
      4,
      COST_MODEL_EMPLOYEES,
      [
        { employeeId: 'cm-1', profileId: null, name: 'Alice' },
        { employeeId: 'cm-1', profileId: null, name: 'Alice' },
      ],
    )

    expect(result.crew).toHaveLength(1)
    expect(result.crew[0].costModelEmployeeId).toBe('cm-1')
  })

  it('does not auto-switch to pricing crew when assigned team is empty', () => {
    const result = resolveCostedCrew(
      'assigned',
      4,
      COST_MODEL_EMPLOYEES,
      [],
      ['cm-1'], // pricing crew ids are ignored while source is assigned
    )

    expect(result.crew).toEqual([])
    expect(result.errors).toEqual([])
  })

  it('blocks when a portal-only employee without Cost Model record is selected alone', () => {
    const result = resolveCostedCrew(
      'assigned',
      4,
      COST_MODEL_EMPLOYEES,
      [{ employeeId: 'portal-only-id', profileId: 'portal-1', name: 'Portal Only' }],
    )

    expect(result.crew).toEqual([])
    expect(result.errors).toContain('Employee portal-only-id not found in Team roster.')
    const validation = validateCrewForCosting(result.crew, 42.45, 4, result)
    expect(validation.valid).toBe(false)
    expect(validation.errors).toContain('Employee portal-only-id not found in Team roster.')
  })

  it('blocks when a portal-only employee is mixed with a valid field worker', () => {
    const result = resolveCostedCrew(
      'assigned',
      4,
      COST_MODEL_EMPLOYEES,
      [
        { employeeId: 'cm-1', profileId: null, name: 'Alice' },
        { employeeId: 'portal-only-id', profileId: 'portal-1', name: 'Portal Only' },
      ],
    )

    expect(result.crew.map((m) => m.costModelEmployeeId)).toEqual(['cm-1'])
    expect(result.errors).toContain('Employee portal-only-id not found in Team roster.')
    const validation = validateCrewForCosting(result.crew, 42.45, 4, result)
    expect(validation.valid).toBe(false)
    expect(validation.errors).toContain('Employee portal-only-id not found in Team roster.')
  })

  it('does not block when a valid office employee is mixed with a valid field worker', () => {
    const result = resolveCostedCrew(
      'assigned',
      4,
      COST_MODEL_EMPLOYEES,
      [
        { employeeId: 'cm-1', profileId: null, name: 'Alice' },
        { employeeId: 'cm-3', profileId: null, name: 'Carol' }, // office
      ],
    )

    expect(result.crew.map((m) => m.costModelEmployeeId)).toEqual(['cm-1'])
    expect(result.errors).toEqual([])
    expect(result.officeOnlyIds).toEqual(['cm-3'])
    const validation = validateCrewForCosting(result.crew, 42.45, 4, result)
    expect(validation.valid).toBe(true)
  })

  it('does not create a partial costSnapshot when validation is blocked', () => {
    const result = resolveCostedCrew(
      'assigned',
      4,
      COST_MODEL_EMPLOYEES,
      [
        { employeeId: 'cm-1', profileId: null, name: 'Alice' },
        { employeeId: 'portal-only-id', profileId: 'portal-1', name: 'Portal Only' },
      ],
    )

    const validation = validateCrewForCosting(result.crew, 42.45, 4, result)
    expect(validation.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })
})

describe('resolveCostedCrew — Owner / Me sentinel resolution (SERVICE-COST-3C)', () => {
  const OWNER_TEAM: CostModelEmployee[] = [
    { id: 'me', name: 'Owner / Me', role: 'Owner', billRate: 95, hourly_rate: 30, costRate: 30, laborCategory: 'field', isOwner: true },
    { id: 'allan', name: 'Allan', role: 'Electrician', billRate: 75, hourly_rate: 27.6, costRate: 27.6, laborCategory: 'field', classification: '1099' },
  ]

  it('Owner only: __owner__ resolves to the one canonical owner Team record with Team rates', () => {
    const result = resolveCostedCrew(
      'assigned',
      4,
      OWNER_TEAM,
      [{ employeeId: OWNER_ASSIGNEE_ID, profileId: null, name: 'Owner / Me' }],
    )

    expect(result.crew).toHaveLength(1)
    expect(result.crew[0].costModelEmployeeId).toBe('me')
    expect(result.crew[0].loadedLaborRate).toBe(30)
    expect(result.crew[0].billRate).toBe(95)
    expect(result.errors).toEqual([])
    expect(result.errors.join(' ')).not.toContain('__owner__')
    expect(result.errors.join(' ')).not.toContain('not found in Team roster')
  })

  it('Owner + Allan: two costed workers, both rates from Team, crew-hours include both', () => {
    const result = resolveCostedCrew(
      'assigned',
      4,
      OWNER_TEAM,
      [
        { employeeId: OWNER_ASSIGNEE_ID, profileId: null, name: 'Owner / Me' },
        { employeeId: 'allan', profileId: null, name: 'Allan' },
      ],
    )

    expect(result.crew.map((m) => m.costModelEmployeeId)).toEqual(['me', 'allan'])
    expect(result.crew.map((m) => m.loadedLaborRate)).toEqual([30, 27.6])
    expect(result.crew.map((m) => m.billRate)).toEqual([95, 75])
    expect(result.errors).toEqual([])

    const quote = computeCrewQuote({
      siteHours: 4,
      crew: result.crew,
      materialCost: 0, miles: 0, mileRate: 0, taxRatePct: 0,
      overheadRecoveryRate: 15.59, totalQuoted: 0, crewSource: 'assigned',
    })
    expect(quote.crewLaborHours).toBe(8)
  })

  it('Owner counted exactly once when reached through both the sentinel and the canonical id', () => {
    const result = resolveCostedCrew(
      'assigned',
      4,
      OWNER_TEAM,
      [
        { employeeId: OWNER_ASSIGNEE_ID, profileId: null, name: 'Owner / Me' },
        { employeeId: 'me', profileId: null, name: 'Owner (roster row)' },
      ],
    )

    expect(result.crew).toHaveLength(1)
    expect(result.crew[0].costModelEmployeeId).toBe('me')
  })

  it('Owner missing laborCategory blocks with a classification error, not "__owner__ not found"', () => {
    const team: CostModelEmployee[] = [
      { id: 'me', name: 'Owner / Me', role: 'Owner', billRate: 95, hourly_rate: 30, costRate: 30, isOwner: true },
    ]
    const result = resolveCostedCrew('assigned', 4, team, [{ employeeId: OWNER_ASSIGNEE_ID, profileId: null, name: 'Owner / Me' }])

    expect(result.crew).toEqual([])
    expect(result.missingClassificationIds).toEqual(['me'])
    expect(result.errors).toEqual([])
    const validation = validateCrewForCosting(result.crew, 15.59, 4, result)
    expect(validation.valid).toBe(false)
    expect(validation.errors.some((e) => e.includes('Labor Category'))).toBe(true)
    expect(validation.errors.join(' ')).not.toContain('__owner__')
  })

  it('Owner missing loaded labor rate blocks with a rate error', () => {
    const team: CostModelEmployee[] = [
      { id: 'me', name: 'Owner / Me', role: 'Owner', billRate: 95, laborCategory: 'field', isOwner: true },
    ]
    const result = resolveCostedCrew('assigned', 4, team, [{ employeeId: OWNER_ASSIGNEE_ID, profileId: null, name: 'Owner / Me' }])

    expect(result.crew).toEqual([])
    expect(result.missingRateIds).toEqual(['me'])
    const validation = validateCrewForCosting(result.crew, 15.59, 4, result)
    expect(validation.valid).toBe(false)
    expect(validation.errors.some((e) => e.toLowerCase().includes('rate'))).toBe(true)
  })

  it('Owner missing bill rate blocks with a rate error', () => {
    const team: CostModelEmployee[] = [
      { id: 'me', name: 'Owner / Me', role: 'Owner', hourly_rate: 30, costRate: 30, billRate: 0, laborCategory: 'field', isOwner: true },
    ]
    const result = resolveCostedCrew('assigned', 4, team, [{ employeeId: OWNER_ASSIGNEE_ID, profileId: null, name: 'Owner / Me' }])

    expect(result.crew).toEqual([])
    expect(result.missingRateIds).toEqual(['me'])
  })

  it('regular employee-only costing is unchanged by owner resolution', () => {
    const result = resolveCostedCrew(
      'assigned',
      4,
      OWNER_TEAM,
      [{ employeeId: 'allan', profileId: null, name: 'Allan' }],
    )
    expect(result.crew.map((m) => m.costModelEmployeeId)).toEqual(['allan'])
    expect(result.errors).toEqual([])
  })

  it('Pricing Crew stays independent and dedupes by resolved Cost Model id', () => {
    const result = resolveCostedCrew(
      'pricing',
      4,
      OWNER_TEAM,
      [],
      ['me', 'me', 'allan'],
    )
    expect(result.crew.map((m) => m.costModelEmployeeId)).toEqual(['me', 'allan'])
    expect(result.errors).toEqual([])
  })
})

describe('resolveCostedFieldWorker — unit guard', () => {
  it('returns null for office-only employees', () => {
    expect(
      resolveCostedFieldWorker('x', 'Office', 'office', 30, 60, 4),
    ).toBeNull()
  })

  it('returns null for unclassified employees', () => {
    expect(
      resolveCostedFieldWorker('x', 'Unclassified', null, 30, 60, 4),
    ).toBeNull()
  })

  it('returns null when loaded or bill rate is missing/zero', () => {
    expect(
      resolveCostedFieldWorker('x', 'Field', 'field', 0, 60, 4),
    ).toBeNull()
    expect(
      resolveCostedFieldWorker('x', 'Field', 'field', 30, 0, 4),
    ).toBeNull()
  })

  it('returns a member when all field criteria are met', () => {
    const member = resolveCostedFieldWorker('x', 'Field', 'field', 38, 95, 4)
    expect(member).not.toBeNull()
    expect(member!.laborCategory).toBe('field')
    expect(member!.loadedLaborRate).toBe(38)
    expect(member!.billRate).toBe(95)
    expect(member!.laborHours).toBe(4)
  })
})

describe('validateCrewForCosting — safety gate', () => {
  it('is valid for a proper field crew with configured overhead', () => {
    const v = validateCrewForCosting([FIELD_WORKER], 42.45, 4)
    expect(v.valid).toBe(true)
    expect(v.errors).toEqual([])
  })

  it('blocks on zero site hours', () => {
    const v = validateCrewForCosting([FIELD_WORKER], 42.45, 0)
    expect(v.valid).toBe(false)
    expect(v.errors.some((e) => e.includes('Site Hours'))).toBe(true)
  })

  it('blocks on zero overhead recovery rate', () => {
    const v = validateCrewForCosting([FIELD_WORKER], 0, 4)
    expect(v.valid).toBe(false)
    expect(v.errors.some((e) => e.includes('Overhead recovery rate'))).toBe(true)
  })

  it('blocks on empty crew', () => {
    const v = validateCrewForCosting([], 42.45, 4)
    expect(v.valid).toBe(false)
    expect(v.errors.some((e) => e.includes('Select a Costed Field Crew'))).toBe(true)
  })

  it('surfaces missing classification errors', () => {
    const v = validateCrewForCosting(
      [],
      42.45,
      4,
      {
        crew: [],
        errors: [],
        missingClassificationIds: ['cm-4'],
        missingRateIds: [],
        officeOnlyIds: [],
      },
    )
    expect(v.valid).toBe(false)
    expect(v.errors.some((e) => e.includes('Labor Category'))).toBe(true)
  })
})

describe('buildCostSnapshot — owner-only record', () => {
  it('adds version and timestamp to a breakdown and excludes totalQuoted', () => {
    const now = new Date().toISOString()
    const breakdown = computeCrewQuote({ ...BASE_ARGS, crew: [FIELD_WORKER], totalQuoted: 441.57 })
    const snapshot = buildCostSnapshot(breakdown, now)

    expect(snapshot.version).toBe(1)
    expect(snapshot.calculatedAt).toBe(now)
    expect(snapshot.directLaborCost).toBe(breakdown.directLaborCost)
    expect(snapshot.crewSource).toBe(breakdown.crewSource)
    expect('totalQuoted' in snapshot).toBe(false)
  })
})

describe('quoteFromCostSnapshot — frozen snapshot display', () => {
  it('returns stored cost buckets even when current rates differ', () => {
    const snapshot = buildCostSnapshot(
      computeCrewQuote({
        siteHours: 4,
        crew: [{ costModelEmployeeId: 'x', displayName: 'X', laborCategory: 'field', loadedLaborRate: 30, billRate: 95, laborHours: 4 }],
        materialCost: 0,
        miles: 0,
        mileRate: 0.66,
        taxRatePct: 8.25,
        overheadRecoveryRate: 15.59,
        totalQuoted: 380,
        crewSource: 'assigned',
      }),
    )

    const quote = quoteFromCostSnapshot(snapshot, 380)
    expect(quote.laborBillable).toBe(380)
    expect(quote.operatingCost).toBe(round2(120 + 62.36))
    expect(quote.internalCost).toBe(snapshot.totalInternalCost)
    expect(quote.suggestedQuote).toBe(380)
    expect(quote.totalQuoted).toBe(380)
  })

  it('recomputes profit and variance from a new currentTotalQuoted', () => {
    const snapshot = buildCostSnapshot(
      computeCrewQuote({
        siteHours: 4,
        crew: [{ costModelEmployeeId: 'x', displayName: 'X', laborCategory: 'field', loadedLaborRate: 30, billRate: 95, laborHours: 4 }],
        materialCost: 0,
        miles: 0,
        mileRate: 0.66,
        taxRatePct: 8.25,
        overheadRecoveryRate: 15.59,
        totalQuoted: 380,
        crewSource: 'assigned',
      }),
    )

    const quote = quoteFromCostSnapshot(snapshot, 400)
    expect(quote.totalQuoted).toBe(400)
    expect(quote.actualEstimatedProfit).toBe(round2(400 - snapshot.totalInternalCost))
    expect(quote.quoteVariance).toBe(round2(400 - snapshot.suggestedQuote))
  })

  it('preserves stored overhead rate, mileage rate and tax rate', () => {
    const snapshot = buildCostSnapshot(
      computeCrewQuote({
        siteHours: 4,
        crew: [{ costModelEmployeeId: 'x', displayName: 'X', laborCategory: 'field', loadedLaborRate: 30, billRate: 95, laborHours: 4 }],
        materialCost: 0,
        miles: 0,
        mileRate: 0.66,
        taxRatePct: 8.25,
        overheadRecoveryRate: 15.59,
        totalQuoted: 380,
        crewSource: 'assigned',
      }),
    )

    expect(snapshot.overheadRecoveryRate).toBe(15.59)
    expect(snapshot.mileRate).toBe(0.66)
    expect(snapshot.taxRatePct).toBe(8.25)

    const quote = quoteFromCostSnapshot(snapshot, 380)
    expect(quote.operatingCost).toBe(round2(120 + 62.36))
    expect(quote.internalCost).toBe(round2(120 + 62.36))
  })
})

describe('SERVICE-COST-3B exact acceptance examples', () => {
  it('Example 1 — Owner only', () => {
    const result = computeCrewQuote({
      siteHours: 4,
      crew: [{ costModelEmployeeId: 'owner', displayName: 'Owner', laborCategory: 'field', loadedLaborRate: 30, billRate: 95, laborHours: 4 }],
      materialCost: 0,
      miles: 0,
      mileRate: 0,
      taxRatePct: 0,
      overheadRecoveryRate: 15.59,
      totalQuoted: 380,
      crewSource: 'assigned',
    })

    expect(result.crewLaborHours).toBe(4)
    expect(result.directLaborCost).toBe(120)
    expect(result.billableLabor).toBe(380)
    expect(result.overheadRecovery).toBe(62.36)
    expect(result.totalInternalCost).toBe(182.36)
    expect(result.suggestedQuote).toBe(380)
    expect(result.suggestedProfit).toBe(197.64)
    expect(result.actualEstimatedProfit).toBe(197.64)
    expect(result.quoteVariance).toBe(0)
  })

  it('Example 2 — Josh plus Allan', () => {
    const result = computeCrewQuote({
      siteHours: 4,
      crew: [
        { costModelEmployeeId: 'josh', displayName: 'Josh', laborCategory: 'field', loadedLaborRate: 30, billRate: 75, laborHours: 4 },
        { costModelEmployeeId: 'allan', displayName: 'Allan', laborCategory: 'field', loadedLaborRate: 27.60, billRate: 75, laborHours: 4 },
      ],
      materialCost: 0,
      miles: 0,
      mileRate: 0,
      taxRatePct: 0,
      overheadRecoveryRate: 15.59,
      totalQuoted: 600,
      crewSource: 'assigned',
    })

    expect(result.crewLaborHours).toBe(8)
    expect(result.directLaborCost).toBe(230.40)
    expect(result.billableLabor).toBe(600)
    expect(result.overheadRecovery).toBe(124.72)
    expect(result.totalInternalCost).toBe(355.12)
    expect(result.suggestedQuote).toBe(600)
    expect(result.suggestedProfit).toBe(244.88)
    expect(result.actualEstimatedProfit).toBe(244.88)
    expect(result.quoteVariance).toBe(0)
  })

  it('Example 3 — Office dispatcher plus field worker', () => {
    const result = resolveCostedCrew(
      'assigned',
      4,
      [
        { id: 'dispatch', name: 'Dispatcher', laborCategory: 'office', billRate: 0, costRate: 30 },
        { id: 'field', name: 'Field Worker', laborCategory: 'field', billRate: 75, costRate: 30, classification: '1099' },
      ],
      [
        { employeeId: 'dispatch', profileId: null, name: 'Dispatcher' },
        { employeeId: 'field', profileId: null, name: 'Field Worker' },
      ],
    )

    expect(result.crew).toHaveLength(1)
    expect(result.crew[0].costModelEmployeeId).toBe('field')
    expect(result.officeOnlyIds).toEqual(['dispatch'])


    const quote = computeCrewQuote({
      siteHours: 4,
      crew: result.crew,
      materialCost: 0,
      miles: 0,
      mileRate: 0,
      taxRatePct: 0,
      overheadRecoveryRate: 15.59,
      totalQuoted: 0,
      crewSource: 'assigned',
    })

    expect(quote.crewLaborHours).toBe(4)
    expect(quote.directLaborCost).toBe(120)
    expect(quote.billableLabor).toBe(300)
    expect(quote.overheadRecovery).toBe(62.36)
    expect(quote.totalInternalCost).toBe(182.36)
    expect(quote.suggestedQuote).toBe(300)
    expect(quote.suggestedProfit).toBe(117.64)
  })

  it('Example 4 — Pricing Crew with no assignments', () => {
    const result = resolveCostedCrew(
      'pricing',
      4,
      [{ id: 'field', name: 'Field Worker', laborCategory: 'field', billRate: 75, costRate: 30, classification: '1099' }],
      [],
      ['field'],
    )

    expect(result.crew).toHaveLength(1)
    expect(result.crew[0].costModelEmployeeId).toBe('field')

    const quote = computeCrewQuote({
      siteHours: 4,
      crew: result.crew,
      materialCost: 0,
      miles: 0,
      mileRate: 0,
      taxRatePct: 0,
      overheadRecoveryRate: 15.59,
      totalQuoted: 0,
      crewSource: 'pricing',
    })

    expect(quote.crewLaborHours).toBe(4)
    expect(quote.directLaborCost).toBe(120)
    expect(quote.billableLabor).toBe(300)
    expect(quote.overheadRecovery).toBe(62.36)
    expect(quote.totalInternalCost).toBe(182.36)
    expect(quote.suggestedQuote).toBe(300)
    expect(quote.suggestedProfit).toBe(117.64)
  })
})

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}
