// @ts-nocheck
/**
 * Margin Analyzer — Advanced margin performance analysis and insights.
 *
 * Functions:
 * - analyzeEstimateMargin: Compare estimated margin vs actual from project_cost_summary
 * - generateMarginInsights: Return actionable insight strings
 */

import { supabase } from '@/lib/supabase'

// ── Types ───────────────────────────────────────────────────────────────────

export interface MarginData {
  estimatedMargin: number
  actualMargin: number
  estimatedTotal: number
  actualTotal: number
  estimatedCost: number
  actualCost: number
}

export interface MarginInsight {
  type: 'favorable' | 'warning' | 'critical' | 'neutral'
  message: string
  actionable: boolean
  suggestedAction?: string
}

// ── Main Analysis Function ──────────────────────────────────────────────────

/**
 * Analyze an estimate's margin performance against actual project costs.
 * Returns detailed margin metrics and insights.
 */
export async function analyzeEstimateMargin(
  estimateId: string,
  orgId: string
): Promise<{
  data: MarginData | null
  insights: MarginInsight[]
  summary: string
}> {
  try {
    // Fetch estimate
    const { data: estimate, error: estErr } = await supabase
      .from('estimates')
      .select('*')
      .eq('id', estimateId)
      .eq('org_id', orgId)
      .single()

    if (estErr || !estimate) {
      return {
        data: null,
        insights: [
          {
            type: 'critical',
            message: 'Estimate not found',
            actionable: false,
          },
        ],
        summary: 'Unable to load estimate data',
      }
    }

    // If no project linked, provide estimate-only analysis
    if (!estimate.project_id) {
      const insights = generateEstimateOnlyInsights(estimate)
      return {
        data: {
          estimatedMargin: estimate.margin_pct ?? 0,
          actualMargin: 0,
          estimatedTotal: estimate.total ?? 0,
          actualTotal: 0,
          estimatedCost: estimate.subtotal ? (estimate.subtotal / (1 + 0.0825)) * 0.75 : 0,
          actualCost: 0,
        },
        insights,
        summary: 'Estimate created but not yet linked to a project',
      }
    }

    // Fetch project cost summary
    const { data: costSummary, error: costErr } = await supabase
      .from('project_cost_summary' as never)
      .select('*')
      .eq('project_id', estimate.project_id)
      .single()

    if (costErr || !costSummary) {
      const insights = generateEstimateOnlyInsights(estimate)
      return {
        data: null,
        insights,
        summary: 'No cost data available yet for this project',
      }
    }

    const cs = costSummary as any
    const marginData: MarginData = {
      estimatedMargin: estimate.margin_pct ?? 0,
      actualMargin: cs.actual_margin_pct ?? 0,
      estimatedTotal: estimate.total ?? 0,
      actualTotal: cs.actual_revenue ?? 0,
      estimatedCost: estimate.subtotal ? (estimate.subtotal / (1 + 0.0825)) * 0.75 : 0,
      actualCost: cs.actual_cost ?? 0,
    }

    const insights = generateMarginInsights(marginData)
    const summary = buildSummary(marginData, insights)

    return {
      data: marginData,
      insights,
      summary,
    }
  } catch (err) {
    console.warn('[MarginAnalyzer] Analysis error:', err)
    return {
      data: null,
      insights: [
        {
          type: 'critical',
          message: `Analysis failed: ${String(err).slice(0, 100)}`,
          actionable: false,
        },
      ],
      summary: 'Unable to complete analysis',
    }
  }
}

// ── Insight Generation ──────────────────────────────────────────────────────

/**
 * Generate margin insights from margin data.
 * Compares estimated vs actual across multiple dimensions.
 */
export function generateMarginInsights(data: MarginData): MarginInsight[] {
  const insights: MarginInsight[] = []
  const variance = data.actualMargin - data.estimatedMargin

  // Overall margin variance
  if (variance > 5) {
    insights.push({
      type: 'favorable',
      message: `Excellent margin performance: +${variance.toFixed(1)}% better than estimated`,
      actionable: true,
      suggestedAction: 'Review what drove the outperformance (labor efficiency, lower waste, better pricing) and apply to similar projects',
    })
  } else if (variance > 0) {
    insights.push({
      type: 'favorable',
      message: `Margin beat estimate by ${variance.toFixed(1)}%`,
      actionable: true,
      suggestedAction: 'Identify efficiency gains to replicate on future bids',
    })
  } else if (variance > -5) {
    insights.push({
      type: 'neutral',
      message: `Margin slightly under estimate by ${Math.abs(variance).toFixed(1)}%`,
      actionable: false,
    })
  } else if (variance > -10) {
    insights.push({
      type: 'warning',
      message: `Margin underperformance: ${Math.abs(variance).toFixed(1)}% below estimate`,
      actionable: true,
      suggestedAction: 'Review labor hours and material costs to identify variances',
    })
  } else {
    insights.push({
      type: 'critical',
      message: `Significant margin erosion: ${Math.abs(variance).toFixed(1)}% shortfall vs estimate`,
      actionable: true,
      suggestedAction: 'Conduct full cost review and adjust future estimates or labor processes',
    })
  }

  // Revenue analysis
  const revenueDelta = data.actualTotal - data.estimatedTotal
  const revenueVariancePercent = (revenueDelta / data.estimatedTotal) * 100

  if (Math.abs(revenueVariancePercent) > 15) {
    insights.push({
      type: 'warning',
      message: `Revenue variance: ${revenueVariancePercent > 0 ? '+' : ''}${revenueVariancePercent.toFixed(1)}% from estimate`,
      actionable: true,
      suggestedAction: 'Scope changes or change orders may explain variance — review project modifications',
    })
  }

  // Cost analysis
  const costDelta = data.actualCost - data.estimatedCost
  const costVariancePercent = (costDelta / data.estimatedCost) * 100

  if (costVariancePercent > 10) {
    insights.push({
      type: 'warning',
      message: `Materials or labor cost overrun: +${costVariancePercent.toFixed(1)}% vs estimate`,
      actionable: true,
      suggestedAction: 'Review material waste and labor hours — tighten estimation for similar work types',
    })
  } else if (costVariancePercent < -10) {
    insights.push({
      type: 'favorable',
      message: `Cost efficiency: ${Math.abs(costVariancePercent).toFixed(1)}% under budget`,
      actionable: true,
      suggestedAction: 'Document the efficiency gains and incorporate into standardized pricing',
    })
  }

  // Margin threshold checks
  if (data.actualMargin < 20) {
    insights.push({
      type: 'critical',
      message: `Dangerously low margin: ${data.actualMargin.toFixed(1)}% (threshold: 30%)`,
      actionable: true,
      suggestedAction: 'This project is barely profitable — review pricing strategy and project staffing',
    })
  } else if (data.actualMargin < 30) {
    insights.push({
      type: 'warning',
      message: `Below target margin: ${data.actualMargin.toFixed(1)}% (target: 40%+)`,
      actionable: true,
      suggestedAction: 'Identify cost drivers and consider price increases for future similar work',
    })
  }

  return insights
}

/**
 * Generate insights for estimates without project cost data yet.
 */
function generateEstimateOnlyInsights(estimate: any): MarginInsight[] {
  const insights: MarginInsight[] = []

  const marginPct = estimate.margin_pct ?? 0

  if (marginPct < 30) {
    insights.push({
      type: 'warning',
      message: `Estimated margin is low: ${marginPct.toFixed(1)}% (recommend 40%+)`,
      actionable: true,
      suggestedAction: 'Consider increasing bid amount or reducing estimated costs',
    })
  } else if (marginPct > 60) {
    insights.push({
      type: 'warning',
      message: `Estimated margin is high: ${marginPct.toFixed(1)}% (typically 40-50%)`,
      actionable: true,
      suggestedAction: 'May signal underestimated costs or pricing too aggressive for market',
    })
  } else {
    insights.push({
      type: 'favorable',
      message: `Estimated margin is healthy: ${marginPct.toFixed(1)}%`,
      actionable: false,
    })
  }

  if (estimate.valid_until) {
    const daysUntilExpiry = Math.floor(
      (new Date(estimate.valid_until).getTime() - Date.now()) / (86400 * 1000)
    )
    if (daysUntilExpiry < 7) {
      insights.push({
        type: 'warning',
        message: `Estimate expires in ${daysUntilExpiry} days`,
        actionable: true,
        suggestedAction: 'Follow up with client or refresh estimate before expiration',
      })
    }
  }

  return insights
}

/**
 * Build a human-readable summary of the analysis.
 */
function buildSummary(data: MarginData, insights: MarginInsight[]): string {
  const variance = data.actualMargin - data.estimatedMargin
  const status = insights[0]?.type || 'neutral'

  if (data.actualTotal === 0) {
    return `Estimate created with ${data.estimatedMargin.toFixed(1)}% target margin on $${data.estimatedTotal.toFixed(2)} bid. Awaiting project completion for actual performance.`
  }

  const performanceText =
    variance > 0
      ? `outperformed by ${variance.toFixed(1)}%`
      : variance < 0
        ? `underperformed by ${Math.abs(variance).toFixed(1)}%`
        : `on-target'`

  return `Project margin ${performanceText} (estimated ${data.estimatedMargin.toFixed(1)}% → actual ${data.actualMargin.toFixed(1)}%). Status: ${status}.`
}

// ── Batch Analysis Helper ────────────────────────────────────────────────────

/**
 * Analyze multiple estimates and return aggregate insights.
 * Useful for dashboard summaries of margin performance.
 */
export async function analyzeBatchMargins(
  estimateIds: string[],
  orgId: string
): Promise<{
  totalEstimates: number
  averageEstimatedMargin: number
  averageActualMargin: number
  overperforming: number
  underperforming: number
  insights: MarginInsight[]
}> {
  const results = await Promise.all(
    estimateIds.map(id => analyzeEstimateMargin(id, orgId))
  )

  const validData = results
    .map(r => r.data)
    .filter((d): d is MarginData => d !== null)

  if (validData.length === 0) {
    return {
      totalEstimates: estimateIds.length,
      averageEstimatedMargin: 0,
      averageActualMargin: 0,
      overperforming: 0,
      underperforming: 0,
      insights: [
        {
          type: 'neutral',
          message: 'No completed projects with margin data available',
          actionable: false,
        },
      ],
    }
  }

  const avgEstimated =
    validData.reduce((sum, d) => sum + d.estimatedMargin, 0) / validData.length
  const avgActual =
    validData.reduce((sum, d) => sum + d.actualMargin, 0) / validData.length

  const overperforming = validData.filter(
    d => d.actualMargin - d.estimatedMargin > 2
  ).length
  const underperforming = validData.filter(
    d => d.actualMargin - d.estimatedMargin < -5
  ).length

  const insights: MarginInsight[] = []

  if (avgActual < avgEstimated - 5) {
    insights.push({
      type: 'warning',
      message: `Portfolio margin trending down: actual ${avgActual.toFixed(1)}% vs estimated ${avgEstimated.toFixed(1)}%`,
      actionable: true,
      suggestedAction: 'Review estimation assumptions and labor productivity across projects',
    })
  } else if (avgActual > avgEstimated + 3) {
    insights.push({
      type: 'favorable',
      message: `Portfolio margin outperforming: actual ${avgActual.toFixed(1)}% vs estimated ${avgEstimated.toFixed(1)}%`,
      actionable: true,
      suggestedAction: 'Document what\'s working and update your estimation models',
    })
  }

  if (underperforming > validData.length * 0.3) {
    insights.push({
      type: 'warning',
      message: `${underperforming} of ${validData.length} projects underperforming on margin`,
      actionable: true,
      suggestedAction: 'Conduct portfolio review to identify systemic estimation or execution gaps',
    })
  }

  return {
    totalEstimates: estimateIds.length,
    averageEstimatedMargin: avgEstimated,
    averageActualMargin: avgActual,
    overperforming,
    underperforming,
    insights,
  }
}
