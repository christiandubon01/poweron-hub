// @ts-nocheck
/**
 * Pattern Learning Service — Analyzes job history to learn patterns.
 *
 * Examines completed jobs, service calls, and financial outcomes to
 * identify actionable patterns. Stores patterns in vector memory and
 * publishes PATTERN_LEARNED events for cross-agent awareness.
 *
 * Patterns include:
 * - Job type → average margin, duration, common issues
 * - Client type → payment speed, repeat rate
 * - Seasonal trends → busy months, common service calls
 * - Pricing patterns → which estimates win vs lose
 */

import { publish } from '@/services/agentEventBus'
import { getBackupData } from '@/services/backupDataService'
import { embedAndStore } from '@/services/vectorMemory'
import { addLearnedPattern } from '@/services/nexusMemory'

// ── Types ────────────────────────────────────────────────────────────────────

export interface LearnedPattern {
  id: string
  category: 'job_type' | 'client_behavior' | 'seasonal' | 'pricing' | 'operational'
  pattern: string
  confidence: number  // 0-1
  dataPoints: number  // How many observations support this
  actionable: string  // What to do with this insight
  discoveredAt: string
  metadata?: Record<string, unknown>
}

const STORAGE_KEY = 'learned_patterns'

// ── Pattern Storage ──────────────────────────────────────────────────────────

function getStoredPatterns(): LearnedPattern[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function savePatterns(patterns: LearnedPattern[]): void {
  try {
    // Keep max 100 patterns
    const trimmed = patterns.slice(0, 100)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
  } catch { /* ignore */ }
}

function addPattern(pattern: LearnedPattern): void {
  const existing = getStoredPatterns()
  // Deduplicate by pattern text similarity (simple check)
  const isDuplicate = existing.some(p => p.pattern === pattern.pattern)
  if (!isDuplicate) {
    existing.unshift(pattern)
    savePatterns(existing)
  }
}

// ── Pattern Analysis Functions ───────────────────────────────────────────────

/**
 * Analyze completed projects to find job type patterns.
 */
export function analyzeJobTypePatterns(): LearnedPattern[] {
  const backup = getBackupData()
  if (!backup) return []

  const projects = backup.projects || []
  const completed = projects.filter((p: any) => p.status === 'completed' || p.status === 'closed')

  if (completed.length < 2) return []

  // Group by project type
  const byType: Record<string, any[]> = {}
  completed.forEach((p: any) => {
    const type = p.type || 'general'
    if (!byType[type]) byType[type] = []
    byType[type].push(p)
  })

  const patterns: LearnedPattern[] = []

  Object.entries(byType).forEach(([type, projects]) => {
    if (projects.length < 2) return

    // Calculate average values
    const values = projects.map((p: any) => p.contract_value || p.estimated_value || 0).filter((v: number) => v > 0)
    const avgValue = values.length > 0 ? Math.round(values.reduce((a: number, b: number) => a + b, 0) / values.length) : 0

    if (avgValue > 0) {
      patterns.push({
        id: `pat_jt_${type}_${Date.now()}`,
        category: 'job_type',
        pattern: `${type} jobs average $${avgValue.toLocaleString()} across ${projects.length} completed projects`,
        confidence: Math.min(0.9, 0.5 + (projects.length * 0.1)),
        dataPoints: projects.length,
        actionable: `Use $${avgValue.toLocaleString()} as baseline when estimating ${type} jobs`,
        discoveredAt: new Date().toISOString(),
        metadata: { jobType: type, avgValue, projectCount: projects.length },
      })
    }
  })

  return patterns
}

/**
 * Analyze service call patterns — common issues, seasonal distribution.
 */
export function analyzeServiceCallPatterns(): LearnedPattern[] {
  const backup = getBackupData()
  if (!backup) return []

  const serviceLogs = backup.serviceLogs || []
  if (serviceLogs.length < 3) return []

  const patterns: LearnedPattern[] = []

  // Analyze by month for seasonal patterns
  const byMonth: Record<number, number> = {}
  serviceLogs.forEach((log: any) => {
    const date = new Date(log.date || log.created_at || log.createdAt)
    if (!isNaN(date.getTime())) {
      const month = date.getMonth()
      byMonth[month] = (byMonth[month] || 0) + 1
    }
  })

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const entries = Object.entries(byMonth).sort(([, a], [, b]) => (b as number) - (a as number))

  if (entries.length >= 3) {
    const busiestMonth = months[parseInt(entries[0][0])]
    const busiestCount = entries[0][1]

    patterns.push({
      id: `pat_seasonal_${Date.now()}`,
      category: 'seasonal',
      pattern: `${busiestMonth} is the busiest month for service calls (${busiestCount} calls from ${serviceLogs.length} total)`,
      confidence: Math.min(0.85, 0.4 + (serviceLogs.length * 0.02)),
      dataPoints: serviceLogs.length,
      actionable: `Plan extra capacity for ${busiestMonth}. Consider pre-scheduling maintenance outreach before peak.`,
      discoveredAt: new Date().toISOString(),
      metadata: { distribution: byMonth, busiestMonth, busiestCount },
    })
  }

  return patterns
}

/**
 * Analyze payment patterns — which clients pay fast vs slow.
 */
export function analyzePaymentPatterns(): LearnedPattern[] {
  const backup = getBackupData()
  if (!backup) return []

  const invoices = backup.invoices || []
  const paid = invoices.filter((inv: any) => inv.status === 'paid' && inv.paidDate)

  if (paid.length < 3) return []

  const patterns: LearnedPattern[] = []

  // Average days to payment
  const daysToPayment = paid.map((inv: any) => {
    const sent = new Date(inv.date || inv.createdAt || inv.created_at)
    const paidDate = new Date(inv.paidDate)
    return Math.max(0, Math.round((paidDate.getTime() - sent.getTime()) / (1000 * 60 * 60 * 24)))
  }).filter((d: number) => d < 365) // Filter outliers

  if (daysToPayment.length > 0) {
    const avgDays = Math.round(daysToPayment.reduce((a: number, b: number) => a + b, 0) / daysToPayment.length)

    patterns.push({
      id: `pat_payment_avg_${Date.now()}`,
      category: 'client_behavior',
      pattern: `Average payment takes ${avgDays} days across ${daysToPayment.length} paid invoices`,
      confidence: Math.min(0.85, 0.5 + (daysToPayment.length * 0.05)),
      dataPoints: daysToPayment.length,
      actionable: avgDays > 30
        ? `Payment cycle is ${avgDays} days. Consider offering early-pay discounts or tightening net terms.`
        : `Payment cycle is healthy at ${avgDays} days. Maintain current billing practices.`,
      discoveredAt: new Date().toISOString(),
      metadata: { avgDays, sampleSize: daysToPayment.length },
    })
  }

  return patterns
}

/**
 * Analyze estimate win/loss patterns.
 */
export function analyzeEstimatePatterns(): LearnedPattern[] {
  const backup = getBackupData()
  if (!backup) return []

  const estimates = backup.estimates || []
  if (estimates.length < 3) return []

  const patterns: LearnedPattern[] = []

  const won = estimates.filter((e: any) => e.status === 'approved' || e.status === 'accepted' || e.status === 'won')
  const lost = estimates.filter((e: any) => e.status === 'rejected' || e.status === 'lost' || e.status === 'declined')

  if (won.length + lost.length >= 3) {
    const winRate = Math.round((won.length / (won.length + lost.length)) * 100)

    const wonValues = won.map((e: any) => e.total || e.amount || 0).filter((v: number) => v > 0)
    const lostValues = lost.map((e: any) => e.total || e.amount || 0).filter((v: number) => v > 0)

    const avgWon = wonValues.length > 0 ? Math.round(wonValues.reduce((a: number, b: number) => a + b, 0) / wonValues.length) : 0
    const avgLost = lostValues.length > 0 ? Math.round(lostValues.reduce((a: number, b: number) => a + b, 0) / lostValues.length) : 0

    patterns.push({
      id: `pat_estimate_${Date.now()}`,
      category: 'pricing',
      pattern: `Estimate win rate: ${winRate}% (${won.length} won, ${lost.length} lost). Won avg: $${avgWon.toLocaleString()}, Lost avg: $${avgLost.toLocaleString()}`,
      confidence: Math.min(0.9, 0.5 + ((won.length + lost.length) * 0.05)),
      dataPoints: won.length + lost.length,
      actionable: avgLost > avgWon
        ? `Losing more on higher-value estimates ($${avgLost.toLocaleString()} avg). Review pricing strategy for large jobs.`
        : `Win rate is ${winRate}%. Pricing appears competitive.`,
      discoveredAt: new Date().toISOString(),
      metadata: { winRate, wonCount: won.length, lostCount: lost.length, avgWon, avgLost },
    })
  }

  return patterns
}

// ── Main Learning Pipeline ───────────────────────────────────────────────────

/**
 * Run the full pattern learning pipeline.
 * Analyzes all data sources, stores discoveries, publishes events.
 */
export async function runPatternLearning(orgId: string): Promise<LearnedPattern[]> {
  console.log('[PatternLearning] Starting pattern analysis...')

  const allPatterns: LearnedPattern[] = []

  // Run all analyzers
  try { allPatterns.push(...analyzeJobTypePatterns()) } catch (err) { console.warn('[PatternLearning] Job type analysis failed:', err) }
  try { allPatterns.push(...analyzeServiceCallPatterns()) } catch (err) { console.warn('[PatternLearning] Service call analysis failed:', err) }
  try { allPatterns.push(...analyzePaymentPatterns()) } catch (err) { console.warn('[PatternLearning] Payment analysis failed:', err) }
  try { allPatterns.push(...analyzeEstimatePatterns()) } catch (err) { console.warn('[PatternLearning] Estimate analysis failed:', err) }

  console.log(`[PatternLearning] Discovered ${allPatterns.length} patterns`)

  // Store each pattern
  for (const pattern of allPatterns) {
    // Store locally
    addPattern(pattern)

    // Add to NEXUS memory seeds
    try {
      addLearnedPattern(pattern.pattern)
    } catch { /* non-critical */ }

    // Store in vector memory for semantic search
    try {
      await embedAndStore(
        orgId,
        'pattern' as any,
        `${pattern.category}: ${pattern.pattern}. Action: ${pattern.actionable}`,
        pattern.id,
        'pattern_learning',
        {
          category: pattern.category,
          confidence: pattern.confidence,
          dataPoints: pattern.dataPoints,
          discoveredAt: pattern.discoveredAt,
        }
      )
    } catch (err) {
      console.warn('[PatternLearning] Vector store failed for pattern:', pattern.id, err)
    }

    // Publish PATTERN_LEARNED event
    publish(
      'PATTERN_LEARNED' as any,
      'pattern_learning',
      {
        patternId: pattern.id,
        category: pattern.category,
        pattern: pattern.pattern,
        confidence: pattern.confidence,
        actionable: pattern.actionable,
      },
      `Pattern learned (${pattern.category}): ${pattern.pattern}`
    )
  }

  return allPatterns
}

/**
 * Get all stored patterns, optionally filtered by category.
 */
export function getPatterns(category?: LearnedPattern['category']): LearnedPattern[] {
  const patterns = getStoredPatterns()
  if (!category) return patterns
  return patterns.filter(p => p.category === category)
}

/**
 * Get pattern summary formatted for NEXUS context injection.
 */
export function getPatternContext(maxPatterns = 5): string {
  const patterns = getStoredPatterns().slice(0, maxPatterns)
  if (patterns.length === 0) return ''

  const lines = patterns.map(p =>
    `- [${p.category}] ${p.pattern} (confidence: ${Math.round(p.confidence * 100)}%)`
  )

  return `## Learned Patterns\n${lines.join('\n')}`
}
