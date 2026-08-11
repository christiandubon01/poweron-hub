/**
 * servicePaymentDateAuthority.test.ts — FORENSIC-KPI-2B2-1 controlled contract.
 *
 * Pins the rule that Service cash FLOW is dated by payments[].receivedAt, not by the
 * service/work date. LIFETIME cash and STOCK metrics remain unchanged.
 */
import { describe, expect, it } from 'vitest'
import { getServiceCashForRange } from '../serviceCashDate'
import { calculateDailyFinancialsForDate, calculateWeeklyFinancialsForRange } from '@/services/weeklyFinancialPolicy'
import { buildBusinessGoalTruth } from '@/services/businessGoalTruth'
import { getKPIs } from '@/services/backupDataService'

const MONDAY_WEEK_START = new Date('2026-05-11T00:00:00.000Z')
const MONDAY_WEEK_END = new Date('2026-05-18T00:00:00.000Z')
const JUNE_5_WEEK_START = new Date('2026-06-01T00:00:00.000Z')
const JUNE_5_WEEK_END = new Date('2026-06-08T00:00:00.000Z')
const AUG_12_WEEK_START = new Date('2026-08-10T00:00:00.000Z')
const AUG_12_WEEK_END = new Date('2026-08-17T00:00:00.000Z')

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

function backup(extra: Record<string, any> = {}): any {
  return {
    projects: [],
    logs: [],
    serviceLogs: [],
    weeklyData: [],
    activeServiceCalls: [],
    settings: { dayTarget: 1_000 },
    ...extra,
  }
}

function activeProject(extra: Record<string, any> = {}): any {
  return {
    id: 'project-1',
    status: 'active',
    contract: 1_000,
    billed: 600,
    ...extra,
  }
}

describe('FORENSIC-KPI-2B2-1 Service cash date authority', () => {
  it('TEST 1 — service date is not payment date', () => {
    const logs = [
      serviceLog({
        collected: 500,
        payments: [paymentEvent({ id: 'p1', amount: 500, receivedAt: '2026-08-12' })],
      }),
    ]

    const june5 = getServiceCashForRange(logs, new Date('2026-06-05T00:00:00.000Z'), new Date('2026-06-06T00:00:00.000Z'))
    const aug12 = getServiceCashForRange(logs, new Date('2026-08-12T00:00:00.000Z'), new Date('2026-08-13T00:00:00.000Z'))

    expect(june5.knownDatedCash).toBe(0)
    expect(june5.unknownDateCash).toBe(0)
    expect(aug12.knownDatedCash).toBe(500)
    expect(aug12.unknownDateCash).toBe(0)
    expect(aug12.lifetimeCash).toBe(500)
  })

  it('TEST 2 — two partial payments land in their received weeks', () => {
    const logs = [
      serviceLog({
        date: '2026-05-01',
        collected: 500,
        payments: [
          paymentEvent({ id: 'p1', amount: 200, receivedAt: '2026-06-05' }),
          paymentEvent({ id: 'p2', amount: 300, receivedAt: '2026-08-12' }),
        ],
      }),
    ]

    const may = getServiceCashForRange(logs, MONDAY_WEEK_START, MONDAY_WEEK_END)
    const june = getServiceCashForRange(logs, JUNE_5_WEEK_START, JUNE_5_WEEK_END)
    const aug = getServiceCashForRange(logs, AUG_12_WEEK_START, AUG_12_WEEK_END)

    expect(may.knownDatedCash).toBe(0)
    expect(june.knownDatedCash).toBe(200)
    expect(aug.knownDatedCash).toBe(300)
    expect(getServiceCashForRange(logs, new Date('1970-01-01T00:00:00.000Z'), new Date('2100-01-01T00:00:00.000Z')).lifetimeCash).toBe(500)
  })

  it('TEST 3 — legacy scalar collected is unknown-date cash', () => {
    const logs = [serviceLog({ collected: 500 })]
    const range = getServiceCashForRange(logs, new Date('2026-06-05T00:00:00.000Z'), new Date('2026-06-06T00:00:00.000Z'))

    expect(range.knownDatedCash).toBe(0)
    expect(range.unknownDateCash).toBe(500)
    expect(range.lifetimeCash).toBe(500)
  })

  it('TEST 4 — legacy baseline with null receivedAt is unknown-date cash', () => {
    const logs = [
      serviceLog({
        collected: 500,
        payments: [paymentEvent({ id: 'base', amount: 500, receivedAt: null, kind: 'legacy_baseline' })],
      }),
    ]
    const range = getServiceCashForRange(logs, new Date('2026-06-05T00:00:00.000Z'), new Date('2026-06-06T00:00:00.000Z'))

    expect(range.knownDatedCash).toBe(0)
    expect(range.unknownDateCash).toBe(500)
    expect(range.lifetimeCash).toBe(500)
  })

  it('TEST 5 — does not double count scalar collected plus payments[]', () => {
    const logs = [
      serviceLog({
        collected: 500,
        payments: [
          paymentEvent({ id: 'p1', amount: 200, receivedAt: '2026-06-01' }),
          paymentEvent({ id: 'p2', amount: 300, receivedAt: '2026-08-12' }),
        ],
      }),
    ]
    const allTime = getServiceCashForRange(logs, new Date('1970-01-01T00:00:00.000Z'), new Date('2100-01-01T00:00:00.000Z'))

    expect(allTime.lifetimeCash).toBe(500)
    expect(allTime.unknownDateCash).toBe(0)
  })

  it('TEST 6 — future refund shape subtracts in its own period', () => {
    const logs = [
      serviceLog({
        collected: 400,
        payments: [
          paymentEvent({ id: 'p1', amount: 500, receivedAt: '2026-08-12' }),
          paymentEvent({ id: 'p2', amount: -100, receivedAt: '2026-09-01', kind: 'refund' }),
        ],
      }),
    ]

    const aug = getServiceCashForRange(logs, AUG_12_WEEK_START, AUG_12_WEEK_END)
    const sep = getServiceCashForRange(logs, new Date('2026-08-31T00:00:00.000Z'), new Date('2026-09-07T00:00:00.000Z'))
    const allTime = getServiceCashForRange(logs, new Date('1970-01-01T00:00:00.000Z'), new Date('2100-01-01T00:00:00.000Z'))

    expect(aug.knownDatedCash).toBe(500)
    expect(sep.knownDatedCash).toBe(-100)
    expect(allTime.lifetimeCash).toBe(400)
  })

  it('TEST 7 — voided events contribute nothing', () => {
    const logs = [
      serviceLog({
        collected: 500,
        payments: [
          paymentEvent({ id: 'p1', amount: 500, receivedAt: '2026-08-12' }),
          paymentEvent({ id: 'p2', amount: 200, receivedAt: '2026-08-12', voidedAt: '2026-08-13T00:00:00.000Z' }),
        ],
      }),
    ]
    const range = getServiceCashForRange(logs, AUG_12_WEEK_START, AUG_12_WEEK_END)

    expect(range.knownDatedCash).toBe(500)
    expect(range.lifetimeCash).toBe(500)
  })

  it('TEST 8 — Daily Target counts a payment on its received date, not its service date', () => {
    const today = new Date('2026-08-12T12:00:00.000Z')
    const source = backup({
      serviceLogs: [
        serviceLog({
          date: '2026-06-05',
          collected: 500,
          payments: [paymentEvent({ id: 'p1', amount: 500, receivedAt: '2026-08-12' })],
        }),
      ],
    })

    const truth = buildBusinessGoalTruth(source, today)
    expect(truth.dailyTarget.serviceCollected).toBe(500)
    expect(truth.dailyTarget.actualCollected).toBe(500)

    // The same payment contributes zero to the original service day.
    const june5Truth = buildBusinessGoalTruth(source, new Date('2026-06-05T12:00:00.000Z'))
    expect(june5Truth.dailyTarget.serviceCollected).toBe(0)
  })

  it('TEST 9 — Weekly / 52-Week rolls payments into their received weeks', () => {
    const source = backup({
      serviceLogs: [
        serviceLog({
          date: '2026-05-01',
          collected: 500,
          payments: [
            paymentEvent({ id: 'p1', amount: 200, receivedAt: '2026-06-05' }),
            paymentEvent({ id: 'p2', amount: 300, receivedAt: '2026-08-12' }),
          ],
        }),
      ],
    })

    const may = calculateWeeklyFinancialsForRange(source, MONDAY_WEEK_START, MONDAY_WEEK_END)
    const june = calculateWeeklyFinancialsForRange(source, JUNE_5_WEEK_START, JUNE_5_WEEK_END)
    const aug = calculateWeeklyFinancialsForRange(source, AUG_12_WEEK_START, AUG_12_WEEK_END)

    expect(may.svc).toBe(0)
    expect(june.svc).toBe(200)
    expect(aug.svc).toBe(300)
    expect(getKPIs(source).paid).toBe(500)
  })

  it('TEST 10 — STOCK metrics are unchanged', () => {
    const source = backup({
      projects: [activeProject()],
      serviceLogs: [
        serviceLog({
          id: 'pending-svc',
          serviceLogId: 'pending-svc',
          collected: 0,
          quoted: 425,
          payments: [],
        }),
      ],
    })

    const values = calculateWeeklyFinancialsForRange(
      source,
      new Date('2026-08-03T00:00:00.000Z'),
      new Date('2026-08-10T00:00:00.000Z'),
    )

    expect(values.unbilled).toBe(400)
    expect(values.pendingInv).toBe(425)
  })

  it('TEST 11 — Header Paid / lifetime canonical collected stays all-time', () => {
    const source = backup({
      serviceLogs: [
        serviceLog({
          collected: 500,
          payments: [paymentEvent({ id: 'p1', amount: 500, receivedAt: '2026-08-12' })],
        }),
      ],
    })

    expect(getKPIs(source).paid).toBe(500)
    expect(getKPIs(source).paid).toBe(source.serviceLogs[0].collected)
  })

  it('TEST 12 — Project cash retention from FORENSIC-KPI-2A is unchanged', () => {
    const source = backup({
      projects: [
        activeProject({ id: 'active', contract: 4_000, billed: 1_000 }),
        activeProject({ id: 'archived', contract: 10_000, billed: 0, archived: true, archivedAt: '2026-08-05T00:00:00.000Z' }),
      ],
      logs: [
        { id: 'active-payment', projId: 'active', date: '2026-08-04', collected: 1_000 },
        { id: 'archived-payment', projId: 'archived', date: '2026-08-04', collected: 6_700 },
      ],
    })

    const activeWeek = calculateWeeklyFinancialsForRange(
      source,
      new Date('2026-08-03T00:00:00.000Z'),
      new Date('2026-08-10T00:00:00.000Z'),
    )

    expect(activeWeek.proj).toBe(7_700)
    expect(activeWeek.unbilled).toBe(3_000)

    const archivedOnly = backup({
      projects: [activeProject({ id: 'archived', contract: 10_000, billed: 0, archived: true, archivedAt: '2026-08-05T00:00:00.000Z' })],
      logs: [{ id: 'archived-payment', projId: 'archived', date: '2026-08-04', collected: 6_700 }],
    })
    const archivedWeek = calculateWeeklyFinancialsForRange(
      archivedOnly,
      new Date('2026-08-03T00:00:00.000Z'),
      new Date('2026-08-10T00:00:00.000Z'),
    )

    expect(archivedWeek.proj).toBe(6_700)
    expect(archivedWeek.unbilled).toBe(0)
  })
})
