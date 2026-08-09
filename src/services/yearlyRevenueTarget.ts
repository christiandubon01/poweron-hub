export interface YearlyRevenueTargetProgress {
  actual: number
  target: number | null
  progressRaw: number | null
  progressPct: number | null
  fillPct: number
  configured: boolean
}

function normalizeAmount(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function calculateYearlyRevenueTargetProgress(
  actualInput: unknown,
  targetInput: unknown,
): YearlyRevenueTargetProgress {
  const actual = normalizeAmount(actualInput)
  const parsedTarget = Number(targetInput)
  const target = Number.isFinite(parsedTarget) && parsedTarget > 0
    ? parsedTarget
    : null

  if (target === null) {
    return {
      actual,
      target: null,
      progressRaw: null,
      progressPct: null,
      fillPct: 0,
      configured: false,
    }
  }

  const progressRaw = actual / target
  const progressPct = Math.round(progressRaw * 100)

  return {
    actual,
    target,
    progressRaw,
    progressPct,
    fillPct: Math.max(0, Math.min(100, progressPct)),
    configured: true,
  }
}
