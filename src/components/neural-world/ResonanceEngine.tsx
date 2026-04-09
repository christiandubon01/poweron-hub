/**
 * ResonanceEngine.tsx — NW40: Computes the Resonance Score from DataBridge data.
 *
 * Alignment factors (each 0.0–1.0, weighted average):
 *   1. Cash flow timing      — invoice paid_at vs expense schedule alignment
 *   2. Capacity utilization  — hours logged vs available (80% = peak)
 *   3. Lead conversion rhythm — time from lead to project start (consistent = high)
 *   4. Project phase rate     — steady phase progression vs stalling
 *   5. Agent workload balance — even distribution across agents
 *   6. Revenue diversity      — single-client dependency kills resonance
 *   7. Bandwidth balance      — attention proportional to business importance
 *
 * Resonance score 0.0–1.0:
 *   0.00–0.35 = DISSONANT
 *   0.35–0.70 = COHERENT
 *   0.70–1.00 = GROWTH
 */

import { useEffect, useRef, useState } from 'react'
import {
  subscribeWorldData,
  type NWWorldData,
  type NWProject,
  type NWInvoice,
  type NWFieldLog,
} from './DataBridge'

// ── Types ─────────────────────────────────────────────────────────────────────

export type ResonanceState = 'DISSONANT' | 'COHERENT' | 'GROWTH'

export interface AlignmentFactor {
  id: string
  label: string
  score: number   // 0.0–1.0
  explanation: string
}

export interface ResonanceResult {
  score: number               // 0.0–1.0 weighted average
  state: ResonanceState
  factors: AlignmentFactor[]
  computedAt: number          // Date.now()
}

// ── Weight config ─────────────────────────────────────────────────────────────

const FACTOR_WEIGHTS: Record<string, number> = {
  cashFlowTiming:    0.20,
  capacityUtil:      0.15,
  leadConversionRhythm: 0.10,
  projectPhaseRate:  0.20,
  agentWorkload:     0.10,
  revenueDiversity:  0.15,
  bandwidthBalance:  0.10,
}

// ── Score helpers ─────────────────────────────────────────────────────────────

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

/**
 * 1. Cash flow timing: paid invoices arriving before expenses = high.
 * Proxy: ratio of paid invoices to total invoices (recent 90 days),
 * weighted by how quickly they were paid (days from created_at to paid_at).
 */
function scoreCashFlowTiming(invoices: NWInvoice[]): { score: number; explanation: string } {
  const now = Date.now()
  const MS_90 = 90 * 24 * 60 * 60 * 1000
  const recent = invoices.filter(inv => {
    if (!inv.created_at) return false
    return now - new Date(inv.created_at).getTime() < MS_90
  })

  if (recent.length === 0) {
    return { score: 0.5, explanation: 'No recent invoice data. Score held at neutral.' }
  }

  const paid = recent.filter(inv => inv.status === 'paid' && inv.paid_at)
  if (paid.length === 0) {
    return {
      score: 0.1,
      explanation: `No paid invoices in last 90 days (${recent.length} open). Cash flow timing is weak.`,
    }
  }

  // Average days to payment
  const avgDays = paid.reduce((sum, inv) => {
    const created = inv.created_at ? new Date(inv.created_at).getTime() : now
    const paidAt  = inv.paid_at    ? new Date(inv.paid_at).getTime()    : now
    return sum + (paidAt - created) / (24 * 60 * 60 * 1000)
  }, 0) / paid.length

  // Fast payment (<= 5 days) = 1.0, slow (>= 45 days) = 0.0
  const timingScore = clamp01(1 - (avgDays - 5) / 40)
  // Paid ratio bonus
  const paidRatio = paid.length / recent.length
  const score = clamp01(timingScore * 0.7 + paidRatio * 0.3)

  const dayStr = avgDays.toFixed(0)
  if (avgDays <= 5) {
    return { score, explanation: `Your last ${paid.length} invoices paid in avg ${dayStr} days. Strong cash alignment.` }
  } else if (avgDays <= 14) {
    return { score, explanation: `Avg ${dayStr} days to payment on ${paid.length} invoices. Good rhythm.` }
  } else {
    return { score, explanation: `Avg ${dayStr} days to payment. Slow collection is compressing cash timing.` }
  }
}

/**
 * 2. Capacity utilization: hours logged vs available hours.
 * 80% of standard 160 hrs/month = peak. Under 50% or over 100% = low.
 */
function scoreCapacityUtilization(fieldLogs: NWFieldLog[]): { score: number; explanation: string } {
  const now = Date.now()
  const MS_30 = 30 * 24 * 60 * 60 * 1000
  const recentLogs = fieldLogs.filter(fl => {
    if (!fl.log_date) return false
    return now - new Date(fl.log_date).getTime() < MS_30
  })

  const totalHours = recentLogs.reduce((s, fl) => s + fl.hours, 0)
  const available  = 160  // standard monthly hours
  const utilRate   = totalHours / available  // 0+

  let score: number
  let explanation: string

  if (utilRate < 0.5) {
    score = clamp01(utilRate / 0.5 * 0.4)
    explanation = `${totalHours.toFixed(0)}h logged vs ${available}h available (${(utilRate*100).toFixed(0)}%). Under-utilized bandwidth.`
  } else if (utilRate <= 0.85) {
    // 50–85%: scale from 0.4 to 1.0
    score = clamp01(0.4 + (utilRate - 0.5) / 0.35 * 0.6)
    explanation = `${totalHours.toFixed(0)}h logged this month (${(utilRate*100).toFixed(0)}% capacity). Near-optimal utilization.`
  } else if (utilRate <= 1.0) {
    score = 1.0
    explanation = `${totalHours.toFixed(0)}h logged (${(utilRate*100).toFixed(0)}%). Peak operational capacity.`
  } else {
    // Over 100%: overloaded, score drops
    score = clamp01(1 - (utilRate - 1.0) * 2)
    explanation = `${totalHours.toFixed(0)}h logged — ${(utilRate*100).toFixed(0)}% capacity. Overload erodes quality and rhythm.`
  }

  return { score, explanation }
}

/**
 * 3. Lead-to-project conversion rhythm.
 * Consistent time between lead status and in_progress = high.
 * Uses variance of created_at gaps between sequential project activations.
 */
function scoreLeadConversionRhythm(projects: NWProject[]): { score: number; explanation: string } {
  const activations = projects
    .filter(p => p.status === 'in_progress' || p.status === 'approved')
    .filter(p => p.created_at)
    .map(p => new Date(p.created_at!).getTime())
    .sort((a, b) => a - b)

  if (activations.length < 2) {
    return { score: 0.4, explanation: 'Fewer than 2 active projects. Rhythm cannot be measured yet.' }
  }

  const gaps = activations.slice(1).map((t, i) => (t - activations[i]) / (24 * 60 * 60 * 1000))
  const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length
  const variance = gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 1  // coefficient of variation

  // CV near 0 = perfectly consistent (score 1.0), CV >= 1.5 = chaotic (score 0.0)
  const score = clamp01(1 - cv / 1.5)

  if (cv < 0.3) {
    return { score, explanation: `Project activations are highly consistent (${mean.toFixed(0)}-day rhythm). Strong conversion cadence.` }
  } else if (cv < 0.8) {
    return { score, explanation: `Moderate variation in lead-to-project timing (avg ${mean.toFixed(0)} days). Some rhythm gaps.` }
  } else {
    return { score, explanation: `Erratic lead conversion timing (variance ${cv.toFixed(1)}x mean). Unpredictable pipeline rhythm.` }
  }
}

/**
 * 4. Project phase completion rate.
 * Average phase_completion across active projects. Steady progress = high.
 * Also penalizes projects with 0% completion that have been open > 14 days.
 */
function scoreProjectPhaseRate(projects: NWProject[]): { score: number; explanation: string } {
  const active = projects.filter(p =>
    p.status === 'in_progress' || p.status === 'approved' || p.status === 'pending'
  )

  if (active.length === 0) {
    return { score: 0.5, explanation: 'No active projects. Phase completion rate is neutral.' }
  }

  const now = Date.now()
  const avgCompletion = active.reduce((s, p) => s + p.phase_completion, 0) / active.length / 100

  // Stalled: projects with < 5% completion open for > 14 days
  const stalledCount = active.filter(p => {
    if (p.phase_completion > 5) return false
    if (!p.created_at) return true
    const age = (now - new Date(p.created_at).getTime()) / (24 * 60 * 60 * 1000)
    return age > 14
  }).length

  const stallPenalty = stalledCount / Math.max(active.length, 1)
  const score = clamp01(avgCompletion * (1 - stallPenalty * 0.5))

  if (stalledCount > 0) {
    return {
      score,
      explanation: `${stalledCount}/${active.length} projects stalled below 5%. Phase momentum is disrupted.`,
    }
  }
  return {
    score,
    explanation: `Avg ${(avgCompletion * 100).toFixed(0)}% phase completion across ${active.length} active projects. ${score > 0.7 ? 'Healthy momentum.' : 'Some phase lag.'}`,
  }
}

/**
 * 5. Agent workload distribution.
 * Uses active project count per project type as a proxy for agent domain load.
 * Even distribution across types = high. One type dominating = low.
 */
function scoreAgentWorkload(projects: NWProject[]): { score: number; explanation: string } {
  const active = projects.filter(p =>
    p.status === 'in_progress' || p.status === 'approved'
  )

  if (active.length === 0) {
    return { score: 0.5, explanation: 'No active projects to measure agent workload distribution.' }
  }

  const typeCounts: Record<string, number> = {}
  active.forEach(p => {
    const t = p.type ?? 'general'
    typeCounts[t] = (typeCounts[t] ?? 0) + 1
  })

  const counts = Object.values(typeCounts)
  const total = counts.reduce((s, c) => s + c, 0)
  const maxCount = Math.max(...counts)
  const dominanceRatio = maxCount / total  // 1.0 = all one type, 1/n = perfectly even

  const nTypes = counts.length
  const perfectEven = 1 / nTypes
  const score = clamp01(1 - (dominanceRatio - perfectEven) / (1 - perfectEven))

  const dominantType = Object.entries(typeCounts).find(([, c]) => c === maxCount)?.[0] ?? 'unknown'

  if (score > 0.75) {
    return { score, explanation: `Workload is well-distributed across ${nTypes} project types. Agents are balanced.` }
  } else {
    return {
      score,
      explanation: `"${dominantType}" projects dominate (${maxCount}/${total}). Agent workload is skewed.`,
    }
  }
}

/**
 * 6. Revenue diversity: single-client dependency ratio.
 * From accountingSignals.singleClientDependencyRatio.
 * 0 = fully diversified (score 1.0), 1.0 = all one client (score 0.0).
 */
function scoreRevenueDiversity(
  singleClientRatio: number,
  projectCount: number,
): { score: number; explanation: string } {
  if (projectCount === 0) {
    return { score: 0.3, explanation: 'No projects. Revenue diversity cannot be assessed.' }
  }

  const score = clamp01(1 - singleClientRatio * 1.2)

  if (singleClientRatio < 0.25) {
    return { score, explanation: `Revenue well-diversified. No single client exceeds 25% of total contract value.` }
  } else if (singleClientRatio < 0.5) {
    return {
      score,
      explanation: `Top client holds ${(singleClientRatio * 100).toFixed(0)}% of total value. Moderate concentration risk.`,
    }
  } else {
    return {
      score,
      explanation: `Single-client dependency at ${(singleClientRatio * 100).toFixed(0)}%. Resonance is fragile — losing this client is critical.`,
    }
  }
}

/**
 * 7. Bandwidth balance: attention proportional to business importance.
 * Proxy: projects with high contract value should have recent field log activity.
 * High-value projects with no recent logs = bandwidth misalignment.
 */
function scoreBandwidthBalance(
  projects: NWProject[],
  fieldLogs: NWFieldLog[],
): { score: number; explanation: string } {
  const active = projects.filter(p =>
    p.status === 'in_progress' || p.status === 'approved'
  )

  if (active.length === 0) {
    return { score: 0.5, explanation: 'No active projects. Bandwidth balance is neutral.' }
  }

  const now = Date.now()
  const MS_14 = 14 * 24 * 60 * 60 * 1000

  // For each project, compute share of contract value and share of recent hours
  const totalValue = active.reduce((s, p) => s + p.contract_value, 0)
  const recentLogMap: Record<string, number> = {}
  fieldLogs
    .filter(fl => fl.log_date && now - new Date(fl.log_date).getTime() < MS_14)
    .forEach(fl => {
      if (fl.project_id) {
        recentLogMap[fl.project_id] = (recentLogMap[fl.project_id] ?? 0) + fl.hours
      }
    })

  const totalRecentHours = Object.values(recentLogMap).reduce((s, h) => s + h, 0)

  if (totalRecentHours === 0) {
    return {
      score: 0.3,
      explanation: 'No field hours logged in last 14 days. Bandwidth distribution cannot be measured.',
    }
  }

  // Compare value share vs hours share for each project
  let totalMismatch = 0
  active.forEach(p => {
    const valueShare = totalValue > 0 ? p.contract_value / totalValue : 0
    const hoursShare = totalRecentHours > 0 ? (recentLogMap[p.id] ?? 0) / totalRecentHours : 0
    totalMismatch += Math.abs(valueShare - hoursShare)
  })

  // totalMismatch 0 = perfect alignment, 2.0 = fully reversed
  const score = clamp01(1 - totalMismatch)

  if (score > 0.8) {
    return { score, explanation: 'Time investment aligns well with project value. Bandwidth is proportionally distributed.' }
  } else if (score > 0.5) {
    return { score, explanation: 'Moderate bandwidth drift — some high-value projects may be under-attended.' }
  } else {
    return { score, explanation: 'Bandwidth is significantly misaligned with project value. Attention is going to low-priority work.' }
  }
}

// ── Main computation ──────────────────────────────────────────────────────────

export function computeResonance(data: NWWorldData): ResonanceResult {
  const { projects, invoices, fieldLogs, accountingSignals } = data

  const cf  = scoreCashFlowTiming(invoices)
  const cap = scoreCapacityUtilization(fieldLogs)
  const lcr = scoreLeadConversionRhythm(projects)
  const ppr = scoreProjectPhaseRate(projects)
  const aw  = scoreAgentWorkload(projects)
  const rd  = scoreRevenueDiversity(accountingSignals.singleClientDependencyRatio, projects.length)
  const bb  = scoreBandwidthBalance(projects, fieldLogs)

  const factors: AlignmentFactor[] = [
    { id: 'cashFlowTiming',    label: 'Cash Flow Timing',       score: cf.score,  explanation: cf.explanation  },
    { id: 'capacityUtil',      label: 'Capacity Utilization',   score: cap.score, explanation: cap.explanation },
    { id: 'leadConversionRhythm', label: 'Lead Conversion Rhythm', score: lcr.score, explanation: lcr.explanation },
    { id: 'projectPhaseRate',  label: 'Project Phase Rate',     score: ppr.score, explanation: ppr.explanation },
    { id: 'agentWorkload',     label: 'Agent Workload Balance', score: aw.score,  explanation: aw.explanation  },
    { id: 'revenueDiversity',  label: 'Revenue Diversity',      score: rd.score,  explanation: rd.explanation  },
    { id: 'bandwidthBalance',  label: 'Bandwidth Balance',      score: bb.score,  explanation: bb.explanation  },
  ]

  // Weighted average
  let totalWeight = 0
  let weightedSum = 0
  factors.forEach(f => {
    const w = FACTOR_WEIGHTS[f.id] ?? 0.1
    weightedSum  += f.score * w
    totalWeight  += w
  })
  const score = clamp01(totalWeight > 0 ? weightedSum / totalWeight : 0)

  const state: ResonanceState =
    score < 0.35 ? 'DISSONANT' :
    score < 0.70 ? 'COHERENT'  :
    'GROWTH'

  return { score, state, factors, computedAt: Date.now() }
}

// ── React hook ────────────────────────────────────────────────────────────────

export function useResonanceScore(): ResonanceResult {
  const [result, setResult] = useState<ResonanceResult>(() => ({
    score: 0.5,
    state: 'COHERENT',
    factors: [],
    computedAt: Date.now(),
  }))

  // Recompute on every DataBridge update
  useEffect(() => {
    const unsub = subscribeWorldData((data: NWWorldData) => {
      setResult(computeResonance(data))
    })
    return unsub
  }, [])

  return result
}

// ── State colors ──────────────────────────────────────────────────────────────

export const RESONANCE_STATE_COLOR: Record<ResonanceState, string> = {
  DISSONANT: '#ff2222',
  COHERENT:  '#ffd700',
  GROWTH:    '#00ff88',
}

export const RESONANCE_STATE_ICON: Record<ResonanceState, string> = {
  DISSONANT: '⚠',
  COHERENT:  '◈',
  GROWTH:    '✦',
}
