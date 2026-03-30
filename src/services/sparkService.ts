// @ts-nocheck
/**
 * SPARK Service — Phase E Full Automation
 *
 * Unified service layer for SPARK's Google Business, lead management,
 * and email campaign automation. All customer-facing actions (review responses,
 * campaign sends) route through MiroFish before execution.
 *
 * Functions:
 *   getReviews()                   — Fetch recent Google Business reviews
 *   draftReviewResponse(text)      — AI-draft a review response (persona: electrical contractor)
 *   postReviewResponse(id, text)   — Post approved response via Netlify function
 *   createLead(data)               — Insert new lead to Supabase
 *   getLeads(status?)              — Fetch leads, optionally filtered by status
 *   scheduleFollowUp(id, date)     — Update follow_up_date on a lead
 *   createCampaign(sub, body, seg) — Insert email_campaign draft to Supabase
 *   sendCampaign(campaignId)       — Execute send via Netlify sendEmail function
 */

import { supabase } from '@/lib/supabase'
import { callClaude, extractText } from './claudeProxy'
import { publish } from './agentEventBus'

// ── Types ────────────────────────────────────────────────────────────────────

export interface SparkReview {
  reviewId:     string
  locationName?: string
  reviewer: {
    displayName: string
    profilePhotoUrl?: string | null
  }
  starRating: number
  comment:    string
  createTime: string
  updateTime: string
  reviewReply?: { comment: string; updateTime: string } | null
}

export type LeadStatus = 'new' | 'contacted' | 'quoted' | 'won' | 'lost'
export type LeadSource = 'google' | 'website' | 'referral' | 'manual' | 'ad'

export interface SparkLead {
  id?:               string
  user_id?:          string
  name:              string
  phone?:            string
  email?:            string
  source:            LeadSource
  service_requested?: string
  status:            LeadStatus
  follow_up_date?:   string | null
  notes?:            string
  created_at?:       string
}

export interface SparkCampaign {
  id?:               string
  user_id?:          string
  subject:           string
  body:              string
  recipient_segment?: string
  status:            'draft' | 'scheduled' | 'sent' | 'cancelled'
  scheduled_at?:     string | null
  sent_at?:          string | null
  open_count?:       number
  click_count?:      number
  created_at?:       string
}

// ── Claude persona for review responses ─────────────────────────────────────

const REVIEW_RESPONSE_SYSTEM = `You are drafting a warm, professional response for Power On Solutions LLC — a C-10 licensed electrical contractor in the Coachella Valley, CA (Desert Hot Springs area). The business owner is Christian.

Rules:
- Max 3 sentences
- Reference specific details from the review if available (type of work, location)
- Tone: friendly, grateful, professional
- Do NOT make up details not in the review
- End with: "— The Power On Solutions Team"
- Do NOT include a subject line or greeting — only the response body`

// ── Reviews ──────────────────────────────────────────────────────────────────

/**
 * Fetch the last 10 Google Business reviews via the Netlify proxy.
 * Falls back to empty array on error.
 */
export async function getReviews(): Promise<SparkReview[]> {
  try {
    const res = await fetch('/.netlify/functions/googleBusiness?action=reviews')
    if (!res.ok) throw new Error(`googleBusiness function returned ${res.status}`)
    const data = await res.json()
    if (!data.success) throw new Error(data.error || 'reviews fetch failed')
    const reviews: SparkReview[] = (data.reviews || []).slice(0, 10)

    // Publish NEXUS alert for any unanswered low-rated reviews
    reviews.forEach(r => {
      if (r.starRating <= 3 && !r.reviewReply) {
        publish(
          'REVIEW_RECEIVED' as any,
          'spark',
          { reviewId: r.reviewId, rating: r.starRating, reviewer: r.reviewer.displayName },
          `⚠️ ${r.starRating}-star review from ${r.reviewer.displayName} — no response yet`
        )
      }
    })

    return reviews
  } catch (err) {
    console.error('[SparkService] getReviews error:', err)
    return []
  }
}

/**
 * Draft an AI response for a review using the electrical contractor persona.
 * Does NOT post — result should be submitted to MiroFish for approval.
 */
export async function draftReviewResponse(reviewText: string): Promise<string> {
  try {
    const result = await callClaude({
      system: REVIEW_RESPONSE_SYSTEM,
      messages: [{
        role: 'user',
        content: `The customer left this review:\n\n"${reviewText}"\n\nWrite a professional response.`,
      }],
      max_tokens: 300,
    })
    return extractText(result)
  } catch (err) {
    console.error('[SparkService] draftReviewResponse error:', err)
    return ''
  }
}

/**
 * Post an approved review response via the Netlify proxy.
 * Call ONLY after MiroFish approval is confirmed.
 */
export async function postReviewResponse(
  reviewId: string,
  text: string,
  locationName?: string
): Promise<boolean> {
  try {
    const res = await fetch('/.netlify/functions/googleBusiness', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action:       'respond',
        reviewId,
        responseText: text,
        locationName: locationName || '',
      }),
    })
    if (!res.ok) throw new Error(`Post response failed: ${res.status}`)
    const data = await res.json()
    return data.success === true
  } catch (err) {
    console.error('[SparkService] postReviewResponse error:', err)
    return false
  }
}

// ── Leads ────────────────────────────────────────────────────────────────────

/**
 * Insert a new lead into the Supabase `leads` table.
 */
export async function createLead(data: Partial<SparkLead>): Promise<SparkLead | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    const userId = user?.id

    const { data: inserted, error } = await supabase
      .from('leads')
      .insert({
        user_id:           userId || null,
        name:              data.name || 'Unknown',
        phone:             data.phone || null,
        email:             data.email || null,
        source:            data.source || 'manual',
        service_requested: data.service_requested || null,
        status:            data.status || 'new',
        follow_up_date:    data.follow_up_date || null,
        notes:             data.notes || null,
      })
      .select('*')
      .single()

    if (error) throw error

    // Publish lead event for PULSE KPI tracking
    publish(
      'HIGH_VALUE_LEAD' as any,
      'spark',
      {
        leadId:  (inserted as any).id,
        name:    data.name,
        source:  data.source,
        service: data.service_requested,
        status:  'new',
      },
      `New lead captured: ${data.name} (${data.source || 'manual'})`
    )

    return inserted as SparkLead
  } catch (err) {
    console.error('[SparkService] createLead error:', err)
    return null
  }
}

/**
 * Fetch leads from Supabase, optionally filtered by status.
 */
export async function getLeads(status?: LeadStatus): Promise<SparkLead[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []

    let query = supabase
      .from('leads')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (status) {
      query = query.eq('status', status)
    }

    const { data, error } = await query
    if (error) throw error
    return (data || []) as SparkLead[]
  } catch (err) {
    console.error('[SparkService] getLeads error:', err)
    return []
  }
}

/**
 * Update the follow_up_date on a lead.
 */
export async function scheduleFollowUp(leadId: string, date: Date): Promise<SparkLead | null> {
  try {
    const followUpDate = date.toISOString().split('T')[0] // YYYY-MM-DD

    const { data, error } = await supabase
      .from('leads')
      .update({ follow_up_date: followUpDate })
      .eq('id', leadId)
      .select('*')
      .single()

    if (error) throw error
    return data as SparkLead
  } catch (err) {
    console.error('[SparkService] scheduleFollowUp error:', err)
    return null
  }
}

/**
 * Update the status of a lead. Publishes to PULSE on won/lost.
 */
export async function updateLeadStatus(leadId: string, status: LeadStatus): Promise<SparkLead | null> {
  try {
    const { data, error } = await supabase
      .from('leads')
      .update({ status })
      .eq('id', leadId)
      .select('*')
      .single()

    if (error) throw error
    const updated = data as SparkLead

    // Publish KPI events for PULSE
    if (status === 'won' || status === 'lost') {
      publish(
        'LEAD_CONVERTED' as any,
        'spark',
        {
          leadId:  leadId,
          status:  status,
          outcome: status === 'won' ? 'converted' : 'lost',
          name:    updated.name,
        },
        `Lead "${updated.name}" marked as ${status}`
      )
    }

    return updated
  } catch (err) {
    console.error('[SparkService] updateLeadStatus error:', err)
    return null
  }
}

// ── Email Campaigns ──────────────────────────────────────────────────────────

/**
 * Insert a new email campaign draft into Supabase.
 */
export async function createCampaign(
  subject: string,
  body: string,
  segment?: string
): Promise<SparkCampaign | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    const userId = user?.id

    const { data, error } = await supabase
      .from('email_campaigns')
      .insert({
        user_id:           userId || null,
        subject,
        body,
        recipient_segment: segment || null,
        status:            'draft',
        open_count:        0,
        click_count:       0,
      })
      .select('*')
      .single()

    if (error) throw error
    return data as SparkCampaign
  } catch (err) {
    console.error('[SparkService] createCampaign error:', err)
    return null
  }
}

/**
 * Send an email campaign via the Netlify sendEmail function.
 * Fetches campaign from Supabase, sends, updates status to 'sent'.
 * Caller MUST ensure MiroFish approval before calling this.
 */
export async function sendCampaign(campaignId: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    // Fetch the campaign
    const { data: campaign, error: fetchErr } = await supabase
      .from('email_campaigns')
      .select('*')
      .eq('id', campaignId)
      .single()

    if (fetchErr || !campaign) {
      return { success: false, error: 'Campaign not found' }
    }

    if (campaign.status === 'sent') {
      return { success: false, error: 'Campaign already sent' }
    }

    // Determine recipients
    const toAddress = campaign.recipient_segment || 'team@poweronsolutions.com'

    // Call Netlify sendEmail function
    const res = await fetch('/.netlify/functions/sendEmail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to:      toAddress,
        subject: campaign.subject,
        body:    campaign.body,
      }),
    })

    const result = await res.json()

    if (!result.success) {
      return { success: false, error: result.error || 'Send failed' }
    }

    // Mark campaign as sent in Supabase
    await supabase
      .from('email_campaigns')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', campaignId)

    // Publish PULSE event
    publish(
      'CAMPAIGN_RESULT' as any,
      'spark',
      {
        campaignId,
        subject:    campaign.subject,
        segment:    campaign.recipient_segment,
        messageId:  result.messageId,
        sentAt:     new Date().toISOString(),
      },
      `Email campaign sent: "${campaign.subject}"`
    )

    return { success: true, messageId: result.messageId }
  } catch (err: any) {
    console.error('[SparkService] sendCampaign error:', err)
    return { success: false, error: err.message || 'Unknown error' }
  }
}
