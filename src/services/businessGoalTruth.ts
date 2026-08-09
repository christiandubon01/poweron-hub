import { num, type BackupData } from '@/services/backupDataService'
import { calculateOverheadMetrics } from '@/utils/costSourceHelper'
import { calculateDailyFinancialsForDate, calculateWeeklyFinancialsForRange } from '@/services/weeklyFinancialPolicy'

export type GoalTruthStatus =
  | 'missing_personal_income_goal'
  | 'missing_overhead_configuration'
  | 'insufficient_actual_cost_data'

export interface GoalTruthAmount {
  available: true
  value: number
}

export interface GoalTruthUnavailable {
  available: false
  value: null
  reason: string
}

export type GoalTruthMetric = GoalTruthAmount | GoalTruthUnavailable

export interface BusinessGoalTruth {
  status: GoalTruthStatus
  statusLabel: string
  blockingReasons: string[]
  personalIncomeGoal: {
    configured: boolean
    value: number | null
  }
  annualCompanyOverhead: GoalTruthMetric
  trailingCollectedRevenue: GoalTruthMetric & {
    start: string | null
    endExclusive: string | null
    days: number
  }
  grossMarginStatus: 'unavailable'
  grossMargin: GoalTruthUnavailable
  requiredAnnualRevenue: GoalTruthUnavailable
  requiredMonthlyRevenue: GoalTruthUnavailable
  requiredDailyRevenue: GoalTruthUnavailable
  dailyTarget: {
    day: string
    targetConfigured: boolean
    targetValue: number | null
    actualCollected: number
    projectCollected: number
    serviceCollected: number
    difference: number | null
    progressPct: number | null
  }
  overheadIncludesDebtCategories: boolean
}

const GROSS_MARGIN_BLOCK_REASON =
  'Complete material actuals and reliable historical project labor costs are required before this target can be trusted.'

function available(value: number): GoalTruthAmount {
  return { available: true, value }
}

function unavailable(reason: string): GoalTruthUnavailable {
  return { available: false, value: null, reason }
}

function toIsoDate(date: Date | null): string | null {
  if (!date || Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 10)
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function resolveTrailing90DayWindow(now = new Date()): { start: Date; endExclusive: Date; days: number } {
  const endExclusive = new Date(startOfLocalDay(now))
  endExclusive.setDate(endExclusive.getDate() + 1)
  const start = new Date(endExclusive)
  start.setDate(start.getDate() - 90)
  return { start, endExclusive, days: 90 }
}

export function buildBusinessGoalTruth(backup: BackupData, now = new Date()): BusinessGoalTruth {
  const settings = backup?.settings || {}
  const personalIncomeGoalRaw = settings?.personalIncomeGoal
  const parsedPersonalIncomeGoal = Number(personalIncomeGoalRaw)
  const personalIncomeGoalValue = Number.isFinite(parsedPersonalIncomeGoal)
    ? num(parsedPersonalIncomeGoal)
    : null
  const personalIncomeGoalConfigured = personalIncomeGoalValue !== null && personalIncomeGoalValue > 0

  const hasOverheadConfig = !!settings?.overhead
  const overheadCalc = hasOverheadConfig
    ? calculateOverheadMetrics(settings.overhead as unknown as Record<string, Array<{ monthly?: number }>>, num(settings.billableHrsYear))
    : null
  const annualCompanyOverhead = overheadCalc
    ? available(num(overheadCalc.annualOverhead))
    : unavailable('Configure Overhead Manager to derive annual company overhead.')

  const trailingWindow = resolveTrailing90DayWindow(now)
  const trailingValues = calculateWeeklyFinancialsForRange(backup, trailingWindow.start, trailingWindow.endExclusive)
  const trailingCollectedRevenue = Object.assign(
    available(num(trailingValues.proj) + num(trailingValues.svc)),
    {
      start: toIsoDate(trailingWindow.start),
      endExclusive: toIsoDate(trailingWindow.endExclusive),
      days: trailingWindow.days,
    },
  )

  const dailyValues = calculateDailyFinancialsForDate(backup, now)
  const configuredDayTarget = Number(settings?.dayTarget)
  const dayTargetValue = Number.isFinite(configuredDayTarget) && configuredDayTarget > 0
    ? num(configuredDayTarget)
    : null
  const dailyActualCollected = num(dailyValues.proj) + num(dailyValues.svc)
  const dailyDifference = dayTargetValue === null
    ? null
    : num(dailyActualCollected - dayTargetValue)
  const dailyProgressPct = dayTargetValue === null || dayTargetValue <= 0
    ? null
    : Math.round((dailyActualCollected / dayTargetValue) * 100)

  const blockingReasons: string[] = []
  let status: GoalTruthStatus = 'insufficient_actual_cost_data'
  let statusLabel = 'Unable to calculate accurately'

  if (!personalIncomeGoalConfigured) {
    status = 'missing_personal_income_goal'
    statusLabel = 'Personal income goal required'
    blockingReasons.push('Add a Personal Income Goal to plan owner compensation.')
  }

  if (!hasOverheadConfig) {
    status = 'missing_overhead_configuration'
    statusLabel = 'Overhead setup required'
    blockingReasons.push('Configure Overhead Manager to derive current annual company overhead.')
  }

  blockingReasons.push(GROSS_MARGIN_BLOCK_REASON)

  return {
    status,
    statusLabel,
    blockingReasons,
    personalIncomeGoal: {
      configured: personalIncomeGoalConfigured,
      value: personalIncomeGoalValue,
    },
    annualCompanyOverhead,
    trailingCollectedRevenue,
    grossMarginStatus: 'unavailable',
    grossMargin: unavailable('Actual material and historical project labor data are incomplete.'),
    requiredAnnualRevenue: unavailable(GROSS_MARGIN_BLOCK_REASON),
    requiredMonthlyRevenue: unavailable(GROSS_MARGIN_BLOCK_REASON),
    requiredDailyRevenue: unavailable(GROSS_MARGIN_BLOCK_REASON),
    dailyTarget: {
      day: dailyValues.dayKey,
      targetConfigured: dayTargetValue !== null,
      targetValue: dayTargetValue,
      actualCollected: dailyActualCollected,
      projectCollected: num(dailyValues.proj),
      serviceCollected: num(dailyValues.svc),
      difference: dailyDifference,
      progressPct: dailyProgressPct,
    },
    overheadIncludesDebtCategories: true,
  }
}
