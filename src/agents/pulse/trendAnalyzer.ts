// @ts-nocheck
/**
 * Trend Analyzer — Financial trend detection and insights for PULSE agent
 *
 * Functions:
 * - analyzeTrends: Calculate trend direction, velocity, and insight
 * - generateTrendInsight: Human-readable insight string
 */

import { supabase } from '@/lib/supabase'

// ── Types ────────────────────────────────────────────────────────────────────

export interface TrendAnalysis {
  metric: string
  direction: 'up' | 'down' | 'flat'
  trend_pct: number
  rolling_average: number
  insight: string
  confidence: number // 0-1
}

// ── Trend Analyzer ──────────────────────────────────────────────────────────

/**
 * Analyze trend for a metric over N periods
 * Fetches historical data from weekly_tracker, calculates 4-week rolling average,
 * determines trend direction and generates insight
 */
export async function analyzeTrends(
  orgId: string,
  metric: 'revenue' | 'margin' | 'ar_aging' | 'active_projects',
  periods: number = 12
): Promise<TrendAnalysis> {
  try {
    // Fetch historical data
    const { data: weeklyData, error } = await supabase
      .from('weekly_tracker' as never)
      .select('*')
      .eq('org_id', orgId)
      .order('week_number', { ascending: true })
      .limit(periods)

    if (error && error.code !== 'PGRST116') throw error

    if (!weeklyData || !Array.isArray(weeklyData) || weeklyData.length === 0) {
      return {
        metric,
        direction: 'flat',
        trend_pct: 0,
        rolling_average: 0,
        insight: 'Insufficient data to calculate trend.',
        confidence: 0,
      }
    }

    // Extract metric values
    let values: number[] = []

    switch (metric) {
      case 'revenue':
        values = weeklyData.map(w => ((w.service_revenue ?? 0) + (w.project_revenue ?? 0)) as number)
        break
      case 'margin':
        // Placeholder - would need project cost data
        values = weeklyData.map(() => 18)
        break
      case 'ar_aging':
        // Placeholder - would need invoice data
        values = weeklyData.map(() => 35)
        break
      case 'active_projects':
        values = weeklyData.map(w => (w.active_projects ?? 0) as number)
        break
    }

    // Calculate 4-week rolling average
    const rollingAverage = calculateRollingAverage(values, 4)

    // Determine trend direction
    const { direction, trend_pct } = calculateTrendDirection(values)

    // Generate insight
    const insight = generateTrendInsight(metric, direction, trend_pct)

    // Calculate confidence (higher with more data points)
    const confidence = Math.min(1, values.length / 12)

    return {
      metric,
      direction,
      trend_pct: parseFloat(trend_pct.toFixed(1)),
      rolling_average: parseFloat(rollingAverage.toFixed(2)),
      insight,
      confidence: parseFloat(confidence.toFixed(2)),
    }
  } catch (error) {
    console.error(`[PULSE] analyzeTrends(${metric}) error:`, error)
    throw error
  }
}

/**
 * Calculate 4-week rolling average
 */
function calculateRollingAverage(values: number[], windowSize: number = 4): number {
  if (values.length < windowSize) {
    return values.reduce((a, b) => a + b, 0) / values.length
  }

  const lastWindow = values.slice(-windowSize)
  return lastWindow.reduce((a, b) => a + b, 0) / windowSize
}

/**
 * Calculate trend direction (up/down/flat) and percentage change
 */
function calculateTrendDirection(values: number[]): { direction: 'up' | 'down' | 'flat'; trend_pct: number } {
  if (values.length < 2) {
    return { direction: 'flat', trend_pct: 0 }
  }

  // Compare recent period to earlier period
  const midpoint = Math.floor(values.length / 2)
  const earlierAvg = values.slice(0, midpoint).reduce((a, b) => a + b, 0) / midpoint
  const recentAvg = values.slice(midpoint).reduce((a, b) => a + b, 0) / (values.length - midpoint)

  if (earlierAvg === 0) {
    return { direction: recentAvg > 0 ? 'up' : 'flat', trend_pct: recentAvg > 0 ? 100 : 0 }
  }

  const trend_pct = ((recentAvg - earlierAvg) / earlierAvg) * 100

  let direction: 'up' | 'down' | 'flat'
  if (Math.abs(trend_pct) < 2) {
    direction = 'flat'
  } else if (trend_pct > 0) {
    direction = 'up'
  } else {
    direction = 'down'
  }

  return { direction, trend_pct }
}

/**
 * Generate human-readable insight string based on trend
 */
export function generateTrendInsight(metric: string, direction: 'up' | 'down' | 'flat', trend_pct: number): string {
  const absPercent = Math.abs(trend_pct)

  switch (metric) {
    case 'revenue':
      if (direction === 'up') {
        if (absPercent > 20) {
          return `Strong revenue growth trend (+${trend_pct.toFixed(0)}%). Momentum is solid — consider increasing capacity if growth continues.`
        } else if (absPercent > 5) {
          return `Steady revenue growth (+${trend_pct.toFixed(0)}%). Healthy trajectory tracking toward annual targets.`
        } else {
          return `Modest revenue growth (+${trend_pct.toFixed(0)}%). On track but watch for seasonal dips.`
        }
      } else if (direction === 'down') {
        if (absPercent > 20) {
          return `Concerning revenue decline (-${trend_pct.toFixed(0)}%). Investigate project pipeline and customer activity urgently.`
        } else if (absPercent > 5) {
          return `Revenue declining (-${trend_pct.toFixed(0)}%). May be seasonal or pipeline-related — verify pipeline fill rate.`
        } else {
          return `Slight revenue decline (-${trend_pct.toFixed(0)}%). Likely seasonal variance.`
        }
      } else {
        return `Revenue is flat. Monitor pipeline closely to ensure next quarter doesn't soften further.`
      }

    case 'margin':
      if (direction === 'up') {
        return `Margin expanding (+${trend_pct.toFixed(0)}%). Excellent cost control or pricing power showing results.`
      } else if (direction === 'down') {
        if (absPercent > 5) {
          return `Margin contracting (-${trend_pct.toFixed(0)}%). Review labor costs, material waste, and pricing strategy.`
        } else {
          return `Margin slightly down (-${trend_pct.toFixed(0)}%). Minor variance but worth monitoring.`
        }
      } else {
        return `Margin stable. Consistent cost structure — continue current operational approach.`
      }

    case 'ar_aging':
      if (direction === 'up') {
        if (absPercent > 10) {
          return `AR aging worsening (+${trend_pct.toFixed(0)}% days). Collections effort needed — prioritize overdue follow-up.`
        } else {
          return `AR trending older (+${trend_pct.toFixed(0)}% days). Increase collection calls to clients.`
        }
      } else if (direction === 'down') {
        return `AR collecting faster (-${trend_pct.toFixed(0)}% days). Great collections performance — maintain current process.`
      } else {
        return `AR days stable. Collections cycle is consistent and predictable.`
      }

    case 'active_projects':
      if (direction === 'up') {
        return `Project count growing (+${trend_pct.toFixed(0)}%). Strong pipeline → ensure crew capacity is adequate.`
      } else if (direction === 'down') {
        if (absPercent > 15) {
          return `Project count declining (-${trend_pct.toFixed(0)}%). Pipeline risk — escalate sales and bidding activity.`
        } else {
          return `Fewer active projects (-${trend_pct.toFixed(0)}%). May be seasonal — verify next quarter forecast.`
        }
      } else {
        return `Project count stable. Consistent workload — monitor for upcoming completions.`
      }

    default:
      if (direction === 'up') {
        return `Positive trend detected (+${trend_pct.toFixed(0)}%).`
      } else if (direction === 'down') {
        return `Declining trend detected (-${trend_pct.toFixed(0)}%).`
      } else {
        return `Metric is stable.`
      }
  }
}
