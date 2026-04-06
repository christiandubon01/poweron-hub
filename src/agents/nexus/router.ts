/**
 * Agent Router — Loads agent-specific context from Supabase and routes
 * classified intents to the correct agent for a response via Claude API.
 *
 * Context loading follows the NEXUS Context Loader table from Phase 01 spec:
 * each agent domain maps to specific Supabase tables and load strategies.
 */

import { supabase } from '@/lib/supabase'
import { buildSystemPrompt, detectAndApplyStrategicMode } from './systemPrompt'
import { callClaude, extractText } from '@/services/claudeProxy'
import { getEventContext } from '@/services/agentEventBus'
import { getLedgerContext } from '@/services/ledgerDataBridge'
import { getBackupData, getProjectFinancials, num } from '@/services/backupDataService'
import { buildOwnerProfileContext } from '@/services/ownerProfileService'
import { useDemoStore } from '@/store/demoStore'
import type { ClassifiedIntent, ConversationMessage, TargetAgent } from './classifier'

// ── Status Bucket Helpers ───────────────────────────────────────────────────

function resolveStatusBucket(status: string): 'ACTIVE CONSTRUCTION' | 'ESTIMATING' | 'COMPLETED' | 'OTHER' {
  const s = (status || '').toLowerCase().trim()
  if (s === 'active' || s === 'in_progress' || s === 'construction') return 'ACTIVE CONSTRUCTION'
  if (s === 'estimate' || s === 'estimating' || s === 'coming') return 'ESTIMATING'
  if (s === 'complete' || s === 'completed') return 'COMPLETED'
  return 'OTHER'
}

/**
 * Build a project status/financials summary from local backup data.
 * Returns a formatted context string for injection into the Claude prompt.
 */
export function getLocalProjectContext(): string {
  const backup = getBackupData()
  if (!backup) return ''

  const projects = Array.isArray(backup.projects) ? backup.projects : []
  if (projects.length === 0) return ''

  const buckets: Record<string, { count: number; contract: number; collected: number; names: string[] }> = {
    'ACTIVE CONSTRUCTION': { count: 0, contract: 0, collected: 0, names: [] },
    'ESTIMATING': { count: 0, contract: 0, collected: 0, names: [] },
    'COMPLETED': { count: 0, contract: 0, collected: 0, names: [] },
    'OTHER': { count: 0, contract: 0, collected: 0, names: [] },
  }

  for (const p of projects) {
    const bucket = resolveStatusBucket(p.status)
    const fin = getProjectFinancials(p, backup)
    buckets[bucket].count++
    buckets[bucket].contract += fin.contract
    buckets[bucket].collected += fin.paid
    if (p.name) buckets[bucket].names.push(p.name)
  }

  const lines: string[] = ['## Local Project Status (from device state)']
  for (const [label, data] of Object.entries(buckets)) {
    if (data.count === 0) continue
    lines.push(`**${label}:** ${data.count} project${data.count !== 1 ? 's' : ''} | Contract: $${data.contract.toLocaleString()} | Collected: $${data.collected.toLocaleString()}`)
    if (data.names.length) lines.push(`  Projects: ${data.names.slice(0, 5).join(', ')}`)
  }

  return lines.join('\n')
}

/**
 * Build a weekly revenue context from local backup data (logs).
 * Groups logs by ISO week, returns this week / last week / 4-week avg.
 */
export function getLocalPulseWeeklyContext(): string {
  const backup = getBackupData()
  if (!backup) return ''

  const allLogs = [
    ...(Array.isArray(backup.logs) ? backup.logs : []),
    ...(Array.isArray(backup.serviceLogs) ? backup.serviceLogs : []),
  ]
  if (allLogs.length === 0) return ''

  // Get ISO week number
  function isoWeek(dateStr: string): string {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return ''
    const jan1 = new Date(d.getFullYear(), 0, 1)
    const week = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7)
    return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`
  }

  const weekBuckets = new Map<string, number>()
  for (const log of allLogs) {
    const dateStr: string = (log as any).date || ''
    if (!dateStr) continue
    const wk = isoWeek(dateStr)
    if (!wk) continue
    const collected = num((log as any).collected)
    weekBuckets.set(wk, (weekBuckets.get(wk) || 0) + collected)
  }

  const sortedWeeks = Array.from(weekBuckets.entries()).sort((a, b) => b[0].localeCompare(a[0]))
  const thisWeek = sortedWeeks[0]?.[1] ?? 0
  const lastWeek = sortedWeeks[1]?.[1] ?? 0
  const last4 = sortedWeeks.slice(0, 4).map(([, v]) => v)
  const avg4 = last4.length ? last4.reduce((s, v) => s + v, 0) / last4.length : 0

  return `## PULSE — Weekly Revenue (from device state)\nThis week: $${thisWeek.toLocaleString()} | Last week: $${lastWeek.toLocaleString()} | 4-week avg: $${Math.round(avg4).toLocaleString()}`
}

// ── Query-aware context scoping ─────────────────────────────────────────────

interface ScopedLocalContext {
  serviceLogs: unknown[]
  projects: unknown[]
  financialSummary: string
}

/**
 * Scope local backup context to the query type.
 * Service call queries → only serviceLogs. Project queries → only projects.
 * Ambiguous queries → both. Always includes a financial summary.
 */
function scopeContextToQuery(query: string, backup: any): ScopedLocalContext {
  const isServiceCall = /service call|service job|svc|collection|uncollected|open collection/i.test(query)
  const isProject = /project|job|construction|estimate|active job/i.test(query)

  // Build financial summary (always included)
  const serviceLogs = Array.isArray(backup.serviceLogs) ? backup.serviceLogs : []
  const projects = Array.isArray(backup.projects) ? backup.projects : []

  const totalQuoted = serviceLogs.reduce((s: number, l: any) => s + num(l.quoted), 0)
  const totalCollected = serviceLogs.reduce((s: number, l: any) => s + num(l.collected), 0)
  const totalUncollected = totalQuoted - totalCollected
  const projectContract = projects.reduce((s: number, p: any) => {
    const fin = getProjectFinancials(p, backup)
    return s + fin.contract
  }, 0)
  const projectPaid = projects.reduce((s: number, p: any) => {
    const fin = getProjectFinancials(p, backup)
    return s + fin.paid
  }, 0)

  const financialSummary = [
    `## Financial Summary`,
    `Service calls: ${serviceLogs.length} total | Quoted: $${totalQuoted.toLocaleString()} | Collected: $${totalCollected.toLocaleString()} | Uncollected: $${totalUncollected.toLocaleString()}`,
    `Projects: ${projects.length} total | Contract: $${projectContract.toLocaleString()} | Paid: $${projectPaid.toLocaleString()}`,
  ].join('\n')

  // When service call specific — filter to open/uncollected service logs only
  const openServiceLogs = serviceLogs.filter((l: any) => {
    const quoted = num(l.quoted)
    const collected = num(l.collected)
    const adjustmentIncome = Array.isArray(l.adjustments)
      ? l.adjustments.filter((a: any) => a.kind === 'income').reduce((s: number, a: any) => s + num(a.amount), 0)
      : 0
    const totalBillable = quoted + adjustmentIncome
    return collected < totalBillable || totalBillable - collected > 0
  })

  return {
    serviceLogs: isServiceCall || (!isProject) ? openServiceLogs : [],
    projects: isProject || (!isServiceCall) ? projects : [],
    financialSummary,
  }
}

/**
 * Build a scoped local context string based on query type.
 * Injects only the relevant data (service logs vs projects vs both).
 */
export function getLocalScopedContext(query: string): string {
  const backup = getBackupData()
  if (!backup) return ''

  const scoped = scopeContextToQuery(query, backup)
  const lines: string[] = []

  if (scoped.financialSummary) lines.push(scoped.financialSummary)

  if (scoped.projects.length > 0) {
    const buckets: Record<string, { count: number; contract: number; collected: number; names: string[] }> = {
      'ACTIVE CONSTRUCTION': { count: 0, contract: 0, collected: 0, names: [] },
      'ESTIMATING': { count: 0, contract: 0, collected: 0, names: [] },
      'COMPLETED': { count: 0, contract: 0, collected: 0, names: [] },
    }
    for (const p of scoped.projects as any[]) {
      const bucket = resolveStatusBucket(p.status)
      const fin = getProjectFinancials(p, backup)
      if (!buckets[bucket]) buckets[bucket] = { count: 0, contract: 0, collected: 0, names: [] }
      buckets[bucket].count++
      buckets[bucket].contract += fin.contract
      buckets[bucket].collected += fin.paid
      if (p.name) buckets[bucket].names.push(p.name)
    }
    lines.push('\n## Projects')
    for (const [label, data] of Object.entries(buckets)) {
      if (data.count === 0) continue
      lines.push(`**${label}:** ${data.count} | Contract: $${data.contract.toLocaleString()} | Collected: $${data.collected.toLocaleString()}`)
      if (data.names.length) lines.push(`  ${data.names.slice(0, 8).join(', ')}`)
    }
  }

  if (scoped.serviceLogs.length > 0) {
    lines.push(`\n## Open Service Calls (${scoped.serviceLogs.length} uncollected)`)
    for (const log of (scoped.serviceLogs as any[]).slice(0, 20)) {
      const quoted = num(log.quoted)
      const collected = num(log.collected)
      const remaining = quoted - collected
      lines.push(`- ${log.customer || 'Unknown'} | ${log.date || ''} | Quoted: $${quoted} | Collected: $${collected} | Remaining: $${remaining}`)
    }
  }

  return lines.join('\n')
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface AgentResponse {
  agentId:     TargetAgent
  agentName:   string
  content:     string
  impactLevel: ClassifiedIntent['impactLevel']
  /** If the agent proposes an action, describe it here */
  proposedAction?: {
    description: string
    entityType:  string
    entityId?:   string
    payload:     Record<string, unknown>
  }
}

// ── Agent display names ─────────────────────────────────────────────────────

const AGENT_DISPLAY_NAMES: Record<TargetAgent, string> = {
  nexus:     'NEXUS',
  vault:     'VAULT',
  pulse:     'PULSE',
  ledger:    'LEDGER',
  spark:     'SPARK',
  blueprint: 'BLUEPRINT',
  ohm:       'OHM',
  chrono:    'CHRONO',
  scout:     'SCOUT',
}

// ── Agent system prompt fragments ───────────────────────────────────────────
// Each agent gets a brief identity + domain focus appended to the NEXUS base prompt

const AGENT_PROMPTS: Record<TargetAgent, string> = {
  nexus: '',  // Uses base NEXUS_SYSTEM_PROMPT directly
  vault: `You are now acting as VAULT, the Estimating Agent. You specialize in bids, cost history, margin analysis, pricing, and material costs. Use the price book, material takeoffs, and project cost data to give precise answers. Always show your math. Respond in narrative prose — name the specific project, material, or cost category, explain why the number matters, and give a specific recommendation.`,
  pulse: `You are now acting as PULSE, the Dashboard Agent. You specialize in KPIs, charts, performance metrics, weekly revenue tracking, and business intelligence. Reference the 52-week tracker for revenue trends. Do not produce raw lists of numbers — explain what the trends mean for the business and what action they suggest. Use real week numbers, real revenue figures, and real comparison periods.`,
  ledger: `You are now acting as LEDGER, the Money Agent. IMPORTANT: Only add information that NEXUS has not already covered in this conversation. This question was explicitly routed to you for financial detail — but if the user asked a general financial context question (not a specific invoice/AR/collection question), say so and defer to NEXUS framing. When you respond: name the specific client, the actual dollar amount owed, and the actual days overdue. Explain why that aging bucket matters for this contractor right now and give one specific, named collection action. Do not list numbers without explaining what each one means and what to do.`,
  spark: `You are now acting as SPARK, the Marketing Agent. You specialize in leads, campaigns, reviews, social media presence, and GC relationship management. Reference gc_contacts for pipeline data and win rates. Respond in narrative — name the specific GC or lead, explain the relationship status, and give a specific next outreach action.`,
  blueprint: `You are now acting as BLUEPRINT, the Project Framework Agent. You specialize in project phases, templates, permits, RFIs, change orders, coordination items, field logs, and material takeoffs. Name the specific project, its current phase, and the specific coordination gap or RFI. Explain what the stall means for timeline and cash flow and give one concrete next action.`,
  ohm: `You are now acting as OHM, the Electrical Coach. You specialize in NEC compliance, electrical safety, code questions, and training recommendations. Always cite specific NEC articles when relevant. Give practical, actionable guidance alongside the code reference — not just the article number.`,
  chrono: `You are now acting as CHRONO, the Calendar Agent. You specialize in job scheduling, crew dispatch, reminders, and agenda task management. Name the specific job, date, and crew member when relevant. Explain scheduling conflicts or idle slots in terms of their business impact — what does an idle day cost at Christian's current overhead rate?`,
  scout: `You are now acting as SCOUT, the System Analyzer. You detect patterns, anomalies, and optimization opportunities across the entire system. CRITICAL: Your proposals go to the silent improvement queue ONLY — you NEVER interrupt the active conversation with flagged items. If this message is not an explicit "Scout, analyze..." or user-submitted improvement idea trigger, return an empty JSON array []. Do not respond conversationally. When you do produce proposals, they enter the MiroFish verification chain before the user sees them.`,
}

// ── Context Loader ──────────────────────────────────────────────────────────
// Maps each agent to the Supabase tables and queries it needs.
// Based on the NEXUS Context Loader table from Phase 01 spec.

interface ContextSlice {
  label:     string
  data:      unknown[]
  count:     number
}

/**
 * Load agent-specific context from Supabase based on the target agent.
 * Returns a formatted string summary for injection into the Claude prompt.
 */
async function loadAgentContext(
  orgId:       string,
  targetAgent: TargetAgent,
  entities:    ClassifiedIntent['entities']
): Promise<string> {
  const slices: ContextSlice[] = []

  // Extract entity hints for targeted queries
  const projectId  = entities.find(e => e.type === 'project')?.id
  const clientId   = entities.find(e => e.type === 'client')?.id
  const invoiceId  = entities.find(e => e.type === 'invoice')?.id

  try {
    // ── Shared: always load active projects summary ──────────────────────
    // Include all known status variants from both Supabase and local backup
    const { data: projects } = await supabase
      .from('projects')
      .select('id, name, status, type, priority, estimated_value, contract_value, phase')
      .eq('org_id', orgId)
      .in('status', [
        'in_progress', 'approved', 'estimate', 'pending', 'punch_list',
        'active', 'construction', 'estimating', 'coming', 'complete', 'completed',
      ])
      .order('updated_at', { ascending: false })
      .limit(20)

    if (projects?.length) {
      // Annotate each project with its resolved bucket for Claude clarity
      const annotated = (projects as Array<Record<string, unknown>>).map(p => ({
        ...p,
        _bucket: resolveStatusBucket(String(p['status'] ?? '')),
      }))
      slices.push({ label: 'Active Projects', data: annotated, count: annotated.length })
    }

    // ── Always inject local device project context (source of truth) ─────
    const localProjectCtx = getLocalProjectContext()
    if (localProjectCtx) {
      slices.push({ label: 'Local Project Summary', data: [localProjectCtx], count: 1 })
    }

    // ── Agent-specific context loading ──────────────────────────────────

    switch (targetAgent) {
      case 'vault': {
        // Price book (cached — full catalog)
        const { data: priceBook } = await supabase
          .from('price_book_items' as never)
          .select('name, unit_cost, unit, supplier, category_name')
          .eq('org_id', orgId)
          .limit(50)
        if (priceBook?.length) slices.push({ label: 'Price Book (sample)', data: priceBook, count: priceBook.length })

        // Active material takeoffs
        if (projectId) {
          const { data: mtos } = await supabase
            .from('material_takeoff_lines' as never)
            .select('phase, item_name, quantity, unit_cost, waste_factor, line_total')
            .eq('takeoff_id', projectId)
            .limit(30)
          if (mtos?.length) slices.push({ label: 'Material Takeoff Lines', data: mtos, count: mtos.length })
        }

        // Project cost summary
        const { data: costSummary } = await supabase
          .from('project_cost_summary' as never)
          .select('*')
          .eq('org_id', orgId)
          .limit(10)
        if (costSummary?.length) slices.push({ label: 'Cost Summary', data: costSummary, count: costSummary.length })

        // Material receipts — variance tracking
        const { data: receipts } = await supabase
          .from('material_receipts' as never)
          .select('project_id, phase, total, mto_estimated, variance_amount, variance_pct, receipt_date')
          .eq('org_id', orgId)
          .order('receipt_date', { ascending: false })
          .limit(20)
        if (receipts?.length) slices.push({ label: 'Material Receipts (recent)', data: receipts, count: receipts.length })
        break
      }

      case 'pulse': {
        // ── Local device weekly revenue data (ground truth) ─────────────
        const localPulseCtx = getLocalPulseWeeklyContext()
        if (localPulseCtx) {
          slices.push({ label: 'Local Weekly Revenue', data: [localPulseCtx], count: 1 })
        }

        // 52-week tracker — current fiscal year (Supabase cloud data)
        const { data: weekly } = await supabase
          .from('weekly_tracker' as never)
          .select('week_number, active_projects, service_revenue, project_revenue, unbilled_amount, ytd_revenue')
          .eq('org_id', orgId)
          .order('week_number', { ascending: false })
          .limit(12)
        if (weekly?.length) slices.push({ label: '52-Week Tracker (recent)', data: weekly, count: weekly.length })

        // Field logs — last 30 days summary
        const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
        const { data: fieldLogs } = await supabase
          .from('field_logs' as never)
          .select('project_id, log_date, hours, material_cost, pay_status')
          .eq('org_id', orgId)
          .gte('log_date', thirtyDaysAgo)
          .order('log_date', { ascending: false })
          .limit(50)
        if (fieldLogs?.length) slices.push({ label: 'Field Logs (30d)', data: fieldLogs, count: fieldLogs.length })
        break
      }

      case 'ledger': {
        // ── Local state data (ground truth for this contractor) ──────────
        try {
          const localLedger = getLedgerContext()
          if (localLedger) {
            slices.push({ label: 'Local Financial Data', data: [localLedger], count: 1 })
          }
        } catch (err) {
          console.warn('[Router] Local ledger data load failed:', err)
        }

        // ── Supabase invoices (cloud data, if available) ─────────────────
        const { data: invoices } = await supabase
          .from('invoices')
          .select('id, invoice_number, status, total, balance_due, due_date, days_overdue')
          .eq('org_id', orgId)
          .in('status', ['sent', 'viewed', 'partial', 'overdue'])
          .order('days_overdue', { ascending: false })
          .limit(20)
        if (invoices?.length) slices.push({ label: 'Outstanding Invoices', data: invoices, count: invoices.length })

        // Field logs with unpaid status
        const { data: unpaidLogs } = await supabase
          .from('field_logs' as never)
          .select('project_id, log_date, hours, material_cost, pay_status')
          .eq('org_id', orgId)
          .eq('pay_status', 'unpaid')
          .limit(30)
        if (unpaidLogs?.length) slices.push({ label: 'Unpaid Field Logs', data: unpaidLogs, count: unpaidLogs.length })
        break
      }

      case 'spark': {
        // Lead pipeline
        const { data: leads } = await supabase
          .from('leads' as never)
          .select('name, status, lead_source, estimated_value, project_type, created_at')
          .eq('org_id', orgId)
          .order('created_at', { ascending: false })
          .limit(20)
        if (leads?.length) slices.push({ label: 'Lead Pipeline', data: leads, count: leads.length })

        // GC contacts pipeline
        const { data: gcContacts } = await supabase
          .from('gc_contacts' as never)
          .select('name, company, fit_score, activity_score, historical_win_rate, relationship_health, total_projects, total_revenue')
          .eq('org_id', orgId)
          .order('fit_score', { ascending: false })
          .limit(15)
        if (gcContacts?.length) slices.push({ label: 'GC Pipeline', data: gcContacts, count: gcContacts.length })

        // Recent GC activity
        const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString()
        const { data: gcActivity } = await supabase
          .from('gc_activity_log' as never)
          .select('activity_type, description, activity_date, created_at')
          .eq('org_id', orgId)
          .gte('created_at', ninetyDaysAgo)
          .order('created_at', { ascending: false })
          .limit(20)
        if (gcActivity?.length) slices.push({ label: 'GC Activity (90d)', data: gcActivity, count: gcActivity.length })

        // Campaigns
        const { data: campaigns } = await supabase
          .from('campaigns' as never)
          .select('name, campaign_type, start_date, budget, status')
          .eq('org_id', orgId)
          .order('start_date', { ascending: false })
          .limit(10)
        if (campaigns?.length) slices.push({ label: 'Campaigns', data: campaigns, count: campaigns.length })

        // Clients
        const { data: clients } = await supabase
          .from('clients')
          .select('id, name, company, type, source, tags')
          .eq('org_id', orgId)
          .order('updated_at', { ascending: false })
          .limit(15)
        if (clients?.length) slices.push({ label: 'Recent Clients', data: clients, count: clients.length })
        break
      }

      case 'blueprint': {
        // Coordination items — open + in_progress
        const { data: coordination } = await supabase
          .from('coordination_items' as never)
          .select('project_id, category, title, status, due_date')
          .eq('org_id', orgId)
          .in('status', ['open', 'in_progress'])
          .order('due_date', { ascending: true })
          .limit(25)
        if (coordination?.length) slices.push({ label: 'Open Coordination Items', data: coordination, count: coordination.length })

        // Field logs — last 30 days
        const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
        const { data: fieldLogs } = await supabase
          .from('field_logs' as never)
          .select('project_id, employee_id, log_date, hours, material_cost, notes')
          .eq('org_id', orgId)
          .gte('log_date', thirtyDaysAgo)
          .order('log_date', { ascending: false })
          .limit(30)
        if (fieldLogs?.length) slices.push({ label: 'Field Logs (30d)', data: fieldLogs, count: fieldLogs.length })
        break
      }

      case 'ohm': {
        // Field logs for safety context
        const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
        const { data: fieldLogs } = await supabase
          .from('field_logs' as never)
          .select('project_id, log_date, notes')
          .eq('org_id', orgId)
          .gte('log_date', thirtyDaysAgo)
          .limit(20)
        if (fieldLogs?.length) slices.push({ label: 'Recent Field Logs', data: fieldLogs, count: fieldLogs.length })

        // Coordination items for compliance context
        const { data: coordination } = await supabase
          .from('coordination_items' as never)
          .select('project_id, category, title, status')
          .eq('org_id', orgId)
          .in('category', ['permit', 'inspect'])
          .in('status', ['open', 'in_progress'])
          .limit(15)
        if (coordination?.length) slices.push({ label: 'Permit/Inspect Items', data: coordination, count: coordination.length })
        break
      }

      case 'chrono': {
        // Calendar events — upcoming 14 days
        const now = new Date().toISOString()
        const twoWeeksOut = new Date(Date.now() + 14 * 86400000).toISOString()
        const { data: calEvents } = await supabase
          .from('calendar_events' as never)
          .select('title, event_type, start_time, end_time, location, address')
          .eq('org_id', orgId)
          .gte('start_time', now)
          .lte('start_time', twoWeeksOut)
          .order('start_time', { ascending: true })
          .limit(25)
        if (calEvents?.length) slices.push({ label: 'Upcoming Events (14d)', data: calEvents, count: calEvents.length })

        // Agenda tasks — pending only
        const { data: agendaTasks } = await supabase
          .from('agenda_tasks' as never)
          .select('title, task_type, status, assigned_to, due_date, priority')
          .eq('org_id', orgId)
          .in('status', ['pending', 'in_progress'])
          .order('due_date', { ascending: true })
          .limit(20)
        if (agendaTasks?.length) slices.push({ label: 'Pending Agenda Tasks', data: agendaTasks, count: agendaTasks.length })

        // Job schedules — active
        const { data: jobSchedules } = await supabase
          .from('job_schedules' as never)
          .select('calendar_event_id, employee_id, lead_role, job_status, estimated_hours')
          .eq('org_id', orgId)
          .in('job_status', ['scheduled', 'confirmed', 'in_progress'])
          .limit(20)
        if (jobSchedules?.length) slices.push({ label: 'Active Job Schedules', data: jobSchedules, count: jobSchedules.length })

        // Field logs for scheduling context
        const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]
        const { data: fieldLogs } = await supabase
          .from('field_logs' as never)
          .select('project_id, log_date, hours')
          .eq('org_id', orgId)
          .gte('log_date', sevenDaysAgo)
          .limit(20)
        if (fieldLogs?.length) slices.push({ label: 'Field Logs (7d)', data: fieldLogs, count: fieldLogs.length })
        break
      }

      case 'scout': {
        // Scout gets broad access — load summaries from multiple domains
        const { data: invoices } = await supabase
          .from('invoices')
          .select('status, total, balance_due, days_overdue')
          .eq('org_id', orgId)
          .in('status', ['overdue', 'sent', 'partial'])
          .limit(10)
        if (invoices?.length) slices.push({ label: 'Outstanding Invoices', data: invoices, count: invoices.length })

        const { data: weekly } = await supabase
          .from('weekly_tracker' as never)
          .select('week_number, ytd_revenue, unbilled_amount')
          .eq('org_id', orgId)
          .order('week_number', { ascending: false })
          .limit(4)
        if (weekly?.length) slices.push({ label: 'Recent Weeks', data: weekly, count: weekly.length })
        break
      }

      case 'nexus':
      default:
        // NEXUS uses the shared projects context loaded above
        break
    }
  } catch (err) {
    console.error(`[Router] Context loading failed for ${targetAgent}:`, err)
  }

  // Format slices into a readable context string
  if (slices.length === 0) return ''

  return slices
    .map(s => `### ${s.label} (${s.count} records)\n${JSON.stringify(s.data, null, 2)}`)
    .join('\n\n')
}


// ── Route to Agent ──────────────────────────────────────────────────────────

/**
 * Route a classified intent to the target agent.
 * Loads context from Supabase, builds the agent prompt, and calls Claude.
 */
export async function routeToAgent(
  intent:       ClassifiedIntent,
  userMessage:  string,
  orgId:        string,
  conversationHistory: ConversationMessage[],
  options?: { isListQuery?: boolean; isResearchQuery?: boolean; operationalContext?: string }
): Promise<AgentResponse> {
  const targetAgent = intent.targetAgent
  const agentName   = AGENT_DISPLAY_NAMES[targetAgent]

  // 1. Load agent-specific context from Supabase
  const contextData = await loadAgentContext(orgId, targetAgent, intent.entities)

  // 1b. Load query-scoped local context (service calls vs projects vs both)
  const scopedLocalCtx = getLocalScopedContext(userMessage)

  // 2. Build the system prompt: base NEXUS + agent-specific identity + events
  const agentPromptFragment = AGENT_PROMPTS[targetAgent]
  const eventContext = getEventContext(6)

  const capabilitySummary = `
APP CAPABILITY AWARENESS:
You know what this app can and cannot do. Key limitations right now:
- Calendar is display-only — no auto-scheduling from voice commands yet (Phase D)
- Service call creation is manual — no voice-to-log yet
- Leads tab has no auto-scoring or market research yet (V3)
- Estimates require manual entry — no voice-to-estimate yet
- Google Calendar sync not built yet (Phase D)
- Push notifications not built yet (Phase H)

When a user asks if the app can do something:
1. Check your knowledge of current capabilities
2. If it can do it — tell them exactly how
3. If it cannot — tell them directly and suggest saving the idea to their improvement bucket
4. Never make up capabilities that don't exist
`

  // Detect strategic/development questions and temporarily switch to strategic mode.
  // Store the previous mode so we can log the switch (mode persists until user
  // explicitly changes it or sends a non-strategic message — acceptable UX trade-off).
  const previousMode = detectAndApplyStrategicMode(userMessage)
  if (previousMode) {
    console.log(`[Router] Strategic mode activated for this response (was: ${previousMode})`)
  }

  // Owner profile — loaded from localStorage cache (no async needed in hot path)
  const ownerProfileCtx = buildOwnerProfileContext()

  // Operational context from NEXUS live data build (injected per session)
  const operationalCtx = options?.operationalContext || ''

  // ── NEXUS-FIRST RESPONSE PROTOCOL ────────────────────────────────────────
  // When routing to a specialist agent, NEXUS must always synthesize a direct
  // conversational answer FIRST before the specialist adds domain-specific detail.
  // This prevents raw data dumps and ensures every response feels like an
  // intelligent orchestrator answer, not a database query result.
  //
  // Rules:
  //  1. NEXUS synthesis: 2-4 sentences, plain language, directly answers the question.
  //  2. Specialist detail: only appended if it adds GENUINELY NEW info not in the synthesis.
  //  3. If synthesis fully covers the question, no specialist section at all.
  //  4. Never start with a table, bullet list, or raw numbers — start conversationally.
  // ──────────────────────────────────────────────────────────────────────────

  const nexusFirstProtocol = targetAgent !== 'nexus' ? `

## NEXUS-FIRST RESPONSE PROTOCOL — MANDATORY

You are NEXUS, the orchestrator for Power On Solutions. Before any specialist data or formatting, you MUST answer the question directly in plain conversational language.

**Structure your response in this exact order:**

**1. NEXUS Direct Answer (REQUIRED — always first):**
Answer what was asked in 2–4 sentences using plain conversational language.
- Draw from the full project context, operational data, and conversation history.
- Be specific — use real project names, real dollar amounts, real dates.
- No bullet lists, no headers, no tables in this section. Just a clear direct answer.
- Simple questions get 2 sentences. Complex analysis gets 4 sentences max.

**2. ${agentName} Supplementary Detail (OPTIONAL — only include if it adds NEW information):**
After the NEXUS synthesis, ${agentName} may add specialist-specific data only if:
- The user asked for specific ${agentName}-domain data (invoices, code citations, schedule items, pricing, leads)
- The detail is NOT already covered in the NEXUS synthesis above
- It genuinely helps the user act on the answer

If the NEXUS synthesis already fully answered the question — stop there. Do NOT add a ${agentName} section just to show data.

**PROHIBITED:**
- Starting the response with a table, data dump, or bullet list
- Answering as only a specialist without NEXUS synthesis first
- Repeating in the specialist section what NEXUS already said
- Using "Here is the data:" or similar database-query language as the opener

**EXAMPLE of what NOT to do (wrong):**
"LEDGER Report: Outstanding AR: $42,500. Project: Desert Solar | Balance: $18,000 | Status: Overdue..."

**EXAMPLE of what to do (right):**
"Based on your current projects, you have three active construction jobs and about $42,500 in outstanding receivables across them. Desert Solar has the largest open balance at $18,000. Your service call collections are running about 78% this month — better than last month but still below your 85% target. LEDGER sees one invoice that's 45 days past due on Desert Solar — worth a follow-up call this week."
` : ''

  // ── Demo Mode: inject industry-specific NEXUS personality prefix ──────────
  let demoPersonalityPrefix = ''
  try {
    const demoState = useDemoStore.getState()
    if (demoState.isDemoMode) {
      const personality = demoState.getDemoData('nexusPersonality')
      if (personality && typeof personality === 'string') {
        demoPersonalityPrefix = `## Demo Mode — NEXUS Personality\n${personality}\n`
      }
    }
  } catch { /* ignore — never block a query */ }

  const systemPrompt = [
    demoPersonalityPrefix ? `${demoPersonalityPrefix}\n---\n\n` : '',
    buildSystemPrompt(),
    `\n---\n\n${capabilitySummary}`,
    ownerProfileCtx ? `\n---\n\n${ownerProfileCtx}` : '',
    agentPromptFragment ? `\n---\n\n## Agent Mode\n${agentPromptFragment}` : '',
    nexusFirstProtocol ? `\n---\n${nexusFirstProtocol}` : '',
    operationalCtx ? `\n---\n\n${operationalCtx}` : '',
    contextData ? `\n---\n\n## Live Data Context\n${contextData}` : '',
    scopedLocalCtx ? `\n---\n\n## Local Device Data (scoped to query)\n${scopedLocalCtx}` : '',
    eventContext ? `\n---\n\n${eventContext}` : '',
    `\n---\n\n## Classification\nCategory: ${intent.category}\nConfidence: ${intent.confidence}\nImpact: ${intent.impactLevel}\nEntities: ${JSON.stringify(intent.entities)}`,
  ].join('')

  // 3. Build messages array from conversation history with labeled turn numbers
  const recentHistory = conversationHistory.slice(-10)
  const hasHistory = recentHistory.length > 0

  const messages = [
    ...recentHistory.map((m, index) => ({
      role: m.role as 'user' | 'assistant',
      content: m.role === 'assistant'
        ? `[Turn ${index + 1} - via ${m.agentId || 'nexus'}]: ${m.content}`
        : `[Turn ${index + 1}]: ${m.content}`,
    })),
    { role: 'user' as const, content: userMessage },
  ]

  // 3b. Inject conversation context instruction when history exists
  if (hasHistory) {
    const contextNote = `\n---\n\nCONVERSATION CONTEXT: You have ${recentHistory.length} previous turns above. When the user refers to "that", "it", "the list", "was that", or any reference to a previous response, look at the MOST RECENT assistant turn and answer based on that specific content. Do not default to a financial briefing if the question is a follow-up.`
    // Append to system prompt by modifying the messages (system prompt is already built)
    messages[messages.length - 1] = {
      role: 'user',
      content: userMessage + contextNote,
    }
  }

  // 4. Call Claude via proxy — token limit varies by query type
  const maxTokens = options?.isListQuery ? 1200 : options?.isResearchQuery ? 1500 : 2048

  // Web search tool — enabled for research queries so Claude can look up
  // NEC codes, industry benchmarks, pricing data, installation methods, etc.
  const tools = options?.isResearchQuery
    ? [{ type: 'web_search_20250305', name: 'web_search' }]
    : undefined

  const claudeResponse = await callClaude({
    system: systemPrompt,
    messages,
    max_tokens: maxTokens,
    ...(tools ? { tools } : {}),
  })

  const content = extractText(claudeResponse) || 'No response generated.'

  console.log(`[Router] ${agentName} Claude response:`, content?.substring(0, 120))

  return {
    agentId:     targetAgent,
    agentName,
    content,
    impactLevel: intent.impactLevel,
  }
}
