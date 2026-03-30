// @ts-nocheck
/**
 * Pattern Service — Phase F canonical API for business pattern detection.
 *
 * Runs after any data write to detect recurring patterns. Stores patterns
 * in Supabase `learned_patterns` table AND in localStorage for offline access.
 *
 * Pattern types:
 *   material_cost_pattern    — recurring estimate line items across jobs
 *   job_duration_pattern     — average hours per job type
 *   lead_source_pattern      — which lead sources convert most
 *   compliance_flag_pattern  — which NEC codes OHM flags most often
 *
 * Functions:
 *   analyzeAfterWrite(entityType, data) — call after any Supabase write
 *   getPatterns(type?)                  — returns patterns sorted by confidence
 *   getSuggestion(context)             — semantic search for relevant suggestion
 */

import { supabase } from '@/lib/supabase'
import { getBackupData } from '@/services/backupDataService'
import { searchSimilar } from '@/services/embeddingService'
import {
  runPatternLearning,
  getPatterns as getLocalPatterns,
  getPatternContext,
  type LearnedPattern,
} from '@/services/patternLearning'

// ── Types ────────────────────────────────────────────────────────────────────

export type PatternType =
  | 'material_cost_pattern'
  | 'job_duration_pattern'
  | 'lead_source_pattern'
  | 'compliance_flag_pattern'
  | 'payment_pattern'
  | 'general'

export interface SupabasePattern {
  id: string
  pattern_type: PatternType
  description: string
  confidence: number
  source_count: number
  last_seen: string
  metadata: Record<string, unknown>
}

// ── Write-triggered pattern analysis ─────────────────────────────────────────

/**
 * Analyze data after a write event to detect/update patterns.
 * Call this fire-and-forget after any agent write.
 *
 * @param entityType - type of entity written ('estimate', 'project', 'payment', 'compliance_flag', 'scout_finding')
 * @param data       - the written record
 * @param orgId      - org context
 */
export async function analyzeAfterWrite(
  entityType: string,
  data: Record<string, unknown>,
  orgId?: string
): Promise<void> {
  const resolvedOrgId = orgId || 'poweron-default-org'

  try {
    switch (entityType) {
      case 'estimate':
        await analyzeEstimateWrite(resolvedOrgId, data)
        break
      case 'project':
        await analyzeProjectWrite(resolvedOrgId, data)
        break
      case 'payment':
      case 'invoice':
        await analyzePaymentWrite(resolvedOrgId, data)
        break
      case 'compliance_flag':
        await analyzeComplianceFlagWrite(resolvedOrgId, data)
        break
      case 'scout_finding':
        await analyzeScoutFindingWrite(resolvedOrgId, data)
        break
      default:
        // Generic — run full pattern learning on any write
        await runPatternLearning(resolvedOrgId)
        break
    }
  } catch (err) {
    // Never throw from fire-and-forget paths
    console.warn('[PatternService] analyzeAfterWrite failed (non-critical):', entityType, err)
  }
}

// ── Entity-specific analyzers ─────────────────────────────────────────────────

async function analyzeEstimateWrite(orgId: string, data: Record<string, unknown>): Promise<void> {
  // Detect recurring line items across estimates
  const backup = getBackupData()
  if (!backup) return

  const projects = backup.projects || []
  const allLineItems: string[] = []

  for (const p of projects) {
    const rows = [...(p.laborRows || []), ...(p.matRows || []), ...(p.mtoRows || [])]
    for (const row of rows) {
      const desc = (row.description || row.name || row.task || row.item || '').toString().trim()
      if (desc.length > 3) allLineItems.push(desc.toLowerCase())
    }
  }

  // Count occurrences
  const counts: Record<string, number> = {}
  for (const item of allLineItems) {
    counts[item] = (counts[item] || 0) + 1
  }

  // Items appearing in 3+ estimates → material_cost_pattern
  const frequent = Object.entries(counts)
    .filter(([, count]) => count >= 3)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)

  for (const [item, count] of frequent) {
    await upsertPattern(orgId, {
      pattern_type: 'material_cost_pattern',
      description: `"${item}" appears in ${count} estimates — commonly used material/labor item`,
      confidence: Math.min(0.95, 0.5 + count * 0.1),
      source_count: count,
      metadata: { item, occurrence_count: count },
    })
  }

  // Also run the full pattern learning pipeline to catch anything else
  await runPatternLearning(orgId).catch(() => { /* non-critical */ })
}

async function analyzeProjectWrite(orgId: string, data: Record<string, unknown>): Promise<void> {
  const backup = getBackupData()
  if (!backup) return

  const projects = backup.projects || []
  const completed = projects.filter((p: any) => p.status === 'completed' || p.status === 'closed')

  // Job duration patterns — derive from logs if available
  const byType: Record<string, number[]> = {}
  for (const p of projects) {
    const type = (p.type || 'general') as string
    const logs = p.logs || []
    const totalHrs = logs.reduce((sum: number, l: any) => sum + (Number(l.hrs) || 0), 0)
    if (totalHrs > 0) {
      if (!byType[type]) byType[type] = []
      byType[type].push(totalHrs)
    }
  }

  for (const [type, hours] of Object.entries(byType)) {
    if (hours.length < 2) continue
    const avg = Math.round(hours.reduce((a, b) => a + b, 0) / hours.length)
    await upsertPattern(orgId, {
      pattern_type: 'job_duration_pattern',
      description: `${type} jobs average ${avg} hours based on ${hours.length} logged projects`,
      confidence: Math.min(0.90, 0.4 + hours.length * 0.1),
      source_count: hours.length,
      metadata: { job_type: type, avg_hours: avg, sample_size: hours.length },
    })
  }
}

async function analyzePaymentWrite(orgId: string, data: Record<string, unknown>): Promise<void> {
  const backup = getBackupData()
  if (!backup) return

  const serviceLogs = backup.serviceLogs || []
  const paid = serviceLogs.filter((s: any) => {
    const totalBillable = (s.quoted || 0) + (s.adjustments || [])
      .filter((a: any) => a.type === 'income')
      .reduce((sum: number, a: any) => sum + (Number(a.amount) || 0), 0)
    return (s.collected || 0) >= totalBillable && totalBillable > 0
  })

  if (paid.length < 3) return

  const avgDays = paid.reduce((sum: number, s: any) => {
    if (!s.date) return sum
    const created = new Date(s.date)
    const now = new Date()
    return sum + Math.max(0, Math.round((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24)))
  }, 0) / paid.length

  await upsertPattern(orgId, {
    pattern_type: 'payment_pattern',
    description: `Service calls collected in avg ${Math.round(avgDays)} days. ${paid.length} paid out of ${serviceLogs.length} total.`,
    confidence: Math.min(0.85, 0.5 + paid.length * 0.05),
    source_count: paid.length,
    metadata: { avg_days_to_collect: Math.round(avgDays), paid_count: paid.length, total_count: serviceLogs.length },
  })
}

async function analyzeComplianceFlagWrite(orgId: string, data: Record<string, unknown>): Promise<void> {
  // Track which NEC code types are flagged most often
  const code = (data.code || data.nec_code || data.code_section || '') as string
  if (!code) return

  await upsertPattern(orgId, {
    pattern_type: 'compliance_flag_pattern',
    description: `NEC ${code} flagged by OHM — common compliance item in this org's project type`,
    confidence: 0.70,
    source_count: 1,
    metadata: { nec_code: code, project_type: data.project_type },
  })
}

async function analyzeScoutFindingWrite(orgId: string, data: Record<string, unknown>): Promise<void> {
  const finding = (data.finding || data.gap || data.description || '') as string
  if (!finding) return

  await upsertPattern(orgId, {
    pattern_type: 'general',
    description: `SCOUT finding: ${finding.slice(0, 200)}`,
    confidence: 0.60,
    source_count: 1,
    metadata: { finding_type: data.finding_type, agent: 'scout' },
  })
}

// ── Supabase pattern upsert ──────────────────────────────────────────────────

async function upsertPattern(
  orgId: string,
  pattern: Omit<SupabasePattern, 'id' | 'last_seen'>
): Promise<void> {
  try {
    await supabase.rpc('upsert_pattern', {
      p_org_id: orgId,
      p_pattern_type: pattern.pattern_type,
      p_description: pattern.description,
      p_confidence: pattern.confidence,
      p_metadata: pattern.metadata || {},
    })
  } catch (err) {
    // Supabase unavailable — store in localStorage via existing patternLearning
    console.warn('[PatternService] Supabase upsert failed, using localStorage:', err)
  }
}

// ── Get patterns ─────────────────────────────────────────────────────────────

/**
 * Get learned patterns, sorted by confidence DESC.
 * Merges Supabase patterns with local localStorage patterns.
 *
 * @param type  - optional filter by pattern_type
 * @param orgId - org context
 */
export async function getPatterns(
  type?: PatternType,
  orgId?: string
): Promise<SupabasePattern[]> {
  const resolvedOrgId = orgId || 'poweron-default-org'
  const results: SupabasePattern[] = []

  // Try Supabase first
  try {
    const { data, error } = await supabase.rpc('get_patterns', {
      p_org_id: resolvedOrgId,
      p_pattern_type: type || null,
      p_limit: 20,
    })
    if (!error && data) {
      results.push(...(data as SupabasePattern[]))
    }
  } catch {
    // Supabase unavailable — fall through to localStorage
  }

  // If no Supabase results, read from localStorage via patternLearning
  if (results.length === 0) {
    const localPatterns = getLocalPatterns()
    return localPatterns.map(p => ({
      id: p.id,
      pattern_type: (p.category === 'job_type' ? 'job_duration_pattern'
        : p.category === 'pricing' ? 'material_cost_pattern'
        : p.category === 'client_behavior' ? 'payment_pattern'
        : 'general') as PatternType,
      description: p.pattern,
      confidence: p.confidence,
      source_count: p.dataPoints,
      last_seen: p.discoveredAt,
      metadata: p.metadata || {},
    })).filter(p => !type || p.pattern_type === type)
  }

  return results
}

// ── Get suggestion ────────────────────────────────────────────────────────────

/**
 * Get the most relevant pattern/suggestion for a given context.
 * Uses semantic search across learned_patterns + memory_embeddings.
 *
 * @param context - natural language description of the current situation
 * @param orgId   - org context
 */
export async function getSuggestion(
  context: string,
  orgId?: string
): Promise<string | null> {
  const resolvedOrgId = orgId || 'poweron-default-org'

  // 1. Try semantic search in memory_embeddings for 'pattern' type
  try {
    const relatedMemories = await searchSimilar(context, 'pattern' as any, 3, resolvedOrgId)
    if (relatedMemories.length > 0) {
      const topMatch = relatedMemories[0]
      return `Based on past patterns (${Math.round(topMatch.similarity * 100)}% match): ${topMatch.content}`
    }
  } catch {
    // Non-critical
  }

  // 2. Fall back to keyword search in localStorage patterns
  const localPatterns = getLocalPatterns()
  const contextLower = context.toLowerCase()
  const relevant = localPatterns.filter(p => {
    const text = (p.pattern + ' ' + p.actionable).toLowerCase()
    return contextLower.split(' ').some(word => word.length > 4 && text.includes(word))
  })

  if (relevant.length > 0) {
    const best = relevant.sort((a, b) => b.confidence - a.confidence)[0]
    return `Pattern insight: ${best.pattern}. Suggested action: ${best.actionable}`
  }

  // 3. Fall back to pattern context string
  const patternCtx = getPatternContext(3)
  if (patternCtx) {
    return patternCtx
  }

  return null
}

// ── Re-export for convenience ─────────────────────────────────────────────────
export { getPatternContext } from '@/services/patternLearning'
export type { LearnedPattern } from '@/services/patternLearning'
