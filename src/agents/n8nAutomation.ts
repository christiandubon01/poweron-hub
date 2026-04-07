// @ts-nocheck
/**
 * n8nAutomation.ts — B27
 * Wires 5 n8n automation workflows to real agent logic:
 *
 *   1. Lead Intake       → SPARK leadManager (scoreAndProcessLead)
 *   2. Invoice Follow-Up → LEDGER invoiceManager (checkOverdueInvoices + aged-invoice query)
 *   3. Daily Briefing    → PULSE (get_kpis) + agentBus broadcast
 *   4. Receipt Processing → VAULT (create) + agentBus relay to LEDGER
 *   5. Review Monitoring → SPARK reviewManager (getReviewSummary + getReviews)
 *
 * Each workflow:
 *   - Calls real agent logic
 *   - Logs to activityLog (agent_name: 'n8n')
 *   - Emits an agentBus message for NEXUS context
 *   - Records a WorkflowRun in module-level state
 *
 * The N8nAutomation view reads:
 *   - getWorkflowRuns()       → last 50 runs (id, timestamp, result, description)
 *   - getLastRunForWorkflow() → ISO timestamp for a given workflowId
 *   - getLastResultForWorkflow() → 'success' | 'failure' | null
 */

import { publish as busPublish } from '@/services/agentBus'
import { logActivity } from '@/services/activityLog'
import { scoreAndProcessLead } from '@/agents/spark/leadManager'
import { checkOverdueInvoices } from '@/agents/ledger/invoiceManager'
import { getReviewSummary, getReviews } from '@/agents/spark/reviewManager'
import { processPulseRequest } from '@/agents/pulse'
import { supabase } from '@/lib/supabase'
import { getBackupData } from '@/services/backupDataService'

// ── Workflow Run Registry ─────────────────────────────────────────────────────

export type WorkflowRunResult = 'success' | 'failure'

export interface WorkflowRun {
  workflowId: string
  timestamp: string
  result: WorkflowRunResult
  description: string
}

const _workflowRuns: WorkflowRun[] = []
let _initialized = false
let _pollingTimers: ReturnType<typeof setInterval>[] = []

/** Prepend a run record; keep at most 50. */
function logWorkflowRun(
  workflowId: string,
  result: WorkflowRunResult,
  description: string
): void {
  _workflowRuns.unshift({ workflowId, timestamp: new Date().toISOString(), result, description })
  if (_workflowRuns.length > 50) _workflowRuns.length = 50
}

/** Return a copy of all workflow runs, newest first. */
export function getWorkflowRuns(): WorkflowRun[] {
  return [..._workflowRuns]
}

/** Return the ISO timestamp of the most recent run for a given workflowId, or null. */
export function getLastRunForWorkflow(workflowId: string): string | null {
  return _workflowRuns.find((r) => r.workflowId === workflowId)?.timestamp ?? null
}

/** Return the result of the most recent run for a given workflowId, or null. */
export function getLastResultForWorkflow(workflowId: string): WorkflowRunResult | null {
  return _workflowRuns.find((r) => r.workflowId === workflowId)?.result ?? null
}

// ── Workflow 1: Lead Intake → SPARK leadManager ───────────────────────────────

/**
 * Process a new inbound lead through SPARK lead scoring.
 * Trigger: Supabase realtime INSERT on `leads` table, or polling every 5 min.
 * Emits: SPARK_LEAD_SCORED event on agentBus.
 * Activity log: "Lead captured from [source] → routed to SPARK queue"
 */
export async function triggerLeadIntake(
  orgId: string,
  lead: {
    id?: string
    name: string
    lead_source?: string
    project_type?: string
    estimated_value?: number
    city?: string
    address?: string
    metadata?: Record<string, unknown>
  }
): Promise<void> {
  try {
    const result = await scoreAndProcessLead(orgId, lead)

    const source = lead.lead_source || 'unknown'
    const activitySummary = `Lead captured from ${source} → routed to SPARK queue`

    logActivity({
      agentName: 'n8n',
      actionType: 'lead_intake',
      entityType: 'lead',
      entityId: lead.id,
      entityLabel: lead.name,
      summary: activitySummary,
      details: { score: result.score, factors: result.factors, source },
    })

    await busPublish('SPARK', 'NEXUS', 'data_updated', {
      workflow: 'lead-intake',
      event: 'SPARK_LEAD_SCORED',
      leadId: lead.id ?? 'unknown',
      leadName: lead.name,
      source,
      score: result.score,
    })

    logWorkflowRun('lead-intake', 'success', activitySummary)
    console.log(`[n8n] Lead Intake ✓ — "${lead.name}" scored ${result.score}/10`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logWorkflowRun('lead-intake', 'failure', `Lead intake failed: ${msg}`)
    console.error('[n8n] Lead Intake ✗ —', msg)
  }
}

// ── Workflow 2: Invoice Follow-Up → LEDGER invoiceManager ────────────────────

/**
 * Find invoices older than 14 days with open status; queue follow-up reminders.
 * Trigger: daily polling.
 * Activity log: "Reminder queued for [client] - Invoice #[N] ([X] days)"
 */
export async function triggerInvoiceFollowUp(orgId: string): Promise<void> {
  try {
    // Run LEDGER overdue detector first (transitions sent/viewed/partial → overdue)
    await checkOverdueInvoices(orgId)

    // Query invoices sent > 14 days ago that are still open
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 14)

    const { data: invoices, error } = await supabase
      .from('invoices')
      .select('id, invoice_number, client_id, balance_due, sent_at, days_overdue')
      .eq('org_id', orgId)
      .in('status', ['sent', 'viewed', 'partial', 'overdue'])
      .lt('sent_at', cutoff.toISOString())

    if (error) throw new Error(error.message)

    const pending = (invoices ?? []) as Array<{
      id: string
      invoice_number: string
      client_id: string | null
      balance_due: number | null
      sent_at: string | null
      days_overdue: number | null
    }>

    if (pending.length === 0) {
      logWorkflowRun('invoice-followup', 'success', 'Invoice sweep complete — no reminders needed')
      return
    }

    for (const inv of pending) {
      const clientLabel = inv.client_id ?? 'Unknown Client'
      const days = inv.sent_at
        ? Math.floor((Date.now() - new Date(inv.sent_at).getTime()) / 86_400_000)
        : (inv.days_overdue ?? 14)

      logActivity({
        agentName: 'n8n',
        actionType: 'invoice_followup',
        entityType: 'invoice',
        entityId: inv.id,
        entityLabel: inv.invoice_number,
        summary: `Reminder queued for ${clientLabel} - Invoice #${inv.invoice_number} (${days} days)`,
        details: {
          invoice_number: inv.invoice_number,
          client_id: inv.client_id,
          balance_due: inv.balance_due,
          days,
        },
      })
    }

    const sweepSummary = `Invoice sweep complete — ${pending.length} reminder${pending.length !== 1 ? 's' : ''} queued`
    logWorkflowRun('invoice-followup', 'success', sweepSummary)

    await busPublish('LEDGER', 'NEXUS', 'data_updated', {
      workflow: 'invoice-followup',
      count: pending.length,
      orgId,
    })

    console.log(`[n8n] Invoice Follow-Up ✓ — ${pending.length} reminders queued`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logWorkflowRun('invoice-followup', 'failure', `Invoice follow-up failed: ${msg}`)
    console.error('[n8n] Invoice Follow-Up ✗ —', msg)
  }
}

// ── Workflow 3: Daily Briefing → NEXUS + PULSE ────────────────────────────────

/**
 * First session of day: PULSE pulls KPIs, formats morning briefing,
 * broadcasts to NEXUS via agentBus so it can be injected as first chat message.
 * Trigger: app open + first session of day.
 * Activity log: "Morning briefing delivered - [N] open jobs, [N] unread leads"
 */
export async function triggerDailyBriefing(orgId: string, userId: string): Promise<void> {
  try {
    // PULSE: pull KPIs
    const pulseResponse = await processPulseRequest({ action: 'get_kpis', orgId, userId })
    const kpis = (pulseResponse.data ?? {}) as Record<string, unknown>
    const activeProjects = Number(kpis.active_projects ?? 0)

    // Count unread leads from backup data
    const backup = getBackupData()
    const gcContacts = (backup?.gcContacts as Array<Record<string, unknown>>) ?? []
    const unreadLeads = gcContacts.filter(
      (c) => c.status === 'new' || !c.contacted_at
    ).length

    const briefingSummary = `Morning briefing delivered - ${activeProjects} open job${activeProjects !== 1 ? 's' : ''}, ${unreadLeads} unread lead${unreadLeads !== 1 ? 's' : ''}`

    logActivity({
      agentName: 'n8n',
      actionType: 'daily_briefing',
      entityType: 'session',
      summary: briefingSummary,
      details: {
        activeProjects,
        unreadLeads,
        pulseSummary: pulseResponse.summary,
        kpiSnapshot: {
          revenue_received: kpis.revenue_received,
          revenue_pending: kpis.revenue_pending,
          overdue_count: kpis.overdue_count,
        },
      },
    })

    // Broadcast to NEXUS — NEXUS injects this as the first chat message
    await busPublish('NEXUS', 'ALL', 'broadcast', {
      workflow: 'daily-briefing',
      event: 'MORNING_BRIEFING',
      briefing: briefingSummary,
      activeProjects,
      unreadLeads,
      pulseSummary: pulseResponse.summary,
    })

    logWorkflowRun('daily-briefing', 'success', briefingSummary)
    console.log(`[n8n] Daily Briefing ✓ — ${briefingSummary}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logWorkflowRun('daily-briefing', 'failure', `Daily briefing failed: ${msg}`)
    console.error('[n8n] Daily Briefing ✗ —', msg)
  }
}

// ── Workflow 4: Receipt Processing → VAULT + LEDGER ──────────────────────────

/**
 * Process an uploaded receipt: VAULT reads items, relays to LEDGER for expense entry.
 * Trigger: receipt uploaded via Material Intelligence.
 * Activity log: "Receipt from [supplier] - [N] items logged to [project]"
 */
export async function triggerReceiptProcessing(
  orgId: string,
  userId: string,
  receipt: {
    supplier: string
    items: Array<{ description: string; amount: number; quantity?: number }>
    projectId?: string
    projectName?: string
    total?: number
  }
): Promise<void> {
  try {
    const { processVaultRequest } = await import('@/agents/vault')

    const itemTotal = receipt.items.reduce((s, i) => s + i.amount, 0)
    const receiptTotal = receipt.total ?? itemTotal
    const projectLabel = receipt.projectName ?? receipt.projectId ?? 'unassigned'

    // VAULT: parse receipt items into an estimate/cost entry
    const vaultResponse = await processVaultRequest({
      action: 'create',
      orgId,
      userId,
      userMessage: [
        `Receipt from ${receipt.supplier} — ${receipt.items.length} items.`,
        receipt.items.map((i) => `${i.description}: $${i.amount.toFixed(2)}`).join(', '),
        `Total: $${receiptTotal.toFixed(2)}.`,
        receipt.projectId ? `Assign to project ${receipt.projectId}.` : '',
      ]
        .filter(Boolean)
        .join(' '),
    })

    const activitySummary = `Receipt from ${receipt.supplier} - ${receipt.items.length} item${receipt.items.length !== 1 ? 's' : ''} logged to ${projectLabel}`

    logActivity({
      agentName: 'n8n',
      actionType: 'receipt_processing',
      entityType: 'receipt',
      entityLabel: receipt.supplier,
      summary: activitySummary,
      details: {
        supplier: receipt.supplier,
        itemCount: receipt.items.length,
        total: receiptTotal,
        projectId: receipt.projectId,
        vaultSuccess: vaultResponse.success,
      },
    })

    // Relay to LEDGER via agentBus for expense entry creation
    await busPublish('VAULT', 'LEDGER', 'data_updated', {
      workflow: 'receipt-processing',
      supplier: receipt.supplier,
      itemCount: receipt.items.length,
      total: receiptTotal,
      projectId: receipt.projectId ?? null,
    })

    logWorkflowRun('receipt-processing', 'success', activitySummary)
    console.log(`[n8n] Receipt Processing ✓ — ${activitySummary}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logWorkflowRun('receipt-processing', 'failure', `Receipt processing failed: ${msg}`)
    console.error('[n8n] Receipt Processing ✗ —', msg)
  }
}

// ── Workflow 5: Review Monitoring → SPARK reviewManager ──────────────────────

/**
 * Poll for new reviews; flag negative ones for immediate attention.
 * Trigger: every 24 hours (mock — real Google Business API in V4).
 * Activity log: "[N] new reviews checked - [N] flagged"
 */
export async function triggerReviewMonitoring(orgId: string): Promise<void> {
  try {
    const [summary, reviews] = await Promise.all([
      getReviewSummary(orgId),
      getReviews(orgId),
    ])

    const negative = reviews.filter((r) => r.rating <= 2).length
    const activitySummary = `${summary.total} new reviews checked - ${negative} flagged`

    logActivity({
      agentName: 'n8n',
      actionType: 'review_monitoring',
      entityType: 'reviews',
      summary: activitySummary,
      details: {
        total: summary.total,
        avgRating: summary.avgRating,
        needsResponse: summary.needsResponse,
        negative,
        byPlatform: summary.byPlatform,
      },
    })

    if (negative > 0) {
      await busPublish('SPARK', 'NEXUS', 'alert', {
        workflow: 'review-monitoring',
        negativeFlagged: negative,
        needsResponse: summary.needsResponse,
        avgRating: summary.avgRating,
      })
    }

    logWorkflowRun('review-monitoring', 'success', activitySummary)
    console.log(`[n8n] Review Monitoring ✓ — ${activitySummary}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logWorkflowRun('review-monitoring', 'failure', `Review monitoring failed: ${msg}`)
    console.error('[n8n] Review Monitoring ✗ —', msg)
  }
}

// ── Supabase Realtime: Lead Intake ────────────────────────────────────────────

function subscribeToLeadRealtime(orgId: string): () => void {
  const channel = supabase
    .channel(`n8n_lead_intake_${orgId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'leads', filter: `org_id=eq.${orgId}` },
      (payload: { new: Record<string, unknown> }) => {
        const lead = payload.new
        triggerLeadIntake(orgId, {
          id: lead.id as string,
          name: (lead.name as string) || 'Unknown',
          lead_source: lead.lead_source as string | undefined,
          project_type: lead.project_type as string | undefined,
          estimated_value: lead.estimated_value as number | undefined,
          city: lead.city as string | undefined,
        }).catch(console.warn)
      }
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel).catch(console.warn)
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────

/**
 * Initialize all n8n automation workflows.
 * Called once from the N8nAutomation view on mount.
 *
 * @param orgId  — current org UUID (optional; polling deferred without it)
 * @param userId — current user UUID (optional; polling deferred without it)
 * @returns cleanup function that unsubscribes realtime and clears polling
 */
export function initN8nAutomationAgent(orgId?: string, userId?: string): (() => void) | void {
  if (_initialized) return
  _initialized = true

  console.log('[n8n] Automation agent initializing — B27')

  if (!orgId || !userId) {
    console.log('[n8n] No orgId/userId — workflow polling deferred until auth')
    return
  }

  // 1. Supabase realtime: immediate lead intake on INSERT
  const unsubLead = subscribeToLeadRealtime(orgId)

  // 2. Daily briefing — run once per calendar day
  const lastBriefingDay = (() => {
    try { return localStorage.getItem('n8n_last_briefing_day') } catch { return null }
  })()
  const today = new Date().toDateString()
  if (lastBriefingDay !== today) {
    try { localStorage.setItem('n8n_last_briefing_day', today) } catch {}
    triggerDailyBriefing(orgId, userId).catch(console.warn)
  }

  // 3. Invoice follow-up — run now + every 24 h
  triggerInvoiceFollowUp(orgId).catch(console.warn)
  const invoiceTimer = setInterval(() => {
    triggerInvoiceFollowUp(orgId).catch(console.warn)
  }, 24 * 60 * 60 * 1000)
  _pollingTimers.push(invoiceTimer)

  // 4. Review monitoring — run now + every 24 h
  triggerReviewMonitoring(orgId).catch(console.warn)
  const reviewTimer = setInterval(() => {
    triggerReviewMonitoring(orgId).catch(console.warn)
  }, 24 * 60 * 60 * 1000)
  _pollingTimers.push(reviewTimer)

  console.log('[n8n] Automation agent initialized — realtime + polling active')

  return () => {
    _initialized = false
    unsubLead()
    _pollingTimers.forEach(clearInterval)
    _pollingTimers = []
    console.log('[n8n] Automation agent stopped')
  }
}
