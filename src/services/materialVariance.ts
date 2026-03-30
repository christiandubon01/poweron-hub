// @ts-nocheck
/**
 * materialVariance.ts — VAULT Material Variance Analysis Engine
 *
 * Compares actual material spend (from material_receipts) against
 * MTO estimates (from material_takeoff_lines) to surface cost overruns
 * and savings by project, phase, and item category.
 *
 * Used by: MaterialVariancePanel.tsx, NEXUS agent routing
 */

import { supabase } from '@/lib/supabase'

// ── Types ────────────────────────────────────────────────────────────────────

export interface PhaseVariance {
  phase: string
  estimated: number
  actual: number
  variance: number       // actual - estimated (negative = under budget)
  variancePct: number    // variance as %
  receiptCount: number
  status: 'under_budget' | 'on_budget' | 'over_budget' | 'no_estimate'
}

export interface ProjectVariance {
  projectId: string
  projectName: string
  phases: PhaseVariance[]
  totalEstimated: number
  totalActual: number
  totalVariance: number
  totalVariancePct: number
  overBudgetPhases: number
}

export interface VarianceSummary {
  projects: ProjectVariance[]
  totalEstimated: number
  totalActual: number
  totalVariance: number
  alerts: VarianceAlert[]
}

export interface VarianceAlert {
  level: 'info' | 'warning' | 'critical'
  message: string
  projectName: string
  phase?: string
  variancePct: number
}

// ── Core: Compute Variance for Org ───────────────────────────────────────────

export async function getOrgVarianceSummary(orgId: string): Promise<VarianceSummary> {
  // 1. Get all material receipts grouped by project + phase
  const { data: receipts, error: rErr } = await supabase
    .from('material_receipts' as never)
    .select('project_id, phase, total, mto_estimated, variance_amount, variance_pct')
    .eq('org_id', orgId)
    .order('receipt_date', { ascending: false })

  if (rErr) {
    console.error('[materialVariance] Receipt fetch failed:', rErr.message)
    return emptyResult()
  }

  // 2. Get project names
  const projectIds = [...new Set((receipts as any[]).map(r => r.project_id).filter(Boolean))]
  const { data: projects } = await supabase
    .from('projects' as never)
    .select('id, name')
    .in('id', projectIds.length > 0 ? projectIds : ['__none__'])

  const projectNameMap = new Map<string, string>()
  for (const p of (projects || []) as any[]) {
    projectNameMap.set(p.id, p.name)
  }

  // 3. Get MTO estimates by project + phase
  const { data: mtoLines } = await supabase
    .from('material_takeoff_lines' as never)
    .select('project_id, phase, line_total')
    .in('project_id', projectIds.length > 0 ? projectIds : ['__none__'])

  const mtoMap = new Map<string, number>() // key: projectId|phase
  for (const line of (mtoLines || []) as any[]) {
    const key = `${line.project_id}|${line.phase}`
    mtoMap.set(key, (mtoMap.get(key) || 0) + (Number(line.line_total) || 0))
  }

  // 4. Aggregate receipts by project + phase
  const aggregated = new Map<string, Map<string, { actual: number; count: number }>>()

  for (const r of (receipts || []) as any[]) {
    const pid = r.project_id || 'unknown'
    const phase = r.phase || 'General'
    if (!aggregated.has(pid)) aggregated.set(pid, new Map())
    const phaseMap = aggregated.get(pid)!
    const existing = phaseMap.get(phase) || { actual: 0, count: 0 }
    existing.actual += Number(r.total) || 0
    existing.count += 1
    phaseMap.set(phase, existing)
  }

  // 5. Build variance per project
  const projectVariances: ProjectVariance[] = []
  let grandEstimated = 0
  let grandActual = 0
  const alerts: VarianceAlert[] = []

  for (const [pid, phaseMap] of aggregated) {
    const phases: PhaseVariance[] = []
    let projEstimated = 0
    let projActual = 0
    let overCount = 0

    // Include all phases that have either receipts or MTO estimates
    const allPhases = new Set<string>([...phaseMap.keys()])
    for (const [key] of mtoMap) {
      if (key.startsWith(pid + '|')) {
        allPhases.add(key.split('|')[1])
      }
    }

    for (const phase of allPhases) {
      const actuals = phaseMap.get(phase) || { actual: 0, count: 0 }
      const estimated = mtoMap.get(`${pid}|${phase}`) || 0
      const variance = actuals.actual - estimated
      const variancePct = estimated > 0
        ? Math.round((variance / estimated) * 100 * 100) / 100
        : 0

      let status: PhaseVariance['status'] = 'no_estimate'
      if (estimated > 0) {
        if (variancePct > 10) { status = 'over_budget'; overCount++ }
        else if (variancePct < -5) status = 'under_budget'
        else status = 'on_budget'
      }

      phases.push({
        phase,
        estimated,
        actual: actuals.actual,
        variance,
        variancePct,
        receiptCount: actuals.count,
        status,
      })

      projEstimated += estimated
      projActual += actuals.actual

      // Generate alerts for significant variances
      if (status === 'over_budget' && variancePct > 15) {
        alerts.push({
          level: variancePct > 30 ? 'critical' : 'warning',
          message: `${phase} is ${variancePct.toFixed(0)}% over material budget`,
          projectName: projectNameMap.get(pid) || 'Unknown Project',
          phase,
          variancePct,
        })
      }
    }

    const totalVariance = projActual - projEstimated
    const totalVariancePct = projEstimated > 0
      ? Math.round((totalVariance / projEstimated) * 100 * 100) / 100
      : 0

    projectVariances.push({
      projectId: pid,
      projectName: projectNameMap.get(pid) || 'Unknown Project',
      phases: phases.sort((a, b) => a.phase.localeCompare(b.phase)),
      totalEstimated: projEstimated,
      totalActual: projActual,
      totalVariance,
      totalVariancePct,
      overBudgetPhases: overCount,
    })

    grandEstimated += projEstimated
    grandActual += projActual
  }

  return {
    projects: projectVariances.sort((a, b) => b.totalActual - a.totalActual),
    totalEstimated: grandEstimated,
    totalActual: grandActual,
    totalVariance: grandActual - grandEstimated,
    alerts: alerts.sort((a, b) => b.variancePct - a.variancePct),
  }
}

// ── Get Variance for Single Project ──────────────────────────────────────────

export async function getProjectVariance(orgId: string, projectId: string): Promise<ProjectVariance | null> {
  const summary = await getOrgVarianceSummary(orgId)
  return summary.projects.find(p => p.projectId === projectId) || null
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function emptyResult(): VarianceSummary {
  return {
    projects: [],
    totalEstimated: 0,
    totalActual: 0,
    totalVariance: 0,
    alerts: [],
  }
}
