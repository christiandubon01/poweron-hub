import { beforeEach, describe, expect, it, vi } from 'vitest'

let mockBackup: any = null

vi.mock('@/services/backupDataService', () => ({
  getBackupData: () => mockBackup,
  num: (value: unknown) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  },
  daysSince: () => 0,
}))

import { getFinancialHealth } from '../BadDecisionDetector'

describe('COST-TRUTH-2B BadDecisionDetector', () => {
  beforeEach(() => {
    mockBackup = {
      settings: {
        personalIncomeGoal: 120_000,
        salaryTarget: 480_000,
        overhead: {
          essential: [{ monthly: 1_000 }],
          extra: [{ monthly: 250 }],
          loans: [{ monthly: 500 }],
          vehicle: [{ monthly: 750 }],
        },
      },
      serviceLogs: [],
      projects: [],
    }
  })

  it('uses Personal Income Goal for owner-compensation burn instead of salaryTarget', () => {
    expect(getFinancialHealth().monthlyBurnRate).toBe(12_500)
  })

  it('keeps legacy salaryTarget readable without making it active burn authority', () => {
    mockBackup.settings.personalIncomeGoal = 0
    mockBackup.settings.salaryTarget = 999_999

    expect(getFinancialHealth().monthlyBurnRate).toBe(2_500)
  })
})
