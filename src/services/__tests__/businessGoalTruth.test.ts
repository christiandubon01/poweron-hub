import { describe, expect, it } from 'vitest'
import { buildBusinessGoalTruth } from '../businessGoalTruth'

function backup(extra: Record<string, any> = {}): any {
  return {
    projects: [],
    logs: [],
    serviceLogs: [],
    weeklyData: [],
    activeServiceCalls: [],
    settings: {
      personalIncomeGoal: 120_000,
      salaryTarget: 240_000,
      annualTarget: 999_999,
      dayTarget: 500,
      overheadPct: 55,
      defaultOHRate: 99,
      billableHrsYear: 1_000,
      overhead: {
        essential: [{ id: 'rent', monthly: 1_000 }],
        extra: [],
        loans: [{ id: 'truck-loan', monthly: 250 }],
        vehicle: [],
      },
    },
    ...extra,
  }
}

describe('COST-TRUTH-2B business goal truth', () => {
  it('derives annual overhead, trailing revenue, and the daily target snapshot from canonical collected cash', () => {
    const source = backup({
      projects: [
        { id: 'project-live', status: 'active', contract: 5_000, billed: 3_000, paid: 999_999 },
        { id: 'project-archived', status: 'active', archived: true, contract: 20_000, billed: 20_000, paid: 20_000 },
      ],
      logs: [
        { id: 'project-payment-live-earlier', projId: 'project-live', date: '2026-08-08', collected: 2_000 },
        { id: 'project-payment-live-today', projId: 'project-live', date: '2026-08-09', collected: 200, paymentsCollected: 200 },
        { id: 'project-payment-archived', projId: 'project-archived', date: '2026-08-09', collected: 900 },
      ],
      serviceLogs: [
        { id: 'service-live-earlier', date: '2026-07-15', quoted: 500, collected: 300 },
        { id: 'service-live-today', date: '2026-08-09', quoted: 250, collected: 150 },
        { id: 'service-deleted-today', date: '2026-08-09', quoted: 700, collected: 700, deletedAt: '2026-08-09T18:00:00.000Z' },
      ],
    })

    const truth = buildBusinessGoalTruth(source, new Date('2026-08-09T12:00:00.000Z'))

    expect(truth.personalIncomeGoal).toEqual({ configured: true, value: 120_000 })
    expect(truth.annualCompanyOverhead).toEqual({ available: true, value: 15_000 })
    expect(truth.trailingCollectedRevenue).toMatchObject({
      available: true,
      value: 2_650,
      start: '2026-05-12',
      endExclusive: '2026-08-10',
      days: 90,
    })
    expect(truth.dailyTarget).toEqual({
      day: '2026-08-09',
      targetConfigured: true,
      targetValue: 500,
      actualCollected: 350,
      projectCollected: 200,
      serviceCollected: 150,
      difference: -150,
      progressPct: 70,
    })
    expect(truth.grossMarginStatus).toBe('unavailable')
    expect(truth.grossMargin.available).toBe(false)
    expect(truth.requiredAnnualRevenue.available).toBe(false)
    expect(truth.requiredMonthlyRevenue.available).toBe(false)
    expect(truth.requiredDailyRevenue.available).toBe(false)
    expect(truth.status).toBe('insufficient_actual_cost_data')
    expect(truth.overheadIncludesDebtCategories).toBe(true)
  })

  it('does not let overheadPct, annualTarget, salaryTarget, or defaultOHRate become canonical authority', () => {
    const first = buildBusinessGoalTruth(backup(), new Date('2026-08-09T12:00:00.000Z'))
    const second = buildBusinessGoalTruth(
      backup({
        settings: {
          personalIncomeGoal: 120_000,
          salaryTarget: 1,
          annualTarget: 1,
          dayTarget: 9_999,
          overheadPct: 5,
          defaultOHRate: 0,
          billableHrsYear: 1_000,
          overhead: {
            essential: [{ id: 'rent', monthly: 1_000 }],
            extra: [],
            loans: [{ id: 'truck-loan', monthly: 250 }],
            vehicle: [],
          },
        },
      }),
      new Date('2026-08-09T12:00:00.000Z'),
    )

    expect(first.annualCompanyOverhead).toEqual(second.annualCompanyOverhead)
    expect(first.trailingCollectedRevenue).toEqual(second.trailingCollectedRevenue)
    expect(first.requiredAnnualRevenue).toEqual(second.requiredAnnualRevenue)
    expect(first.requiredMonthlyRevenue).toEqual(second.requiredMonthlyRevenue)
    expect(first.requiredDailyRevenue).toEqual(second.requiredDailyRevenue)
    expect(first.status).toBe('insufficient_actual_cost_data')
    expect(second.status).toBe('insufficient_actual_cost_data')
  })

  it('keeps the daily target comparison safe when target is zero or missing', () => {
    const truth = buildBusinessGoalTruth(
      backup({
        logs: [{ id: 'today-project', projId: 'project-live', date: '2026-08-09', collected: 25 }],
        settings: {
          personalIncomeGoal: 120_000,
          dayTarget: 0,
          billableHrsYear: 1_000,
          overhead: { essential: [{ monthly: 100 }], extra: [], loans: [], vehicle: [] },
        },
      }),
      new Date('2026-08-09T12:00:00.000Z'),
    )

    expect(truth.dailyTarget).toMatchObject({
      day: '2026-08-09',
      targetConfigured: false,
      targetValue: null,
      actualCollected: 25,
      projectCollected: 25,
      serviceCollected: 0,
      difference: null,
      progressPct: null,
    })
  })

  it('blocks with a missing personal income goal instead of inventing a required-revenue target', () => {
    const truth = buildBusinessGoalTruth(
      backup({
        settings: {
          personalIncomeGoal: 0,
          dayTarget: 0,
          billableHrsYear: 1_000,
          overhead: { essential: [{ monthly: 100 }], extra: [], loans: [], vehicle: [] },
        },
      }),
      new Date('2026-08-09T12:00:00.000Z'),
    )

    expect(truth.personalIncomeGoal).toEqual({ configured: false, value: 0 })
    expect(truth.status).toBe('missing_personal_income_goal')
    expect(truth.requiredAnnualRevenue.available).toBe(false)
    expect(truth.requiredMonthlyRevenue.available).toBe(false)
    expect(truth.requiredDailyRevenue.available).toBe(false)
  })
})
