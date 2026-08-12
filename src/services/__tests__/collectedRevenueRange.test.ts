import { describe, expect, it } from 'vitest'
import { getCollectedRevenueForRange, getCurrentYearCollectedRevenue } from '../collectedRevenueRange'
import { isActiveProject, type BackupData } from '../backupDataService'

function paymentEvent(overrides: Record<string, any> = {}): any {
  return {
    id: `pay-${overrides.amount ?? 'x'}`,
    amount: overrides.amount ?? 0,
    receivedAt: overrides.receivedAt ?? null,
    recordedAt: overrides.recordedAt ?? '2026-08-12T00:00:00.000Z',
    kind: overrides.kind ?? 'payment',
    voidedAt: overrides.voidedAt ?? null,
    ...overrides,
  }
}

function serviceLog(overrides: Record<string, any> = {}): any {
  return {
    id: 'svc-1',
    serviceLogId: 'svc-1',
    date: '2026-06-05',
    quoted: 500,
    collected: 0,
    ...overrides,
  }
}

function backup(extra: Record<string, any> = {}): BackupData {
  return {
    projects: [],
    logs: [],
    serviceLogs: [],
    weeklyData: [],
    activeServiceCalls: [],
    settings: { dayTarget: 1_000 },
    ...extra,
  } as unknown as BackupData
}

function project(overrides: Record<string, any> = {}): any {
  return {
    id: 'proj-1',
    status: 'completed',
    contract: 1_000,
    billed: 1_000,
    paid: 0,
    finance: {},
    ...overrides,
  }
}

describe('FORENSIC-KPI-2B2-2 collected revenue range helper', () => {
  it('buckets service cash by payment receivedAt, not service date', () => {
    const data = backup({
      serviceLogs: [
        serviceLog({
          collected: 400,
          payments: [paymentEvent({ amount: 400, receivedAt: '2026-08-12' })],
        }),
      ],
    })

    const august = getCollectedRevenueForRange(
      data,
      new Date('2026-08-01T00:00:00.000Z'),
      new Date('2026-09-01T00:00:00.000Z'),
    )
    const june = getCollectedRevenueForRange(
      data,
      new Date('2026-06-01T00:00:00.000Z'),
      new Date('2026-07-01T00:00:00.000Z'),
    )

    expect(august.serviceKnownDatedCash).toBe(400)
    expect(june.serviceKnownDatedCash).toBe(0)
    expect(august.knownTotal).toBe(400)
  })

  it('tracks legacy scalar service collected as unknown-date cash', () => {
    const data = backup({
      serviceLogs: [serviceLog({ collected: 300 })],
    })

    const currentYear = getCurrentYearCollectedRevenue(data, 2026)
    expect(currentYear.serviceKnownDatedCash).toBe(0)
    expect(currentYear.serviceUnknownDateCash).toBe(300)
    expect(currentYear.knownTotal).toBe(0)
  })

  it('includes project log payments dated in the range', () => {
    const data = backup({
      projects: [project()],
      logs: [
        { id: 'log-1', projectId: 'proj-1', date: '2026-08-10', collected: 600 },
      ],
    })

    const august = getCollectedRevenueForRange(
      data,
      new Date('2026-08-01T00:00:00.000Z'),
      new Date('2026-09-01T00:00:00.000Z'),
    )
    expect(august.projectKnownDatedCash).toBe(600)
    expect(august.knownTotal).toBe(600)
  })

  it('tracks project manualPaidAdjustment as unknown-date cash', () => {
    const data = backup({
      projects: [project({ finance: { manualPaidAdjustment: 250 } })],
      logs: [],
    })

    const currentYear = getCurrentYearCollectedRevenue(data, 2026)
    expect(currentYear.projectKnownDatedCash).toBe(0)
    expect(currentYear.projectUnknownDateCash).toBe(250)
    expect(currentYear.knownTotal).toBe(0)
  })

  it('excludes deleted project logs and logs from deleted projects', () => {
    const data = backup({
      projects: [project({ id: 'live', status: 'completed' }), project({ id: 'dead', status: 'deleted' })],
      logs: [
        { id: 'log-1', projectId: 'live', date: '2026-08-10', collected: 100 },
        { id: 'log-2', projectId: 'dead', date: '2026-08-10', collected: 200 },
        { id: 'log-3', date: '2026-08-10', collected: 300, deleted: true },
      ],
    })

    const august = getCollectedRevenueForRange(
      data,
      new Date('2026-08-01T00:00:00.000Z'),
      new Date('2026-09-01T00:00:00.000Z'),
    )
    expect(august.projectKnownDatedCash).toBe(100)
  })

  it('keeps knownTotal and unknownDateTotal separate', () => {
    const data = backup({
      serviceLogs: [
        serviceLog({ collected: 100 }),
        serviceLog({
          collected: 200,
          payments: [paymentEvent({ amount: 200, receivedAt: '2026-08-05' })],
        }),
      ],
      projects: [project({ finance: { manualPaidAdjustment: 50 } })],
      logs: [{ id: 'log-1', projectId: 'proj-1', date: '2026-08-10', collected: 75 }],
    })

    const currentYear = getCurrentYearCollectedRevenue(data, 2026)
    expect(currentYear.serviceKnownDatedCash).toBe(200)
    expect(currentYear.projectKnownDatedCash).toBe(75)
    expect(currentYear.knownTotal).toBe(275)
    expect(currentYear.serviceUnknownDateCash).toBe(100)
    expect(currentYear.projectUnknownDateCash).toBe(50)
    expect(currentYear.unknownDateTotal).toBe(150)
  })

  it('lifetimeTotal matches service + project lifetime collected semantics', () => {
    const data = backup({
      serviceLogs: [
        serviceLog({
          collected: 200,
          payments: [paymentEvent({ amount: 200, receivedAt: '2026-08-05' })],
        }),
      ],
      projects: [project()],
      logs: [{ id: 'log-1', projectId: 'proj-1', date: '2026-08-10', collected: 100 }],
    })

    const currentYear = getCurrentYearCollectedRevenue(data, 2026)
    expect(currentYear.lifetimeTotal).toBe(300)
  })
})

describe('FORENSIC-KPI-2B2-2C Project synthetic-backfill provenance', () => {
  const BACKFILL_NOTES = 'Backfilled from p.paid scalar (CFOT-COLLECTION-PATH-PARITY migration)'

  // Shape matches handleLogPartialPayment / handleMarkFullPayment in V15rProjectsPanel.
  function genuinePaymentLog(overrides: Record<string, any> = {}): any {
    return {
      id: 'log1700000000000',
      logId: 'log-internal-1',
      createdAt: '2026-07-20T12:00:00.000Z',
      updatedAt: '2026-07-20T12:00:00.000Z',
      projId: 'proj-1',
      projName: 'Proj',
      phase: 'Payment',
      emp: 'Me',
      empId: '',
      hrs: 0,
      miles: 0,
      mat: 0,
      collected: 0,
      store: '',
      notes: 'Partial payment received',
      ...overrides,
    }
  }

  // Shape matches the backupDataService paid-scalar backfill writer.
  function syntheticBackfillLog(overrides: Record<string, any> = {}): any {
    return {
      id: 'log-paidbackfill-proj-1-1700000000000',
      projId: 'proj-1',
      projName: 'Proj',
      phase: 'Payment',
      emp: 'Me',
      empId: '',
      hrs: 0,
      miles: 0,
      mat: 0,
      collected: 0,
      store: '',
      notes: BACKFILL_NOTES,
      ...overrides,
    }
  }

  it('P1 — genuine partial payment is current-year known Project cash', () => {
    const data = backup({
      projects: [project()],
      logs: [genuinePaymentLog({ date: '2026-05-10', collected: 3_000, notes: 'Partial payment received' })],
    })
    const cy = getCurrentYearCollectedRevenue(data, 2026)
    expect(cy.projectKnownDatedCash).toBe(3_000)
    expect(cy.projectUnknownDateCash).toBe(0)
    expect(cy.knownTotal).toBe(3_000)
  })

  it('P2 — genuine full payment is current-year known Project cash', () => {
    const data = backup({
      projects: [project()],
      logs: [genuinePaymentLog({ id: 'log1700000000001', logId: 'log-internal-2', date: '2026-07-20', collected: 5_000, notes: 'Full payment received' })],
    })
    const cy = getCurrentYearCollectedRevenue(data, 2026)
    expect(cy.projectKnownDatedCash).toBe(5_000)
    expect(cy.projectUnknownDateCash).toBe(0)
  })

  it('P3 — synthetic historical gap is NOT current-year known, even with a lastCollectedAt date', () => {
    const data = backup({
      projects: [project()],
      logs: [syntheticBackfillLog({ date: '2026-07-20', collected: 10_000 })],
    })
    const cy = getCurrentYearCollectedRevenue(data, 2026)
    expect(cy.projectKnownDatedCash).toBe(0)
    expect(cy.projectUnknownDateCash).toBe(10_000)
    expect(cy.knownTotal).toBe(0)
    // Lifetime historical cash is still preserved.
    expect(cy.lifetimeTotal).toBe(10_000)
  })

  it('P4 — archived project synthetic backfill remains lifetime cash, excluded from active Pipeline/Exposure', () => {
    const archived = project({ id: 'archived-1', status: 'archived' })
    const data = backup({
      projects: [archived],
      logs: [syntheticBackfillLog({ id: 'log-paidbackfill-archived-1-1700000000000', projId: 'archived-1', date: '2026-07-20', collected: 10_000 })],
    })
    const cy = getCurrentYearCollectedRevenue(data, 2026)
    // Legitimate lifetime historical cash, but unknown-date for precise range.
    expect(cy.lifetimeTotal).toBe(10_000)
    expect(cy.projectUnknownDateCash).toBe(10_000)
    expect(cy.projectKnownDatedCash).toBe(0)
    // Active Pipeline/Exposure gate excludes archived projects.
    expect(isActiveProject(archived)).toBe(false)
  })

  it('P5 — mixed genuine + synthetic: known Project numerator is genuine only', () => {
    const data = backup({
      projects: [project()],
      logs: [
        genuinePaymentLog({ id: 'log1700000000002', logId: 'log-internal-3', date: '2026-05-10', collected: 3_000, notes: 'Partial payment received' }),
        syntheticBackfillLog({ date: '2026-07-20', collected: 10_000 }),
      ],
    })
    const cy = getCurrentYearCollectedRevenue(data, 2026)
    expect(cy.projectKnownDatedCash).toBe(3_000)
    expect(cy.projectUnknownDateCash).toBe(10_000)
    expect(cy.knownTotal).toBe(3_000)
    expect(cy.lifetimeTotal).toBe(13_000)
  })

  it('Annual Target — known numerator = known Service + known Project; unknown does not enter', () => {
    const data = backup({
      serviceLogs: [
        serviceLog({
          collected: 5_000,
          payments: [paymentEvent({ amount: 5_000, receivedAt: '2026-06-01' })],
        }),
      ],
      projects: [project()],
      logs: [
        genuinePaymentLog({ id: 'log1700000000003', logId: 'log-internal-4', date: '2026-05-10', collected: 3_000, notes: 'Partial payment received' }),
        syntheticBackfillLog({ date: '2026-07-20', collected: 10_000 }),
      ],
    })
    const cy = getCurrentYearCollectedRevenue(data, 2026)
    // 5,000 known Service + 3,000 known Project = 8,000 — NOT 18,000.
    expect(cy.serviceKnownDatedCash).toBe(5_000)
    expect(cy.projectKnownDatedCash).toBe(3_000)
    expect(cy.knownTotal).toBe(8_000)
    expect(cy.projectUnknownDateCash).toBe(10_000)
    // Lifetime preserves all historical cash.
    expect(cy.lifetimeTotal).toBe(18_000)
  })
})
