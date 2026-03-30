// @ts-nocheck
/**
 * Activity Log Service — lightweight plain-English audit trail.
 *
 * Writes to the `activity_log` Supabase table (migration 036).
 * All writes are fire-and-forget — callers never await logActivity().
 *
 * Exposes:
 *   logActivity()          — fire-and-forget insert
 *   getRecentActivity()    — last N rows DESC
 *   getActivitySummary()   — plain English paragraph for NEXUS voice/text
 */

import { supabase } from '@/lib/supabase'

// ── Types ───────────────────────────────────────────────────────────────────

export interface ActivityEntry {
  id:            string
  agent_name:    string
  action_type:   string
  entity_type?:  string
  entity_id?:    string
  entity_label?: string
  summary:       string
  details:       Record<string, unknown>
  created_at:    string
}

export interface LogActivityParams {
  agentName:    string
  actionType:   string
  entityType?:  string
  entityId?:    string
  entityLabel?: string
  summary:      string
  details?:     object
}

// ── logActivity ─────────────────────────────────────────────────────────────

/**
 * Fire-and-forget activity log insert.
 * Never awaited by callers — all errors are swallowed silently.
 */
export function logActivity(params: LogActivityParams): void {
  // Kick off async work without blocking the caller
  ;(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return   // Not authenticated — log nothing silently

      await supabase.from('activity_log').insert({
        user_id:      user.id,
        agent_name:   params.agentName,
        action_type:  params.actionType,
        entity_type:  params.entityType  ?? null,
        entity_id:    params.entityId    ?? null,
        entity_label: params.entityLabel ?? null,
        summary:      params.summary,
        details:      params.details     ?? {},
      })
    } catch {
      // Intentionally swallowed — activity logging must never crash callers
    }
  })()
}

// ── getRecentActivity ────────────────────────────────────────────────────────

/**
 * Return the last `limit` activity rows, newest first.
 */
export async function getRecentActivity(limit = 20): Promise<ActivityEntry[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []

    const { data, error } = await supabase
      .from('activity_log')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.error('[activityLog] getRecentActivity error:', error)
      return []
    }

    return (data || []) as ActivityEntry[]
  } catch {
    return []
  }
}

// ── getActivitySummary ───────────────────────────────────────────────────────

/**
 * Fetch all activity in the last `hours` hours and return a plain English
 * paragraph grouped by agent — suitable for NEXUS voice/text responses.
 *
 * Example output:
 *   "In the last 24 hours: VAULT saved 2 estimates totaling $8,200.
 *    LEDGER recorded 1 payment of $2,400. SCOUT flagged 1 gap.
 *    CHRONO scheduled 3 jobs — no conflicts."
 */
export async function getActivitySummary(hours = 24): Promise<string> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return 'No activity recorded.'

    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()

    const { data, error } = await supabase
      .from('activity_log')
      .select('agent_name, action_type, summary, details, created_at')
      .eq('user_id', user.id)
      .gte('created_at', since)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[activityLog] getActivitySummary error:', error)
      return 'Unable to retrieve activity summary.'
    }

    const rows = data || []

    if (rows.length === 0) {
      return `No activity recorded in the last ${hours} hours.`
    }

    // Group by agent
    const byAgent: Record<string, typeof rows> = {}
    for (const row of rows) {
      const a = row.agent_name || 'UNKNOWN'
      if (!byAgent[a]) byAgent[a] = []
      byAgent[a].push(row)
    }

    const parts: string[] = []

    // Build plain English sentence per agent
    for (const [agent, entries] of Object.entries(byAgent)) {
      const count = entries.length

      switch (agent) {
        case 'VAULT': {
          // Try to sum totals from details
          let total = 0
          for (const e of entries) {
            const d = e.details as any
            total += d?.total || 0
          }
          const amtStr = total > 0 ? ` totaling $${total.toLocaleString()}` : ''
          parts.push(`VAULT saved ${count} estimate${count !== 1 ? 's' : ''}${amtStr}`)
          break
        }
        case 'LEDGER': {
          let total = 0
          for (const e of entries) {
            const d = e.details as any
            total += d?.amount || 0
          }
          const amtStr = total > 0 ? ` of $${total.toLocaleString()}` : ''
          parts.push(`LEDGER recorded ${count} payment${count !== 1 ? 's' : ''}${amtStr}`)
          break
        }
        case 'BLUEPRINT': {
          parts.push(`BLUEPRINT updated ${count} project${count !== 1 ? 's' : ''}`)
          break
        }
        case 'CHRONO': {
          const conflicts = entries.filter(e => (e.details as any)?.conflict_flag).length
          const conflictStr = conflicts > 0 ? ` — ${conflicts} conflict${conflicts !== 1 ? 's' : ''} detected` : ' — no conflicts'
          parts.push(`CHRONO scheduled ${count} job${count !== 1 ? 's' : ''}${conflictStr}`)
          break
        }
        case 'SPARK': {
          parts.push(`SPARK logged ${count} new lead${count !== 1 ? 's' : ''}`)
          break
        }
        case 'SCOUT': {
          parts.push(`SCOUT flagged ${count} gap${count !== 1 ? 's' : ''}`)
          break
        }
        case 'MIROFISH': {
          parts.push(`MiroFish approved ${count} proposal${count !== 1 ? 's' : ''}`)
          break
        }
        default: {
          parts.push(`${agent} logged ${count} action${count !== 1 ? 's' : ''}`)
          break
        }
      }
    }

    const label = hours === 24 ? 'last 24 hours' : hours === 168 ? 'last 7 days' : `last ${hours} hours`
    return `In the ${label}: ${parts.join('. ')}.`
  } catch {
    return 'Unable to retrieve activity summary.'
  }
}
