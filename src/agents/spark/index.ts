// @ts-nocheck
/**
 * SPARK Orchestrator — Marketing & Sales intelligence for PowerOn Hub
 *
 * Phase E additions (full automation):
 * - get_reviews:       Fetch last 10 Google Business reviews via Netlify proxy
 * - draft_response:    AI-draft a review response → MiroFish approval required
 * - log_lead:          Create a new lead record in Supabase
 * - list_leads:        Return leads by status
 * - create_follow_up:  Set follow_up_date on a lead
 * - send_campaign:     Route campaign send through MiroFish approval before delivery
 *
 * Original actions preserved:
 * - get_pipeline, get_leads, create_lead, update_lead_status
 * - get_gc_contacts, update_gc_scores, log_gc_activity
 * - get_campaigns, create_campaign, get_campaign_roi
 * - draft_review_response, get_review_summary
 */

import { SPARK_SYSTEM_PROMPT } from './systemPrompt'
import { createLead as createLeadLegacy, updateLeadStatus, getLeads as getLeadsLegacy, getLeadPipelineSummary } from './leadManager'
import { getGCContacts, updateGCScores, logGCActivity } from './gcManager'
import { getCampaigns, createCampaign as createCampaignLegacy, calculateCampaignROI } from './campaignManager'
import { getReviews as getReviewsLegacy, draftReviewResponse as draftReviewResponseLegacy, getReviewSummary } from './reviewManager'
import { logAudit } from '@/lib/memory/audit'
import { submitProposal, runAutomatedReview } from '@/services/miroFish'
import {
  getReviews,
  draftReviewResponse as draftReviewService,
  postReviewResponse,
  createLead as createLeadService,
  getLeads as getLeadsService,
  scheduleFollowUp,
  updateLeadStatus as updateLeadStatusService,
  sendCampaign as sendCampaignService,
} from '@/services/sparkService'
import { subscribe as agentBusSubscribe } from '@/services/agentBus'
import type { AgentMessage } from '@/services/agentBus'
import { publish } from '@/services/agentEventBus'
import { logActivity } from '@/services/activityLog'

// Types
export type SparkAction =
  | 'get_pipeline' | 'get_leads' | 'create_lead' | 'update_lead_status'
  | 'get_gc_contacts' | 'update_gc_scores' | 'log_gc_activity'
  | 'get_campaigns' | 'create_campaign' | 'get_campaign_roi'
  | 'get_reviews' | 'draft_review_response' | 'get_review_summary'
  // Phase E new tools:
  | 'draft_response' | 'log_lead' | 'list_leads' | 'create_follow_up' | 'send_campaign'

export interface SparkRequest {
  action: SparkAction
  orgId: string
  userId: string
  params?: Record<string, unknown>
}

export interface SparkResponse {
  action: SparkAction
  data: unknown
  summary: string
  timestamp: string
}

export { SPARK_SYSTEM_PROMPT }

// Main processor
export async function processSparkRequest(request: SparkRequest): Promise<SparkResponse> {
  const startTime = Date.now()

  try {
    let data: unknown
    let summary: string = ''

    switch (request.action) {
      case 'get_pipeline':
        data = await getLeadPipelineSummary(request.orgId)
        summary = await generateSparkSummary('pipeline', data)
        break

      case 'get_leads':
        data = await getLeads(request.orgId, request.params as any)
        summary = `Found ${(data as any[]).length} leads`
        break

      case 'create_lead':
        data = await createLead(request.orgId, request.params as any)
        summary = `Lead "${(data as any).name}" created successfully`
        break

      case 'update_lead_status':
        data = await updateLeadStatus(
          request.params?.leadId as string,
          request.params?.status as any,
          request.params?.details as any
        )
        summary = `Lead status updated to ${(data as any).status}`
        break

      case 'get_gc_contacts':
        data = await getGCContacts(request.orgId, request.params as any)
        summary = `Found ${(data as any[]).length} GC contacts`
        break

      case 'update_gc_scores':
        data = await updateGCScores(request.params?.gcContactId as string, request.orgId)
        summary = `GC scores updated: fit=${(data as any).fit_score}, health=${(data as any).relationship_health}`
        break

      case 'log_gc_activity':
        data = await logGCActivity(request.orgId, request.params?.gcContactId as string, request.params as any)
        summary = `Activity logged for GC contact`
        break

      case 'get_campaigns':
        data = await getCampaigns(request.orgId)
        summary = `Found ${(data as any[]).length} campaigns`
        break

      case 'create_campaign':
        data = await createCampaign(request.orgId, request.params as any)
        summary = `Campaign "${(data as any).name}" created`
        break

      case 'get_campaign_roi':
        data = await calculateCampaignROI(request.params?.campaignId as string)
        summary = `Campaign ROI: ${(data as any).roi_pct}%`
        break

      case 'draft_review_response':
        data = await draftReviewResponse(
          request.orgId,
          request.params?.reviewId as string,
          request.params?.reviewText as string,
          request.params?.rating as number,
          request.userId
        )
        summary = 'Review response drafted — awaiting approval'
        break

      case 'get_review_summary':
        data = await getReviewSummary(request.orgId)
        summary = await generateSparkSummary('reviews', data)
        break

      // ── Phase E: SPARK Full Automation Tools ──────────────────────────────

      /**
       * get_reviews — Fetch last 10 Google Business reviews via Netlify proxy.
       * Publishes REVIEW_RECEIVED to NEXUS for morning briefing.
       */
      case 'get_reviews': {
        data = await getReviews()
        const reviewArr = data as any[]
        summary = `Fetched ${reviewArr.length} reviews from Google Business`

        // Notify NEXUS for any unanswered reviews
        const unanswered = reviewArr.filter((r: any) => !r.reviewReply)
        if (unanswered.length > 0) {
          publish(
            'REVIEW_RECEIVED' as any,
            'spark',
            { count: unanswered.length, reviews: unanswered.map((r: any) => ({ id: r.reviewId, rating: r.starRating })) },
            `${unanswered.length} unanswered Google Business review(s) need attention`
          )
        }
        break
      }

      /**
       * draft_response — AI-draft a review response using electrical contractor persona.
       * DOES NOT POST — submits a MiroFish proposal for Christian to approve.
       */
      case 'draft_response': {
        const reviewText = request.params?.reviewText as string
        const reviewId   = request.params?.reviewId as string

        if (!reviewText) throw new Error('draft_response requires params.reviewText')

        const draftText = await draftReviewService(reviewText)

        // Submit to MiroFish — SPARK does NOT post directly
        const proposal = await submitProposal({
          orgId:          request.orgId,
          proposingAgent: 'spark',
          title:          `Review Response — ${(reviewText || '').slice(0, 60)}...`,
          description:    `SPARK drafted a review response for approval. Review ID: ${reviewId || 'unknown'}`,
          category:       'operations',
          impactLevel:    'medium',
          actionType:     'post_review_response',
          actionPayload:  { reviewId, responseText: draftText },
          sourceData:     { reviewText, reviewId },
        })

        await runAutomatedReview(proposal.id!)

        data    = { draft: draftText, proposalId: proposal.id }
        summary = 'Review response drafted — MiroFish proposal created, awaiting Christian\'s approval'
        break
      }

      /**
       * log_lead — Create a new lead record in Supabase leads table.
       */
      case 'log_lead': {
        const leadData = request.params as any
        if (!leadData?.name) throw new Error('log_lead requires params.name')

        data    = await createLeadService(leadData)
        summary = `Lead "${leadData.name}" logged from ${leadData.source || 'manual'}`

        // Activity log (fire-and-forget)
        logActivity({
          agentName:   'SPARK',
          actionType:  'lead_created',
          entityType:  'lead',
          entityLabel: leadData.name,
          summary:     `SPARK logged new lead: ${leadData.name} — ${leadData.service_requested || 'service TBD'}`,
          details:     { name: leadData.name, source: leadData.source, service_requested: leadData.service_requested },
        })
        break
      }

      /**
       * list_leads — Return leads, optionally filtered by status.
       */
      case 'list_leads': {
        const statusFilter = request.params?.status as string | undefined
        data    = await getLeadsService(statusFilter as any)
        const leadsArr = data as any[]
        summary = statusFilter
          ? `Found ${leadsArr.length} leads with status "${statusFilter}"`
          : `Found ${leadsArr.length} total leads`
        break
      }

      /**
       * create_follow_up — Set follow_up_date on an existing lead.
       */
      case 'create_follow_up': {
        const leadId   = request.params?.leadId as string
        const dateStr  = request.params?.date as string

        if (!leadId || !dateStr) throw new Error('create_follow_up requires params.leadId and params.date')

        const followUpDate = new Date(dateStr)
        data    = await scheduleFollowUp(leadId, followUpDate)
        summary = `Follow-up scheduled for lead ${leadId} on ${dateStr}`
        break
      }

      /**
       * send_campaign — Route campaign send through MiroFish before execution.
       * SPARK submits a proposal — does NOT send directly.
       */
      case 'send_campaign': {
        const campaignId = request.params?.campaignId as string
        if (!campaignId) throw new Error('send_campaign requires params.campaignId')

        // Submit MiroFish proposal — do NOT call sendCampaignService directly
        const proposal = await submitProposal({
          orgId:          request.orgId,
          proposingAgent: 'spark',
          title:          `Send Email Campaign — ${campaignId}`,
          description:    `SPARK requests approval to send email campaign ${campaignId} to its target segment.`,
          category:       'operations',
          impactLevel:    'high',
          actionType:     'send_email_campaign',
          actionPayload:  { campaignId },
          sourceData:     { campaignId, requestedBy: request.userId },
        })

        await runAutomatedReview(proposal.id!)

        data    = { proposalId: proposal.id, campaignId }
        summary = 'Campaign send routed through MiroFish — awaiting Christian\'s approval before delivery'
        break
      }

      default:
        throw new Error(`Unknown SPARK action: ${request.action}`)
    }

    // Audit
    await logAudit({
      orgId: request.orgId,
      actorType: 'agent',
      actorId: 'spark',
      action: 'fetch',
      entityType: 'marketing',
      description: `SPARK executed ${request.action}`,
      metadata: { action: request.action, duration: Date.now() - startTime },
    })

    return {
      action: request.action,
      data,
      summary,
      timestamp: new Date().toISOString(),
    }
  } catch (error) {
    console.error('[SPARK] processSparkRequest error:', error)

    await logAudit({
      orgId: request.orgId,
      actorType: 'agent',
      actorId: 'spark',
      action: 'error',
      entityType: 'marketing',
      description: `SPARK error on ${request.action}`,
      metadata: { error: String(error) },
    })

    throw error
  }
}

// ── Phase D Part 2: SPARK ↔ CHRONO agentBus Route ────────────────────────────

/**
 * In-memory store for idle slot follow-up opportunities received from CHRONO.
 * Phase E automation will read this to auto-schedule outreach.
 * SPARK never auto-sends anything — it only stores for later.
 */
export interface FollowUpOpportunity {
  date: string
  idleHours: number
  suggestions: string[]
  receivedAt: string
  source: 'CHRONO'
}

let _followUpOpportunities: FollowUpOpportunity[] = []

/** Get all stored follow-up opportunities (Phase E reads this). */
export function getFollowUpOpportunities(): FollowUpOpportunity[] {
  return [..._followUpOpportunities]
}

/** Clear follow-up opportunities (e.g. after Phase E processes them). */
export function clearFollowUpOpportunities(): void {
  _followUpOpportunities = []
}

/**
 * Initialize SPARK's agentBus subscription.
 * Subscribe to 'data_updated' messages from CHRONO.
 * When CHRONO detects idle slots, SPARK stores them as follow_up_opportunities.
 * Called once on app startup (from App.tsx or layout).
 * Returns an unsubscribe function.
 */
export function initSparkBusListeners(): () => void {
  console.log('[SPARK] Initializing agentBus listener for CHRONO idle slots')

  const unsubscribe = agentBusSubscribe('SPARK', (msg: AgentMessage) => {
    // Only handle 'data_updated' messages from CHRONO
    if (msg.from !== 'CHRONO' || msg.type !== 'data_updated') return

    const payload = msg.payload as any

    if (payload?.event === 'idle_slots_detected' && Array.isArray(payload?.idleSlots)) {
      const opportunities: FollowUpOpportunity[] = payload.idleSlots.map((slot: any) => ({
        date:        slot.date || slot.startDate || 'unknown',
        idleHours:   typeof slot.idleHours === 'number' ? slot.idleHours : 0,
        suggestions: Array.isArray(payload.suggestions) ? payload.suggestions : [],
        receivedAt:  payload.detectedAt || new Date().toISOString(),
        source:      'CHRONO' as const,
      }))

      // Merge new opportunities (dedupe by date)
      for (const opp of opportunities) {
        const exists = _followUpOpportunities.some(o => o.date === opp.date)
        if (!exists) {
          _followUpOpportunities.push(opp)
        }
      }

      // Keep most recent 90 days of opportunities
      _followUpOpportunities = _followUpOpportunities
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(-90)

      console.log(
        `[SPARK] Stored ${opportunities.length} follow-up opportunity(ies) from CHRONO idle slots. ` +
        `Total stored: ${_followUpOpportunities.length}`
      )
    }
  })

  return unsubscribe
}

// ── Claude summary generator ──────────────────────────────────────────────────

// Claude summary generator
async function generateSparkSummary(topic: string, data: unknown): Promise<string> {
  try {
    const ANTHROPIC_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY as string

    const response = await fetch('/api/anthropic/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        system: SPARK_SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: `Summarize this ${topic} data in 2-3 sentences. Be concise, data-driven, and actionable:\n\n${JSON.stringify(data, null, 2)}`,
        }],
      }),
    })

    if (!response.ok) throw new Error(`Claude API error: ${response.statusText}`)

    const result = (await response.json()) as { content?: Array<{ type: string; text: string }> }
    return result.content?.find(c => c.type === 'text')?.text ?? ''
  } catch (error) {
    console.error('[SPARK] generateSparkSummary error:', error)
    return 'Summary generation unavailable.'
  }
}

// ── Live Call Engine (SparkLiveCall view integration) ─────────────────────────
// These functions are used by views/SparkLiveCall.tsx for guided call scripts.
// Stubs — replace with real call engine logic during Phase E7 integration.

export type CallType = 'vendor' | 'sub' | 'gc'

export interface CallOption {
  id: string
  label: string
  nextStageId?: string
}

export interface CallStage {
  id: string
  prompt: string
  options: CallOption[]
  isEscalationPoint?: boolean
  isOutcome?: boolean
}

export interface CallSession {
  id: string
  callType: CallType
  currentStageId: string
  history: Array<{ stageId: string; optionId: string; timestamp: string }>
  startedAt: string
  endedAt?: string
  outcome?: string
}

const DEFAULT_SCRIPTS: Record<CallType, CallStage[]> = {
  vendor: [
    { id: 'v1', prompt: 'Introduce yourself and confirm vendor contact.', options: [{ id: 'v1a', label: 'Contact confirmed', nextStageId: 'v2' }, { id: 'v1b', label: 'No answer — leave message', nextStageId: 'v_end' }] },
    { id: 'v2', prompt: 'Check on open purchase order status.', options: [{ id: 'v2a', label: 'PO confirmed, ETA received', nextStageId: 'v_end' }, { id: 'v2b', label: 'Delay — escalate', nextStageId: 'v_esc', isEscalationPoint: true }] },
    { id: 'v_esc', prompt: 'Escalation: document delay and notify project manager.', options: [{ id: 'v_esc_ok', label: 'Documented and notified', nextStageId: 'v_end' }], isEscalationPoint: true },
    { id: 'v_end', prompt: 'Call complete. Log outcome.', options: [], isOutcome: true },
  ],
  sub: [
    { id: 's1', prompt: 'Confirm sub is on schedule for their scope.', options: [{ id: 's1a', label: 'On schedule', nextStageId: 's_end' }, { id: 's1b', label: 'Behind — escalate', nextStageId: 's_esc', isEscalationPoint: true }] },
    { id: 's_esc', prompt: 'Escalation: document delay.', options: [{ id: 's_esc_ok', label: 'Documented', nextStageId: 's_end' }], isEscalationPoint: true },
    { id: 's_end', prompt: 'Call complete. Log outcome.', options: [], isOutcome: true },
  ],
  gc: [
    { id: 'g1', prompt: 'Check in on project status and upcoming scope windows.', options: [{ id: 'g1a', label: 'Status confirmed — next window set', nextStageId: 'g_end' }, { id: 'g1b', label: 'Issue flagged — escalate', nextStageId: 'g_esc', isEscalationPoint: true }] },
    { id: 'g_esc', prompt: 'Escalation: document GC issue.', options: [{ id: 'g_esc_ok', label: 'Documented', nextStageId: 'g_end' }], isEscalationPoint: true },
    { id: 'g_end', prompt: 'Call complete. Log outcome.', options: [], isOutcome: true },
  ],
}

/** Load the call script for the given call type. */
export function loadScript(callType: CallType): CallStage[] {
  return DEFAULT_SCRIPTS[callType] ?? DEFAULT_SCRIPTS.vendor
}

/** Advance the session to the next stage based on the chosen option. */
export function advance(session: CallSession, optionId: string): { nextStage: CallStage | null; updatedSession: CallSession } {
  const script = loadScript(session.callType)
  const currentStage = script.find(s => s.id === session.currentStageId)
  const option = currentStage?.options.find(o => o.id === optionId)

  const updatedHistory = [
    ...session.history,
    { stageId: session.currentStageId, optionId, timestamp: new Date().toISOString() },
  ]

  if (!option?.nextStageId) {
    return {
      nextStage: null,
      updatedSession: { ...session, history: updatedHistory, endedAt: new Date().toISOString() },
    }
  }

  const nextStage = script.find(s => s.id === option.nextStageId) ?? null
  return {
    nextStage,
    updatedSession: {
      ...session,
      currentStageId: option.nextStageId,
      history: updatedHistory,
    },
  }
}

/** Detect if the current session has hit an escalation point. */
export function detectEscalation(session: CallSession): boolean {
  const script = loadScript(session.callType)
  const currentStage = script.find(s => s.id === session.currentStageId)
  if (currentStage?.isEscalationPoint) return true
  return session.history.some(h => {
    const stage = script.find(s => s.id === h.stageId)
    return stage?.isEscalationPoint === true
  })
}

/** Generate a short text summary of the completed call session. */
export function getOutcomeSummary(session: CallSession): string {
  if (!session) return 'No session data.'
  const steps = session.history.length
  const escalated = detectEscalation(session)
  const duration = session.endedAt
    ? Math.round((new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()) / 1000)
    : null
  return [
    `Call type: ${session.callType?.toUpperCase() ?? 'Unknown'}`,
    `Steps completed: ${steps}`,
    escalated ? '⚠ Escalation flagged during call' : '✓ No escalation',
    duration != null ? `Duration: ${Math.floor(duration / 60)}m ${duration % 60}s` : '',
  ].filter(Boolean).join('\n')
}
