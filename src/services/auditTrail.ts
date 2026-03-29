// @ts-nocheck
/**
 * Audit Trail Service — MiroFish-aware audit log with CSV export.
 *
 * Extends the existing audit system (src/lib/memory/audit.ts) with:
 * - MiroFish proposal audit entries (full 5-step chain tracking)
 * - Filtered queries by agent, action type, date range
 * - CSV export for compliance and reporting
 * - Summary statistics for the Settings UI
 *
 * Uses the existing Supabase `audit_log` table — no schema changes needed.
 */

import { supabase } from '@/lib/supabase'
import { logAudit, getAuditLog, type AuditAction } from '@/lib/memory/audit'

// ── Types ───────────────────────────────────────────────────────────────────

export interface AuditEntry {
  id:          string
  orgId:       string
  actorType:   string
  actorId:     string | null
  actorName:   string | null
  action:      string
  entityType:  string
  entityId:    string | null
  description: string | null
  changes:     Record<string, unknown> | null
  metadata:    Record<string, unknown> | null
  createdAt:   string
}

export interface AuditQueryOptions {
  limit?:       number
  offset?:      number
  entityType?:  string
  entityId?:    string
  actorId?:     string
  action?:      AuditAction
  agentName?:   string   // Filter by proposing agent (in metadata)
  dateFrom?:    string   // ISO date
  dateTo?:      string   // ISO date
}

export interface AuditStats {
  totalEntries:     number
  last24h:          number
  proposalsCreated: number
  proposalsApproved: number
  proposalsRejected: number
  topAgents:        { agent: string; count: number }[]
}

// ── Query Functions ─────────────────────────────────────────────────────────

/**
 * Get audit log entries with extended filtering.
 */
export async function queryAuditTrail(options: AuditQueryOptions = {}): Promise<AuditEntry[]> {
  let query = supabase
    .from('audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(options.limit ?? 100)

  if (options.offset) {
    query = query.range(options.offset, options.offset + (options.limit ?? 100) - 1)
  }

  if (options.entityType) query = query.eq('entity_type', options.entityType)
  if (options.entityId)   query = query.eq('entity_id', options.entityId)
  if (options.actorId)    query = query.eq('actor_id', options.actorId)
  if (options.action)     query = query.eq('action', options.action)
  if (options.dateFrom)   query = query.gte('created_at', options.dateFrom)
  if (options.dateTo)     query = query.lte('created_at', options.dateTo)

  const { data, error } = await query

  if (error) {
    console.error('[AuditTrail] Query failed:', error)
    return []
  }

  let entries = (data ?? []).map(mapDbToAuditEntry)

  // Client-side filter for agent name (stored in metadata)
  if (options.agentName) {
    entries = entries.filter(e =>
      e.metadata?.proposing_agent === options.agentName ||
      e.metadata?.agent === options.agentName ||
      e.description?.includes(options.agentName!)
    )
  }

  return entries
}

/**
 * Get MiroFish-specific audit entries (proposals only).
 */
export async function getMiroFishAuditTrail(orgId: string, limit = 50): Promise<AuditEntry[]> {
  return queryAuditTrail({
    entityType: 'agent_proposals',
    limit,
  })
}

/**
 * Get audit summary stats for the Settings UI.
 */
export async function getAuditStats(): Promise<AuditStats> {
  const now = new Date()
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()

  // Total entries
  const { count: totalEntries } = await supabase
    .from('audit_log')
    .select('id', { count: 'exact', head: true })

  // Last 24h
  const { count: last24h } = await supabase
    .from('audit_log')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', dayAgo)

  // Proposal-specific counts
  const { count: proposalsCreated } = await supabase
    .from('audit_log')
    .select('id', { count: 'exact', head: true })
    .eq('entity_type', 'agent_proposals')
    .eq('action', 'insert')

  const { count: proposalsApproved } = await supabase
    .from('audit_log')
    .select('id', { count: 'exact', head: true })
    .eq('entity_type', 'agent_proposals')
    .eq('action', 'update')
    .ilike('description', '%confirmed%')

  const { count: proposalsRejected } = await supabase
    .from('audit_log')
    .select('id', { count: 'exact', head: true })
    .eq('entity_type', 'agent_proposals')
    .eq('action', 'update')
    .ilike('description', '%rejected%')

  // Top agents (from recent proposal entries)
  const { data: recentProposalEntries } = await supabase
    .from('audit_log')
    .select('metadata')
    .eq('entity_type', 'agent_proposals')
    .order('created_at', { ascending: false })
    .limit(200)

  const agentCounts = new Map<string, number>()
  for (const entry of recentProposalEntries ?? []) {
    const agent = (entry.metadata as any)?.proposing_agent as string
    if (agent) {
      agentCounts.set(agent, (agentCounts.get(agent) ?? 0) + 1)
    }
  }

  const topAgents = Array.from(agentCounts.entries())
    .map(([agent, count]) => ({ agent, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  return {
    totalEntries:     totalEntries ?? 0,
    last24h:          last24h ?? 0,
    proposalsCreated: proposalsCreated ?? 0,
    proposalsApproved: proposalsApproved ?? 0,
    proposalsRejected: proposalsRejected ?? 0,
    topAgents,
  }
}

// ── CSV Export ───────────────────────────────────────────────────────────────

/**
 * Export audit entries as CSV string.
 * Suitable for download or compliance reporting.
 */
export function exportAuditToCSV(entries: AuditEntry[]): string {
  const headers = [
    'Timestamp',
    'Action',
    'Entity Type',
    'Entity ID',
    'Actor',
    'Actor Type',
    'Description',
    'Metadata',
  ]

  const rows = entries.map(entry => [
    entry.createdAt,
    entry.action,
    entry.entityType,
    entry.entityId ?? '',
    entry.actorName ?? entry.actorId ?? '',
    entry.actorType,
    escapeCSV(entry.description ?? ''),
    escapeCSV(JSON.stringify(entry.metadata ?? {})),
  ])

  const csvLines = [
    headers.join(','),
    ...rows.map(row => row.join(',')),
  ]

  return csvLines.join('\n')
}

/**
 * Generate and trigger a CSV download in the browser.
 */
export async function downloadAuditCSV(options: AuditQueryOptions = {}): Promise<void> {
  const entries = await queryAuditTrail({ ...options, limit: options.limit ?? 1000 })
  const csv = exportAuditToCSV(entries)

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  const dateStr = new Date().toISOString().split('T')[0]
  link.setAttribute('href', url)
  link.setAttribute('download', `poweron_audit_${dateStr}.csv`)
  link.style.display = 'none'

  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)

  // Log the export action
  await logAudit({
    action:      'export',
    entity_type: 'audit_log',
    description: `Audit log exported as CSV (${entries.length} entries)`,
    metadata:    { entry_count: entries.length, filters: options },
  })
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function mapDbToAuditEntry(row: any): AuditEntry {
  return {
    id:          row.id,
    orgId:       row.org_id,
    actorType:   row.actor_type ?? 'unknown',
    actorId:     row.actor_id,
    actorName:   row.actor_name,
    action:      row.action,
    entityType:  row.entity_type,
    entityId:    row.entity_id,
    description: row.description,
    changes:     row.changes,
    metadata:    row.metadata,
    createdAt:   row.created_at,
  }
}

function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

// ── Re-exports from core audit ──────────────────────────────────────────────

export { logAudit, getAuditLog } from '@/lib/memory/audit'
