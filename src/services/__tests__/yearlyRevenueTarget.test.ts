import { describe, expect, it } from 'vitest'
import { calculateYearlyRevenueTargetProgress } from '../yearlyRevenueTarget'

describe('COST-TRUTH-2B yearly revenue target progress', () => {
  it('keeps the yearly bar numerator identical to the resolved Paid KPI value', () => {
    const progress = calculateYearlyRevenueTargetProgress(69_700, 75_000)

    expect(progress).toMatchObject({
      actual: 69_700,
      target: 75_000,
      progressPct: 93,
      fillPct: 93,
      configured: true,
    })
    expect(progress.progressRaw).toBeCloseTo(69_700 / 75_000, 6)
  })

  it('preserves true percentage text above 100 while clamping fill to the bar width', () => {
    const progress = calculateYearlyRevenueTargetProgress(120_000, 100_000)

    expect(progress.progressPct).toBe(120)
    expect(progress.fillPct).toBe(100)
  })

  it('falls back to the safe not-configured state when the yearly target is zero or missing', () => {
    expect(calculateYearlyRevenueTargetProgress(10_000, 0)).toEqual({
      actual: 10_000,
      target: null,
      progressRaw: null,
      progressPct: null,
      fillPct: 0,
      configured: false,
    })
  })
})
