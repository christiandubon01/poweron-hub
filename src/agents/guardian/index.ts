// @ts-nocheck
/**
 * GUARDIAN Agent — Employee activity monitoring, audit trail, anomaly flagging.
 *
 * Functions:
 *   analyzeCrewLog(log)           → Flag[]   — detects anomalies in a single crew_field_log
 *   reviewPendingLogs()           → ReviewResult — batch review all unreviewed crew logs
 *   getDailyCrewSummary()         → string   — plain-English summary of last 24 hours
 *
 *   -- activity_log analysis (Part 1) --
 *   analyzeActivityEntry(entry)   → ActivityFlag[] — anomaly detection on a single activity_log row
 *   runActivityAnalysis(days?)    → ActivityAnalysisResult — full 30-day scan for anomalies
 *   getActivityFeed(orgId)        → ActivityEntry[] — recent activity_log rows for an org
 *   routeGuardianAlerts(flags)    → void — push flagged anomalies into the Home panel alert store
 */

import { supabase } from '@/lib/supabase'
import { getBackupData, saveBackupData } from '@/services/backupDataService'

// ── Types ─────────────────────────────────────────────────────────────────────

export type FlagSeverity = 'low' | 'medium' | 'high'

export type FlagType =
  | 'MISSING_HOURS'
  | 'MISSING_MATERIALS'
  | 'LONG_SHIFT'
  | 'SHORT_LOG'
  | 'NO_JOB_REFERENCE'

export interface Flag {
  type: FlagType
  message: string
  severity: FlagSeverity
}

export interface CrewFieldLog {
  id: string
  user_id: string | null
  owner_id: string
  crew_name: string
  job_reference: string | null
  work_description: string
  hours_logged: number | null
  materials_used: Array<{ name: string; quantity: number; unit: string }>
  photos: string[]
  flags: Flag[]
  reviewed_by_owner: boolean
  created_at: string
}

export interface ReviewResult {
  flagged: CrewFieldLog[]
  clean: CrewFieldLog[]
  summary: string
}

// ── Activity Log Types ────────────────────────────────────────────────────────

export type ActivityAnomalyType =
  | 'DUPLICATE_SAME_DAY'
  | 'EXCESS_HOURS'
  | 'MATERIAL_COST_SPIKE'
  | 'OUT_OF_HOURS'

export interface ActivityFlag {
  anomalyType: ActivityAnomalyType
  severity: FlagSeverity
  reason: string
  entryId: string
  entityLabel?: string
  employeeName?: string
  timestamp: string
}

export interface ActivityEntry {
  id: string
  user_id: string | null
  agent_name: string
  action_type: string
  entity_type: string | null
  entity_id: string | null
  entity_label: string | null
  summary: string
  details: Record<string, any>
  created_at: string
  // computed
  isFlagged?: boolean
  flags?: ActivityFlag[]
}

export interface ActivityAnalysisResult {
  totalEntries: number
  flaggedCount: number
  cleanCount: number
  flags: ActivityFlag[]
  summary: string
}

// ── Crew Log Anomaly Detection ─────────────────────────────────────────────────

/**
 * Analyzes a single crew field log and returns any detected anomaly flags.
 */
export function analyzeCrewLog(log: CrewFieldLog): Flag[] {
  const flags: Flag[] = []

  // MISSING_HOURS: hours_logged is null or 0
  if (log.hours_logged === null || log.hours_logged === undefined || log.hours_logged === 0) {
    flags.push({
      type: 'MISSING_HOURS',
      message: 'No hours logged for this entry.',
      severity: 'high',
    })
  }

  // LONG_SHIFT: hours_logged > 10
  if (log.hours_logged !== null && log.hours_logged > 10) {
    flags.push({
      type: 'LONG_SHIFT',
      message: `Shift logged at ${log.hours_logged} hours — exceeds 10-hour threshold.`,
      severity: 'medium',
    })
  }

  // MISSING_MATERIALS: description mentions materials but materials_used is empty
  const materialKeywords = /material|wire|conduit|panel|breaker|outlet|switch|fixture|cable|box|emt|pvc|romex|flex|connector|lug|pipe|fitting|junction/i
  const hasMaterialMention = materialKeywords.test(log.work_description)
  const materialsEmpty = !log.materials_used || log.materials_used.length === 0
  if (hasMaterialMention && materialsEmpty) {
    flags.push({
      type: 'MISSING_MATERIALS',
      message: 'Work description mentions materials but no materials list was provided.',
      severity: 'medium',
    })
  }

  // SHORT_LOG: work_description under 20 words
  const wordCount = log.work_description.trim().split(/\s+/).filter(w => w.length > 0).length
  if (wordCount < 20) {
    flags.push({
      type: 'SHORT_LOG',
      message: `Work description is too brief (${wordCount} words). Minimum 20 words expected.`,
      severity: 'low',
    })
  }

  // NO_JOB_REFERENCE: job_reference is null or empty
  if (!log.job_reference || log.job_reference.trim() === '') {
    flags.push({
      type: 'NO_JOB_REFERENCE',
      message: 'No job reference provided for this log entry.',
      severity: 'low',
    })
  }

  return flags
}

// ── Pending Log Review ────────────────────────────────────────────────────────

/**
 * Fetches all unreviewed crew logs for the current owner, runs anomaly detection,
 * persists flag data, and returns a categorized result with summary.
 */
export async function reviewPendingLogs(): Promise<ReviewResult> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return {
      flagged: [],
      clean: [],
      summary: 'Not authenticated — cannot fetch crew logs.',
    }
  }

  const { data: logs, error } = await supabase
    .from('crew_field_logs')
    .select('*')
    .eq('owner_id', user.id)
    .eq('reviewed_by_owner', false)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[GUARDIAN] reviewPendingLogs error:', error)
    return {
      flagged: [],
      clean: [],
      summary: 'Error fetching crew logs from database.',
    }
  }

  const flagged: CrewFieldLog[] = []
  const clean: CrewFieldLog[] = []

  for (const log of (logs || [])) {
    const detectedFlags = analyzeCrewLog(log as CrewFieldLog)

    if (detectedFlags.length > 0) {
      await supabase
        .from('crew_field_logs')
        .update({ flags: detectedFlags })
        .eq('id', log.id)

      flagged.push({ ...log, flags: detectedFlags } as CrewFieldLog)
    } else {
      clean.push({ ...log, flags: [] } as CrewFieldLog)
    }
  }

  const summary = buildReviewSummary(flagged)
  return { flagged, clean, summary }
}

function buildReviewSummary(flagged: CrewFieldLog[]): string {
  if (flagged.length === 0) return 'All crew logs are clear — no flags detected.'

  const typeCounts: Record<FlagType, number> = {
    MISSING_HOURS: 0,
    MISSING_MATERIALS: 0,
    LONG_SHIFT: 0,
    SHORT_LOG: 0,
    NO_JOB_REFERENCE: 0,
  }

  for (const log of flagged) {
    for (const flag of log.flags) {
      typeCounts[flag.type] = (typeCounts[flag.type] || 0) + 1
    }
  }

  const parts: string[] = []
  if (typeCounts.MISSING_HOURS > 0) parts.push(`${typeCounts.MISSING_HOURS} missing hours`)
  if (typeCounts.MISSING_MATERIALS > 0) parts.push(`${typeCounts.MISSING_MATERIALS} missing materials list`)
  if (typeCounts.LONG_SHIFT > 0) parts.push(`${typeCounts.LONG_SHIFT} long shift`)
  if (typeCounts.SHORT_LOG > 0) parts.push(`${typeCounts.SHORT_LOG} short log`)
  if (typeCounts.NO_JOB_REFERENCE > 0) parts.push(`${typeCounts.NO_JOB_REFERENCE} no job reference`)

  const flagDesc = parts.join('. ')
  return `${flagged.length} crew log${flagged.length !== 1 ? 's' : ''} need${flagged.length === 1 ? 's' : ''} review. ${flagDesc}.`
}

// ── Daily Crew Summary ────────────────────────────────────────────────────────

export async function getDailyCrewSummary(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return 'Not authenticated — cannot fetch crew summary.'

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data: logs, error } = await supabase
    .from('crew_field_logs')
    .select('*')
    .eq('owner_id', user.id)
    .gte('created_at', since)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[GUARDIAN] getDailyCrewSummary error:', error)
    return 'Error fetching crew logs.'
  }

  if (!logs || logs.length === 0) {
    return 'No crew logs in the last 24 hours.'
  }

  const byCrewMember = new Map<string, CrewFieldLog[]>()
  for (const log of logs) {
    const existing = byCrewMember.get(log.crew_name) || []
    existing.push(log as CrewFieldLog)
    byCrewMember.set(log.crew_name, existing)
  }

  const lines: string[] = [`Yesterday: ${logs.length} log${logs.length !== 1 ? 's' : ''} from ${byCrewMember.size} crew member${byCrewMember.size !== 1 ? 's' : ''}.`]

  for (const [crewName, crewLogs] of byCrewMember.entries()) {
    for (const log of crewLogs) {
      const detectedFlags = analyzeCrewLog(log)
      const hours = log.hours_logged !== null ? `${log.hours_logged} hour${log.hours_logged !== 1 ? 's' : ''}` : 'no hours logged'
      const job = log.job_reference || 'no job reference'

      if (detectedFlags.length === 0) {
        lines.push(`• ${crewName} logged ${hours} on ${job} — no flags.`)
      } else {
        const flagSummary = detectedFlags.map(f => {
          switch (f.type) {
            case 'MISSING_HOURS': return 'missing hours'
            case 'MISSING_MATERIALS': return 'missing materials list'
            case 'LONG_SHIFT': return `long shift (${log.hours_logged}h)`
            case 'SHORT_LOG': return 'short log entry'
            case 'NO_JOB_REFERENCE': return 'no job reference'
            default: return f.type.toLowerCase()
          }
        }).join(', ')
        lines.push(`• ${crewName} logged ${hours} on ${job} — flagged: ${flagSummary}.`)
      }
    }
  }

  return lines.join('\n')
}

// ── Mark Log as Reviewed ──────────────────────────────────────────────────────

export async function markLogReviewed(logId: string): Promise<boolean> {
  const { error } = await supabase
    .from('crew_field_logs')
    .update({ reviewed_by_owner: true })
    .eq('id', logId)

  if (error) {
    console.error('[GUARDIAN] markLogReviewed error:', error)
    return false
  }
  return true
}

export async function markAllLogsReviewed(): Promise<number> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return 0

  const { data, error } = await supabase
    .from('crew_field_logs')
    .update({ reviewed_by_owner: true })
    .eq('owner_id', user.id)
    .eq('reviewed_by_owner', false)
    .select('id')

  if (error) {
    console.error('[GUARDIAN] markAllLogsReviewed error:', error)
    return 0
  }
  return (data || []).length
}

// ── Activity Log Feed ─────────────────────────────────────────────────────────

/**
 * Fetch recent activity_log entries for the current user's org.
 * Returns entries enriched with anomaly flags.
 */
export async function getActivityFeed(limit = 50): Promise<ActivityEntry[]> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('activity_log')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('[GUARDIAN] getActivityFeed error:', error)
    return []
  }

  return (data || []).map(entry => {
    const flags = analyzeActivityEntry(entry as ActivityEntry)
    return {
      ...entry,
      isFlagged: flags.length > 0,
      flags,
    } as ActivityEntry
  })
}

// ── Activity Entry Anomaly Detection ─────────────────────────────────────────

/**
 * Analyzes a single activity_log entry for anomalies:
 * - Duplicate entries on same day/project
 * - Hours logged > 12h in a day per employee
 * - Material costs spiking > 2x project average
 * - Entries logged outside normal hours (before 6am or after 9pm)
 */
export function analyzeActivityEntry(entry: ActivityEntry): ActivityFlag[] {
  const flags: ActivityFlag[] = []
  const entryDate = new Date(entry.created_at)
  const hour = entryDate.getHours()
  const details = entry.details || {}

  // OUT_OF_HOURS: logged before 6am or after 9pm
  if (hour < 6 || hour >= 21) {
    flags.push({
      anomalyType: 'OUT_OF_HOURS',
      severity: 'medium',
      reason: `Entry logged at ${entryDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} — outside normal hours (6am–9pm).`,
      entryId: entry.id,
      entityLabel: entry.entity_label ?? undefined,
      timestamp: entry.created_at,
    })
  }

  // EXCESS_HOURS: hours_worked or hours field in details exceeds 12
  const hoursWorked =
    typeof details.hours_worked === 'number' ? details.hours_worked :
    typeof details.hours === 'number' ? details.hours :
    typeof details.hoursLogged === 'number' ? details.hoursLogged : null

  if (hoursWorked !== null && hoursWorked > 12) {
    flags.push({
      anomalyType: 'EXCESS_HOURS',
      severity: 'high',
      reason: `${hoursWorked}h logged in a single entry — exceeds 12-hour daily limit.`,
      entryId: entry.id,
      entityLabel: entry.entity_label ?? undefined,
      employeeName: details.employee_name ?? details.employeeName ?? undefined,
      timestamp: entry.created_at,
    })
  }

  // MATERIAL_COST_SPIKE: material_cost > 2x average (uses details.material_cost and details.project_avg_material_cost)
  const materialCost = typeof details.material_cost === 'number' ? details.material_cost : null
  const projectAvg = typeof details.project_avg_material_cost === 'number' ? details.project_avg_material_cost : null

  if (materialCost !== null && projectAvg !== null && projectAvg > 0 && materialCost > projectAvg * 2) {
    flags.push({
      anomalyType: 'MATERIAL_COST_SPIKE',
      severity: 'high',
      reason: `Material cost $${materialCost.toFixed(2)} is more than 2× project average ($${projectAvg.toFixed(2)}).`,
      entryId: entry.id,
      entityLabel: entry.entity_label ?? undefined,
      timestamp: entry.created_at,
    })
  }

  return flags
}

// ── Full Activity Analysis (30-day scan) ──────────────────────────────────────

/**
 * Fetch activity_log entries for the past N days and analyze them for all
 * anomaly types. Also detects DUPLICATE_SAME_DAY across the entire batch.
 */
export async function runActivityAnalysis(days = 30): Promise<ActivityAnalysisResult> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return {
      totalEntries: 0,
      flaggedCount: 0,
      cleanCount: 0,
      flags: [],
      summary: 'Not authenticated.',
    }
  }

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('activity_log')
    .select('*')
    .eq('user_id', user.id)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(500)

  if (error) {
    console.error('[GUARDIAN] runActivityAnalysis error:', error)
    return {
      totalEntries: 0,
      flaggedCount: 0,
      cleanCount: 0,
      flags: [],
      summary: `Error querying activity log: ${error.message}`,
    }
  }

  const entries: ActivityEntry[] = (data || []) as ActivityEntry[]
  const allFlags: ActivityFlag[] = []

  // Per-entry anomaly detection
  for (const entry of entries) {
    const entryFlags = analyzeActivityEntry(entry)
    allFlags.push(...entryFlags)
  }

  // DUPLICATE_SAME_DAY: same agent_name + entity_id + same calendar day
  const dayEntityMap = new Map<string, ActivityEntry[]>()
  for (const entry of entries) {
    if (!entry.entity_id) continue
    const day = entry.created_at.slice(0, 10) // YYYY-MM-DD
    const key = `${entry.agent_name}::${entry.entity_id}::${day}`
    const existing = dayEntityMap.get(key) || []
    existing.push(entry)
    dayEntityMap.set(key, existing)
  }

  for (const [, group] of dayEntityMap.entries()) {
    if (group.length >= 2) {
      // Flag the later duplicate entries
      for (let i = 1; i < group.length; i++) {
        const dup = group[i]
        allFlags.push({
          anomalyType: 'DUPLICATE_SAME_DAY',
          severity: 'medium',
          reason: `Duplicate entry detected: ${dup.entity_label || dup.entity_id} logged ${group.length}× on ${dup.created_at.slice(0, 10)}.`,
          entryId: dup.id,
          entityLabel: dup.entity_label ?? undefined,
          timestamp: dup.created_at,
        })
      }
    }
  }

  const flaggedEntryIds = new Set(allFlags.map(f => f.entryId))
  const flaggedCount = flaggedEntryIds.size
  const cleanCount = entries.length - flaggedCount

  const summary = buildActivitySummary(entries.length, allFlags, days)

  return {
    totalEntries: entries.length,
    flaggedCount,
    cleanCount,
    flags: allFlags,
    summary,
  }
}

function buildActivitySummary(total: number, flags: ActivityFlag[], days: number): string {
  if (flags.length === 0) {
    return `GUARDIAN scanned ${total} activity entries over the last ${days} days — no anomalies detected.`
  }

  const counts: Record<ActivityAnomalyType, number> = {
    DUPLICATE_SAME_DAY: 0,
    EXCESS_HOURS: 0,
    MATERIAL_COST_SPIKE: 0,
    OUT_OF_HOURS: 0,
  }

  for (const f of flags) {
    counts[f.anomalyType] = (counts[f.anomalyType] || 0) + 1
  }

  const parts: string[] = []
  if (counts.DUPLICATE_SAME_DAY > 0) parts.push(`${counts.DUPLICATE_SAME_DAY} duplicate entries`)
  if (counts.EXCESS_HOURS > 0) parts.push(`${counts.EXCESS_HOURS} excess-hours entries`)
  if (counts.MATERIAL_COST_SPIKE > 0) parts.push(`${counts.MATERIAL_COST_SPIKE} material cost spikes`)
  if (counts.OUT_OF_HOURS > 0) parts.push(`${counts.OUT_OF_HOURS} out-of-hours entries`)

  return `GUARDIAN found ${flags.length} anomalie${flags.length !== 1 ? 's' : ''} in ${total} entries over ${days} days: ${parts.join(', ')}.`
}

// ── Alert Routing (Part 3) ────────────────────────────────────────────────────

/**
 * Routes GUARDIAN anomaly flags to the Home panel alert store (customAlerts).
 * Each flag becomes an alert tagged with source: 'guardian'.
 * Deduplicates by entryId so repeated runs don't create duplicate alerts.
 */
export function routeGuardianAlerts(flags: ActivityFlag[]): void {
  if (!flags || flags.length === 0) return

  try {
    const backup = getBackupData()
    if (!backup) return

    if (!backup.customAlerts) backup.customAlerts = []

    // Deduplicate: skip if alert for this entryId already exists
    const existingIds = new Set(
      backup.customAlerts
        .filter((a: any) => a.source === 'guardian')
        .map((a: any) => a.guardianEntryId)
        .filter(Boolean)
    )

    let added = 0
    for (const flag of flags) {
      if (existingIds.has(flag.entryId)) continue

      const severityLabel = flag.severity === 'high' ? '🔴' : flag.severity === 'medium' ? '🟡' : '🟢'
      const typeLabel: Record<ActivityAnomalyType, string> = {
        DUPLICATE_SAME_DAY: 'Duplicate Entry',
        EXCESS_HOURS: 'Excess Hours',
        MATERIAL_COST_SPIKE: 'Material Cost Spike',
        OUT_OF_HOURS: 'After-Hours Entry',
      }

      backup.customAlerts.push({
        id: `guardian_${flag.entryId}_${flag.anomalyType}`,
        title: `${severityLabel} GUARDIAN: ${typeLabel[flag.anomalyType]}`,
        description: flag.reason,
        action: 'Review in GUARDIAN panel → Activity Feed',
        isAI: true,
        source: 'guardian',
        guardianEntryId: flag.entryId,
        guardianAnomalyType: flag.anomalyType,
        severity: flag.severity,
        createdAt: new Date().toISOString(),
      } as any)

      existingIds.add(flag.entryId)
      added++
    }

    if (added > 0) {
      saveBackupData(backup)
      console.log(`[GUARDIAN] Routed ${added} new alert${added !== 1 ? 's' : ''} to Home panel.`)
    }
  } catch (err) {
    console.error('[GUARDIAN] routeGuardianAlerts error:', err)
  }
}
