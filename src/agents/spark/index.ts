// @ts-nocheck
/**
 * SPARK Orchestrator — Marketing & Sales intelligence for PowerOn Hub
 *
 * Actions:
 * - get_pipeline: Lead pipeline summary by status
 * - get_leads: List leads with optional filters
 * - create_lead: Create a new lead
 * - update_lead_status: Transition a lead's status
 * - get_gc_contacts: List GC contacts with relationship scores
 * - update_gc_scores: Recalculate GC relationship scores
 * - log_gc_activity: Log an activity for a GC contact
 * - get_campaigns: List campaigns
 * - create_campaign: Create a new campaign
 * - get_campaign_roi: Calculate campaign ROI
 * - get_reviews: List reviews
 * - draft_review_response: Generate AI draft response
 * - get_review_summary: Review analytics summary
 */

import { SPARK_SYSTEM_PROMPT } from './systemPrompt'
import { createLead, updateLeadStatus, getLeads, getLeadPipelineSummary } from './leadManager'
import { getGCContacts, updateGCScores, logGCActivity } from './gcManager'
import { getCampaigns, createCampaign, calculateCampaignROI } from './campaignManager'
import { getReviews, draftReviewResponse, getReviewSummary } from './reviewManager'
import { logAudit } from '@/lib/memory/audit'

// Types
export type SparkAction =
  | 'get_pipeline' | 'get_leads' | 'create_lead' | 'update_lead_status'
  | 'get_gc_contacts' | 'update_gc_scores' | 'log_gc_activity'
  | 'get_campaigns' | 'create_campaign' | 'get_campaign_roi'
  | 'get_reviews' | 'draft_review_response' | 'get_review_summary'

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

      case 'get_reviews':
        data = await getReviews(request.orgId, request.params as any)
        summary = `Found ${(data as any[]).length} reviews`
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
